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
  /* 以下为 v1.5 计划角色：元数据先就位，能力实现后才会进入牌组 */
  hunter: { key: 'hunter', name: '猎人', emoji: '🏹', team: 'good' },
  guard: { key: 'guard', name: '守卫', emoji: '🛡', team: 'good' },
  idiot: { key: 'idiot', name: '白痴', emoji: '🤡', team: 'good' },
  elder: { key: 'elder', name: '长老', emoji: '🧓', team: 'good' },
  wolfking: { key: 'wolfking', name: '黑狼王', emoji: '👑', team: 'wolf' },
  dreamweaver: { key: 'dreamweaver', name: '摄梦人', emoji: '🌙', team: 'good' },
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
