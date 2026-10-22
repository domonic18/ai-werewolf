import type {
  CreateGameResponse,
  EventsResponse,
  HealthResponse,
  LiveResponse,
  MatchesResponse,
  ModelsResponse,
  OkResponse,
  Snapshot,
  SpectateResponse,
} from '@shared/types';

/** 大厅查询：字段与 src/server/lobby.ts 的 LobbyQuery 一一对应 */
export interface LiveQuery {
  filter?: 'all' | 'human' | 'final';
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

async function request<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  /* 玩家凭证走请求头：不进 URL，避免出现在日志与分享里 */
  if (token) headers['X-Player-Token'] = token;

  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
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
    if (query.sort && query.sort !== 'spectators') params.set('sort', query.sort);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.after) params.set('after', query.after);
    const qs = params.toString();
    return request(`/live${qs ? `?${qs}` : ''}`);
  },

  createGame: (playerName: string): Promise<CreateGameResponse> => request('/games', { playerName }),
  snapshot: (gameId: string, token: string): Promise<Snapshot> => request(`/games/${gameId}`, undefined, token),
  events: (gameId: string, since: number, token: string): Promise<EventsResponse> =>
    request(`/games/${gameId}/events?since=${since}`, undefined, token),
  spectate: (gameId: string, since: number, clientId?: string): Promise<SpectateResponse> =>
    request(`/games/${gameId}/spectate?since=${since}${clientId ? `&client=${encodeURIComponent(clientId)}` : ''}`),
  action: (gameId: string, value: string | number | null, token: string): Promise<OkResponse> =>
    request(`/games/${gameId}/action`, { value }, token),
  quit: (gameId: string, token: string): Promise<OkResponse> => request(`/games/${gameId}/quit`, {}, token),
};
