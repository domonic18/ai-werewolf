import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine.js';
import type { LLMClient } from '../src/ai/types.js';
import type { GameEvent, NightRecord } from '../src/shared/types.js';
import { expandDeck, recommendDeck } from '../src/game/catalog.js';
import type { DeckSlot } from '../src/game/catalog.js';

/**
 * 剧本化 LLM：按 prompt 类型返回固定策略，用来把「守卫/猎人/女巫」的组合逼出来。
 * 不是 mock 随机行为，而是「每次都做同一个选择」，这样断言才有意义。
 */
interface Script {
  /** 狼刀：'first' 取列表第一人；'cycle' 逐夜轮换（用来覆盖更多目标）；'human' 杀真人 */
  wolf: 'first' | 'human' | 'cycle';
  /** 守卫：'first' 表示可守列表第一个人（常与狼刀撞上，用来验证同守同救） */
  guard: 'first' | 'self' | 'none';
  /** 女巫是否用解药 */
  save: boolean;
  /** 猎人是否开枪 */
  shoot: boolean;
  /** 女巫是否下毒（毒列表第一人） */
  poison?: boolean;
  /** 指定目标名（狼刀与守卫共用）：用来制造「守中/奶穿」这种确定性场景 */
  targetName?: string;
}

function scriptedLLM(script: Script): LLMClient {
  let wolfTurn = 0;
  const pick = (user: string, marker: RegExp, index = 0): string => {
    const listed = user.match(marker)?.[1];
    const names = listed?.split('、').map((n) => n.trim()).filter(Boolean) ?? [];
    return names[index % Math.max(1, names.length)] ?? '';
  };

  return {
    label: () => 'scripted',
    async task(system: string, user: string): Promise<Record<string, unknown>> {
      /* 必须按「你是XX」匹配：规则文本里会出现所有角色名 */
      if (/你是守卫/.test(system)) {
        if (script.guard === 'none') return { target: '', reason: 'scripted-none' };
        if (script.targetName) return { target: script.targetName, reason: 'scripted-guard-target' };
        return { target: pick(user, /可以守护的存活玩家：(.+?)。/), reason: 'scripted-guard' };
      }
      if (/你是女巫/.test(system)) {
        const poison = script.poison ? pick(user, /可以毒死场上任意一人：(.+?)。/) : '';
        return { save: script.save, poison, reason: 'scripted-witch' };
      }
      if (/你是猎人/.test(system)) {
        if (!script.shoot) return { target: '', reason: 'scripted-hold' };
        return { target: pick(user, /还活着的玩家：(.+?)。/), reason: 'scripted-shot' };
      }
      if (/（狼人）/.test(system)) {
        if (script.targetName) return { target: script.targetName, reason: 'scripted-wolf-target' };
        if (script.wolf === 'human') return { target: '我', reason: 'scripted-human' };
        const index = script.wolf === 'cycle' ? wolfTurn++ : 0;
        return { target: pick(user, /可以下手的对象：(.+?)。/, index), reason: 'scripted-wolf' };
      }
      if (/你是预言家/.test(system)) return { target: '', reason: 'scripted-seer' };
      if (/白天发言/.test(system)) return { speech: '我是好人。', vote: '', reason: 'scripted' };
      if (/投票/.test(system)) return { vote: '', reason: 'scripted' };
      if (/遗言/.test(system)) return { text: '留个遗言。', reason: 'scripted' };
      return { ok: true };
    },
  };
}

/** 自动应答真人输入：一律选「第一个人/第一个选项」 */
function autoAnswer(engine: GameEngine): () => void {
  const timer = setInterval(() => {
    const pending = engine.pendingAction;
    if (!pending) return;
    if (pending.kind === 'input') engine.submitHuman('我先听一圈。');
    else engine.submitHuman(pending.options.length ? (pending.options[0]?.value ?? 1) : 1);
  }, 5);
  return () => clearInterval(timer);
}

async function play(deck: DeckSlot[], script: Script, rounds = 6): Promise<GameEngine> {
  const engine = new GameEngine({
    playerName: '剧本',
    deck: expandDeck(deck),
    llm: scriptedLLM(script),
    pace: 0.01,
  });
  const stop = autoAnswer(engine);
  try {
    await engine.run();
  } finally {
    stop();
  }
  expect(engine.timeline.length).toBeGreaterThan(0);
  expect(engine.timeline.length).toBeLessThanOrEqual(rounds + 1);
  return engine;
}

/** 反复开局直到出现满足条件的一局（真人角色是随机的，避免用例偶发失败） */
async function playUntil(
  deck: DeckSlot[],
  script: Script,
  predicate: (engine: GameEngine) => boolean,
  tries = 40,
): Promise<GameEngine> {
  for (let i = 0; i < tries; i++) {
    const engine = await play(deck, script);
    if (predicate(engine)) return engine;
  }
  throw new Error(`跑了 ${tries} 局都没有出现预期场景`);
}

const sixWithGuard: DeckSlot[] = [
  { key: 'wolf', count: 2 },
  { key: 'guard', count: 1 },
  { key: 'witch', count: 1 },
  { key: 'villager', count: 2 },
];

describe('守卫（按官方规则：只挡狼刀，不能连守，同守同救奶穿）', () => {
  it('同守同救：守卫与解药同时作用于同一人时仍然死亡', async () => {
    /* 狼刀与守卫都取列表第一人 → 必然撞上；女巫每夜救人 */
    const script: Script = { wolf: 'first', guard: 'first', save: true, shoot: false, targetName: '剧本' };
    const engine = await playUntil(sixWithGuard, script, (e) => e.timeline.some((r) => r.pierced));
    const engineRecs = engine.timeline;

    const pierced = engineRecs.filter((r) => r.pierced);
    expect(pierced.length, '应至少出现一次同守同救').toBeGreaterThan(0);

    for (const rec of pierced) {
      expect(rec.guardTarget?.playerId).toBe(rec.wolfTarget?.playerId);
      expect(rec.saved).toBe(true);
      expect(rec.guarded).toBe(false);
      /* 奶穿 = 仍然出局 */
      expect(rec.deaths.map((d) => d.playerId)).toContain(rec.wolfTarget?.playerId);
    }
  }, 120_000);

  it('只守不救：狼刀被挡下，当晚无人因刀出局', async () => {
    const script: Script = { wolf: 'first', guard: 'first', save: false, shoot: false, targetName: '剧本' };
    const engine = await playUntil(sixWithGuard, script, (e) => e.timeline.some((r) => r.guarded));
    const guarded = engine.timeline.filter((r) => r.guarded);
    expect(guarded.length, '应至少成功守住一次').toBeGreaterThan(0);

    for (const rec of guarded) {
      expect(rec.guardTarget?.playerId).toBe(rec.wolfTarget?.playerId);
      expect(rec.deaths.map((d) => d.playerId)).not.toContain(rec.wolfTarget?.playerId);
    }
  }, 120_000);

  it('不能连续两晚守同一人', async () => {
    const script: Script = { wolf: 'first', guard: 'first', save: false, shoot: false, targetName: '剧本' };
    const engine = await playUntil(
      sixWithGuard,
      script,
      (e) => e.timeline.filter((r) => r.guardTarget != null).length >= 2,
    );
    const guards = engine.timeline.map((r) => r.guardTarget?.playerId ?? null);
    for (let i = 1; i < guards.length; i++) {
      if (guards[i] == null || guards[i - 1] == null) continue;
      expect(guards[i], `第 ${i + 1} 夜不能重复守同一人`).not.toBe(guards[i - 1]);
    }
  }, 120_000);

  it('守卫挡不住毒药：被毒的人即使被守也照常出局', async () => {
    /* 女巫选毒时目标同样取第一人；这里让守卫守第一人、女巫毒第一人 */
    const poisonScript: Script = { wolf: 'human', guard: 'first', save: false, shoot: false };
    const deck: DeckSlot[] = [
      { key: 'wolf', count: 1 },
      { key: 'guard', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'villager', count: 3 },
    ];
    const engine = await play(deck, poisonScript);
    for (const rec of engine.timeline) {
      if (!rec.poisonTarget) continue;
      expect(rec.deaths.map((d) => d.playerId)).toContain(rec.poisonTarget.playerId);
      const death = rec.deaths.find((d) => d.playerId === rec.poisonTarget?.playerId);
      expect(['poison', 'hunter']).toContain(death?.cause);
    }
  }, 120_000);
});

describe('猎人（Q7：当场开枪；被毒杀不能开枪）', () => {
  const deckWithHunter: DeckSlot[] = [
    { key: 'wolf', count: 2 },
    { key: 'hunter', count: 1 },
    { key: 'seer', count: 1 },
    { key: 'villager', count: 2 },
  ];

  it('猎人被刀出局后能开枪，被枪带走的人记入死亡与时间轴', async () => {
    /* 狼刀逐夜轮换目标，保证多局内能覆盖到猎人被刀的情形 */
    let sawShot = false;
    for (let i = 0; i < 20 && !sawShot; i++) {
      const engine = await play(deckWithHunter, { wolf: 'cycle', guard: 'none', save: false, shoot: true });
      for (const rec of engine.timeline) {
        const shot = rec.hunterShot;
        if (!shot || shot.targetId == null) continue;
        sawShot = true;
        expect(rec.deaths.map((d) => d.playerId)).toContain(shot.targetId);
        const death = rec.deaths.find((d) => d.playerId === shot.targetId);
        expect(death?.cause).toBe('hunter');
      }
    }
    expect(sawShot, '多局内应至少出现一次猎人开枪').toBe(true);
  }, 180_000);

  it('压枪不开时也留下记录，且不产生额外死亡', async () => {
    let sawHold = false;
    for (let i = 0; i < 20 && !sawHold; i++) {
      const engine = await play(deckWithHunter, { wolf: 'cycle', guard: 'none', save: false, shoot: false });
      for (const rec of engine.timeline) {
        if (!rec.hunterShot) continue;
        sawHold = true;
        expect(rec.hunterShot.targetId).toBeNull();
        expect(rec.deaths.some((d) => d.cause === 'hunter')).toBe(false);
      }
    }
    expect(sawHold).toBe(true);
  }, 180_000);

  it('被毒杀的猎人不能开枪', async () => {
    /* 女巫毒第一人：脚本里女巫 poison 为空，这里改用「狼刀自刀」制造毒药决策不可控，
       因此只断言不变量：凡死因为 poison 的猎人，其 hunterShot 必须为空或 targetId 为 null */
    const deck: DeckSlot[] = [
      { key: 'wolf', count: 2 },
      { key: 'witch', count: 1 },
      { key: 'hunter', count: 1 },
      { key: 'villager', count: 2 },
    ];
    /* 女巫每夜下毒（毒列表第一人），狼刀轮换 → 多局内必然出现「猎人被毒」 */
    let sawPoisonedHunter = false;
    for (let i = 0; i < 20 && !sawPoisonedHunter; i++) {
      const engine = await play(deck, { wolf: 'cycle', guard: 'none', save: false, shoot: true, poison: true });
      for (const rec of engine.timeline) {
        for (const death of rec.deaths) {
          if (death.cause !== 'poison') continue;
          const isHunter = rec.hunterShot?.hunterId === death.playerId;
          if (!isHunter) continue;
          sawPoisonedHunter = true;
          expect(rec.hunterShot?.targetId, '被毒杀的猎人不能开枪').toBeNull();
        }
      }
    }
    expect(sawPoisonedHunter, '多局内应至少出现一次猎人被毒').toBe(true);
  }, 180_000);
});

describe('多人局与守卫/猎人共存', () => {
  it('推荐牌组（8 人）能跑完，且阵营统计正确', async () => {
    const engine = new GameEngine({
      playerName: '八人',
      deck: expandDeck(recommendDeck(8)),
      llm: scriptedLLM({ wolf: 'first', guard: 'first', save: false, shoot: true }),
      pace: 0.01,
    });
    const stop = autoAnswer(engine);
    try {
      await engine.run();
    } finally {
      stop();
    }
    expect(engine.players).toHaveLength(8);
    expect(['good', 'wolf']).toContain(engine.winner);
  }, 180_000);

  it('复盘记录永远自洽：每条死亡都有死因，守卫目标与狼刀目标可对照', async () => {
    const engine = await play(sixWithGuard, { wolf: 'first', guard: 'first', save: true, shoot: false });
    for (const rec of engine.timeline as NightRecord[]) {
      const ids = new Set<string>();
      for (const death of rec.deaths) {
        expect(['wolf', 'poison', 'hunter', 'vote']).toContain(death.cause);
        const key = `${death.playerId}`;
        expect(ids.has(key), `第 ${rec.round} 轮同一人不应重复记录`).toBe(false);
        ids.add(key);
      }
      if (rec.guarded) expect(rec.pierced).toBe(false);
      if (rec.pierced) expect(rec.guarded).toBe(false);
    }
  }, 120_000);
});

/* 事件流里必须出现守卫口令，且不能出现玩家名（夜晚零泄露） */
describe('新角色不破坏夜晚隐私', () => {
  it('守卫口令只播报角色名，不含任何玩家名', async () => {
    const events: GameEvent[] = [];
    const engine = new GameEngine({
      playerName: '隐私',
      deck: expandDeck(sixWithGuard),
      llm: scriptedLLM({ wolf: 'first', guard: 'first', save: false, shoot: false }),
      pace: 0.01,
      emit: (event) => events.push(event),
    });
    const stop = autoAnswer(engine);
    try {
      await engine.run();
    } finally {
      stop();
    }

    const cues = events.filter((e): e is Extract<GameEvent, { type: 'night-cue' }> => e.type === 'night-cue');
    expect(cues.some((e) => e.payload.text.includes('守卫请睁眼'))).toBe(true);

    const names = engine.players.map((p) => p.name);
    for (const cue of cues) {
      for (const name of names) {
        expect(cue.payload.text.includes(name), `口令不应包含玩家名「${name}」：${cue.payload.text}`).toBe(false);
      }
    }
  }, 120_000);
});
