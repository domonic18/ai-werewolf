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
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  availableRoles,
  expandDeck,
  lockedRoles,
  recommendDeck,
  validateDeck,
} from '../game/catalog.js';
import type { DeckSlot } from '../game/catalog.js';
import { listRooms, parseLobbyQuery } from './lobby.js';
import type {
  CreateGameResponse,
  ErrorResponse,
  EventsResponse,
  HealthResponse,
  LiveResponse,
  MatchesResponse,
  RolesResponse,
  ModelsResponse,
  OkResponse,
  SpectateResponse,
  AppEnv,
} from '../shared/types.js';

export interface ApiContext {
  llm: LLMService;
  rooms: RoomManager;
  matchStore: MatchStore;
  /** 运行环境：前端据此显示区分标识 */
  env: AppEnv;
  /** 前端登录所需的可公开配置（endpoint / publishableKey），不含密钥 */
  publicConfig?: { endpoint?: string; publishableKey?: string };
  /** 解析请求归属的账号；未配置则一律匿名（登录是可选项） */
  resolveOwner?: (req: IncomingMessage) => Promise<string | null>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** 玩家凭证校验：只认请求头，避免出现在 URL 里被日志/分享泄露 */
function hasPlayerToken(req: IncomingMessage, expected: string): boolean {
  const raw = req.headers['x-player-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token || token.length !== expected.length) return false;
  /* 定长比较，避免时序侧信道（这里风险极低，但成本也就几行） */
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
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
        env: ctx.env,
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

    /* ---------- 登录配置（只下发可公开值） ---------- */
    if (path === '/api/auth-config' && method === 'GET') {
      return sendJson(res, 200, {
        endpoint: ctx.publicConfig?.endpoint ?? null,
        publishableKey: ctx.publicConfig?.publishableKey ?? null,
      });
  }

    /* ---------- 角色库（新建对局页） ---------- */
    if (path === '/api/roles' && method === 'GET') {
      const raw = Number(parsed.query.players ?? 6);
      const players = Number.isFinite(raw)
        ? Math.min(Math.max(Math.floor(raw), MIN_PLAYERS), MAX_PLAYERS)
        : MIN_PLAYERS;
      const body: RolesResponse = {
        players,
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        recommended: recommendDeck(players),
        available: availableRoles(players),
        locked: lockedRoles(players),
      };
      return sendJson(res, 200, body);
    }

    /* ---------- 进行中对局（大厅） ---------- */
    if (path === '/api/live' && method === 'GET') {
      const query = parseLobbyQuery(parsed.query);
      const page = listRooms(ctx.rooms.rooms, query);
      const body: LiveResponse = { games: page.games, nextCursor: page.nextCursor, total: page.total };
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
      const body = await readBody<{
        playerName: string;
        players?: number;
        deck?: { key: string; count: number }[];
      }>(req);
      const name = String(body.playerName ?? '').slice(0, 8) || '你';

      /* 牌组：显式传入则校验，否则按人数给推荐（不传人数 = 6 人基础局） */
      let deckSlots: DeckSlot[] = recommendDeck(body.players ?? MIN_PLAYERS);
      if (Array.isArray(body.deck) && body.deck.length) {
        deckSlots = body.deck
          .filter((slot) => slot && typeof slot.key === 'string')
          .map((slot) => ({ key: slot.key as DeckSlot['key'], count: Math.max(0, Math.floor(Number(slot.count) || 0)) }));
      }
      const total = deckSlots.reduce((acc, slot) => acc + slot.count, 0);
      const check = validateDeck(deckSlots, total);
      if (!check.ok) {
        return sendJson(res, 400, { error: check.errors.join('；'), errors: check.errors });
      }

      /* 归属：有登录态就记账号，没有就是匿名局，不影响能不能玩 */
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      const room = ctx.rooms.create(name, expandDeck(deckSlots), ownerId);
      if (!room) {
        return sendJson(res, 503, { error: '同时进行的对局已满，请稍后再试（不会踢掉别人正在进行的对局）' });
      }

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

      return sendJson(res, 200, {
        gameId: room.engine.id,
        playerToken: room.playerToken,
      } satisfies CreateGameResponse);
    }

    /* ---------- 单局 ---------- */
    const match = path.match(/^\/api\/games\/([^/]+)(?:\/(events|action|quit|spectate))?$/);
    if (match) {
      const roomId = match[1] as string;
      const sub = match[2] ?? '';
      const room = ctx.rooms.get(roomId);
      if (!room) return sendJson(res, 404, { error: 'game not found' } satisfies ErrorResponse);

      const engine = room.engine;

      /* 观战：只读、不需要玩家凭证（观战投影本身就是全量身份，没有可泄露的私有信息） */
      if (method === 'GET' && sub === 'spectate') {
        const since = Number(parsed.query.since ?? 0) || 0;
        /* 观战心跳：用于大厅的观战人数统计（服务端计数，不信任客户端上报的数字） */
        const clientId = String(parsed.query.client ?? '').slice(0, 64);
        if (clientId) room.touchSpectator(clientId);
        const body: SpectateResponse = {
          version: engine.version,
          events: engine.events.filter((e) => e.seq > since),
          /* 上帝视角投影：全量身份，与玩家快照是两个函数 */
          snapshot: engine.spectateSnapshot(),
          spectators: room.spectatorCount,
        };
        return sendJson(res, 200, body);
      }

      /**
       * 其余端点都是玩家私有：必须持有本局凭证。
       * 没有它，任何知道 gameId 的人（大厅里就能看到）都能读真人身份、替真人做决定。
       */
      if (!hasPlayerToken(req, room.playerToken)) {
        return sendJson(res, 401, {
          error: 'player_token_required',
          hint: '这一局需要开局时下发的凭证；观战请使用 /spectate',
        } satisfies ErrorResponse & { hint: string });
      }

      if (method === 'GET' && !sub) {
        return sendJson(res, 200, engine.snapshot(engine.human.id));
      }

      if (method === 'GET' && sub === 'events') {
        const since = Number(parsed.query.since ?? 0) || 0;
        const body: EventsResponse = {
          version: engine.version,
          events: engine.events.filter((e) => e.seq > since),
          snapshot: engine.snapshot(engine.human.id),
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
    }

    return sendJson(res, 404, { error: 'not found' } satisfies ErrorResponse);
  } catch (e) {
    return sendJson(res, 500, { error: (e as Error).message } satisfies ErrorResponse);
  }
}
