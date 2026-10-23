import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import { EventStore, hashActor } from '../src/cloud/event-store.js';
import type { EventStore as EventStoreType } from '../src/cloud/event-store.js';
import type { SocialStore } from '../src/cloud/social-store.js';
import type { LLMService } from '../src/server/llm-service.js';
import type { TrackResponse, TrackSummaryResponse } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';
import { permissiveLimiters } from './helpers/limiters.js';

/**
 * 埋点接口的契约。
 *
 * 这门功能的风险不在“少记一条”，而在“记了不该记的”：
 * 事件名必须窄（四个），身份必须不可逆（哈希），汇总必须登录才能看。
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

/** 只记录「收到了什么」，用来断言服务端传下去的内容 */
function fakeEvents(): EventStoreType & { seen: { name: string; meta: Record<string, unknown> }[] } {
  const seen: { name: string; meta: Record<string, unknown> }[] = [];
  return {
    seen,
    available: true,
    record: async (name: string, meta: Record<string, unknown> = {}) => {
      seen.push({ name, meta });
    },
    summary: async (days: number) => [
      { name: 'share_click', count: 3 },
      { name: 'landing', count: days },
    ],
  } as unknown as EventStoreType & { seen: { name: string; meta: Record<string, unknown> }[] };
}

const events = fakeEvents();

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    llm,
    rooms: new RoomManager({ llm, pace: 0.05 }),
    matchStore: new MatchStore(null),
    socialStore: {} as SocialStore,
    eventStore: events,
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

const post = async (body: unknown): Promise<Response> =>
  fetch(`${base}/api/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/track', () => {
  it('白名单内的事件照收，登录时带哈希标识', async () => {
    events.seen.length = 0;
    const res = await post({ event: 'share_click' });
    expect(await res.json()).toEqual<TrackResponse>({ ok: true });
    expect(events.seen[0]?.name).toBe('share_click');
  });

  it('未知事件 400，不落库', async () => {
    events.seen.length = 0;
    const res = await post({ event: 'whatever' });
    expect(res.status).toBe(400);
    expect(events.seen).toHaveLength(0);
  });

  it('落地事件带 ref 时只保留邀请码形状（防脏数据）', async () => {
    events.seen.length = 0;
    await post({ event: 'landing', ref: 'ye ke 7f2' });
    expect(events.seen[0]?.meta.ref).toBe('YEKE-7F2');

    events.seen.length = 0;
    await post({ event: 'landing', ref: '随便什么' });
    expect(events.seen[0]?.meta.ref).toBeNull();
  });
});

describe('GET /api/track/summary', () => {
  it('未登录 401：统计是给自家人看的', async () => {
    const res = await fetch(`${base}/api/track/summary`);
    expect(res.status).toBe(401);
  });

  it('登录后返回聚合计数（窗口天数被夹在 1~30）', async () => {
    const res = await fetch(`${base}/api/track/summary?days=999`, {
      headers: { 'X-WW-Token': 'good-token' },
    });
    const body = (await res.json()) as TrackSummaryResponse;
    expect(body.days).toBe(30);
    expect(body.counts[0]).toEqual({ name: 'share_click', count: 3 });
  });
});

describe('身份脱敏', () => {
  it('哈希稳定且长度固定（可去重，不可反查）', () => {
    const a = hashActor('user-1');
    expect(a).toBe(hashActor('user-1'));
    expect(a).toHaveLength(16);
    expect(a).not.toBe(hashActor('user-2'));
    expect(hashActor(null)).toBeNull();
  });

  it('只读环境（staging）不写库', async () => {
    const store = new EventStore(null, { readOnly: true });
    await expect(store.record('share_click')).resolves.toBeUndefined();
  });
});
