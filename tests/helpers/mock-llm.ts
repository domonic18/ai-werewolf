import type { LLMClient, LLMTaskOptions } from '../../src/ai/types.js';

/**
 * 测试用 LLM 桩：立即返回合法 JSON，行为可预期。
 * 只用于验证引擎/接口的流程与不变量 —— 绝不用于验证"AI 说了什么"。
 */
export interface MockLLM extends LLMClient {
  callCount: number;
}

export function createMockLLM(): MockLLM {
  const mock: MockLLM = {
    callCount: 0,
    label: () => 'mock',
    async task(system: string, user: string, _options?: LLMTaskOptions): Promise<Record<string, unknown>> {
      mock.callCount += 1;
      const text = `${system}\n${user}`;

      if (/狼人.*杀|要杀/.test(text)) return { target: 'TARGET', reason: 'mock' };
      if (/预言家.*查验|要查验/.test(text)) return { target: 'TARGET', reason: 'mock' };
      if (/女巫/.test(system)) return { save: false, poison: '', reason: 'mock' };
      if (/白天发言/.test(system)) return { speech: '我是好人，先听后面的。', vote: 'TARGET', reason: 'mock' };
      if (/投票放逐|现在投票/.test(text)) return { vote: 'TARGET', reason: 'mock' };
      if (/遗言/.test(system)) return { text: '留个遗言。', reason: 'mock' };
      return { ok: true };
    },
  };
  return mock;
}
