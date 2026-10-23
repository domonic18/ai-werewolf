import { describe, expect, it } from 'vitest';
import { SocialStore, makeInviteCode, normalizeInviteCode } from '../src/cloud/social-store.js';

/**
 * 邀请与好友的存储层。
 *
 * 这里用一个「够用的内存库」替身：支持 select / insert / update / eq / in / order / limit，
 * 足以把聚合口径、幂等、权限承诺这些真正会出错的地方压住。不碰真实云表。
 */

type Row = Record<string, unknown>;

interface FakeTables {
  ww_profiles: Row[];
  ww_invites: Row[];
  ww_matches: Row[];
}

function fakeDb(seed: Partial<FakeTables> = {}) {
  const tables: FakeTables = {
    ww_profiles: [...(seed.ww_profiles ?? [])],
    ww_invites: [...(seed.ww_invites ?? [])],
    ww_matches: [...(seed.ww_matches ?? [])],
  };
  /** 主键/唯一约束：模拟真实表，才谈得上「幂等」 */
  const uniques: Record<string, string[]> = {
    ww_profiles: ['user_id', 'invite_code'],
    ww_invites: ['invitee_id'],
  };

  class Builder {
    private filters: { col: string; val: unknown; kind: 'eq' | 'in' }[] = [];
    private orderBy: { col: string; asc: boolean } | null = null;
    private limitN = Infinity;
    private payload: Row | null = null;
    private mode: 'select' | 'insert' | 'update' = 'select';

    constructor(private readonly table: keyof FakeTables) {}

    insert(row: Row): this {
      this.mode = 'insert';
      this.payload = row;
      return this;
    }
    update(row: Row): this {
      this.mode = 'update';
      this.payload = row;
      return this;
    }
    select(): this {
      if (this.mode !== 'insert') this.mode = 'select';
      return this;
    }
    eq(col: string, val: unknown): this {
      this.filters.push({ col, val, kind: 'eq' });
      return this;
    }
    in(col: string, vals: string[]): this {
      this.filters.push({ col, val: vals, kind: 'in' });
      return this;
    }
    order(col: string, opts: { ascending: boolean }): this {
      this.orderBy = { col, asc: opts.ascending };
      return this;
    }
    limit(n: number): this {
      this.limitN = n;
      return this;
    }

    then<T>(onFulfilled: (value: { data: unknown; error: { message?: string; code?: string } | null }) => T): Promise<T> {
      return Promise.resolve(this.run()).then(onFulfilled);
    }

    private match(row: Row): boolean {
      return this.filters.every((f) =>
        f.kind === 'eq' ? row[f.col] === f.val : (f.val as string[]).includes(String(row[f.col] ?? '')),
      );
    }

    private run(): { data: unknown; error: { message?: string; code?: string } | null } {
      const rows = tables[this.table];

      if (this.mode === 'insert') {
        const row = { ...(this.payload ?? {}) };
        for (const key of uniques[this.table] ?? []) {
          if (rows.some((existing) => existing[key] === row[key])) {
            return { data: null, error: { message: 'duplicate key', code: '23505' } };
          }
        }
        rows.push(row);
        return { data: null, error: null };
      }

      if (this.mode === 'update') {
        const hit = rows.filter((row) => this.match(row));
        for (const row of hit) Object.assign(row, this.payload);
        return { data: null, error: null };
      }

      let result = rows.filter((row) => this.match(row));
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        result = [...result].sort((a, b) => {
          const av = String(a[col] ?? '');
          const bv = String(b[col] ?? '');
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      return { data: result.slice(0, this.limitN), error: null };
    }
  }

  const database = { from: (table: string) => new Builder(table as keyof FakeTables) };
  const cloud = { database } as never;
  return { cloud, tables };
}

const daysAgo = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString();

describe('邀请码', () => {
  it('形如 YEKE-7F2：4 字母 + 3 位，且不含易混的 O/0/I/1', () => {
    for (let i = 0; i < 50; i++) {
      const code = makeInviteCode();
      expect(code).toMatch(/^[A-Z]{4}-[0-9A-Z]{3}$/);
      expect(code.slice(0, 4)).not.toMatch(/[OI]/);
      expect(code.slice(5)).not.toMatch(/[OI01]/);
    }
  });

  it('规范化：大小写、空格、缺连字符都认；形状不对就返回空', () => {
    expect(normalizeInviteCode('yeke-7f2')).toBe('YEKE-7F2');
    expect(normalizeInviteCode(' YEKE7F2 ')).toBe('YEKE-7F2');
    expect(normalizeInviteCode('ye ke 7f2')).toBe('YEKE-7F2');
    expect(normalizeInviteCode('abc')).toBe('');
    expect(normalizeInviteCode(null)).toBe('');
    expect(normalizeInviteCode('1234-ABC')).toBe('');
  });
});

describe('资料：一个账号一个码', () => {
  it('首次调用生成邀请码，第二次原样返回', async () => {
    const { cloud } = fakeDb();
    const store = new SocialStore(cloud);

    const first = await store.ensureProfile('u1', '夜客');
    expect(first?.invite_code).toMatch(/^[A-Z]{4}-[0-9A-Z]{3}$/);

    const again = await store.ensureProfile('u1');
    expect(again?.invite_code).toBe(first?.invite_code);
    expect(again?.nickname).toBe('夜客');
  });

  it('只读环境（staging）不写库，返回 null 让上层降级', async () => {
    const { cloud, tables } = fakeDb();
    const store = new SocialStore(cloud, { readOnly: true });
    expect(await store.ensureProfile('u1')).toBeNull();
    expect(tables.ww_profiles).toHaveLength(0);
  });

  it('改名与开关只动这两项，邀请码不变', async () => {
    const { cloud } = fakeDb({ ww_profiles: [{ user_id: 'u1', nickname: null, invite_code: 'ABCD-234', hide_stats: false }] });
    const store = new SocialStore(cloud);

    const updated = await store.updateProfile('u1', { nickname: '守夜人', hideStats: true });
    expect(updated?.nickname).toBe('守夜人');
    expect(updated?.hide_stats).toBe(true);
    expect(updated?.invite_code).toBe('ABCD-234');
  });
});

describe('邀请关系：只记第一条', () => {
  const seed = { ww_profiles: [{ user_id: 'inviter', nickname: '老K', invite_code: 'ABCD-234', hide_stats: false }] };

  it('正常绑定并回传邀请人昵称', async () => {
    const { cloud, tables } = fakeDb(seed);
    const store = new SocialStore(cloud);

    const result = await store.bind('abcd-234', 'newbie');
    expect(result.status).toBe('bound');
    expect(result.inviterName).toBe('老K');
    expect(tables.ww_invites).toEqual([{ invitee_id: 'newbie', inviter_id: 'inviter' }]);
  });

  it('重复绑定幂等：仍是 exists，不新增第二行', async () => {
    const { cloud, tables } = fakeDb(seed);
    const store = new SocialStore(cloud);

    await store.bind('ABCD-234', 'newbie');
    const again = await store.bind('ABCD-234', 'newbie');
    expect(again.status).toBe('exists');
    expect(tables.ww_invites).toHaveLength(1);
  });

  it('别人再来邀请同一个账号，不覆盖第一个邀请人', async () => {
    const { cloud, tables } = fakeDb({
      ...seed,
      ww_profiles: [
        ...seed.ww_profiles,
        { user_id: 'another', nickname: '小满', invite_code: 'WXYZ-567', hide_stats: false },
      ],
    });
    const store = new SocialStore(cloud);

    await store.bind('ABCD-234', 'newbie');
    const second = await store.bind('WXYZ-567', 'newbie');
    expect(second.status).toBe('exists');
    expect(tables.ww_invites).toHaveLength(1);
    expect(tables.ww_invites[0]?.inviter_id).toBe('inviter');
  });

  it('不能邀请自己', async () => {
    const { cloud } = fakeDb(seed);
    const store = new SocialStore(cloud);
    expect((await store.bind('ABCD-234', 'inviter')).status).toBe('self');
  });

  it('码不存在时明确回报，不写库', async () => {
    const { cloud, tables } = fakeDb(seed);
    const store = new SocialStore(cloud);
    expect((await store.bind('ZZZZ-999', 'newbie')).status).toBe('bad-code');
    expect(tables.ww_invites).toHaveLength(0);
  });
});

describe('我邀请的朋友：聚合口径', () => {
  const profiles = [
    { user_id: 'me', nickname: '米粒', invite_code: 'MEXX-234', hide_stats: false },
    { user_id: 'a', nickname: '阿岚', invite_code: 'AAAA-234', hide_stats: false },
    { user_id: 'b', nickname: null, invite_code: 'BBBB-234', hide_stats: true },
    { user_id: 'c', nickname: '迟到者', invite_code: 'CCCC-234', hide_stats: false },
  ];
  const invites = [
    { invitee_id: 'a', inviter_id: 'me', created_at: daysAgo(2) },
    { invitee_id: 'b', inviter_id: 'me', created_at: daysAgo(3) },
    { invitee_id: 'c', inviter_id: 'me', created_at: daysAgo(200) },
  ];
  const matches = [
    /* a：3 局 2 胜（狼人赢那局要算胜，好人输那局算负） */
    { owner_id: 'a', player_name: '阿岚', player_role: '狼人', result: 'wolf', created_at: daysAgo(1) },
    { owner_id: 'a', player_name: '阿岚', player_role: '村民', result: 'wolf', created_at: daysAgo(1) },
    { owner_id: 'a', player_name: '阿岚', player_role: '预言家', result: 'good', created_at: daysAgo(2) },
    /* b：1 局，且关了公开 */
    { owner_id: 'b', player_name: '匿名的他', player_role: '村民', result: 'good', created_at: daysAgo(3) },
    /* c：200 天前打过一局 —— 很久没来 */
    { owner_id: 'c', player_name: '迟到者', player_role: '村民', result: 'good', created_at: daysAgo(200) },
    /* 别人的局不该混进来 */
    { owner_id: 'stranger', player_name: '路人', player_role: '村民', result: 'good', created_at: daysAgo(1) },
  ];

  it('按各自身份判胜负；关闭公开的人只留「在玩」', async () => {
    const { cloud } = fakeDb({ ww_profiles: profiles, ww_invites: invites, ww_matches: matches });
    const store = new SocialStore(cloud);
    const friends = await store.listFriends('me');

    const a = friends.find((f) => f.name === '阿岚');
    expect(a).toMatchObject({ games: 3, wins: 2, hidden: false, stale: false });

    const b = friends.find((f) => f.name === '匿名的他');
    /* 昵称没填 → 回落到最近一局用的代号；关了公开则连数字都不返回（不是靠前端遮） */
    expect(b).toMatchObject({ hidden: true, games: 0, wins: 0 });

    /* 不认识的账号绝不出现在列表里 */
    expect(friends.some((f) => f.name === '路人')).toBe(false);
  });

  it('很久没来的沉底并打标，不被静默删除', async () => {
    const { cloud } = fakeDb({ ww_profiles: profiles, ww_invites: invites, ww_matches: matches });
    const store = new SocialStore(cloud);
    const friends = await store.listFriends('me');

    expect(friends).toHaveLength(3);
    expect(friends.at(-1)?.name).toBe('迟到者');
    expect(friends.at(-1)?.stale).toBe(true);
  });

  it('按最近活跃倒序', async () => {
    const { cloud } = fakeDb({ ww_profiles: profiles, ww_invites: invites, ww_matches: matches });
    const store = new SocialStore(cloud);
    const friends = await store.listFriends('me');
    expect(friends.map((f) => f.name)).toEqual(['阿岚', '匿名的他', '迟到者']);
  });

  it('没邀请过任何人时返回空数组', async () => {
    const { cloud } = fakeDb({ ww_profiles: profiles });
    expect(await new SocialStore(cloud).listFriends('me')).toEqual([]);
  });
});

describe('落地页预览', () => {
  it('凭邀请码给出昵称与聚合战绩', async () => {
    const { cloud } = fakeDb({
      ww_profiles: [{ user_id: 'me', nickname: '米粒', invite_code: 'MEXX-234', hide_stats: false }],
      ww_matches: [
        { owner_id: 'me', player_role: '狼人', result: 'wolf', created_at: daysAgo(1) },
        { owner_id: 'me', player_role: '村民', result: 'wolf', created_at: daysAgo(1) },
      ],
    });
    const store = new SocialStore(cloud);
    await expect(store.preview('mexx234')).resolves.toEqual({ code: 'MEXX-234', name: '米粒', games: 2, wins: 1 });
  });

  it('码不存在返回 null', async () => {
    const { cloud } = fakeDb();
    await expect(new SocialStore(cloud).preview('MEXX-234')).resolves.toBeNull();
  });
});
