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

  it('已实装角色：基础四角色 + 猎人 + 守卫 + 白痴 + 长老 + 黑狼王', () => {
    expect(ROLE_CATALOG.filter((c) => c.implemented).map((c) => c.key).sort()).toEqual([
      'elder',
      'guard',
      'hunter',
      'idiot',
      'seer',
      'villager',
      'witch',
      'wolf',
      'wolfking',
    ]);
  });

  it('6 人局只能选基础角色，猎人/守卫按门槛锁住', () => {
    expect(availableRoles(6).map((c) => c.key).sort()).toEqual(['seer', 'villager', 'witch', 'wolf']);
    const locked = lockedRoles(6).map((c) => c.key);
    expect(locked).toContain('hunter');
    expect(locked).toContain('guard');
    expect(locked).toContain('dreamweaver');
  });

  it('8 人局开放猎人与守卫；白痴 9 人起、长老与黑狼王 10 人起', () => {
    const at8 = availableRoles(8).map((c) => c.key);
    expect(at8).toContain('hunter');
    expect(at8).toContain('guard');
    expect(at8).not.toContain('idiot');

    const at9 = availableRoles(9).map((c) => c.key);
    expect(at9).toContain('idiot');
    expect(at9).not.toContain('elder');

    const at10 = availableRoles(10).map((c) => c.key);
    expect(at10).toContain('elder');
    expect(at10).toContain('wolfking');
    /* 摄梦人还没实装，任何人数下都只能看不能选 */
    expect(at10).not.toContain('dreamweaver');
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

  it('8 人局含猎人，9 人局上白痴与第 3 狼，10 人局上黑狼王与守卫', () => {
    const eight = recommendDeck(8);
    expect(sum(eight)).toBe(8);
    expect(eight.find((s) => s.key === 'hunter')?.count).toBe(1);
    expect(validateDeck(eight, 8).ok).toBe(true);

    const nine = recommendDeck(9);
    expect(sum(nine)).toBe(9);
    expect(nine.find((s) => s.key === 'idiot')?.count).toBe(1);
    expect(nine.find((s) => s.key === 'wolf')?.count).toBe(3);
    expect(validateDeck(nine, 9).ok).toBe(true);

    const ten = recommendDeck(10);
    expect(sum(ten)).toBe(10);
    expect(ten.find((s) => s.key === 'wolfking')?.count).toBe(1);
    expect(ten.find((s) => s.key === 'guard')?.count).toBe(1);
    expect(validateDeck(ten, 10).ok).toBe(true);

    /* 12 人局要有长老：人数上去，角色也要有纵深，而不是只多几个平民 */
    const twelve = recommendDeck(12);
    expect(twelve.find((s) => s.key === 'elder')?.count).toBe(1);
    expect(validateDeck(twelve, 12).ok).toBe(true);
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
    /* 摄梦人尚未实装：即使人数够也不能进牌组 */
    const notImplemented = validateDeck(
      [
        { key: 'wolf', count: 3 },
        { key: 'dreamweaver', count: 1 },
        { key: 'villager', count: 8 },
      ],
      12,
    );
    expect(notImplemented.ok).toBe(false);
    expect(notImplemented.errors.join()).toContain('尚未开放');

    /* 长老要 10 人，6 人局人数不够 */
    const locked = validateDeck(
      [
        { key: 'wolf', count: 2 },
        { key: 'elder', count: 1 },
        { key: 'villager', count: 3 },
      ],
      6,
    );
    expect(locked.ok).toBe(false);
    expect(locked.errors.join()).toContain('至少 10 人');

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
