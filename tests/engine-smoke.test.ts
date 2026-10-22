import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine.js';
import type { GameEvent } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';

/** 自动应答真人输入：一律选第一个选项 / 固定发言 */
function autoAnswer(engine: GameEngine): () => void {
  const timer = setInterval(() => {
    const pending = engine.pendingAction;
    if (!pending) return;
    if (pending.kind === 'input') engine.submitHuman('我听一轮。');
    else if (pending.kind === 'ack') engine.submitHuman(1);
    else engine.submitHuman(pending.options.length ? (pending.options[0]?.value ?? 1) : 1);
  }, 5);
  return () => clearInterval(timer);
}

async function runOnce(index: number): Promise<{ engine: GameEngine; events: GameEvent[] }> {
  const events: GameEvent[] = [];
  const engine = new GameEngine({
    playerName: `测试${index}`,
    llm: createMockLLM(),
    pace: 0.02,
    emit: (event) => events.push(event),
  });

  const stop = autoAnswer(engine);
  try {
    await engine.run();
  } finally {
    stop();
  }
  return { engine, events };
}

describe('对局引擎冒烟（Mock LLM，10 局）', () => {
  it('每局都能走到胜负判定，且事件流结构完整', async () => {
    const results: { good: number; wolf: number; rounds: number[] } = { good: 0, wolf: 0, rounds: [] };

    for (let i = 0; i < 10; i++) {
      const { engine, events } = await runOnce(i);

      expect(engine.aborted, `第 ${i} 局不应中止`).toBeNull();
      expect(['good', 'wolf']).toContain(engine.winner);
      engine.winner === 'good' ? results.good++ : results.wolf++;
      results.rounds.push(engine.round);

      expect(events.some((e) => e.type === 'game-start')).toBe(true);
      expect(events.some((e) => e.type === 'speech')).toBe(true);
      expect(events.some((e) => e.type === 'vote-result')).toBe(true);
      expect(events.some((e) => e.type === 'game-over')).toBe(true);

      /* 真人有身份；观战视角没有 */
      expect(engine.snapshot(engine.human.id).myRole).toBeTruthy();
      const spectator = engine.snapshot(-1);
      expect(spectator.myRole).toBeNull();
      expect(spectator.pendingAction).toBeNull();
    }

    expect(results.good + results.wolf).toBe(10);
    expect(results.rounds.every((r) => r >= 1)).toBe(true);
  }, 120_000);

  it('事件序号严格递增，且发言事件带天数', async () => {
    const { events } = await runOnce(99);
    for (let i = 1; i < events.length; i++) {
      expect((events[i] as GameEvent).seq).toBe((events[i - 1] as GameEvent).seq + 1);
    }
    const speeches = events.filter((e): e is Extract<GameEvent, { type: 'speech' }> => e.type === 'speech');
    expect(speeches.length).toBeGreaterThan(0);
    for (const speech of speeches) expect(speech.payload.round).toBeGreaterThan(0);
  }, 120_000);

  it('夜晚事件不泄露身份：法官口令不含任何玩家名', async () => {
    const { engine, events } = await runOnce(7);
    const names = engine.players.map((p) => p.name);

    const nightEvents = events.filter(
      (e) => e.type === 'night-cue' || (e.type === 'log' && e.payload.tone === 'night'),
    );
    expect(nightEvents.length).toBeGreaterThan(0);

    for (const event of nightEvents) {
      const text = event.type === 'night-cue' ? event.payload.text : (event.payload as { text: string }).text;
      for (const name of names) {
        expect(text.includes(name), `夜晚口令不应包含玩家名「${name}」：${text}`).toBe(false);
      }
    }
  }, 120_000);
});

describe('复盘时间轴', () => {
  it('每局都留下与轮次一致的记录，且玩家视角不含死因与用药', async () => {
    const { engine } = await runOnce(42);
    const records = engine.timeline;

    expect(records.length).toBeGreaterThan(0);
    /* 结束时的轮次应等于最后一条记录（中途不跳号） */
    expect(records.at(-1)?.round).toBe(engine.round);
    expect(records.map((r) => r.round)).toEqual([...records.map((r) => r.round)].sort((a, b) => a - b));

    /* 上帝视角：字段齐全 */
    for (const rec of records) {
      expect(Array.isArray(rec.deaths)).toBe(true);
      expect(typeof rec.saved).toBe('boolean');
      expect(typeof rec.tie).toBe('boolean');
    }

    /* 玩家视角：只有公开信息 */
    const review = engine.snapshot(engine.human.id).review;
    expect(review).toHaveLength(records.length);
    for (const item of review) {
      expect(Object.keys(item).sort()).toEqual(['deadNames', 'exiled', 'round', 'tie']);
      expect(JSON.stringify(item)).not.toContain('saved');
      expect(JSON.stringify(item)).not.toContain('cause');
    }
  }, 120_000);

  it('观战投影带全量时间轴与阵营统计', async () => {
    const { engine } = await runOnce(43);
    const view = engine.spectateSnapshot();
    expect(view.timeline).toHaveLength(engine.timeline.length);
    expect(view.timeline[0]?.round).toBe(1);
    expect(view.factions.wolf.total + view.factions.good.total).toBe(engine.players.length);
    expect(view).not.toHaveProperty('pendingAction');
  }, 120_000);
});
