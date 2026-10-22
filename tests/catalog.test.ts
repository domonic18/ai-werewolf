import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROLE_CATALOG,
  availableRoles,
  lockedRoles,
  recommendDeck,
  validateDeck,
  wolfCount,
} from '../src/game/catalog.js';

const sum = (deck: { count: number }[]): number => deck.reduce((a, s) => a + s.count, 0);

describe('角色库', () => {
  it('每个角色都有唯一 key 与人数门槛', () => {
    const keys = ROLE_CATALOG.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const card of ROLE_CATALOG) expect(card.minPlayers).toBeGreaterThanOrEqual(MIN_PLAYERS);
  });

  it('已实装角色：基础四角色 + 猎人 + 守卫', () => {
    expect(ROLE_CATALOG.filter((c) => c.implemented).map((c) => c.key).sort()).toEqual([
      'guard',
      'hunter',
      'seer',
      'villager',
      'witch',
      'wolf',
    ]);
  });

  it('6 人局只能选基础角色，猎人/守卫按门槛锁住', () => {
    expect(availableRoles(6).map((c) => c.key).sort()).toEqual(['seer', 'villager', 'witch', 'wolf']);
    const locked = lockedRoles(6).map((c) => c.key);
    expect(locked).toContain('hunter');
    expect(locked).toContain('guard');
    expect(locked).toContain('dreamweaver');
  });

  it('8 人局同时开放猎人与守卫（门槛都是 8）', () => {
    const at8 = availableRoles(8).map((c) => c.key);
    expect(at8).toContain('hunter');
    expect(at8).toContain('guard');
    /* 白痴要 9 人，且尚未实装 → 任何人数下都不可选 */
    expect(at8).not.toContain('idiot');
    expect(availableRoles(9).map((c) => c.key)).not.toContain('idiot');
  });
});

describe('狼人数量', () => {
  it('随人数分档', () => {
    expect(wolfCount(6)).toBe(2);
    expect(wolfCount(8)).toBe(2);
    expect(wolfCount(9)).toBe(3);
    expect(wolfCount(11)).toBe(3);
    expect(wolfCount(12)).toBe(4);
  });
});

describe('推荐牌组', () => {
  it('6 人局就是当前的基础牌组', () => {
    const deck = recommendDeck(6);
    expect(sum(deck)).toBe(6);
    expect(deck.find((s) => s.key === 'wolf')?.count).toBe(2);
    expect(deck.find((s) => s.key === 'villager')?.count).toBe(2);
    expect(validateDeck(deck, 6).ok).toBe(true);
  });

  it('8 人局推荐含猎人，9 人局再加守卫与第 3 狼', () => {
    const eight = recommendDeck(8);
    expect(sum(eight)).toBe(8);
    expect(eight.find((s) => s.key === 'hunter')?.count).toBe(1);
    expect(validateDeck(eight, 8).ok).toBe(true);

    const nine = recommendDeck(9);
    expect(sum(nine)).toBe(9);
    expect(nine.find((s) => s.key === 'guard')?.count).toBe(1);
    expect(nine.find((s) => s.key === 'wolf')?.count).toBe(3);
    expect(validateDeck(nine, 9).ok).toBe(true);
  });

  it('每个合法人数都能给出能通过校验的牌组', () => {
    for (let total = MIN_PLAYERS; total <= MAX_PLAYERS; total++) {
      const deck = recommendDeck(total);
      const check = validateDeck(deck, total);
      expect(check.ok, `${total} 人局：${check.errors.join('；')}`).toBe(true);
      expect(sum(deck)).toBe(total);
    }
  });

  it('人数越界直接报错，不返回半成品', () => {
    expect(() => recommendDeck(5)).toThrow();
    expect(() => recommendDeck(13)).toThrow();
  });
});

describe('牌组校验', () => {
  it('数量不符要报错', () => {
    expect(validateDeck([{ key: 'wolf', count: 2 }], 6).errors[0]).toContain('不一致');
  });

  it('狼人过少或达到半数都要报错', () => {
    expect(validateDeck([{ key: 'wolf', count: 1 }, { key: 'villager', count: 5 }], 6).ok).toBe(false);
    const tooMany = validateDeck([{ key: 'wolf', count: 3 }, { key: 'villager', count: 3 }], 6);
    expect(tooMany.errors.join()).toContain('半数');
  });

  it('未实装角色与人数不足的角色都不能进牌组', () => {
    /* 长老最快要 10 人，且尚未实装 */
    const locked = validateDeck(
      [
        { key: 'wolf', count: 2 },
        { key: 'elder', count: 1 },
        { key: 'villager', count: 3 },
      ],
      6,
    );
    expect(locked.ok).toBe(false);
    expect(locked.errors.join()).toContain('尚未开放');

    /* 猎人在 6 人局人数不够，同样拒绝 */
    const tooFew = validateDeck(
      [
        { key: 'wolf', count: 2 },
        { key: 'hunter', count: 1 },
        { key: 'villager', count: 3 },
      ],
      6,
    );
    expect(tooFew.ok).toBe(false);
    expect(tooFew.errors.join()).toContain('至少 8 人');
  });
});
