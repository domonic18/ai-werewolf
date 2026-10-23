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
import { createHash } from 'node:crypto';
import { parse as parseUrl } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from './rooms.js';
import type { MatchStore } from '../cloud/match-store.js';
import type { SocialStore } from '../cloud/social-store.js';
import { normalizeInviteCode } from '../cloud/social-store.js';
import type { EventStore } from '../cloud/event-store.js';
import { isTrackEvent } from '../cloud/event-store.js';
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
import { readAccessToken } from './auth.js';
import { listRooms, parseLobbyQuery } from './lobby.js';
import { SlidingWindowLimiter, actorKey, clientIp } from './rate-limit.js';
import type {
  CreateGameResponse,
  ErrorResponse,
  EventsResponse,
  HealthResponse,
  LiveResponse,
  MatchesResponse,
  WhoAmIResponse,
  InviteOverviewResponse,
  InvitePreviewResponse,
  BindInviteResponse,
  UpdateProfileResponse,
  TrackResponse,
  TrackSummaryResponse,
  TrackEventName,
  RolesResponse,
  ModelsResponse,
  OkResponse,
  SpectateResponse,
  AppEnv,
} from '../shared/types.js';

/**
 * 限流器集合。放在 ctx 里而不是模块单例，测试才能每个用例拿到干净的窗口。
 * 规则全部是「单进程内存滑动窗口」，多实例部署时需要替换成共享存储。
 */
export interface ApiLimiters {
  /** 同一个人（账号或 IP）10 分钟内最多开几局 */
  createGameActor: SlidingWindowLimiter;
  /** 全站每分钟最多开几局，防止分布式小号绕开单账号限制 */
  createGameGlobal: SlidingWindowLimiter;
  /** 单局提交动作：防止脚本刷动作把 AI 调用打满 */
  action: SlidingWindowLimiter;
  /** 切换模型：成本高、影响所有人，单独收紧 */
  modelSelect: SlidingWindowLimiter;
  /** 只读接口（大厅/战绩）的粗暴保护 */
  read: SlidingWindowLimiter;
}

export function createLimiters(): ApiLimiters {
  return {
    createGameActor: new SlidingWindowLimiter({ limit: 3, windowMs: 10 * 60_000 }),
    createGameGlobal: new SlidingWindowLimiter({ limit: 10, windowMs: 60_000 }),
    action: new SlidingWindowLimiter({ limit: 30, windowMs: 60_000 }),
    modelSelect: new SlidingWindowLimiter({ limit: 6, windowMs: 60 * 60_000 }),
    read: new SlidingWindowLimiter({ limit: 240, windowMs: 60_000 }),
  };
}

export interface ApiContext {
  llm: LLMService;
  rooms: RoomManager;
  matchStore: MatchStore;
  /** 账号资料与邀请关系（云库未就绪时也传，内部会降级） */
  socialStore?: SocialStore;
  /** 埋点（四个事件，可选） */
  eventStore?: EventStore;
  /** 运行环境：前端据此显示区分标识 */
  env: AppEnv;
  /** 前端登录所需的可公开配置（endpoint / publishableKey / oauthRelayBaseUrl），不含密钥 */
  publicConfig?: {
    endpoint?: string;
    publishableKey?: string;
    oauthRelayBaseUrl?: string;
    /** 已开启的登录方式（phone / email / wechat / workbuddy） */
    providers?: string[];
  };
  /** 解析请求归属的账号；未配置则一律匿名（登录是可选项） */
  resolveOwner?: (req: IncomingMessage) => Promise<string | null>;
  /** 限流器（不传则用默认规则） */
  limiters?: ApiLimiters;
  /** 身份自检：拿 token 问一次云端，返回状态码（供 /api/whoami 用） */
  probeOwner?: (token: string) => Promise<{ userId: string | null; status: number | 'network' }>;
}

/** 请求体上限：一局请求就十几个字段，32KB 足够；再大就是攻击或 bug */
const MAX_BODY_BYTES = 32 * 1024;
/** 真人发言长度上限（前端 textarea 是 200，服务端留一点余量） */
const MAX_ACTION_TEXT = 300;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** 去掉控制字符与零宽字符：这些字符会污染 UI 与 AI prompt */
function cleanText(raw: string, max: number): string {
  return raw
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .trim()
    .slice(0, max);
}

function tooMany(res: ServerResponse, retryAfterSec: number, error: string): void {
  res.setHeader('Retry-After', String(retryAfterSec));
  sendJson(res, 429, { error, retryAfterSec });
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

async function readBody<T extends Record<string, unknown>>(
  req: IncomingMessage,
  maxBytes = MAX_BODY_BYTES,
): Promise<Partial<T>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    /* 边读边判：不等到收完再拒绝，否则大包已经进内存了 */
    if (size > maxBytes) throw new HttpError(413, '请求体过大');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    return {};
  }
}

/**
 * 真人动作的取值规整：
 * - 字符串（发言）去掉控制字符并限长，避免超大文本进事件流、进 AI prompt
 * - 数字只接受有限整数，其它一律当作「继续」
 */
function normalizeActionValue(value: unknown): string | number | null {
  if (typeof value === 'string') return cleanText(value, MAX_ACTION_TEXT);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (value === null || value === undefined) return null;
  return null;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, ctx: ApiContext): Promise<void> {
  const parsed = parseUrl(req.url ?? '/', true);
  const path = (parsed.pathname ?? '/').replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';
  const limits = ctx.limiters ?? (ctx.limiters = createLimiters());
  const ip = clientIp(req.headers);

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
      /*
       * 切模型是全局生效的动作（影响所有人的成本与质量），不能匿名调。
       * production 要求登录；staging / 本地保留匿名，方便开发时对比模型。
       */
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      if (ctx.env === 'production' && !ownerId) {
        return sendJson(res, 403, { error: '切换模型需要先登录' } satisfies ErrorResponse);
      }
      const rl = limits.modelSelect.take(actorKey(ownerId, ip));
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '切换模型过于频繁，请稍后再试');
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
      const rl = limits.read.take(`matches:${ip || 'unknown'}`);
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '请求过于频繁，请稍后再试');
      /* mine=1 且已登录 → 只看自己的；未登录退回全量（匿名也能看战绩墙） */
      const mine = (parsed.query.mine ?? '') === '1';
      const ownerId = mine && ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      const [recent, stats, mineStats] = await Promise.all([
        ctx.matchStore.recent(8, ownerId),
        ctx.matchStore.stats(ownerId),
        ownerId ? ctx.matchStore.personalStats(ownerId) : Promise.resolve(null),
      ]);
      const body: MatchesResponse = {
        recent: recent.rows,
        stats,
        scope: ownerId ? 'mine' : 'all',
        mine: mineStats,
      };
      return sendJson(res, 200, body);
    }

    /* ---------- 邀请与好友 ---------- */
    /*
     * 我的邀请码 + 我邀请来的朋友。
     * 未登录一律 401：邀请关系是账号级数据，匿名没有「我」可言。
     */
    if (path === '/api/invite' && method === 'GET') {
      const rl = limits.read.take(`invite:${ip || 'unknown'}`);
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '请求过于频繁，请稍后再试');
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      if (!ownerId) return sendJson(res, 401, { error: '登录后才有邀请码' } satisfies ErrorResponse);

      const store = ctx.socialStore;
      if (!store) {
        return sendJson(res, 200, {
          available: false,
          code: '',
          nickname: null,
          hideStats: false,
          friends: [],
        } satisfies InviteOverviewResponse);
      }

      const profile = await store.ensureProfile(ownerId);
      if (!profile) {
        /* 云库不可用 / 只读环境建不了资料：明确告诉前端，而不是回一份空列表 */
        return sendJson(res, 200, {
          available: false,
          code: '',
          nickname: null,
          hideStats: false,
          friends: [],
        } satisfies InviteOverviewResponse);
      }

      const friends = await store.listFriends(ownerId);
      return sendJson(res, 200, {
        available: true,
        code: profile.invite_code,
        nickname: profile.nickname,
        hideStats: profile.hide_stats,
        friends,
      } satisfies InviteOverviewResponse);
    }

    /*
     * 落地页用：凭邀请码看邀请人的昵称与战绩。公开、不需要登录——
     * 被邀请人此刻正是「还没登录」的状态，等他登录再问就晚了。
     */
    if (path === '/api/invite/preview' && method === 'GET') {
      const rl = limits.read.take(`invite-preview:${ip || 'unknown'}`);
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '请求过于频繁，请稍后再试');
      const rawRef = parsed.query.ref;
      const code = normalizeInviteCode(Array.isArray(rawRef) ? (rawRef[0] ?? '') : (rawRef ?? ''));
      if (!code) return sendJson(res, 200, { ok: false } satisfies InvitePreviewResponse);
      const preview = ctx.socialStore ? await ctx.socialStore.preview(code) : null;
      if (!preview) return sendJson(res, 200, { ok: false } satisfies InvitePreviewResponse);
      return sendJson(res, 200, {
        ok: true,
        name: preview.name,
        games: preview.games,
        wins: preview.wins,
      } satisfies InvitePreviewResponse);
    }

    /*
     * 登录后补记邀请关系。幂等：同一对只记一次，自己邀请自己直接拒。
     * 客户端会在登录成功后自动调它，失败也不该打断玩家（他已经在玩了）。
     */
    if (path === '/api/invite/bind' && method === 'POST') {
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      if (!ownerId) return sendJson(res, 401, { error: '登录后才能记录邀请' } satisfies ErrorResponse);
      const rl = limits.action.take(actorKey(ownerId, ip));
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '操作过于频繁，请稍后再试');

      const body = await readBody<{ ref: string }>(req);
      const code = normalizeInviteCode(body.ref);
      if (!code) return sendJson(res, 200, { ok: false, status: 'bad-code' } satisfies BindInviteResponse);

      const result = ctx.socialStore ? await ctx.socialStore.bind(code, ownerId) : { status: 'unavailable' as const };
      /* 邀请关系建立只在**真正写入**时记一次：幂等命中（exists）不算新增转化 */
      if (result.status === 'bound') void ctx.eventStore?.record('invite_bound', { ownerId, ref: code });
      return sendJson(res, 200, {
        ok: result.status === 'bound' || result.status === 'exists',
        status: result.status,
        inviterName: result.inviterName,
      } satisfies BindInviteResponse);
    }

    /*
     * 埋点上报：四个事件白名单，其余一律 400。
     * 不要求登录——落地事件发生在登录之前；能认出人时带哈希标识用于去重。
     */
    if (path === '/api/track' && method === 'POST') {
      const rl = limits.read.take(`track:${ip || 'unknown'}`);
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '请求过于频繁，请稍后再试');
      const body = await readBody<{ event: string; ref?: string }>(req);
      if (!isTrackEvent(body.event)) {
        return sendJson(res, 400, { error: '未知事件' } satisfies ErrorResponse);
      }
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req).catch(() => null) : null;
      await ctx.eventStore?.record(body.event, {
        ownerId,
        ref: typeof body.ref === 'string' ? normalizeInviteCode(body.ref) || null : null,
      });
      return sendJson(res, 200, { ok: true } satisfies TrackResponse);
    }

    /*
     * 埋点汇总：只回聚合计数，不含任何身份。
     * 要求登录：这数据是给自家人看的，没必要对匿名开放。
     */
    if (path === '/api/track/summary' && method === 'GET') {
      const rl = limits.read.take(`track-summary:${ip || 'unknown'}`);
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '请求过于频繁，请稍后再试');
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      if (!ownerId) return sendJson(res, 401, { error: '登录后才能查看统计' } satisfies ErrorResponse);

      const days = Math.min(30, Math.max(1, Number(parsed.query.days ?? 7) || 7));
      const rows = ctx.eventStore ? await ctx.eventStore.summary(days) : [];
      return sendJson(res, 200, {
        days,
        counts: rows as { name: TrackEventName; count: number }[],
      } satisfies TrackSummaryResponse);
    }

    /* 改昵称 / 战绩是否公开 */
    if (path === '/api/profile' && method === 'POST') {
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      if (!ownerId) return sendJson(res, 401, { error: '登录后才能修改资料' } satisfies ErrorResponse);
      const rl = limits.action.take(actorKey(ownerId, ip));
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '操作过于频繁，请稍后再试');

      const body = await readBody<{ nickname?: string; hideStats?: boolean }>(req);
      const patch: { nickname?: string | null; hideStats?: boolean } = {};
      if (typeof body.nickname === 'string') {
        const name = cleanText(body.nickname, 12);
        /* 空串 = 清空昵称，回落到「一位玩家」 */
        patch.nickname = name || null;
      }
      if (typeof body.hideStats === 'boolean') patch.hideStats = body.hideStats;
      if (!ctx.socialStore || !Object.keys(patch).length) {
        return sendJson(res, 400, { ok: false, error: '没有可修改的字段' } satisfies UpdateProfileResponse);
      }

      const profile = await ctx.socialStore.updateProfile(ownerId, patch);
      if (!profile) return sendJson(res, 503, { ok: false, error: '云库暂不可用' } satisfies UpdateProfileResponse);
      return sendJson(res, 200, {
        ok: true,
        nickname: profile.nickname,
        hideStats: profile.hide_stats,
      } satisfies UpdateProfileResponse);
    }

    /*
     * 身份自检：浏览器里直接打开就能看到「服务端有没有认出我」。
     * 只回布尔与状态码，不回 token、不回账号 id —— 排查够用，泄露为零。
     */
    if (path === '/api/whoami' && method === 'GET') {
      const rl = limits.read.take(`whoami:${ip || 'unknown'}`);
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '请求过于频繁，请稍后再试');
      const token = readAccessToken(req);
      if (!token) return sendJson(res, 200, { signedIn: false, reason: 'no-token' } satisfies WhoAmIResponse);

      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      if (ownerId) return sendJson(res, 200, { signedIn: true, status: 200 } satisfies WhoAmIResponse);

      const probe = ctx.probeOwner ? await ctx.probeOwner(token) : null;
      /* tokenHint：收到的 token 的 SHA-256 前 8 位。用于确认「网关有没有把 Authorization 换掉」——
         拿它和自己发出的 token 比一下就知道，且不泄露 token 本身 */
      const tokenHint = createHash('sha256').update(token).digest('hex').slice(0, 8);
      return sendJson(res, 200, {
        signedIn: false,
        reason: 'unresolved',
        status: probe?.status ?? 'skipped',
        tokenHint,
      } satisfies WhoAmIResponse);
    }

    /* ---------- 登录配置（只下发可公开值） ---------- */
    if (path === '/api/auth-config' && method === 'GET') {
      return sendJson(res, 200, {
        endpoint: ctx.publicConfig?.endpoint ?? null,
        publishableKey: ctx.publicConfig?.publishableKey ?? null,
        oauthRelayBaseUrl: ctx.publicConfig?.oauthRelayBaseUrl ?? null,
        providers: ctx.publicConfig?.providers ?? ['phone', 'wechat', 'workbuddy'],
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
      const rl = limits.read.take(`live:${ip || 'unknown'}`);
      if (!rl.ok) return tooMany(res, rl.retryAfterSec, '请求过于频繁，请稍后再试');
      /* 顺手回收弃局：大厅每次刷新都是一次自然清扫点，不额外起定时器 */
      ctx.rooms.sweep();
      /* 「我的对局」：登录了就按账号查（换设备也能看到），否则只能靠前端带的本机 id */
      const wantsMine = (parsed.query.filter ?? '') === 'mine';
      const ownerId = wantsMine && ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      const query = parseLobbyQuery(parsed.query, { ownerId });
      /* 挂起的对局（长时间无人操作）不再展示：既不误导观众，也不给攻击者「占坑可视」的反馈 */
      const page = listRooms(ctx.rooms.liveRooms(), query);
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
      /* 归属先解析：限流要按账号算，匿名才退回 IP */
      const ownerId = ctx.resolveOwner ? await ctx.resolveOwner(req) : null;
      const actor = limits.createGameActor.take(actorKey(ownerId, ip));
      if (!actor.ok) {
        return tooMany(res, actor.retryAfterSec, `开局太频繁了，${actor.retryAfterSec} 秒后再试`);
      }
      const global = limits.createGameGlobal.take('global');
      if (!global.ok) {
        return tooMany(res, global.retryAfterSec, '当前开局人数较多，稍等片刻再试');
      }

      const body = await readBody<{
        playerName: string;
        players?: number;
        deck?: { key: string; count: number }[];
      }>(req);
      /*
       * 代号会进 AI prompt 与战绩表：去掉控制字符、限长。
       * 空值不叫「你」——AI 发言里满口「你」，两种「你」混起来分不清谁在说谁。
       */
      const name = cleanText(String(body.playerName ?? ''), 8) || '无名氏';

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

      const room = ctx.rooms.create(name, expandDeck(deckSlots), ownerId);
      if (!room) {
        return sendJson(res, 503, { error: '同时进行的对局已满，请稍后再试（不会踢掉别人正在进行的对局）' });
      }

      /* 异步开跑：对局循环挂起在 waitHuman 上，等待前端 action */
      void room.engine
        .run()
        .then(() => {
          if (room.engine.winner) return ctx.rooms.archive(room.engine, room.ownerId);
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
          live: engine.liveSpeechView(),
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

      /* 有凭证的访问都算「人还在」：弃局判定看这个时间，而不是开局时间 */
      room.touch();

      if (method === 'GET' && !sub) {
        return sendJson(res, 200, engine.snapshot(engine.human.id));
      }

      if (method === 'GET' && sub === 'events') {
        const since = Number(parsed.query.since ?? 0) || 0;
        const body: EventsResponse = {
          version: engine.version,
          events: engine.events.filter((e) => e.seq > since),
          snapshot: engine.snapshot(engine.human.id),
          live: engine.liveSpeechView(),
        };
        return sendJson(res, 200, body);
      }

      if (method === 'POST' && sub === 'action') {
        /* 每次动作都会推动一轮 AI 决策，脚本狂刷等于直接烧额度 */
        const rl = limits.action.take(`act:${roomId}`);
        if (!rl.ok) return tooMany(res, rl.retryAfterSec, '操作过于频繁，请稍后再试');
        const body = await readBody<{ value: string | number | null }>(req);
        const value = normalizeActionValue(body.value);
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
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message } satisfies ErrorResponse);
    return sendJson(res, 500, { error: (e as Error).message } satisfies ErrorResponse);
  }
}
