import type { LLMClient, LLMTaskOptions } from '../../src/ai/types.js';

/**
 * 测试用 LLM 桩：立即返回合法 JSON，行为可预期。
 * 只用于验证引擎/接口的流程与不变量 —— 绝不用于验证"AI 说了什么"。
 */
export interface MockLLM extends LLMClient {
  callCount: number;
}

export interface MockOptions {
  /** 女巫每局都救人（用来覆盖「被救则不死」这条不变量） */
  witchSave?: boolean;
  /** 女巫每局都下毒，毒第一个候选人（用来覆盖死因标注） */
  witchPoison?: boolean;
}

export function createMockLLM(options: MockOptions = {}): MockLLM {
  const mock: MockLLM = {
    callCount: 0,
    label: () => 'mock',
    async task(system: string, user: string, _options?: LLMTaskOptions): Promise<Record<string, unknown>> {
      mock.callCount += 1;
      const text = `${system}\n${user}`;

      /* 顺序要紧：女巫的 system 里也可能出现「狼人杀」字样，先判女巫免得被狼人分支吃掉 */
      if (/女巫/.test(system)) {
        if (options.witchSave) return { save: true, poison: '', reason: 'mock-save' };
        if (options.witchPoison) {
          /* 毒药要填玩家名字，从 prompt 列出的候选人里取第一个 */
          const listed = user.match(/可以毒死场上任意一人：(.+?)。/)?.[1];
          const name = listed?.split('、')[0]?.trim() ?? '';
          return { save: false, poison: name, reason: 'mock-poison' };
        }
        return { save: false, poison: '', reason: 'mock' };
      }
      if (/狼人.*杀|要杀/.test(text)) return { target: 'TARGET', reason: 'mock' };
      if (/预言家.*查验|要查验/.test(text)) return { target: 'TARGET', reason: 'mock' };
      if (/白天发言/.test(system)) return { speech: '我是好人，先听后面的。', vote: 'TARGET', reason: 'mock' };
      if (/投票放逐|现在投票/.test(text)) return { vote: 'TARGET', reason: 'mock' };
      if (/遗言/.test(system)) return { text: '留个遗言。', reason: 'mock' };
      return { ok: true };
    },
  };
  return mock;
}
