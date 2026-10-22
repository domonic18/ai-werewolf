import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import type { LLMService } from '../src/server/llm-service.js';
import type { Snapshot, SpectateResponse } from '../src/shared/types.js';
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
let staticDir: string;
let rooms: RoomManager;

beforeAll(async () => {
  staticDir = mkdtempSync(path.join(tmpdir(), 'ww-static-'));
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>spa</title><div id="root"></div>');

  rooms = new RoomManager({ llm, pace: 0.05 });
  const app = createApp({ llm, rooms, matchStore: new MatchStore(null), staticDir });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  server = app;
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const getJson = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
  const res = await fetch(base + path, init);
  return { status: res.status, body: (await res.json()) as T };
};

describe('观战投影（P0：身份隔离）', () => {
  it('玩家快照不含身份与阵营字段，观战快照含全量身份', async () => {
    const created = await fetch(base + '/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: '隔离测试' }),
    });
    const { gameId, playerToken } = (await created.json()) as { gameId: string; playerToken: string };

    /* 玩家视角：座位里只有 revealed，没有 role / camp */
    const player = await getJson<Snapshot>(`/api/games/${gameId}`, { headers: { 'X-Player-Token': playerToken } });
    expect(player.status).toBe(200);
    for (const seat of player.body.players) {
      expect(Object.keys(seat)).not.toContain('role');
      expect(Object.keys(seat)).not.toContain('camp');
    }
    expect(player.body).not.toHaveProperty('factions');

    /* 观战视角：上帝视角，每个座位都带身份与阵营 */
    const spectate = await getJson<SpectateResponse>(`/api/games/${gameId}/spectate?since=0&client=watcher-1`);
    expect(spectate.status).toBe(200);
    expect(spectate.body.snapshot.players).toHaveLength(6);
    for (const seat of spectate.body.snapshot.players) {
      expect(['wolf', 'seer', 'witch', 'villager']).toContain(seat.role);
      expect(['wolf', 'good']).toContain(seat.camp);
    }

    /* 阵营统计：2 狼 4 好（6 人局固定配置） */
    expect(spectate.body.snapshot.factions.wolf.total).toBe(2);
    expect(spectate.body.snapshot.factions.good.total).toBe(4);

    /* 观战数据里不能出现「谁在行动」 */
    expect(spectate.body.snapshot).not.toHaveProperty('pendingAction');
  });

  it('观战人数按 client 心跳去重统计', async () => {
    const created = await fetch(base + '/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: '计数测试' }),
    });
    const { gameId } = (await created.json()) as { gameId: string };

    const first = await getJson<SpectateResponse>(`/api/games/${gameId}/spectate?since=0&client=w1`);
    expect(first.body.spectators).toBe(1);

    /* 同一个 client 重复拉取不重复计数 */
    const again = await getJson<SpectateResponse>(`/api/games/${gameId}/spectate?since=0&client=w1`);
    expect(again.body.spectators).toBe(1);

    const second = await getJson<SpectateResponse>(`/api/games/${gameId}/spectate?since=0&client=w2`);
    expect(second.body.spectators).toBe(2);

    /* 大厅里也能看到这个数字 */
    const live = await getJson<{ games: { gameId: string; spectators: number }[] }>('/api/live');
    const entry = live.body.games.find((g) => g.gameId === gameId);
    expect(entry?.spectators).toBe(2);
  });
});

describe('静态托管（P0：404 不得伪装成 200）', () => {
  it('缺失的构建产物返回 404，而不是 index.html', async () => {
    const res = await fetch(base + '/assets/index-deadbeef.js');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('text/plain');
  });

  it('缺失的普通文件返回 404', async () => {
    const res = await fetch(base + '/missing.png');
    expect(res.status).toBe(404);
  });

  it('前端路由回退仍然生效（导航请求才回 index.html）', async () => {
    const res = await fetch(base + '/some/deep/link', { headers: { Accept: 'text/html' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });

  it('API 未命中返回 JSON 404', async () => {
    const res = await fetch(base + '/api/not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('房间容量（P0：不得删进行中的对局）', () => {
  it('到达上限时拒绝新建，前两局仍在', () => {
    const small = new RoomManager({ llm, pace: 0, maxRooms: 2 });

    const first = small.create('A');
    const second = small.create('B');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    /* 两局都没结束（phase=lobby），第三个必须被拒绝而不是踢掉别人 */
    const third = small.create('C');
    expect(third).toBeNull();
    expect(small.get(first!.engine.id)).not.toBeNull();
    expect(small.get(second!.engine.id)).not.toBeNull();
    expect(small.rooms.size).toBe(2);
  });

  it('已结束的对局不会占位（清理后可以再开）', () => {
    const small = new RoomManager({ llm, pace: 0, maxRooms: 1 });
    const room = small.create('A');
    expect(room).not.toBeNull();

    /* 手动标记结束 + 把创建时间推到 TTL 之前，模拟可回收状态 */
    room!.engine.phase = 'over';
    Object.defineProperty(room!, 'createdAt', { value: Date.now() - 3 * 60 * 60 * 1000 });

    expect(small.create('B')).not.toBeNull();
  });
});


describe('玩家凭证（P0-a：观战者不能替真人操作）', () => {
  const createGame = async (): Promise<{ gameId: string; playerToken: string }> => {
    const res = await fetch(base + '/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: '凭证测试' }),
    });
    return (await res.json()) as { gameId: string; playerToken: string };
  };

  it('开局下发 32 位凭证', async () => {
    const { playerToken } = await createGame();
    expect(playerToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('没有凭证读快照返回 401（而不是把真人身份交出去）', async () => {
    const { gameId } = await createGame();
    const res = await fetch(base + `/api/games/${gameId}`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('player_token_required');
  });

  it('错误凭证同样 401', async () => {
    const { gameId } = await createGame();
    const res = await fetch(base + `/api/games/${gameId}`, {
      headers: { 'X-Player-Token': 'f'.repeat(32) },
    });
    expect(res.status).toBe(401);
  });

  it('观战者拿到 gameId 也无法替真人提交动作', async () => {
    const { gameId } = await createGame();
    const res = await fetch(base + `/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('观战接口不需要凭证，且不返回任何玩家私有字段', async () => {
    const { gameId } = await createGame();
    const res = await fetch(base + `/api/games/${gameId}/spectate?since=0&client=watcher`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SpectateResponse;
    expect(body.snapshot).not.toHaveProperty('pendingAction');
    expect(body.snapshot).not.toHaveProperty('myRole');
  });
});


describe('环境标识与测试环境数据隔离', () => {
  it('默认按 production 上报', async () => {
    const res = await fetch(base + '/api/health');
    const body = (await res.json()) as { env: string };
    expect(body.env).toBe('production');
  });

  it('传入 staging 时健康检查如实上报', async () => {
    const stagingApp = createApp({
      llm,
      rooms: new RoomManager({ llm, pace: 0 }),
      matchStore: new MatchStore(null),
      staticDir,
      env: 'staging',
    });
    await new Promise<void>((resolve) => stagingApp.listen(0, '127.0.0.1', resolve));
    const port = (stagingApp.address() as AddressInfo).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = (await res.json()) as { env: string };
    expect(body.env).toBe('staging');

    await new Promise<void>((resolve) => stagingApp.close(() => resolve()));
  });

  it('测试环境的战绩默认只读，不污染生产表', async () => {
    const store = new MatchStore(null, { readOnly: true });
    const result = await store.save({
      playerName: 'staging',
      playerRole: '平民',
      result: 'good',
      rounds: 1,
      survivors: 3,
      detail: { players: [], log: [], thoughts: [] },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('staging_read_only');
  });
});

describe('角色库接口', () => {
  it('按人数返回推荐牌组与可选/锁定角色', async () => {
    const { body } = await getJson<{
      players: number;
      recommended: { key: string; count: number }[];
      available: { key: string }[];
      locked: { key: string; implemented: boolean }[];
    }>('/api/roles?players=8');

    expect(body.players).toBe(8);
    const total = body.recommended.reduce((a, s) => a + s.count, 0);
    expect(total).toBe(8);
    /* 8 人局已实装猎人：推荐里应有它；长老未实装，应在锁定列表 */
    expect(body.recommended.some((s) => s.key === 'hunter')).toBe(true);
    expect(body.available.map((c) => c.key)).toContain('hunter');
    expect(body.available.map((c) => c.key)).not.toContain('elder');
    expect(body.locked.map((c) => c.key)).toContain('elder');
  });

  it('人数越界会被夹到 6~12，而不是报错', async () => {
    const low = (await getJson<{ players: number }>('/api/roles?players=1')).body;
    const high = (await getJson<{ players: number }>('/api/roles?players=99')).body;
    const junk = (await getJson<{ players: number }>('/api/roles?players=abc')).body;
    expect(low.players).toBe(6);
    expect(high.players).toBe(12);
    expect(junk.players).toBe(6);
  });
});

describe('按人数/牌组开局', () => {
  const create = async (payload: unknown): Promise<{ status: number; body: { gameId?: string; error?: string } }> => {
    const res = await fetch(base + '/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: (await res.json()) as { gameId?: string; error?: string } };
  };

  it('不传人数时按 6 人基础局开局（向后兼容）', async () => {
    const { status } = await create({ playerName: '默认局' });
    expect(status).toBe(200);
  });

  it('传人数时按推荐牌组开局', async () => {
    const { status, body } = await create({ playerName: '八人局', players: 8 });
    expect(status).toBe(200);
    expect(body.gameId).toBeTruthy();
  });

  it('非法牌组返回 400 并说明原因（不静默改成默认牌组）', async () => {
    const tooFewWolves = await create({
      playerName: '非法',
      deck: [
        { key: 'wolf', count: 1 },
        { key: 'villager', count: 5 },
      ],
    });
    expect(tooFewWolves.status).toBe(400);
    expect(tooFewWolves.body.error).toContain('狼人');

    const notImplemented = await create({
      playerName: '非法2',
      deck: [
        { key: 'wolf', count: 2 },
        { key: 'elder', count: 1 },
        { key: 'villager', count: 3 },
      ],
    });
    expect(notImplemented.status).toBe(400);
    expect(notImplemented.body.error).toContain('尚未开放');

    /* 猎人在 6 人局人数不够 */
    const tooFew = await create({
      playerName: '非法3',
      deck: [
        { key: 'wolf', count: 2 },
        { key: 'hunter', count: 1 },
        { key: 'villager', count: 3 },
      ],
    });
    expect(tooFew.status).toBe(400);
    expect(tooFew.body.error).toContain('至少 8 人');
  });
});
