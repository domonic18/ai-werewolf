/**
 * 大厅投影：把内存房间裁剪成对外列表项，并负责筛选、排序与游标分页。
 *
 * 为什么要游标而不是 offset：默认按"观战人数"排序，而这个值是实时变化的，
 * 用 offset 翻页会出现重复/漏项（第 2 页把第 1 页的某条又拿到一次）。
 * 游标里带上"排序值 + gameId"，同值时用 id 兜底，保证单调推进。
 */
import type { LobbyGame, Phase } from '../shared/types.js';

export type LobbyFilter = 'all' | 'human' | 'final' | 'mine';
export type LobbySort = 'spectators' | 'created';

export interface LobbyQuery {
  filter: LobbyFilter;
  sort: LobbySort;
  limit: number;
  after: string | null;
  /** filter=mine 时要找的对局 id（未登录时用：由前端把本地存档的 id 带上来） */
  mine: string | null;
  /** filter=mine 的账号维度：登录后由服务端解析出的账号 id，优先于 mine */
  ownerId?: string | null;
}

export interface LobbyPage {
  games: LobbyGame[];
  nextCursor: string | null;
  total: number;
}

/** 只依赖房间的这几个字段，便于单测构造假房间 */
export interface LobbyRoomLike {
  createdAt: number;
  spectatorCount: number;
  /** 开局者账号（匿名局为 null / 未提供） */
  ownerId?: string | null;
  engine: {
    id: string;
    playerName: string;
    round: number;
    phase: Phase;
    aborted: { reason: string } | null;
    players: { isHuman: boolean }[];
    alivePlayers(): unknown[];
  };
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** 阶段标签：第 N 夜 / 第 N 天 / 第 N 天 · 投票；round=0 表示还没真正开局 */
export function phaseLabel(phase: Phase, round: number): string {
  if (round === 0 && phase !== 'over') return '准备中';
  if (phase === 'night') return `第 ${round} 夜`;
  if (phase === 'vote') return `第 ${round} 天 · 投票`;
  if (phase === 'over') return '已结束';
  return `第 ${round} 天`;
}

/** 房间 → 大厅条目；已结束 / 已中止返回 null（不对外展示） */
export function toEntry(room: LobbyRoomLike): LobbyGame | null {
  const engine = room.engine;
  if (engine.phase === 'over' || engine.aborted) return null;

  const alive = engine.alivePlayers().length;
  return {
    gameId: engine.id,
    host: engine.playerName,
    round: engine.round,
    phase: engine.phase,
    phaseLabel: phaseLabel(engine.phase, engine.round),
    players: engine.players.length,
    maxPlayers: engine.players.length,
    alive,
    spectators: room.spectatorCount,
    hasHuman: engine.players.some((p) => p.isHuman),
    isFinal: alive <= 3,
    spectatable: true,
    startedAt: room.createdAt,
  };
}

function firstValue(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}

/** 解析并夹紧查询参数，非法值一律回落到默认值（不抛错） */
export function parseLobbyQuery(
  query: Record<string, string | string[] | undefined>,
  options: { ownerId?: string | null } = {},
): LobbyQuery {
  const filterRaw = firstValue(query.filter);
  const sortRaw = firstValue(query.sort);
  const limitRaw = Number(firstValue(query.limit) ?? DEFAULT_LIMIT);
  const afterRaw = firstValue(query.after);

  const filter: LobbyFilter =
    filterRaw === 'human' || filterRaw === 'final' || filterRaw === 'mine' ? filterRaw : 'all';
  const sort: LobbySort = sortRaw === 'created' ? 'created' : 'spectators';
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;

  const mine = firstValue(query.mine)?.slice(0, 64) || null;
  const ownerId = options.ownerId ?? null;
  /*
   * filter=mine 需要「我是谁」的依据：
   * - 登录后由服务端解析出账号（ownerId），换设备也能查；
   * - 未登录只能靠前端带上来的本机对局 id（mine）。
   * 两者都没有时由 listRooms 返回空结果，而不是退化成全量——
   * 否则「我的对局」会变成「所有对局」（见 tests/lobby.test.ts）。
   */
  return { filter, sort, limit, after: afterRaw || null, mine, ownerId };
}

function sortValue(entry: LobbyGame, sort: LobbySort): number {
  return sort === 'created' ? entry.startedAt : entry.spectators;
}

interface Cursor {
  s: number;
  id: string;
}

export function encodeCursor(entry: LobbyGame, sort: LobbySort): string {
  const payload: Cursor = { s: sortValue(entry, sort), id: entry.gameId };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(token: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const { s, id } = parsed as { s?: unknown; id?: unknown };
    if (typeof s !== 'number' || typeof id !== 'string') return null;
    return { s, id };
  } catch {
    return null;
  }
}

/** 是否排在游标之后（排序：值降序，同值 gameId 升序） */
function isAfterCursor(entry: LobbyGame, cursor: Cursor, sort: LobbySort): boolean {
  const value = sortValue(entry, sort);
  if (value !== cursor.s) return value < cursor.s;
  return entry.gameId > cursor.id;
}

/**
 * 生成一页大厅数据。
 * `total` 是过滤后的总数（不受游标影响），前端用它展示「还有 N 局」。
 */
export function listRooms(rooms: Iterable<[string, LobbyRoomLike]>, query: LobbyQuery): LobbyPage {
  const entries: LobbyGame[] = [];

  for (const [, room] of rooms) {
    const entry = toEntry(room);
    if (!entry) continue;
    if (query.filter === 'human' && !entry.hasHuman) continue;
    if (query.filter === 'final' && !entry.isFinal) continue;
    if (query.filter === 'mine') {
      /* 登录后按账号归属匹配（跨设备可见）；未登录按本机存档的对局 id */
      const hit = query.ownerId ? room.ownerId === query.ownerId : entry.gameId === query.mine;
      if (!hit) continue;
    }
    entries.push(entry);
  }

  entries.sort((a, b) => {
    const diff = sortValue(b, query.sort) - sortValue(a, query.sort);
    if (diff !== 0) return diff;
    return a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0;
  });

  const total = entries.length;
  const cursor = query.after ? decodeCursor(query.after) : null;
  const remaining = cursor ? entries.filter((entry) => isAfterCursor(entry, cursor, query.sort)) : entries;

  const games = remaining.slice(0, query.limit);
  const last = games.at(-1);
  const nextCursor = last && remaining.length > games.length ? encodeCursor(last, query.sort) : null;

  return { games, nextCursor, total };
}
