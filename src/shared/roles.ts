/**
 * 角色展示元数据：前后端共用（服务端用于结算/日志，前端用于展示）。
 * 唯一事实来源，避免两边各写一份名字和 emoji。
 */
import type { RoleKey, RoleMeta } from './types.js';

export const ROLES: Record<RoleKey, RoleMeta> = {
  wolf: { key: 'wolf', name: '狼人', emoji: '🐺', team: 'wolf' },
  seer: { key: 'seer', name: '预言家', emoji: '🔮', team: 'good' },
  witch: { key: 'witch', name: '女巫', emoji: '🧪', team: 'good' },
  villager: { key: 'villager', name: '平民', emoji: '🧑‍🌾', team: 'good' },
};

export function roleName(role: RoleKey | null | undefined): string {
  return role ? ROLES[role].name : '未知';
}

export function roleEmoji(role: RoleKey | null | undefined): string {
  return role ? ROLES[role].emoji : '❓';
}

/** 是否属于狼人阵营 */
export function isWolf(role: RoleKey): boolean {
  return ROLES[role].team === 'wolf';
}
