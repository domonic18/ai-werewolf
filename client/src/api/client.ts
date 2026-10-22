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

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
  live: (): Promise<LiveResponse> => request('/live'),

  createGame: (playerName: string): Promise<CreateGameResponse> => request('/games', { playerName }),
  snapshot: (gameId: string): Promise<Snapshot> => request(`/games/${gameId}`),
  events: (gameId: string, since: number): Promise<EventsResponse> => request(`/games/${gameId}/events?since=${since}`),
  spectate: (gameId: string, since: number): Promise<SpectateResponse> =>
    request(`/games/${gameId}/spectate?since=${since}`),
  action: (gameId: string, value: string | number | null): Promise<OkResponse> =>
    request(`/games/${gameId}/action`, { value }),
  quit: (gameId: string): Promise<OkResponse> => request(`/games/${gameId}/quit`, {}),
};
