/**
 * 角色库与牌组推荐（R4）。
 *
 * 为什么要单独一个文件：v1.5 的角色配置页需要「按人数给推荐牌组」「人数不足的角色置灰」，
 * 这些是纯数据与纯函数，放在引擎里会让规则状态机更难读，放在前端又会让前后端各写一份。
 * 所以放 shared 相邻的 game/ 层，服务端校验与前端展示用同一套。
 */
import type { RoleKey } from '../shared/types.js';
import { ROLES } from '../shared/roles.js';

export interface RoleCard {
  key: RoleKey;
  name: string;
  emoji: string;
  team: 'wolf' | 'good';
  /** 开放该角色所需的最少人数 */
  minPlayers: number;
  /** 一句话能力说明（配置页展示） */
  ability: string;
  /** 能力是否已实装：未实装的不会进推荐牌组，配置页里置灰 */
  implemented: boolean;
}

export const ROLE_CATALOG: readonly RoleCard[] = [
  { ...ROLES.wolf, minPlayers: 6, ability: '每晚与队友共同刀一人', implemented: true },
  { ...ROLES.seer, minPlayers: 6, ability: '每晚查验一人身份', implemented: true },
  { ...ROLES.witch, minPlayers: 6, ability: '一瓶解药一瓶毒药，全局各一次', implemented: true },
  { ...ROLES.villager, minPlayers: 6, ability: '没有技能，靠推理与投票', implemented: true },
  { ...ROLES.hunter, minPlayers: 8, ability: '出局时可开枪带走一人（被毒杀除外）', implemented: true },
  { ...ROLES.guard, minPlayers: 8, ability: '每晚守护一人，不能连续两晚守同一人；同守同救仍会死亡', implemented: true },
  { ...ROLES.idiot, minPlayers: 9, ability: '被放逐可翻牌免死一次，但从此失去投票权', implemented: true },
  { ...ROLES.elder, minPlayers: 10, ability: '首次被狼刀不死；被毒、被枪或被放逐会让全体好人失去技能', implemented: true },
  { ...ROLES.wolfking, minPlayers: 10, ability: '出局时可开枪带走一人（被毒杀不能开枪）', implemented: true },
  { ...ROLES.dreamweaver, minPlayers: 12, ability: '每晚摄梦一人，被摄者死亡时连带死亡', implemented: false },
];

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 12;

export interface DeckSlot {
  key: RoleKey;
  count: number;
}

export interface DeckCheck {
  ok: boolean;
  errors: string[];
}

const cardOf = (key: RoleKey): RoleCard => {
  const card = ROLE_CATALOG.find((c) => c.key === key);
  if (!card) throw new Error(`未知角色：${key}`);
  return card;
};

/** 不抛异常的查询：校验牌组时客户端可能塞进来任意字符串，不能让它变成 500 */
const cardOrNull = (key: string): RoleCard | null => ROLE_CATALOG.find((c) => c.key === key) ?? null;

/** 该人数下「能选」的角色（已实装且人数够） */
export function availableRoles(total: number): RoleCard[] {
  return ROLE_CATALOG.filter((card) => card.implemented && total >= card.minPlayers);
}

/** 该人数下「看得见但选不了」的角色（UI 置灰 + 标注门槛） */
export function lockedRoles(total: number): RoleCard[] {
  return ROLE_CATALOG.filter((card) => !card.implemented || total < card.minPlayers);
}

/** 狼人数量：6~8 人 2 狼，9~11 人 3 狼，12 人 4 狼 */
export function wolfCount(total: number): number {
  if (total >= 12) return 4;
  if (total >= 9) return 3;
  return 2;
}

/**
 * 推荐牌组：按人数给一套「有角色纵深」的标准局。
 *
 * 早期版本是「先排神职，不够的用平民补」，结果 10/12 人局只是多了几个平民 ——
 * 人数越多，信息密度反而越稀。现在按总人数显式给配方，新角色随人数登场：
 *   9 人 起有白痴（翻牌免死，制造一次「投了但没死」的转折）
 *   10 人 起有黑狼王（狼队多一个出局反打的手段）
 *   12 人 起有长老（教会好人「别乱毒」）
 */
export function recommendDeck(total: number): DeckSlot[] {
  if (total < MIN_PLAYERS || total > MAX_PLAYERS) {
    throw new Error(`人数需在 ${MIN_PLAYERS}~${MAX_PLAYERS} 之间，收到 ${total}`);
  }

  const recipe: Record<number, DeckSlot[]> = {
    6: [
      { key: 'wolf', count: 2 },
      { key: 'seer', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'villager', count: 2 },
    ],
    7: [
      { key: 'wolf', count: 2 },
      { key: 'seer', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'villager', count: 3 },
    ],
    8: [
      { key: 'wolf', count: 2 },
      { key: 'seer', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'hunter', count: 1 },
      { key: 'villager', count: 3 },
    ],
    9: [
      { key: 'wolf', count: 3 },
      { key: 'seer', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'hunter', count: 1 },
      { key: 'idiot', count: 1 },
      { key: 'villager', count: 2 },
    ],
    10: [
      { key: 'wolfking', count: 1 },
      { key: 'wolf', count: 2 },
      { key: 'seer', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'hunter', count: 1 },
      { key: 'guard', count: 1 },
      { key: 'villager', count: 3 },
    ],
    11: [
      { key: 'wolfking', count: 1 },
      { key: 'wolf', count: 2 },
      { key: 'seer', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'hunter', count: 1 },
      { key: 'guard', count: 1 },
      { key: 'idiot', count: 1 },
      { key: 'villager', count: 3 },
    ],
    12: [
      { key: 'wolfking', count: 1 },
      { key: 'wolf', count: 3 },
      { key: 'seer', count: 1 },
      { key: 'witch', count: 1 },
      { key: 'hunter', count: 1 },
      { key: 'guard', count: 1 },
      { key: 'elder', count: 1 },
      { key: 'villager', count: 3 },
    ],
  };

  const exact = recipe[total];
  if (exact) return exact.map((slot) => ({ ...slot }));

  /* 兜底：不在配方表里的总人数，按「狼数 + 存活神职 + 其余平民」拼一套合法牌组 */
  const wolves = wolfCount(total);
  const gods = ['seer', 'witch', 'hunter', 'guard', 'idiot']
    .filter((key) => cardOf(key as RoleKey).implemented && total >= cardOf(key as RoleKey).minPlayers)
    .slice(0, Math.max(0, total - wolves - 2));
  const villagers = total - wolves - gods.length;
  return [
    ...gods.map((key) => ({ key: key as RoleKey, count: 1 })),
    { key: 'wolf' as RoleKey, count: wolves },
    ...(villagers > 0 ? [{ key: 'villager' as RoleKey, count: villagers }] : []),
  ];
}

/** 把 {角色, 数量} 展开成发牌用的角色数组 */
export function expandDeck(deck: DeckSlot[]): RoleKey[] {
  const roles: RoleKey[] = [];
  for (const slot of deck) {
    for (let i = 0; i < slot.count; i++) roles.push(slot.key);
  }
  return roles;
}

/** 牌组校验：数量合计、狼人下限、神职不超过半数（PRD 4.1） */
export function validateDeck(deck: DeckSlot[], total: number): DeckCheck {
  const errors: string[] = [];
  const sum = deck.reduce((acc, slot) => acc + slot.count, 0);
  if (sum !== total) errors.push(`角色数量合计 ${sum}，与人数 ${total} 不一致`);

  const wolves = deck
    .filter((slot) => cardOrNull(slot.key)?.team === 'wolf')
    .reduce((a, s) => a + s.count, 0);
  if (wolves < 2) errors.push('狼人至少 2 名');
  if (wolves >= total / 2) errors.push('狼人不能达到半数，否则开局即结束');

  const gods = deck
    .filter((slot) => {
      const card = cardOrNull(slot.key);
      return card?.team === 'good' && slot.key !== 'villager';
    })
    .reduce((a, s) => a + s.count, 0);
  if (gods >= total / 2) errors.push('神职数量不能达到半数');

  for (const slot of deck) {
    const card = cardOrNull(slot.key);
    if (!card) {
      errors.push(`未知角色：${slot.key}`);
      continue;
    }
    if (slot.count < 0) errors.push(`${card.name} 数量不能为负`);
    if (slot.count > 0 && !card.implemented) errors.push(`${card.name} 尚未开放`);
    if (slot.count > 0 && total < card.minPlayers) errors.push(`${card.name} 需要至少 ${card.minPlayers} 人`);
  }

  return { ok: errors.length === 0, errors };
}
