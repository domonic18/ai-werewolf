import { describe, expect, it } from 'vitest';
import { AIPlayer } from '../src/ai/ai-player.js';
import { AI_CAST, type CastTraits } from '../src/game/roles.js';
import type { GameView, Player } from '../src/game/types.js';
import type { LLMClient, LLMTaskOptions } from '../src/ai/types.js';

/** 记录 prompt 的 LLM 桩：只关心「模型看到了什么」，不关心它回什么 */
function captureLLM(reply: Record<string, unknown> = { speech: '听着呢', vote: '', reason: 'r' }) {
  const seen: { system: string; user: string; options?: LLMTaskOptions }[] = [];
  const llm: LLMClient = {
    label: () => 'capture',
    async task(system: string, user: string, options?: LLMTaskOptions) {
      seen.push({ system, user, options });
      return reply;
    },
  };
  return { llm, seen };
}

function makePlayer(partial: Partial<Player> & Pick<Player, 'name' | 'role' | 'seat'>): Player {
  return {
    id: partial.seat,
    emoji: '',
    persona: partial.persona ?? '普通玩家',
    isHuman: false,
    alive: true,
    thoughts: [],
    checks: [],
    antidote: false,
    poison: false,
    revealRole: false,
    ...partial,
  };
}

function makeGame(players: Player[], logLines: string[] = []): GameView {
  return {
    round: 2,
    lastNightText: '昨夜是平安夜',
    publicLog: logLines,
    players,
    alivePlayers: () => players.filter((p) => p.alive),
  };
}

const LOG = Array.from({ length: 40 }, (_, i) => `第2天 玩家${i % 3}：这是第 ${i + 1} 条发言记录`);

const TRAITS_HIGH: CastTraits = { skill: 0.9, style: 'logic', talk: 0.5, push: 0.6, suggestibility: 0.2 };
const TRAITS_LOW: CastTraits = { skill: 0.2, style: 'intuition', talk: 0.4, push: 0.2, suggestibility: 0.8 };

describe('AI 角色池的差异化', () => {
  it('至少 12 个角色，牌感有真实落差（不是所有人都是高手）', () => {
    expect(AI_CAST.length).toBeGreaterThanOrEqual(12);
    const skills = AI_CAST.map((m) => m.traits.skill);
    expect(Math.min(...skills)).toBeLessThan(0.4);
    expect(Math.max(...skills)).toBeGreaterThanOrEqual(0.78);
    /* 中位数附近也要有人，避免只有两个极端 */
    expect(skills.filter((s) => s >= 0.42 && s <= 0.7).length).toBeGreaterThanOrEqual(4);
  });

  it('推理风格不止一种', () => {
    const styles = new Set(AI_CAST.map((m) => m.traits.style));
    expect(styles.size).toBeGreaterThanOrEqual(4);
  });

  it('话量 / 攻击性 / 易受影响程度都有分化', () => {
    const talk = AI_CAST.map((m) => m.traits.talk);
    const push = AI_CAST.map((m) => m.traits.push);
    const suggest = AI_CAST.map((m) => m.traits.suggestibility);
    expect(Math.max(...talk) - Math.min(...talk)).toBeGreaterThan(0.4);
    expect(Math.max(...push) - Math.min(...push)).toBeGreaterThan(0.5);
    expect(Math.max(...suggest) - Math.min(...suggest)).toBeGreaterThan(0.5);
  });
});

describe('推理能力真的影响 AI 看到/被允许想的东西', () => {
  it('牌感低的只看到最近几条发言，牌感高的能看全', async () => {
    const players = [
      makePlayer({ name: '新手甲', role: 'villager', seat: 1, traits: TRAITS_LOW }),
      makePlayer({ name: '高手乙', role: 'villager', seat: 2, traits: TRAITS_HIGH }),
    ];
    const game = makeGame(players, LOG);

    const low = captureLLM();
    await new AIPlayer(players[0]!, low.llm).speak(game);

    const high = captureLLM();
    await new AIPlayer(players[1]!, high.llm).speak(game);

    const countLog = (user: string): number => user.split('\n').filter((l) => l.includes('条发言记录')).length;
    expect(countLog(low.seen[0]!.user)).toBeLessThan(countLog(high.seen[0]!.user));
  });

  it('人格卡写明牌感、短板与说话习惯，而不是一句性格', async () => {
    const players = [makePlayer({ name: '新手甲', role: 'villager', seat: 1, traits: TRAITS_LOW, persona: '紧张型新手' })];
    const cap = captureLLM();
    await new AIPlayer(players[0]!, cap.llm).speak(makeGame(players, LOG));
    const prompt = cap.seen[0]!.user;

    expect(prompt).toContain('牌感：新手');
    expect(prompt).toContain('短板');
    expect(prompt).toContain('说话与行动');
    expect(prompt).toContain('紧张型新手');
  });

  it('老玩家拿到「可以多步推理」，新手拿到「别做复杂推理」', async () => {
    const high = [makePlayer({ name: '高手乙', role: 'villager', seat: 1, traits: TRAITS_HIGH })];
    const low = [makePlayer({ name: '新手甲', role: 'villager', seat: 1, traits: TRAITS_LOW })];

    const capHigh = captureLLM();
    await new AIPlayer(high[0]!, capHigh.llm).speak(makeGame(high));
    expect(capHigh.seen[0]!.user).toContain('多步推理');

    const capLow = captureLLM();
    await new AIPlayer(low[0]!, capLow.llm).speak(makeGame(low));
    expect(capLow.seen[0]!.user).toContain('别做复杂推理');
  });

  it('温度随风格浮动（混沌型更跳，逻辑型更稳）', async () => {
    const mk = (traits: CastTraits) => [makePlayer({ name: '测试', role: 'villager', seat: 1, traits })];
    const logic = mk({ ...TRAITS_HIGH, style: 'logic' });
    const chaos = mk({ ...TRAITS_HIGH, style: 'chaos' });

    const a = captureLLM();
    await new AIPlayer(logic[0]!, a.llm).speak(makeGame(logic));
    const b = captureLLM();
    await new AIPlayer(chaos[0]!, b.llm).speak(makeGame(chaos));

    expect(b.seen[0]!.options?.temperature).toBeGreaterThan(a.seen[0]!.options?.temperature as number);
  });
});

describe('身份隔离：AI 只知道自己的身份（狼人额外知道队友）', () => {
  const players = [
    makePlayer({ name: '村民甲', role: 'villager', seat: 1, traits: TRAITS_LOW }),
    makePlayer({ name: '预言家乙', role: 'seer', seat: 2, traits: TRAITS_HIGH }),
    makePlayer({ name: '狼人丙', role: 'wolf', seat: 3, traits: TRAITS_HIGH }),
    makePlayer({ name: '狼人丁', role: 'wolf', seat: 4, traits: TRAITS_LOW }),
  ];
  players[2]!.gameMates = [players[3]!];
  players[3]!.gameMates = [players[2]!];

  it('村民的 prompt 里不出现别人的身份，也没有队友信息', async () => {
    const cap = captureLLM();
    await new AIPlayer(players[0]!, cap.llm).speak(makeGame(players));
    const prompt = cap.seen[0]!.user;

    expect(prompt).toContain('你的身份：平民');
    expect(prompt).not.toContain('你的身份：预言家');
    expect(prompt).not.toContain('你的狼队友');
    expect(prompt).not.toContain('狼人丙 是');
    expect(prompt).not.toContain('查验记录');
    expect(prompt).not.toContain('你的药');
  });

  it('预言家的 prompt 只有自己的身份与自己的查验记录', async () => {
    const seer = makePlayer({
      name: '预言家乙',
      role: 'seer',
      seat: 2,
      traits: TRAITS_HIGH,
      checks: [{ id: 3, name: '狼人丙', isWolf: true, round: 1 }],
    });
    const game = makeGame([players[0]!, seer, players[2]!, players[3]!]);
    const cap = captureLLM();
    await new AIPlayer(seer, cap.llm).speak(game);
    const prompt = cap.seen[0]!.user;

    expect(prompt).toContain('你的身份：预言家');
    expect(prompt).toContain('你的查验记录');
    expect(prompt).not.toContain('你的狼队友');
  });

  it('狼人知道且只知道自己的队友', async () => {
    const cap = captureLLM();
    await new AIPlayer(players[2]!, cap.llm).speak(makeGame(players));
    const prompt = cap.seen[0]!.user;

    expect(prompt).toContain('你的身份：狼人');
    expect(prompt).toContain('你的狼队友：狼人丁');
    /* 好人身份不能泄给狼 */
    expect(prompt).not.toContain('预言家乙 是');
    expect(prompt).not.toContain('查验记录');
  });

  it('死亡但未翻牌的人，身份对 AI 仍然不可见', async () => {
    const dead = makePlayer({ name: '出局者', role: 'witch', seat: 5, alive: false, revealRole: false });
    const game = makeGame([players[0]!, players[2]!, dead]);
    const cap = captureLLM();
    await new AIPlayer(players[0]!, cap.llm).speak(game);
    const prompt = cap.seen[0]!.user;

    expect(prompt).toContain('出局者（身份未公开）');
    expect(prompt).not.toContain('出局者（女巫）');
  });
});
