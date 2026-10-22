/**
 * 角色配置与对局常量（服务端）。
 * 展示用的元数据在 src/shared/roles.ts，这里只放"这一局用什么配置"。
 */
import type { RoleKey, Team } from '../shared/types.js';

export { ROLES, roleName, roleEmoji, isWolf } from '../shared/roles.js';

/** 6 人局固定配置：狼 2 / 预言家 1 / 女巫 1 / 平民 2 */
export const ROLE_DECK: RoleKey[] = ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager'];

export interface CastMember {
  name: string;
  emoji: string;
  persona: string;
}

/** AI 补位角色池：名字 / 形象 / 性格 prompt */
export const AI_CAST: CastMember[] = [
  { name: '老K', emoji: '🕶️', persona: '沉稳老练，说话短促，喜欢抓别人话里的逻辑漏洞' },
  { name: '小满', emoji: '🍊', persona: '热情话多，爱打比方，容易冲动站边' },
  { name: '阿岚', emoji: '🧊', persona: '冷静理性，爱讲概率和可能性，句子像简报' },
  { name: '豆豆', emoji: '🍬', persona: '新手感，语气软，凭直觉说话但经常意外地准' },
  { name: '七喜', emoji: '🎭', persona: '阴阳怪气，爱反讽拱火，喜欢逼人表态' },
  /* 8~12 人局需要更多 AI 补位 */
  { name: '大熊', emoji: '🐻', persona: '直来直去的大嗓门，喜欢带头冲锋，容易被带节奏' },
  { name: '阿桃', emoji: '🍑', persona: '温和谨慎，习惯先复述别人观点再下结论，讨厌互踩' },
  { name: '老白', emoji: '🧓', persona: '老派玩家，讲经验讲套路，爱说"按规矩应该"' },
  { name: '小北', emoji: '🌬️', persona: '话少但每句都戳重点，讨厌废话，常冷不丁反问' },
  { name: '星野', emoji: '🌌', persona: '爱编故事做假设，喜欢用"如果我是狼我会怎么打"推演' },
  { name: '米粒', emoji: '🍚', persona: '紧张型新手，容易被质疑就打退堂鼓，但观察细节很准' },
  { name: '阿七', emoji: '🃏', persona: '赌徒性格，喜欢搏一把，投票常常出人意料' },
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
