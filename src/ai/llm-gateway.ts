/**
 * LLM 网关：服务端调用 WorkBuddy 云服务大模型（免密钥）。
 * 职责：模型选择、流式收集（含 reasoning_content）、JSON 提取、错误归一。
 * 失败一律抛错并标记 llmFailure —— 引擎据此中止对局，绝不用假话术兜底。
 */
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk';
import type { PublicLLMModel, WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk';
import { extractJSON } from './json.js';
import { extractSpeechSoFar } from './speech-stream.js';
import type { LLMClient, LLMTaskOptions } from './types.js';
import type { ModelInfo } from '../shared/types.js';

const REQUEST_TIMEOUT_MS = 45_000;

/** 首选模型：速度快、消耗低（一局 20+ 次调用） */
export const PREFER_IDS = ['glm-5.3-flash', 'deepseek-v4.1-flash', 'hy3', 'auto'];

export interface CloudConfig {
  endpoint: string;
  publishableKey: string;
  oauthRelayBaseUrl?: string;
}

interface ChatDelta {
  content?: string | null;
  reasoning_content?: string | null;
}

interface ChatChunk {
  choices?: { delta?: ChatDelta | null }[];
}

export interface TaskFailure extends Error {
  llmFailure: true;
  raw?: string;
}

export class LLMGateway implements LLMClient {
  readonly cloud: WorkBuddyCloudClient;
  models: PublicLLMModel[] = [];
  model: PublicLLMModel | null = null;
  callCount = 0;

  constructor(config: CloudConfig) {
    this.cloud = createWorkBuddyCloud({
      endpoint: config.endpoint,
      publishableKey: config.publishableKey,
      ...(config.oauthRelayBaseUrl ? { oauthRelayBaseUrl: config.oauthRelayBaseUrl } : {}),
    });
  }

  /** 拉取可用模型并选定默认模型；失败抛错（不静默降级） */
  async init(): Promise<this> {
    const models = await this.cloud.llm.models.list();
    if (!models.length) throw new Error('云服务模型列表为空');
    this.models = models;
    const preferred = PREFER_IDS.map((id) => models.find((m) => m.id === id)).filter(
      (m): m is PublicLLMModel => Boolean(m),
    );
    this.model = preferred[0] ?? (models[0] as PublicLLMModel);
    return this;
  }

  /** 供接口暴露的模型清单（首选模型排前） */
  listModels(): ModelInfo[] {
    const preferSet = new Set(PREFER_IDS);
    const rank = (id: string): number => (preferSet.has(id) ? 0 : 1);
    return this.models
      .slice()
      .sort((a, b) => rank(a.id) - rank(b.id))
      .map((m) => ({ id: m.id, name: m.name || m.id, credits: m.credits ?? null }));
  }

  selectModel(id: string): PublicLLMModel {
    const found = this.models.find((m) => m.id === id);
    if (!found) throw new Error(`未知模型: ${id}`);
    this.model = found;
    return found;
  }

  label(): string {
    return this.model ? this.model.name || this.model.id : '';
  }

  /**
   * 流式收集一次补全：content 优先，思考型模型 reasoning_content 兜底。
   * `onChunk` 会在每个增量到达时回调「目前已收到的完整文本」，用于把发言做成流式。
   */
  async raw(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    {
      temperature = 0.9,
      timeoutMs = REQUEST_TIMEOUT_MS,
      onChunk,
    }: { temperature?: number; timeoutMs?: number; onChunk?: (soFar: string) => void } = {},
  ): Promise<string> {
    if (!this.model) throw new Error('模型尚未初始化');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let content = '';
    let reasoning = '';

    try {
      this.callCount++;
      const stream = this.cloud.llm.chat.completions.create({
        model: this.model.id,
        messages,
        stream: true,
        temperature,
        response_format: { type: 'json_object' },
        signal: controller.signal,
      }) as unknown as AsyncIterable<ChatChunk>;

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        let grew = false;
        if (delta?.content) {
          content += delta.content;
          grew = true;
        }
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        if (grew && onChunk) onChunk(content);
      }
    } finally {
      clearTimeout(timer);
    }

    if (!content.trim() && reasoning.trim()) content = reasoning;
    return content;
  }

  /**
   * 任务式调用：要求模型输出 JSON 并解析。
   * 失败抛带 llmFailure 标记的错误（含原因与原文片段）。
   */
  async task(system: string, user: string, options: LLMTaskOptions = {}): Promise<Record<string, unknown>> {
    return this.runTask(system, user, options);
  }

  /**
   * 流式任务：与 task 一样的重试与 JSON 解析，只是边收边把 speech 文本回调出去。
   * 只在「发言」这类需要逐字上屏的任务上用；决策类（刀谁/验谁）不需要。
   */
  async streamTask(
    system: string,
    user: string,
    options: LLMTaskOptions = {},
    onText: (text: string) => void,
  ): Promise<Record<string, unknown>> {
    return this.runTask(system, user, options, (soFar) => {
      const speech = extractSpeechSoFar(soFar);
      if (speech) onText(speech);
    });
  }

  private async runTask(
    system: string,
    user: string,
    options: LLMTaskOptions = {},
    onChunk?: (soFar: string) => void,
  ): Promise<Record<string, unknown>> {
    const { temperature = 0.9, retries = 1 } = options;
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];

    let lastError = '未知错误';
    let lastRaw = '';

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await this.raw(messages, { temperature, onChunk });
        lastRaw = raw;
        const parsed = extractJSON(raw);
        if (parsed) return parsed;
        lastError = '模型输出不是合法 JSON，原文前 80 字：' + String(raw || '').slice(0, 80);
      } catch (e) {
        const err = e as { name?: string; message?: string; error?: { code?: string; message?: string } };
        const code = err?.error?.code ?? '';
        lastError = code
          ? `${code} ${err.error?.message ?? ''}`
          : err?.name === 'AbortError'
            ? `请求超时(${REQUEST_TIMEOUT_MS / 1000}s)`
            : err?.message ?? String(e);
        if (code.startsWith('request_')) break; // 参数类错误重试无意义
      }
    }

    const failure = Object.assign(new Error(lastError), { llmFailure: true as const, raw: lastRaw });
    throw failure;
  }

  /** 通道自检：真实跑一次极小请求 */
  async selfTest(): Promise<{ ok: boolean; sec: string; model?: string; error?: string }> {
    const startedAt = Date.now();
    try {
      const obj = await this.task('You are a precise assistant. Reply with JSON only.', '请只输出 {"ok":true}', {
        temperature: 0.1,
        retries: 0,
      });
      const sec = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (obj.ok === true) return { ok: true, sec, model: this.label() };
      return { ok: false, sec, error: '返回未通过校验' };
    } catch (e) {
      return { ok: false, sec: ((Date.now() - startedAt) / 1000).toFixed(1), error: (e as Error).message };
    }
  }
}

/** 应用级单例的构造入口 */
export async function createLLMGateway(config: CloudConfig): Promise<LLMGateway> {
  const gateway = new LLMGateway(config);
  await gateway.init();
  return gateway;
}
