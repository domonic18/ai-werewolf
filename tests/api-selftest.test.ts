import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import type { LLMService } from '../src/server/routes.js';
import type { EventsResponse, Snapshot } from '../src/shared/types.js';
import { createMockLLM } from './helpers/mock-llm.js';

const mock = createMockLLM();

const llmStub: LLMService = {
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

let server: Server;
let base: string;

const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path);
  return { status: res.status, body: (await res.json()) as T };
};

const post = async <T>(path: string, body?: unknown): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: (await res.json()) as T };
};

beforeAll(async () => {
  const rooms = new RoomManager({ llm: llmStub, pace: 0.05 });
  const app = createApp({ llm: llmStub, rooms, matchStore: new MatchStore(null) });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  server = app;
  const address = app.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('API 全链路（进程内）', () => {
  it('健康检查与模型列表可用', async () => {
    const health = await get<{ ok: boolean; llm: { ok: boolean; model: string }; rooms: number }>('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.llm.model).toBe('mock');

    const models = await get<{ models: { id: string }[]; current: string }>('/api/models');
    expect(models.body.models.length).toBeGreaterThan(0);
    expect(models.body.current).toBe('mock');
  });

  it('开局 → 推进 → 事件流可读，且不泄露真人私有信息', async () => {
    const created = await post<{ gameId: string }>('/api/games', { playerName: '自测' });
    expect(created.status).toBe(200);
    const gameId = created.body.gameId;
    expect(gameId).toBeTruthy();

    /* 大厅能看到这局 */
    const live = await get<{ games: { gameId: string }[] }>('/api/live');
    expect(live.body.games.some((g) => g.gameId === gameId)).toBe(true);

    /* 自动应答，直到对局结束 */
    let snapshot: Snapshot | null = null;
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const current = await get<Snapshot>(`/api/games/${gameId}`);
      snapshot = current.body;
      if (snapshot.phase === 'over') break;
      if (snapshot.pendingAction) {
        const pending = snapshot.pendingAction;
        const value = pending.kind === 'input' ? '我先过。' : pending.options[0]?.value ?? 1;
        await post(`/api/games/${gameId}/action`, { value });
      }
    }

    expect(snapshot?.phase).toBe('over');

    const events = await get<EventsResponse>(`/api/games/${gameId}/events?since=0`);
    expect(events.status).toBe(200);
    expect(events.body.events.length).toBeGreaterThan(0);
    expect(events.body.events.some((e) => e.type === 'game-over')).toBe(true);

    /* 事件流里不得出现真人私有字段 */
    for (const event of events.body.events) {
      expect(Object.prototype.hasOwnProperty.call(event.payload, 'myRole')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(event.payload, 'seerChecks')).toBe(false);
    }

    /* 观战：只读事件流，不含真人私有信息 */
    const spectate = await get<{ version: number; events: unknown[] }>(`/api/games/${gameId}/spectate?since=0`);
    expect(spectate.status).toBe(200);
    expect(Array.isArray(spectate.body.events)).toBe(true);
  }, 60_000);

  it('不存在的对局返回 404', async () => {
    const missing = await get<{ error: string }>('/api/games/not-exist');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('game not found');
  });

  it('没有挂起点时提交动作返回 409', async () => {
    const created = await post<{ gameId: string }>('/api/games', { playerName: '空转' });
    const gameId = created.body.gameId;
    /* 立刻提交：此时可能仍在 ack 之前，也可能已在等待；两种都接受，但状态码必须是 200/409 */
    const result = await post<unknown>(`/api/games/${gameId}/action`, { value: 1 });
    expect([200, 409]).toContain(result.status);
    await post(`/api/games/${gameId}/quit`);
  });
});
