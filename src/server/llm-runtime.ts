/**
 * LLM 运行时：把「初始化」从「启动」里摘出来。
 *
 * 背景（2026-10-22 线上 504 事故）：原实现是 main() 里先 await createLLMGateway()，
 * 成功后才 server.listen()。而 LLM 请求打的是本应用自己的公网域名——沙箱冷启动时
 * 该域名/代理尚未就绪，初始化必然失败，进程直接退出，端口从未监听，平台报
 * `service on port 3000 not ready after 30000ms`。这是一次自举死锁：
 * 「要先能访问自己，才能对外提供服务」。
 *
 * 现在的顺序：先 listen（静态页立刻可用）→ 后台初始化 LLM（失败退避重试）→
 * 就绪前 /api/games 返回 503、/api/health 上报 initializing，其余接口照常。
 */
import { createLLMGateway } from '../ai/llm-gateway.js';
import type { CloudConfig, LLMGateway } from '../ai/llm-gateway.js';
import type { LLMTaskOptions } from '../ai/types.js';
import type { ModelInfo } from '../shared/types.js';
import type { LLMService, LLMState } from './llm-service.js';

const DEFAULT_RETRY_DELAYS_MS = [0, 2_000, 5_000, 10_000, 20_000, 30_000];
const LONG_RETRY_MS = 60_000;
const SELF_TEST_TTL_MS = 20_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface LLMRuntimeOptions {
  /** 覆盖重试间隔（测试用），默认 [0s,2s,5s,10s,20s,30s] */
  retryDelaysMs?: number[];
  /** 长重试间隔，默认 60s */
  longRetryMs?: number;
}

export class LLMRuntime implements LLMService {
  state: LLMState = 'initializing';

  private gateway: LLMGateway | null = null;
  private lastError: string | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private selfTestCache: { at: number; value: Awaited<ReturnType<LLMGateway['selfTest']>> } | null = null;

  private readonly config: CloudConfig;
  private readonly retryDelaysMs: number[];
  private readonly longRetryMs: number;

  constructor(config: CloudConfig, options: LLMRuntimeOptions = {}) {
    this.config = config;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.longRetryMs = options.longRetryMs ?? LONG_RETRY_MS;
  }

  /* ---------- 状态读取 ---------- */

  get models(): unknown[] {
    return this.gateway?.models ?? [];
  }

  get model(): { id: string } | null {
    return this.gateway?.model ?? null;
  }

  get callCount(): number {
    return this.gateway?.callCount ?? 0;
  }

  get cloud(): LLMGateway['cloud'] | null {
    return this.gateway?.cloud ?? null;
  }

  label(): string {
    return this.gateway?.label() ?? '';
  }

  listModels(): ModelInfo[] {
    return this.gateway?.listModels() ?? [];
  }

  selectModel(id: string): unknown {
    if (!this.gateway) throw new Error('AI 通道尚未就绪');
    return this.gateway.selectModel(id);
  }

  async task(system: string, user: string, options?: LLMTaskOptions): Promise<Record<string, unknown>> {
    if (!this.gateway) {
      throw Object.assign(new Error(`AI 通道尚未就绪：${this.lastError ?? '正在初始化'}`), { llmFailure: true });
    }
    return this.gateway.task(system, user, options);
  }

  /** 健康检查：结果缓存 20s，避免首页每次刷新都真实消耗一次补全 */
  async selfTest(): Promise<{ ok: boolean; sec: string; model?: string; error?: string }> {
    if (!this.gateway) {
      return { ok: false, sec: '0.0', error: this.lastError ?? 'AI 通道启动中' };
    }
    if (this.selfTestCache && Date.now() - this.selfTestCache.at < SELF_TEST_TTL_MS) {
      return this.selfTestCache.value;
    }
    const value = await this.gateway.selfTest();
    this.selfTestCache = { at: Date.now(), value };
    return value;
  }

  /* ---------- 后台引导 ---------- */

  /** 不阻塞启动：调用方 listen 之后再执行 */
  async bootstrap(): Promise<void> {
    for (const delay of this.retryDelaysMs) {
      if (delay > 0) await sleep(delay);
      if (await this.tryInit()) return;
    }
    this.state = 'failed';
    this.scheduleLongRetry();
  }

  private async tryInit(): Promise<boolean> {
    try {
      this.gateway = await createLLMGateway(this.config);
      this.state = 'ready';
      this.lastError = null;
      this.selfTestCache = null;
      console.log(`[werewolf-ai] LLM 就绪: ${this.gateway.label()}（${this.gateway.models.length} 个模型）`);
      return true;
    } catch (e) {
      this.lastError = (e as Error).message;
      console.warn(`[werewolf-ai] LLM 初始化失败，稍后重试: ${this.lastError}`);
      return false;
    }
  }

  /** 首轮重试都失败后，按长间隔继续尝试（站点保持可用） */
  private scheduleLongRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      this.state = 'initializing';
      if (!(await this.tryInit())) {
        this.state = 'failed';
        this.scheduleLongRetry();
      }
    }, this.longRetryMs);
    this.retryTimer.unref?.();
  }

  /** 进程退出时清理定时器（测试用） */
  dispose(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
