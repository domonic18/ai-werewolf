import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import { createOwnerResolver } from '../src/server/auth.js';
import type { TokenVerifier } from '../src/server/auth.js';
import type { LLMService } from '../src/server/llm-service.js';
import type { LiveResponse } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';

/**
 * 账号闭环：登录态要真的影响服务端行为。
 *
 * 之前 `resolveOwner` 这条通道铺好了却没人注入，服务端一律按匿名处理 ——
 * 登录只是「能登进去」，对局不归属账号，换设备也查不到。这组用例守住这条线。
 */
const mock = createMockLLM();

const llmStub: LLMService = {
  state: 'ready',
  models: [{ id: 'mock', name: 'Mock' }],
  model: { id: 'mock' },
  get callCount(): number {
    return mock.callCount;
  },
  label: () => 'mock',
  listModels: () => [{ id: 'mock', name: 'Mock', credits: null }],
  selectModel: (id: string) => ({ id }),
  selfTest: async () => ({ ok: true, sec: '0.0', model: 'mock' }),
  task: mock.task,
};

/* 假校验器：token 直接就是账号 id，省掉一次云端往返 */
const verifier: TokenVerifier = {
  async verify(token: string) {
    return token.startsWith('tok-') ? token.slice(4) : null;
  },
};

let server: Server;
let base: string;

const authHeaders = (token?: string): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const get = async <T>(path: string, token?: string): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path, { headers: authHeaders(token) });
  return { status: res.status, body: (await res.json()) as T };
};

const post = async <T>(
  path: string,
  body: unknown,
  token?: string,
  playerToken?: string,
): Promise<{ status: number; body: T }> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders(token) };
  if (playerToken) headers['X-Player-Token'] = playerToken;
  const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
};

beforeAll(async () => {
  const rooms = new RoomManager({ llm: llmStub, pace: 0.05 });
  const app = createApp({
    llm: llmStub,
    rooms,
    matchStore: new MatchStore(null),
    resolveOwner: createOwnerResolver(verifier),
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  server = app;
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('账号闭环（登录态 → 服务端归属）', () => {
  it('登录开局后，换设备用同一账号能在「我的对局」看到它', async () => {
    const created = await post<{ gameId: string; playerToken: string }>(
      '/api/games',
      { playerName: '甲' },
      'tok-alice',
    );
    expect(created.status).toBe(200);

    /* 模拟换设备：没有本机存档，只带账号 */
    const mine = await get<LiveResponse>('/api/live?filter=mine', 'tok-alice');
    expect(mine.status).toBe(200);
    expect(mine.body.games.map((g) => g.gameId)).toContain(created.body.gameId);
  });

  it('别人的账号看不到我这一局', async () => {
    const mine = await get<LiveResponse>('/api/live?filter=mine', 'tok-bob');
    expect(mine.body.games).toHaveLength(0);
  });

  it('未登录也没本机对局 id 时，「我的对局」不会退化成全部对局', async () => {
    const all = await get<LiveResponse>('/api/live?filter=all');
    const mine = await get<LiveResponse>('/api/live?filter=mine');
    expect(all.body.total).toBeGreaterThan(0);
    expect(mine.body.games).toHaveLength(0);
  });

  it('匿名局不写账号归属', async () => {
    const created = await post<{ gameId: string }>('/api/games', { playerName: '匿名' });
    const mine = await get<LiveResponse>('/api/live?filter=mine', 'tok-alice');
    expect(mine.body.games.map((g) => g.gameId)).not.toContain(created.body.gameId);
  });

  it('坏 token 至少不能冒充别人：降级为匿名，不报错也不阻塞开局', async () => {
    const created = await post<{ gameId: string }>('/api/games', { playerName: '丙' }, 'not-a-token');
    expect(created.status).toBe(200);

    const mine = await get<LiveResponse>('/api/live?filter=mine', 'tok-alice');
    expect(mine.body.games.map((g) => g.gameId)).not.toContain(created.body.gameId);
  });

  it('战绩接口 mine=1 未登录时回落全网，不报错', async () => {
    const res = await get<{ stats: unknown; scope?: string }>('/api/matches?mine=1');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('all');
  });

  it('战绩接口 mine=1 登录后按账号取', async () => {
    const res = await get<{ stats: unknown; scope?: string }>('/api/matches?mine=1', 'tok-alice');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('mine');
  });
});
