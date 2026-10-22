import type {
  CreateGameResponse,
  EventsResponse,
  HealthResponse,
  LiveResponse,
  MatchesResponse,
  ModelsResponse,
  RolesResponse,
  OkResponse,
  Snapshot,
  SpectateResponse,
} from '@shared/types';
import { readShareCode, withShareCode } from '../lib/url';

/** 大厅查询：字段与 src/server/lobby.ts 的 LobbyQuery 一一对应 */
export interface LiveQuery {
  filter?: 'all' | 'human' | 'final' | 'mine';
  /** filter=mine 时要找的对局 id */
  mine?: string | null;
  sort?: 'spectators' | 'created';
  limit?: number;
  after?: string | null;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * 平台发布网关要求请求带分享码：同域 GET 放行，**POST 不放行**（直接 403 链接不完整页）。
 * 浏览器里表现为 fetch 直接失败，所以每个请求都要把当前页面的 sharecode 带上。
 */
const SHARE_CODE = typeof window === 'undefined' ? '' : readShareCode(window.location.search);

async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  /* 玩家凭证走请求头：不进 URL，避免出现在日志与分享里 */
  if (token) headers['X-Player-Token'] = token;

  const res = await fetch(withShareCode(`/api${path}`, SHARE_CODE), {
    method: body === undefined ? 'GET' : 'POST',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const contentType = res.headers.get('content-type') ?? '';

  /* 网关拦截时返回的是 HTML 错误页，直接 JSON.parse 会抛「Unexpected token '<'」，
     对使用者毫无帮助，这里换成能指明原因的话 */
  if (!contentType.includes('application/json')) {
    throw new ApiError(
      res.status,
      res.status === 403
        ? '访问链接不完整：请用带 sharecode 的分享链接打开这个页面'
        : `服务返回了非预期内容（HTTP ${res.status}）`,
    );
  }

  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : res.statusText;
    throw new ApiError(res.status, message);
  }
  return parsed as T;
}

export const api = {
  health: (): Promise<HealthResponse> => request('/health'),
  models: (): Promise<ModelsResponse> => request('/models'),
  selectModel: (id: string): Promise<OkResponse> => request('/models/select', { id }),
  matches: (): Promise<MatchesResponse> => request('/matches'),
  live: (query: LiveQuery = {}): Promise<LiveResponse> => {
    const params = new URLSearchParams();
    if (query.filter && query.filter !== 'all') params.set('filter', query.filter);
    if (query.mine) params.set('mine', query.mine);
    if (query.sort && query.sort !== 'spectators') params.set('sort', query.sort);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.after) params.set('after', query.after);
    const qs = params.toString();
    return request(`/live${qs ? `?${qs}` : ''}`);
  },

  roles: (players: number): Promise<RolesResponse> => request(`/roles?players=${players}`),
  createGame: (
    payload: { playerName: string; players?: number; deck?: { key: string; count: number }[] },
  ): Promise<CreateGameResponse> => request('/games', payload),
  snapshot: (gameId: string, token: string): Promise<Snapshot> => request(`/games/${gameId}`, undefined, token),
  events: (gameId: string, since: number, token: string): Promise<EventsResponse> =>
    request(`/games/${gameId}/events?since=${since}`, undefined, token),
  spectate: (gameId: string, since: number, clientId?: string): Promise<SpectateResponse> =>
    request(`/games/${gameId}/spectate?since=${since}${clientId ? `&client=${encodeURIComponent(clientId)}` : ''}`),
  action: (gameId: string, value: string | number | null, token: string): Promise<OkResponse> =>
    request(`/games/${gameId}/action`, { value }, token),
  quit: (gameId: string, token: string): Promise<OkResponse> => request(`/games/${gameId}/quit`, {}, token),
};
