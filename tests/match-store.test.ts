import { describe, expect, it, vi } from 'vitest';
import { MatchStore } from '../src/cloud/match-store.js';

/**
 * 战绩归属：登录后这一局必须记在账号下，否则「我的战绩」永远是空的。
 * 这里用假 database 链式对象，只断言「写了什么、按什么过滤」，不碰真实云表。
 */
function fakeDb() {
  const calls: { op: string; args: unknown[] }[] = [];
  const result = { data: null as unknown, error: null as { message?: string } | null };

  const builder: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  builder.insert = record('insert');
  builder.select = record('select');
  builder.eq = record('eq');
  builder.order = record('order');
  builder.limit = record('limit');
  builder.single = () => Promise.resolve(result);
  builder.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);

  /* MatchStore 从 cloud.database 取库，所以这里要包一层 */
  const db = { database: { from: (table: string) => (calls.push({ op: 'from', args: [table] }), builder) } };
  return { db, calls, result };
}

const archiveRow = {
  playerName: '我',
  playerRole: 'hunter',
  result: 'good',
  rounds: 3,
  survivors: 4,
  detail: {},
} as unknown as Parameters<MatchStore['save']>[0];

describe('MatchStore 战绩归属', () => {
  it('登录局写入 owner_id', async () => {
    const { db, calls } = fakeDb();
    const store = new MatchStore(db as never);

    await store.save(archiveRow, 'user-1');

    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toMatchObject({ owner_id: 'user-1', player_role: 'hunter' });
  });

  it('匿名局写 null，不伪造归属', async () => {
    const { db, calls } = fakeDb();
    const store = new MatchStore(db as never);

    await store.save(archiveRow);

    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.args[0]).toMatchObject({ owner_id: null });
  });

  it('按账号查最近战绩会带 eq 过滤', async () => {
    const { db, calls } = fakeDb();
    const store = new MatchStore(db as never);

    await store.recent(8, 'user-1');

    expect(calls.some((c) => c.op === 'eq' && c.args[0] === 'owner_id' && c.args[1] === 'user-1')).toBe(true);
  });

  it('全网战绩不加过滤（匿名也能看战绩墙）', async () => {
    const { db, calls } = fakeDb();
    const store = new MatchStore(db as never);

    await store.recent(8);

    expect(calls.some((c) => c.op === 'eq')).toBe(false);
  });

  it('个人战绩按「自己那一局的身份」判胜负（表里存的是中文角色名）', async () => {
    const { db, result } = fakeDb();
    /*
     * 关键：引擎写库时 player_role 是 ROLES[...].name（「狼人」「黑狼王」「村民」），不是 key。
     * 只认 'wolf' 会让 isWolf 永远为 false，狼人赢的局被判成输 —— 这条用例就是防这个。
     */
    result.data = [
      { result: 'good', player_role: '村民' }, // 好人阵赢，我是好人 → 胜
      { result: 'wolf', player_role: '村民' }, // 狼人阵赢，我是好人 → 负
      { result: 'wolf', player_role: '狼人' }, // 狼人阵赢，我是狼 → 胜
      { result: 'good', player_role: '黑狼王' }, // 好人阵赢，我是狼王 → 负
      { result: 'wolf', player_role: '黑狼王' }, // 狼人阵赢，我是狼王 → 胜
      { result: 'aborted', player_role: '预言家' }, // 中止：不计入胜率
    ];
    const store = new MatchStore(db as never);

    await expect(store.personalStats('user-1')).resolves.toEqual({ total: 5, wins: 3, aborted: 1 });
  });

  it('兼容早期按角色 key 存的行', async () => {
    const { db, result } = fakeDb();
    result.data = [
      { result: 'wolf', player_role: 'wolf' },
      { result: 'good', player_role: 'villager' },
      { result: 'good', player_role: 'wolf' },
    ];
    const store = new MatchStore(db as never);

    await expect(store.personalStats('user-1')).resolves.toEqual({ total: 3, wins: 2, aborted: 0 });
  });

  it('staging 只读模式不写库', async () => {
    const { db, calls } = fakeDb();
    const store = new MatchStore(db as never, { readOnly: true });

    const saved = await store.save(archiveRow, 'user-1');

    expect(saved).toEqual({ ok: false, error: 'staging_read_only' });
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
  });
});
