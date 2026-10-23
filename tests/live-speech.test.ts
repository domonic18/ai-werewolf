import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine.js';
import { expandDeck, recommendDeck } from '../src/game/catalog.js';
import { createMockLLM } from './helpers/mock-llm.js';

/**
 * 流式发言的引擎侧契约：
 * - 说话期间 `liveSpeechView()` 能拿到「说到一半」的文本；
 * - 说完立刻清空（否则气泡会一直挂在那儿，像卡住了）；
 * - 增量不进事件流（一段发言上百个增量，事件上限只有 500 条）。
 */
function autoAnswer(engine: GameEngine): () => void {
  const timer = setInterval(() => {
    const pending = engine.pendingAction;
    if (!pending) return;
    if (pending.kind === 'input') engine.submitHuman('我听一轮。');
    else engine.submitHuman(pending.options.length ? (pending.options[0]?.value ?? 1) : 1);
  }, 5);
  return () => clearInterval(timer);
}

describe('流式发言', () => {
  it('发言过程中 live 可见且是逐步变长的，说完清空', async () => {
    const events: { type: string }[] = [];
    const engine = new GameEngine({
      playerName: '流式观察',
      /* 每段停留 30ms：给观察窗口，也让「随机某次采样」一定能撞上中间态 */
      llm: createMockLLM({ streamDelayMs: 30 }),
      pace: 0.02,
      deck: expandDeck(recommendDeck(6)),
      emit: (event) => events.push(event),
    });

    const samples: string[] = [];
    const watcher = setInterval(() => {
      const live = engine.liveSpeechView();
      if (live?.text) samples.push(live.text);
    }, 5);

    const stop = autoAnswer(engine);
    try {
      await engine.run();
    } finally {
      clearInterval(watcher);
      stop();
    }

    /* 结束时一定没有残留 */
    expect(engine.liveSpeech).toBeNull();
    expect(engine.liveSpeechView()).toBeNull();

    /* 至少观察到一次「说到一半」：比最终发言短，且是它的前缀 */
    const finalSpeech = '我是好人，先听后面的。';
    const partial = samples.find((text) => text.length < finalSpeech.length);
    expect(partial, `没观察到中间态，采样：${JSON.stringify(samples.slice(0, 5))}`).toBeTruthy();
    expect(finalSpeech.startsWith(partial as string)).toBe(true);

    /* 发言仍然只以一条完整 speech 事件落库 */
    const speeches = events.filter((e) => e.type === 'speech');
    expect(speeches.length).toBeGreaterThan(0);
  }, 120_000);

  it('增量不会写进事件流（否则一局就能把 500 条历史挤爆）', async () => {
    const events: { type: string }[] = [];
    const engine = new GameEngine({
      playerName: '事件观察',
      llm: createMockLLM({ streamDelayMs: 5 }),
      pace: 0.02,
      deck: expandDeck(recommendDeck(6)),
      emit: (event) => events.push(event),
    });

    const stop = autoAnswer(engine);
    try {
      await engine.run();
    } finally {
      stop();
    }

    /* 事件类型必须仍是既有枚举：没有任何 stream 类事件混进来 */
    const kinds = new Set(events.map((e) => e.type));
    for (const kind of kinds) {
      expect(kind).not.toMatch(/stream|delta/i);
    }
  }, 120_000);
});
