import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine.js';
import type { GameEvent } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';
import { expandDeck, recommendDeck } from '../src/game/catalog.js';
import type { MockOptions } from './helpers/mock-llm.js';

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

async function runOnce(
  index: number,
  mockOptions: MockOptions = {},
): Promise<{ engine: GameEngine; events: GameEvent[] }> {
  const events: GameEvent[] = [];
  const engine = new GameEngine({
    playerName: `测试${index}`,
    llm: createMockLLM(mockOptions),
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

describe('复盘记录与实际行动一致（用药 / 死因）', () => {
  it('救人就一定没死，下毒就一定死，死因标注与实际一致', async () => {
    /* 用可配桩把两种用药场景都逼出来，否则这条不变量形同虚设 */
    /* 真人角色是随机的（1/6 可能是女巫），所以多跑几局保证「AI 女巫」在场 */
    const games = await Promise.all([
      runOnce(101, { witchSave: true }),
      runOnce(102, { witchSave: true }),
      ...[103, 104, 105, 106, 107, 108].map((i) => runOnce(i, { witchPoison: true })),
    ]);
    let savedSeen = 0;
    let poisonSeen = 0;

    for (const { engine } of games) {
      for (const rec of engine.timeline) {
        const deathIds = rec.deaths.map((d) => d.playerId);

        if (rec.saved) {
          savedSeen += 1;
          expect(rec.wolfTarget).not.toBeNull();
          /* 同晚只能用一种药：被救的人绝不会同时被毒 */
          expect(rec.poisonTarget).toBeNull();
          expect(deathIds).not.toContain(rec.wolfTarget?.playerId);
        }

        if (rec.poisonTarget) {
          poisonSeen += 1;
          expect(deathIds).toContain(rec.poisonTarget.playerId);
          const poisonDeath = rec.deaths.find((d) => d.playerId === rec.poisonTarget?.playerId);
          /* 同一个人既被刀又被毒时只记一条；死因以「毒」为准（女巫是明确下手的动作），
             被猎人开枪带走则记 hunter */
          expect(['poison', 'hunter']).toContain(poisonDeath?.cause);
          /* 用了解药就不能再用毒药 */
          expect(rec.saved).toBe(false);
        }

        /* 没被救、也没被毒顶掉的狼刀目标，必须出现在死亡名单且死因为刀 */
        if (rec.wolfTarget && !rec.saved && !rec.guarded) {
          const wolfDeath = rec.deaths.find((d) => d.playerId === rec.wolfTarget?.playerId);
          if (wolfDeath) {
            /* 同一人被刀又被毒时死因记为 poison（女巫是明确动作） */
            const alsoPoisoned = rec.poisonTarget?.playerId === rec.wolfTarget.playerId;
            expect(wolfDeath.cause).toBe(alsoPoisoned ? 'poison' : 'wolf');
          } else {
            /* 没死，说明被解药救下或被守卫挡下 */
            expect(rec.saved || rec.guarded || rec.pierced).toBe(true);
          }
        }

        /* 每条死亡记录的死因必须能在场上找到解释（hunter = 被猎人开枪带走） */
        for (const death of rec.deaths) {
          if (death.cause === 'hunter') {
            expect(rec.hunterShot?.targetId).toBe(death.playerId);
            continue;
          }
          const explainedByWolf = rec.wolfTarget?.playerId === death.playerId && !rec.saved && !rec.guarded;
          const explainedByPoison = rec.poisonTarget?.playerId === death.playerId;
          /* 同守同救（奶穿）也算「有解释」的死亡 */
          if (rec.pierced && rec.wolfTarget?.playerId === death.playerId) continue;
          expect(
            explainedByWolf || explainedByPoison,
            `第 ${rec.round} 轮的死亡 ${death.name} 找不到死因解释`,
          ).toBe(true);
        }

        /* 放逐只会发生在白天，且当事人不在当晚死亡名单里 */
        if (rec.exiled) {
          expect(rec.exiled.votes).toBeGreaterThan(0);
        }
      }
    }

    /* 两种用药场景都必须被覆盖到 */
    expect(savedSeen).toBeGreaterThan(0);
    expect(poisonSeen).toBeGreaterThan(0);
  }, 120_000);
});

describe('多人局（按牌组发牌）', () => {
  const runWithDeck = async (players: number) => {
    const deck = expandDeck(recommendDeck(players));
    const engine = new GameEngine({ playerName: '多人局', deck, llm: createMockLLM(), pace: 0.02 });
    const stop = autoAnswer(engine);
    try {
      await engine.run();
    } finally {
      stop();
    }
    return engine;
  };

  it('8 人局：人数、狼人数、神职数符合推荐牌组，并能打到结束', async () => {
    const engine = await runWithDeck(8);
    expect(engine.players).toHaveLength(8);
    expect(engine.players.filter((p) => p.role === 'wolf')).toHaveLength(2);
    expect(engine.players.filter((p) => p.role === 'seer')).toHaveLength(1);
    expect(engine.players.filter((p) => p.role === 'witch')).toHaveLength(1);
    expect(engine.players.filter((p) => p.isHuman)).toHaveLength(1);
    expect(['good', 'wolf']).toContain(engine.winner);
  }, 180_000);

  it('9 人局：狼人升到 3 名，且 AI 补位人数够用（不再是固定 5 个）', async () => {
    const engine = await runWithDeck(9);
    expect(engine.players).toHaveLength(9);
    expect(engine.players.filter((p) => p.role === 'wolf')).toHaveLength(3);
    expect(engine.players.filter((p) => !p.isHuman)).toHaveLength(8);
    /* AI 名字不能重复 */
    const names = engine.players.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(['good', 'wolf']).toContain(engine.winner);
  }, 180_000);

  it('12 人局也能发牌，且阵营统计覆盖全部座位', async () => {
    const engine = await runWithDeck(12);
    expect(engine.players).toHaveLength(12);
    const view = engine.spectateSnapshot();
    expect(view.factions.wolf.total + view.factions.good.total).toBe(12);
    expect(view.factions.wolf.total).toBe(4);
  }, 180_000);
});
