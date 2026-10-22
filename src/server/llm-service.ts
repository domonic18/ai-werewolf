import type { ModelInfo } from '../shared/types.js';
import type { LLMClient } from '../ai/types.js';

export type LLMState = 'initializing' | 'ready' | 'failed';

/**
 * 路由层需要的 LLM 能力。
 * `state` 让"AI 通道还没起来"成为一种可表达、可降级的状态，
 * 而不是把站点一起拖死（见 llm-runtime.ts 的启动顺序说明）。
 */
export interface LLMService extends LLMClient {
  readonly state: LLMState;
  models: unknown[];
  model: { id: string } | null;
  listModels(): ModelInfo[];
  selectModel(id: string): unknown;
  selfTest(): Promise<{ ok: boolean; sec: string; model?: string; error?: string }>;
}
