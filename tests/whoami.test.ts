import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import type { LLMService } from '../src/server/llm-service.js';
import type { WhoAmIResponse } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';
import { permissiveLimiters } from './helpers/limiters.js';

/**
 * /api/whoami：把「服务端有没有认出我」变成一个可以直接打开看的答案。
 *
 * 起因是线上「登录后战绩还是全网口径」——服务端静默降级成匿名，前端却无从判断
 * 原因（token 过期？网关拒了？网络不通？）。这个接口只回布尔与状态码，不回 token 与账号 id。
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

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    llm,
    rooms: new RoomManager({ llm, pace: 0.05 }),
    matchStore: new MatchStore(null),
    limiters: permissiveLimiters(),
    /* 只在 token 等于 'good-token' 时认人，其它一律探测出 401 */
    resolveOwner: async (req) => {
      /* 与 createOwnerResolver 一致：优先自定义头（线上网关会覆盖 Authorization） */
      const custom = req.headers['x-ww-token'];
      const token = typeof custom === 'string' ? custom : String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      return token === 'good-token' ? 'user-1' : null;
    },
    probeOwner: async (token) => ({ userId: null, status: token ? 401 : 'network' }),
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  server = app;
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const get = async (path: string, token?: string): Promise<WhoAmIResponse> => {
  const res = await fetch(base + path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  return (await res.json()) as WhoAmIResponse;
};

describe('/api/whoami', () => {
  it('没带 token：明确说没登录，不去打云端', async () => {
    await expect(get('/api/whoami')).resolves.toMatchObject({ signedIn: false, reason: 'no-token' });
  });

  it('带了能认的 token：signedIn 为 true', async () => {
    await expect(get('/api/whoami', 'good-token')).resolves.toMatchObject({ signedIn: true });
  });

  it('带了认不出的 token：给出云端状态码，便于定位是过期还是网关拒绝', async () => {
    await expect(get('/api/whoami', 'expired-token')).resolves.toMatchObject({
      signedIn: false,
      reason: 'unresolved',
      status: 401,
    });
  });

  it('自定义头 x-ww-token 优先：网关会覆盖 Authorization，用户 token 只能走这里', async () => {
    const res = await fetch(`${base}/api/whoami`, {
      headers: { Authorization: 'Bearer gateway-token', 'X-WW-Token': 'good-token' },
    });
    await expect(res.json()).resolves.toMatchObject({ signedIn: true });
  });

  it('不泄露 token 与账号 id', async () => {
    const body = await fetch(`${base}/api/whoami`, { headers: { Authorization: 'Bearer secret-token' } }).then(
      (r) => r.text(),
    );
    expect(body).not.toContain('secret-token');
    expect(body).not.toContain('user-1');
  });
});
