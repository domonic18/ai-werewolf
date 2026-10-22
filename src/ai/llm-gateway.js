/**
 * LLM 网关：服务端调用 WorkBuddy 云服务大模型（免密钥）。
 * Node 环境已实测可用（models.list / chat.completions 均 OK）。
 * 职责：模型选择、流式收集（含 reasoning_content）、JSON 提取、错误归一。
 */
const { createWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk');
const { extractJSON } = require('./json');

const REQUEST_TIMEOUT_MS = 45000;
/** 首选模型：速度快、消耗低（一局 20+ 次调用） */
const PREFER_IDS = ['glm-5.3-flash', 'deepseek-v4.1-flash', 'hy3', 'auto'];

class LLMGateway {
  constructor({ endpoint, publishableKey, oauthRelayBaseUrl }) {
    this.cloud = createWorkBuddyCloud({ endpoint, publishableKey, oauthRelayBaseUrl });
    this.models = [];
    this.model = null;
    this.callCount = 0;
  }

  /** 拉取可用模型并选定默认模型；失败抛错（fail-fast，不静默降级） */
  async init() {
    const models = await this.cloud.llm.models.list();
    const usable = (models || []).filter(m => m && m.disabled !== true && m.enabled !== false);
    if (!usable.length) throw new Error('云服务模型列表为空');
    this.models = usable;
    const prefer = PREFER_IDS.map(id => usable.find(m => m.id === id)).filter(Boolean);
    this.model = prefer[0] || usable[0];
    return this;
  }

  /** 供接口暴露的模型清单 */
  listModels() {
    const preferSet = new Set(PREFER_IDS);
    return this.models
      .slice()
      .sort((a, b) => (preferSet.has(a.id) ? 0 : 1) - (preferSet.has(b.id) ? 0 : 1))
      .map(m => ({ id: m.id, name: m.name || m.id, credits: m.credits || null }));
  }

  selectModel(id) {
    const m = this.models.find(x => x.id === id);
    if (!m) throw new Error(`未知模型: ${id}`);
    this.model = m;
    return m;
  }

  label() {
    return this.model ? (this.model.name || this.model.id) : '';
  }

  /** 流式收集一次补全：content 优先，思考型模型 reasoning_content 兜底 */
  async raw(messages, { temperature = 0.9, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let content = '';
    let reasoning = '';
    try {
      this.callCount++;
      for await (const chunk of this.cloud.llm.chat.completions.create({
        model: this.model.id,
        messages,
        stream: true,
        temperature,
        response_format: { type: 'json_object' },
        signal: controller.signal
      })) {
        const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        if (d && d.content) content += d.content;
        if (d && d.reasoning_content) reasoning += d.reasoning_content;
      }
    } finally {
      clearTimeout(timer);
    }
    if (!content.trim() && reasoning.trim()) content = reasoning;
    return content;
  }

  /**
   * 任务式调用：要求模型输出 JSON 并解析。
   * @returns {Promise<object>} 解析后的对象；失败抛 LLMTaskError（含原因与原文片段）
   */
  async task(system, user, { temperature = 0.9, retries = 1 } = {}) {
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
    let lastErr = '未知错误';
    let lastRaw = '';
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await this.raw(messages, { temperature });
        lastRaw = raw;
        const obj = extractJSON(raw);
        if (obj) return obj;
        lastErr = '模型输出不是合法 JSON，原文前 80 字：' + String(raw || '').slice(0, 80);
      } catch (e) {
        const code = e && e.error && e.error.code ? e.error.code : '';
        lastErr = code
          ? `${code} ${e.error.message || ''}`
          : (e && e.name === 'AbortError' ? `请求超时(${REQUEST_TIMEOUT_MS / 1000}s)` : (e && e.message) || String(e));
        if (code && code.startsWith('request_')) break; // 参数类错误重试无意义
      }
    }
    throw Object.assign(new Error(lastErr), { llmFailure: true, raw: lastRaw });
  }

  /** 通道自检：真实跑一次极小请求 */
  async selfTest() {
    const t0 = Date.now();
    try {
      const obj = await this.task(
        'You are a precise assistant. Reply with JSON only.',
        '请只输出 {"ok":true}',
        { temperature: 0.1, retries: 0 }
      );
      const sec = ((Date.now() - t0) / 1000).toFixed(1);
      if (obj && obj.ok) return { ok: true, sec, model: this.label() };
      return { ok: false, sec, error: '返回未通过校验' };
    } catch (e) {
      return { ok: false, sec: ((Date.now() - t0) / 1000).toFixed(1), error: e.message };
    }
  }
}

/** 应用级单例的构造入口 */
async function createLLMGateway(publicConfig) {
  const gw = new LLMGateway(publicConfig);
  await gw.init();
  return gw;
}

module.exports = { LLMGateway, createLLMGateway, PREFER_IDS };
