/**
 * API 路由（零依赖，基于原生 http）：
 *   GET  /api/health                  服务与 LLM 通道状态
 *   GET  /api/models                  可用模型列表
 *   POST /api/models/select           切换模型
 *   POST /api/games                   开局 { playerName } → { gameId }
 *   GET  /api/games/:id               对局快照（真人视角）
 *   GET  /api/games/:id/events?since= 增量事件（轮询）
 *   POST /api/games/:id/action        提交真人动作 { value }
 *   POST /api/games/:id/quit          退出对局
 *   GET  /api/games/:id/spectate      观战只读事件流
 *   GET  /api/live                    进行中对局（大厅）
 *   GET  /api/matches                 战绩墙
 */
import { parse as parseUrl } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from './rooms.js';
import type { MatchStore } from '../cloud/match-store.js';
import type { LLMService } from './llm-service.js';
import type {
  CreateGameResponse,
  ErrorResponse,
  EventsResponse,
  HealthResponse,
  LiveResponse,
  LobbyGame,
  MatchesResponse,
  ModelsResponse,
  OkResponse,
  SpectateResponse,
} from '../shared/types.js';

export interface ApiContext {
  llm: LLMService;
  rooms: RoomManager;
  matchStore: MatchStore;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody<T extends Record<string, unknown>>(req: IncomingMessage): Promise<Partial<T>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, ctx: ApiContext): Promise<void> {
  const parsed = parseUrl(req.url ?? '/', true);
  const path = (parsed.pathname ?? '/').replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  try {
    /* ---------- 服务状态 ---------- */
    if (path === '/api/health' && method === 'GET') {
      const selfTest = await ctx.llm.selfTest();
      const body: HealthResponse = {
        ok: true,
        llm: {
          ok: selfTest.ok,
          state: ctx.llm.state,
          model: selfTest.model ?? ctx.llm.label(),
          sec: selfTest.sec,
          error: selfTest.error ?? null,
          calls: ctx.llm.callCount ?? 0,
        },
        rooms: ctx.rooms.rooms.size,
      };
      return sendJson(res, 200, body);
    }

    if (path === '/api/models' && method === 'GET') {
      const body: ModelsResponse = { models: ctx.llm.listModels(), current: ctx.llm.model?.id };
      return sendJson(res, 200, body);
    }

    if (path === '/api/models/select' && method === 'POST') {
      const body = await readBody<{ id: string }>(req);
      if (!body.id) return sendJson(res, 400, { error: 'missing id' } satisfies ErrorResponse);
      try {
        ctx.llm.selectModel(body.id);
        return sendJson(res, 200, { ok: true, current: ctx.llm.model?.id } satisfies OkResponse & {
          current?: string;
        });
      } catch (e) {
        return sendJson(res, 404, { error: (e as Error).message } satisfies ErrorResponse);
      }
    }

    /* ---------- 战绩 ---------- */
    if (path === '/api/matches' && method === 'GET') {
      const recent = await ctx.matchStore.recent(8);
      const stats = await ctx.matchStore.stats();
      const body: MatchesResponse = { recent: recent.rows, stats };
      return sendJson(res, 200, body);
    }

    /* ---------- 进行中对局（大厅） ---------- */
    if (path === '/api/live' && method === 'GET') {
      const games: LobbyGame[] = [];
      for (const [id, room] of ctx.rooms.rooms) {
        const engine = room.engine;
        if (engine.phase === 'over' || engine.aborted) continue;
        games.push({
          gameId: id,
          host: engine.playerName,
          round: engine.round,
          phase: engine.phase,
          players: engine.players.length,
          alive: engine.alivePlayers().length,
          startedAt: room.createdAt,
        });
      }
      games.sort((a, b) => b.startedAt - a.startedAt);
      const body: LiveResponse = { games: games.slice(0, 20) };
      return sendJson(res, 200, body);
    }

    /* ---------- 开局 ---------- */
    if (path === '/api/games' && method === 'POST') {
      if (ctx.llm.state !== 'ready') {
        return sendJson(res, 503, {
          error:
            ctx.llm.state === 'initializing'
              ? 'AI 通道启动中，请稍等几秒再开一局'
              : 'AI 通道不可用，请稍后重试',
          state: ctx.llm.state,
        });
      }
      const body = await readBody<{ playerName: string }>(req);
      const name = String(body.playerName ?? '').slice(0, 8) || '你';
      const room = ctx.rooms.create(name);

      /* 异步开跑：对局循环挂起在 waitHuman 上，等待前端 action */
      void room.engine
        .run()
        .then(() => {
          if (room.engine.winner) return ctx.rooms.archive(room.engine);
          return undefined;
        })
        .catch((e: Error) => {
          room.engine.aborted = { reason: e.message };
          room.engine.pushEvent('aborted', { reason: e.message });
        });

      return sendJson(res, 200, { gameId: room.engine.id } satisfies CreateGameResponse);
    }

    /* ---------- 单局 ---------- */
    const match = path.match(/^\/api\/games\/([^/]+)(?:\/(events|action|quit|spectate))?$/);
    if (match) {
      const roomId = match[1] as string;
      const sub = match[2] ?? '';
      const room = ctx.rooms.get(roomId);
      if (!room) return sendJson(res, 404, { error: 'game not found' } satisfies ErrorResponse);

      const engine = room.engine;
      const snapshot = engine.snapshot(engine.human.id);

      if (method === 'GET' && !sub) {
        return sendJson(res, 200, snapshot);
      }

      if (method === 'GET' && sub === 'events') {
        const since = Number(parsed.query.since ?? 0) || 0;
        const body: EventsResponse = {
          version: engine.version,
          events: engine.events.filter((e) => e.seq > since),
          snapshot,
        };
        return sendJson(res, 200, body);
      }

      if (method === 'POST' && sub === 'action') {
        const body = await readBody<{ value: string | number | null }>(req);
        const value = body.value === undefined ? null : body.value;
        const accepted = engine.submitHuman(value);
        if (!accepted) return sendJson(res, 409, { error: 'no pending action' } satisfies ErrorResponse);
        return sendJson(res, 200, { ok: true } satisfies OkResponse);
      }

      if (method === 'POST' && sub === 'quit') {
        engine.stop();
        return sendJson(res, 200, { ok: true } satisfies OkResponse);
      }

      /* 观战：只读事件流（不含真人私有信息） */
      if (method === 'GET' && sub === 'spectate') {
        const since = Number(parsed.query.since ?? 0) || 0;
        const body: SpectateResponse = {
          version: engine.version,
          events: engine.events.filter((e) => e.seq > since),
        };
        return sendJson(res, 200, body);
      }
    }

    return sendJson(res, 404, { error: 'not found' } satisfies ErrorResponse);
  } catch (e) {
    return sendJson(res, 500, { error: (e as Error).message } satisfies ErrorResponse);
  }
}
