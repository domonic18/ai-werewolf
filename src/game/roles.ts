/**
 * 角色配置与对局常量（服务端）。
 * 展示用的元数据在 src/shared/roles.ts，这里只放"这一局用什么配置"。
 */
import type { RoleKey, Team } from '../shared/types.js';

export { ROLES, roleName, roleEmoji, isWolf } from '../shared/roles.js';

/** 6 人局固定配置：狼 2 / 预言家 1 / 女巫 1 / 平民 2 */
export const ROLE_DECK: RoleKey[] = ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'];

/** 推理风格：决定 AI「怎么想」，不是「怎么说话」 */
export type ReasoningStyle = 'logic' | 'emotion' | 'intuition' | 'chaos' | 'probe';

export interface CastTraits {
  /** 牌感 0~1：直接决定它能看到多少条场上信息、以及提示里允许它推理多深 */
  skill: number;
  style: ReasoningStyle;
  /** 话多程度 0~1 */
  talk: number;
  /** 攻击性 0~1：越高越爱点人、归票 */
  push: number;
  /** 易受影响 0~1：越高越容易被带节奏 */
  suggestibility: number;
  /** 本局抽到的状态，每次开局随机，让同一个人在两天里表现不一样 */
  mood?: 'calm' | 'sharp' | 'tilted' | 'lazy';
}

export interface CastMember {
  name: string;
  emoji: string;
  persona: string;
  traits: CastTraits;
}

/** AI 补位角色池：名字 / 形象 / 性格 prompt */
/**
 * AI 角色池。
 *
 * 两条设计原则：
 * 1) 每个人「牌感」不同 —— 不是所有 AI 都该像同一个高手，场上要有萌新、有半吊子、有老炮；
 * 2) 每个人「短板」不同 —— 高手也会过度自信，新手也会蒙对，这样一局一局才有随机性。
 */
export const AI_CAST: CastMember[] = [
  {
    name: '老K',
    emoji: '🕶️',
    persona: '沉稳老练，说话短促，喜欢抓别人话里的逻辑漏洞',
    traits: { skill: 0.72, style: 'logic', talk: 0.35, push: 0.6, suggestibility: 0.2 },
  },
  {
    name: '小满',
    emoji: '🍊',
    persona: '热情话多，爱打比方，容易冲动站边',
    traits: { skill: 0.5, style: 'emotion', talk: 0.85, push: 0.7, suggestibility: 0.65 },
  },
  {
    name: '阿岚',
    emoji: '🧊',
    persona: '冷静理性，爱讲概率和可能性，句子像简报',
    traits: { skill: 0.85, style: 'logic', talk: 0.45, push: 0.5, suggestibility: 0.15 },
  },
  {
    name: '豆豆',
    emoji: '🍬',
    persona: '新手感，语气软，凭直觉说话但经常意外地准',
    traits: { skill: 0.32, style: 'intuition', talk: 0.6, push: 0.25, suggestibility: 0.75 },
  },
  {
    name: '七喜',
    emoji: '🎭',
    persona: '阴阳怪气，爱反讽拱火，喜欢逼人表态',
    traits: { skill: 0.62, style: 'chaos', talk: 0.7, push: 0.85, suggestibility: 0.35 },
  },
  /* 8~12 人局需要更多 AI 补位 */
  {
    name: '大熊',
    emoji: '🐻',
    persona: '直来直去的大嗓门，喜欢带头冲锋，容易被带节奏',
    traits: { skill: 0.28, style: 'emotion', talk: 0.8, push: 0.9, suggestibility: 0.85 },
  },
  {
    name: '阿桃',
    emoji: '🍑',
    persona: '温和谨慎，习惯先复述别人观点再下结论，讨厌互踩',
    traits: { skill: 0.55, style: 'emotion', talk: 0.55, push: 0.2, suggestibility: 0.5 },
  },
  {
    name: '老白',
    emoji: '🧓',
    persona: '老派玩家，讲经验讲套路，爱说"按规矩应该"',
    traits: { skill: 0.6, style: 'probe', talk: 0.65, push: 0.55, suggestibility: 0.4 },
  },
  {
    name: '小北',
    emoji: '🌬️',
    persona: '话少但每句都戳重点，讨厌废话，常冷不丁反问',
    traits: { skill: 0.78, style: 'probe', talk: 0.3, push: 0.5, suggestibility: 0.25 },
  },
  {
    name: '星野',
    emoji: '🌌',
    persona: '爱编故事做假设，喜欢用"如果我是狼我会怎么打"推演',
    traits: { skill: 0.66, style: 'chaos', talk: 0.75, push: 0.45, suggestibility: 0.3 },
  },
  {
    name: '米粒',
    emoji: '🍚',
    persona: '紧张型新手，容易被质疑就打退堂鼓，但观察细节很准',
    traits: { skill: 0.38, style: 'intuition', talk: 0.4, push: 0.15, suggestibility: 0.8 },
  },
  {
    name: '阿七',
    emoji: '🃏',
    persona: '赌徒性格，喜欢搏一把，投票常常出人意料',
    traits: { skill: 0.45, style: 'chaos', talk: 0.5, push: 0.6, suggestibility: 0.55 },
  },
];

export const GAME_RULES = {
  minPlayers: 6,
  maxRounds: 8,
  humanPlayerName: '你',
} as const;

/** 胜负判定：狼人全灭 → 好人胜；狼人数 ≥ 好人数 → 狼人胜 */
export function judgeWinner(roles: RoleKey[]): Team | null {
  const wolves = roles.filter((r) => r === 'wolf').length;
  const goods = roles.length - wolves;
  if (wolves === 0) return 'good';
  if (wolves >= goods) return 'wolf';
  return null;
}
