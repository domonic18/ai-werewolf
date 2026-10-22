import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine.js';
import { ROLES } from '../src/shared/roles.js';
import type { RoleKey } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';
import type { Player } from '../src/game/types.js';

/**
 * 白痴 / 长老 / 黑狼王 的规则断言。
 *
 * 这三个角色的判定藏在引擎私有流程里（放逐、夜间结算、出局开枪），
 * 整局模拟很难稳定碰到具体分支，所以这里直接调用对应的私有方法验证规则本身；
 * 集成层面由 engine-smoke 的 9/10/12 人局覆盖。
 */

type EngineInternals = {
  setup(): void;
  resolveVotes(votes: { voter: number; target: number }[]): Promise<void>;
  resolveDeathShots(dead: Player[]): Promise<Player[]>;
  wolfKillOutcome(): { victim: Player | null; elderSaved: boolean };
  disableGoodSkills(reason: string): void;
  recordOf(round: number): { exiled: { survived?: boolean } | null };
};

function internals(engine: GameEngine): EngineInternals {
  return engine as unknown as EngineInternals;
}

/** 造一个已经发好牌的引擎（不跑主流程，方便逐条验规则） */
function makeEngine(deck: RoleKey[], playerName = '你'): GameEngine {
  const engine = new GameEngine({ playerName, deck, llm: createMockLLM(), pace: 0 });
  internals(engine).setup();
  return engine;
}

const roleOf = (engine: GameEngine, role: RoleKey): Player =>
  engine.players.find((p) => p.role === role) as Player;

/**
 * 保证被测角色由 AI 持有：setup 会洗牌，真人有可能正好拿到这个角色，
 * 那样引擎会挂起等真人输入，测试就会一直等下去。这里把真人和一个平民交换。
 */
function ensureAIControls(engine: GameEngine, role: RoleKey): void {
  const human = engine.human;
  if (human.role !== role) return;
  const donor = engine.players.find((p) => !p.isHuman && p.role === 'villager') as Player;
  human.role = donor.role;
  donor.role = role;
  human.antidote = false;
  human.poison = false;
  human.checks = [];
  human.elderImmune = undefined;
  if (role === 'elder') donor.elderImmune = true;
  if (role === 'witch') {
    donor.antidote = true;
    donor.poison = true;
  }
  if (role === 'wolf' || role === 'wolfking') {
    donor.gameMates = engine.players.filter((p) => (p.role === 'wolf' || p.role === 'wolfking') && p.id !== donor.id);
  }
}

/** 真人可能是平民：自动替他做选择，直到传入的 promise 结束 */
async function withAutoHuman(engine: GameEngine, work: Promise<unknown>): Promise<void> {
  let done = false;
  const settled = work.then(
    () => {
      done = true;
    },
    (e) => {
      done = true;
      throw e;
    },
  );
  while (!done) {
    const pending = engine.snapshot(engine.human.id).pendingAction;
    if (pending) {
      engine.submitHuman(pending.kind === 'input' ? '我先过。' : (pending.options[0]?.value ?? 1));
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  await settled;
}

describe('白痴：翻牌免死一次，此后失去投票权', () => {
  const deck: RoleKey[] = ['idiot', 'wolf', 'wolf', 'seer', 'witch', 'villager', 'villager', 'villager', 'villager'];

  it('第一次被投出不死，翻牌且失去投票权，事件带 survived', async () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'idiot');
    const idiot = roleOf(engine, 'idiot');
    const others = engine.players.filter((p) => p.id !== idiot.id);

    await internals(engine).resolveVotes(others.map((p) => ({ voter: p.id, target: idiot.id })));

    expect(idiot.alive).toBe(true);
    expect(idiot.idiotRevealed).toBe(true);
    expect(idiot.canVote).toBe(false);
    expect(idiot.revealRole).toBe(true);
    expect(internals(engine).recordOf(engine.round)?.exiled?.survived).toBe(true);

    const result = [...engine.events].reverse().find((e) => e.type === 'vote-result');
    expect(result?.payload).toMatchObject({ survived: true, role: 'idiot', name: idiot.name });
  });

  it('翻牌之后再被投出就正常出局', async () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'idiot');
    const idiot = roleOf(engine, 'idiot');
    const others = engine.players.filter((p) => p.id !== idiot.id);
    const votes = others.map((p) => ({ voter: p.id, target: idiot.id }));

    await internals(engine).resolveVotes(votes);
    await internals(engine).resolveVotes(votes);

    expect(idiot.alive).toBe(false);
  });

  it('翻牌后不再参与投票（引擎会跳过并留一条日志）', async () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'idiot');
    const idiot = roleOf(engine, 'idiot');
    const others = engine.players.filter((p) => p.id !== idiot.id);
    await internals(engine).resolveVotes(others.map((p) => ({ voter: p.id, target: idiot.id })));
    expect(idiot.canVote).toBe(false);

    /* 直接跑投票阶段：没有投票权的玩家不该产生 vote 事件 */
    await withAutoHuman(engine, (engine as unknown as { vote(): Promise<void> }).vote());
    const votedByIdiot = engine.events.some((e) => e.type === 'vote' && e.payload.voter === idiot.id);
    expect(votedByIdiot).toBe(false);
    expect(engine.publicLog.join()).toContain('没有投票权');
  }, 20_000);
});

describe('长老：首次被刀不死；被好人误伤则神职技能失效', () => {
  const deck: RoleKey[] = [
    'elder',
    'wolf',
    'wolf',
    'wolf',
    'seer',
    'witch',
    'hunter',
    'guard',
    'villager',
    'villager',
    'villager',
    'villager',
  ];

  it('第一次被狼刀：不死，且免疫标记被消耗', () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'elder');
    const elder = roleOf(engine, 'elder');
    const inner = engine as unknown as { nightKill: number | null; guardedId: number | null; saved: boolean };
    inner.nightKill = elder.id;
    inner.guardedId = null;
    inner.saved = false;

    const outcome = internals(engine).wolfKillOutcome();
    expect(outcome.victim).toBeNull();
    expect(outcome.elderSaved).toBe(true);
    expect(elder.elderImmune).toBe(false);

    /* 第二次同样的刀就正常死了 */
    inner.nightKill = elder.id;
    const second = internals(engine).wolfKillOutcome();
    expect(second.victim?.id).toBe(elder.id);
  });

  it('被守卫守住 / 被解药救下时，长老免疫不被消耗', () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'elder');
    const elder = roleOf(engine, 'elder');
    const inner = engine as unknown as { nightKill: number | null; guardedId: number | null; saved: boolean };
    inner.nightKill = elder.id;
    inner.guardedId = elder.id;
    inner.saved = false;

    const outcome = internals(engine).wolfKillOutcome();
    expect(outcome.victim).toBeNull();
    expect(elder.elderImmune).toBe(true);
  });

  it('长老被误伤后：好人技能封印、身份公开、记入复盘', () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'elder');
    const elder = roleOf(engine, 'elder');
    internals(engine).disableGoodSkills('测试');

    expect(engine.skillsDisabled).toBe(true);
    expect(elder.revealRole).toBe(true);
    expect(engine.publicLog.join()).toContain('长老出局');
    expect(internals(engine).recordOf(engine.round)?.skillsDisabled).toBe(true);
  });
});

describe('黑狼王：出局可开枪，被毒不能开枪', () => {
  const deck: RoleKey[] = [
    'wolfking',
    'wolf',
    'wolf',
    'seer',
    'witch',
    'hunter',
    'guard',
    'villager',
    'villager',
    'villager',
  ];

  it('被放逐时开枪带走目标，事件标明开枪者是黑狼王', async () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'wolfking');
    const king = roleOf(engine, 'wolfking');
    const victim = roleOf(engine, 'villager');

    /* mock LLM 对开枪返回 target=TARGET（匹配不到名字时压枪），这里直接给名字 */
    const inner = engine as unknown as { llm: { task: unknown } };
    inner.llm = {
      label: () => 'scripted',
      task: async () => ({ target: victim.name, reason: '带走一个' }),
    };

    const shot = await internals(engine).resolveDeathShots([king]);
    expect(shot.map((p) => p.id)).toEqual([victim.id]);
    expect(victim.alive).toBe(false);

    const event = [...engine.events].reverse().find((e) => e.type === 'hunter-shot');
    expect(event?.payload).toMatchObject({ shooterRole: 'wolfking' });
    expect(engine.publicLog.join()).toContain(ROLES.wolfking.name);
  });

  it('被毒杀时不能开枪', async () => {
    const engine = makeEngine(deck);
    ensureAIControls(engine, 'wolfking');
    const king = roleOf(engine, 'wolfking');
    const victim = roleOf(engine, 'villager');
    (engine as unknown as { poisonId: number | null }).poisonId = king.id;

    const shot = await internals(engine).resolveDeathShots([king]);
    expect(shot).toHaveLength(0);
    expect(victim.alive).toBe(true);
    expect(engine.publicLog.join()).toContain('被毒杀无法开枪');
  });
});
