import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import { SlidingWindowLimiter } from '../src/server/rate-limit.js';
import { createLimiters } from '../src/server/routes.js';
import type { ApiLimiters } from '../src/server/routes.js';
import type { HealthResponse, Snapshot } from '../src/shared/types.js';
import type { LLMService } from '../src/server/llm-service.js';
import { createMockLLM } from './helpers/mock-llm.js';

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
let rooms: RoomManager;

/** 严格档位：开局 2 次、动作 5 次，方便一个测试内触发 429 */
function strictLimiters(): ApiLimiters {
  const base = createLimiters();
  return {
    ...base,
    createGameActor: new SlidingWindowLimiter({ limit: 2, windowMs: 60_000 }),
    createGameGlobal: new SlidingWindowLimiter({ limit: 100, windowMs: 60_000 }),
    action: new SlidingWindowLimiter({ limit: 5, windowMs: 60_000 }),
    modelSelect: new SlidingWindowLimiter({ limit: 2, windowMs: 60_000 }),
  };
}

beforeAll(async () => {
  const staticDir = mkdtempSync(path.join(tmpdir(), 'ww-sec-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>spa</title><div id="root"></div>');

  rooms = new RoomManager({ llm, pace: 0.02, idleTtlMs: 50 });
  const app = createApp({
    llm,
    rooms,
    matchStore: new MatchStore(null),
    staticDir,
    env: 'production',
    limiters: strictLimiters(),
    /* 只有带 x-test-owner 的请求才算登录，用来验证「需要登录」的接口 */
    resolveOwner: async (req) => {
      const raw = req.headers['x-test-owner'];
      const value = Array.isArray(raw) ? raw[0] : raw;
      return value ?? null;
    },
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  server = app;
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const createGame = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + '/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('开局限流（P0：防止额度被刷光）', () => {
  it('同来源超过上限后返回 429 并带 Retry-After', async () => {
    const headers = { 'x-test-owner': 'limit-user' };
    expect((await createGame({ playerName: 'A' }, headers)).status).toBe(200);
    expect((await createGame({ playerName: 'B' }, headers)).status).toBe(200);

    const blocked = await createGame({ playerName: 'C' }, headers);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: string; retryAfterSec: number };
    expect(body.retryAfterSec).toBeGreaterThan(0);
  });

  it('换一个账号不受别人额度影响', async () => {
    const res = await createGame({ playerName: 'D' }, { 'x-test-owner': 'another-user' });
    expect(res.status).toBe(200);
  });
});

describe('请求体与输入校验', () => {
  it('超过 32KB 的请求体直接 413，不进入解析', async () => {
    const res = await createGame(JSON.stringify({ playerName: 'x', padding: 'a'.repeat(40 * 1024) }), {
      'x-test-owner': 'bigbody',
    });
    expect(res.status).toBe(413);
  });

  it('代号里的控制字符被清掉、长度被截断', async () => {
    const res = await createGame({ playerName: '  老\u0000K   ' }, { 'x-test-owner': 'name-user' });
    expect(res.status).toBe(200);
    const { gameId, playerToken } = (await res.json()) as { gameId: string; playerToken: string };
    const snapshot = await fetch(`${base}/api/games/${gameId}`, { headers: { 'x-player-token': playerToken } });
    const body = (await snapshot.json()) as Snapshot;
    const human = body.players.find((p) => p.isHuman);
    expect(human?.name).toBe('老K');
  });

  it('未知的牌组 key 被拒绝，不会静默开局', async () => {
    const res = await createGame(
      { playerName: '牌组', deck: [{ key: 'dragon', count: 6 }] },
      { 'x-test-owner': 'deck-user' },
    );
    expect(res.status).toBe(400);
  });
});

describe('全局动作需要登录', () => {
  it('匿名切模型在 production 被拒绝', async () => {
    const res = await fetch(base + '/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'mock' }),
    });
    expect(res.status).toBe(403);
  });

  it('登录后可以切模型', async () => {
    const res = await fetch(base + '/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-owner': 'model-user' },
      body: JSON.stringify({ id: 'mock' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('安全响应头', () => {
  it('/api 与静态资源都带 CSP / nosniff / frame-ancestors', async () => {
    for (const url of ['/api/health', '/']) {
      const res = await fetch(base + url);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    }
  });

  it('/api/health 不会泄露密钥类配置', async () => {
    const res = await fetch(base + '/api/health');
    const body = (await res.json()) as HealthResponse & Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/wbpk_|secret|token/i);
  });
});

describe('房间回收（P0：弃局不再永久占位）', () => {
  it('进行中但静默超时的房间会被回收，并停掉引擎', async () => {
    const before = rooms.rooms.size;
    const res = await createGame({ playerName: '弃局' }, { 'x-test-owner': 'idle-user' });
    expect(res.status).toBe(200);
    const { gameId } = (await res.json()) as { gameId: string };

    const room = rooms.get(gameId);
    expect(room).toBeTruthy();
    /* 模拟 50ms 没人操作 */
    room!.lastActiveAt = Date.now() - 1_000;

    const removed = rooms.sweep();
    expect(removed).toBeGreaterThan(0);
    expect(rooms.get(gameId)).toBeNull();
    expect(rooms.rooms.size).toBeLessThan(before + 1);
  });

  it('有人操作的房间不会被回收（touch 续命）', async () => {
    const res = await createGame({ playerName: '活跃' }, { 'x-test-owner': 'active-user' });
    const { gameId, playerToken } = (await res.json()) as { gameId: string; playerToken: string };
    const room = rooms.get(gameId)!;
    room.lastActiveAt = Date.now() - 1_000;

    /* 真实访问一次私有接口 → touch → 不该被回收 */
    await fetch(`${base}/api/games/${gameId}`, { headers: { 'x-player-token': playerToken } });
    rooms.sweep();
    expect(rooms.get(gameId)).toBeTruthy();
  });

  it('挂起的房间不出现在大厅列表里', async () => {
    const res = await createGame({ playerName: '挂起' }, { 'x-test-owner': 'stale-user' });
    const { gameId } = (await res.json()) as { gameId: string };
    rooms.get(gameId)!.lastActiveAt = Date.now() - 10_000;

    const live = await fetch(`${base}/api/live`).then((r) => r.json() as Promise<{ games: { gameId: string }[] }>);
    expect(live.games.some((g) => g.gameId === gameId)).toBe(false);
  });
});
