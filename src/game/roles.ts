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
