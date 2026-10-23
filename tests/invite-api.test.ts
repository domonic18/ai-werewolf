import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import type { SocialStore } from '../src/cloud/social-store.js';
import type { LLMService } from '../src/server/llm-service.js';
import type { BindInviteResponse, InviteOverviewResponse, InvitePreviewResponse } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';
import { permissiveLimiters } from './helpers/limiters.js';

/**
 * 邀请相关接口的契约。
 *
 * 重点不是 happy path，而是三条承诺：
 * 1. 未登录不能读/写别人的邀请关系（401）；
 * 2. 邀请码无效时明确回 bad-code，不写库、不假装成功；
 * 3. 改资料时把昵称洗干净（控制字符、超长），避免污染朋友列表与 AI prompt。
 */
const mock = createMockLLM();
const llm: LLMService = {
  state: 'ready',
  models: [{ id: 'mock' }],
  model: { id: 'mock' },
  get callCount(): number {
    return mock.callCount;
  },
  label: () => 'mock',
  listModels: () => [{ id: 'mock', name: 'Mock' }],
  selectModel: (id: string) => ({ id }),
  selfTest: async () => ({ ok: true, sec: '0.0', model: 'mock' }),
  task: mock.task,
};

/** 只实现路由用到的几个方法；行为由用例按需改 */
function fakeSocial(): SocialStore & { binds: string[]; patches: Record<string, unknown>[] } {
  const binds: string[] = [];
  const patches: Record<string, unknown>[] = [];
  const store = {
    binds,
    patches,
    ensureProfile: async (userId: string) => ({
      user_id: userId,
      nickname: '夜客',
      avatar_url: null,
      invite_code: 'YEKE-7F2',
      hide_stats: false,
    }),
    listFriends: async () => [
      {
        name: '阿岚',
        games: 3,
        wins: 2,
        lastPlayedAt: new Date().toISOString(),
        hidden: false,
        stale: false,
      },
    ],
    inviterOf: async () => null,
    preview: async (code: string) =>
      code === 'YEKE-7F2' ? { code, name: '夜客', games: 4, wins: 1 } : null,
    bind: async (code: string, invitee: string) => {
      binds.push(`${code}->${invitee}`);
      return code === 'YEKE-7F2'
        ? { status: 'bound' as const, inviterName: '夜客' }
        : { status: 'bad-code' as const };
    },
    updateProfile: async (userId: string, patch: Record<string, unknown>) => {
      patches.push({ userId, ...patch });
      return {
        user_id: userId,
        nickname: (patch.nickname as string | null) ?? '夜客',
        avatar_url: null,
        invite_code: 'YEKE-7F2',
        hide_stats: patch.hideStats === true,
      };
    },
  };
  return store as unknown as SocialStore & { binds: string[]; patches: Record<string, unknown>[] };
}

const social = fakeSocial();

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    llm,
    rooms: new RoomManager({ llm, pace: 0.05 }),
    matchStore: new MatchStore(null),
    socialStore: social,
    limiters: permissiveLimiters(),
    resolveOwner: async (req) => {
      const custom = req.headers['x-ww-token'];
      const token = typeof custom === 'string' ? custom : String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      return token === 'good-token' ? 'user-1' : null;
    },
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  server = app;
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const headers = (token?: string): Record<string, string> =>
  token ? { 'X-WW-Token': token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

describe('GET /api/invite', () => {
  it('未登录 401：邀请关系是账号级数据', async () => {
    const res = await fetch(`${base}/api/invite`, { headers: headers() });
    expect(res.status).toBe(401);
  });

  it('登录后返回邀请码与朋友列表', async () => {
    const res = await fetch(`${base}/api/invite`, { headers: headers('good-token') });
    const body = (await res.json()) as InviteOverviewResponse;
    expect(body.available).toBe(true);
    expect(body.code).toBe('YEKE-7F2');
    expect(body.friends).toHaveLength(1);
    expect(body.friends[0]).toMatchObject({ name: '阿岚', games: 3, wins: 2 });
  });
});

describe('GET /api/invite/preview', () => {
  it('有效邀请码返回邀请人聚合战绩（公开，不需要登录）', async () => {
    const res = await fetch(`${base}/api/invite/preview?ref=yeke7f2`);
    const body = (await res.json()) as InvitePreviewResponse;
    expect(body).toMatchObject({ ok: true, name: '夜客', games: 4, wins: 1 });
  });

  it('无效邀请码 ok=false，不抛错', async () => {
    const res = await fetch(`${base}/api/invite/preview?ref=ZZZZ999`);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('形状不对的 ref 直接判无效，不请求存储层', async () => {
    const res = await fetch(`${base}/api/invite/preview?ref=abc`);
    expect(await res.json()).toEqual({ ok: false });
  });
});

describe('POST /api/invite/bind', () => {
  it('未登录 401', async () => {
    const res = await fetch(`${base}/api/invite/bind`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ref: 'YEKE-7F2' }),
    });
    expect(res.status).toBe(401);
  });

  it('登录后把关系记在自己名下（规范化后再写）', async () => {
    social.binds.length = 0;
    const res = await fetch(`${base}/api/invite/bind`, {
      method: 'POST',
      headers: headers('good-token'),
      body: JSON.stringify({ ref: 'ye ke 7f2' }),
    });
    const body = (await res.json()) as BindInviteResponse;
    expect(body).toMatchObject({ ok: true, status: 'bound', inviterName: '夜客' });
    expect(social.binds).toEqual(['YEKE-7F2->user-1']);
  });

  it('垃圾 ref 回 bad-code，不调用存储层', async () => {
    social.binds.length = 0;
    const res = await fetch(`${base}/api/invite/bind`, {
      method: 'POST',
      headers: headers('good-token'),
      body: JSON.stringify({ ref: 'hello' }),
    });
    expect(await res.json()).toMatchObject({ ok: false, status: 'bad-code' });
    expect(social.binds).toEqual([]);
  });
});

describe('POST /api/profile', () => {
  it('未登录 401', async () => {
    const res = await fetch(`${base}/api/profile`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ nickname: '夜客' }),
    });
    expect(res.status).toBe(401);
  });

  it('昵称去掉控制字符并限长', async () => {
    social.patches.length = 0;
    const res = await fetch(`${base}/api/profile`, {
      method: 'POST',
      headers: headers('good-token'),
      body: JSON.stringify({ nickname: '夜\u0000客\u200b超长超长超长超长超长超长超长' }),
    });
    const body = (await res.json()) as { ok: boolean; nickname: string };
    expect(body.ok).toBe(true);
    expect(body.nickname).not.toContain('\u0000');
    expect(body.nickname.length).toBeLessThanOrEqual(12);
  });

  it('没有任何可改字段时 400', async () => {
    const res = await fetch(`${base}/api/profile`, {
      method: 'POST',
      headers: headers('good-token'),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
