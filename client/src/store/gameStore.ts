import { create } from 'zustand';
import type { GameEvent, LiveSpeech, Snapshot, SpectateSnapshot } from '@shared/types';
import { clearSavedGame, saveGame } from '../lib/storage';

const MAX_EVENTS = 500;

interface ApplyPayload {
  events: GameEvent[];
  version: number;
  snapshot?: Snapshot;
  /** 观战投影（上帝视角），与玩家快照互斥使用 */
  spectate?: SpectateSnapshot;
  /** 正在流式输出的发言；null 表示这一段已经说完 */
  live?: LiveSpeech | null;
}

interface GameStore {
  gameId: string | null;
  /** 玩家凭证；观战为 null */
  token: string | null;
  watching: boolean;
  version: number;
  snapshot: Snapshot | null;
  spectate: SpectateSnapshot | null;
  events: GameEvent[];
  live: LiveSpeech | null;
  /** 起一局（或进入观战） */
  open: (gameId: string, options?: { watching?: boolean; token?: string }) => void;
  /** 应用一次轮询结果：事件按 seq 去重追加 */
  apply: (payload: ApplyPayload) => void;
  /** 退出/结束后回首页 */
  close: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  gameId: null,
  token: null,
  watching: false,
  version: 0,
  snapshot: null,
  spectate: null,
  events: [],
  live: null,

  open: (gameId, options) => {
    const watching = options?.watching ?? false;
    const token = options?.token ?? null;
    if (!watching && token) saveGame({ id: gameId, token });
    set({ gameId, token, watching, version: 0, snapshot: null, spectate: null, events: [], live: null });
  },

  apply: ({ events, version, snapshot, spectate, live }) =>
    set((state) => {
      const seen = new Set(state.events.map((e) => e.seq));
      const fresh = events.filter((e) => !seen.has(e.seq));
      const merged = fresh.length ? [...state.events, ...fresh] : state.events;
      return {
        version: Math.max(state.version, version),
        events: merged.length > MAX_EVENTS ? merged.slice(-MAX_EVENTS) : merged,
        snapshot: snapshot ?? state.snapshot,
        spectate: spectate ?? state.spectate,
        live: live === undefined ? state.live : live,
      };
    }),

  close: () => {
    clearSavedGame();
    set({ gameId: null, token: null, watching: false, version: 0, snapshot: null, spectate: null, events: [], live: null });
  },
}));
