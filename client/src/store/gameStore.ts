import { create } from 'zustand';
import type { GameEvent, Snapshot, SpectateSnapshot } from '@shared/types';

const MAX_EVENTS = 500;
export const STORAGE_KEY = 'ww_game';

interface ApplyPayload {
  events: GameEvent[];
  version: number;
  snapshot?: Snapshot;
  /** 观战投影（上帝视角），与玩家快照互斥使用 */
  spectate?: SpectateSnapshot;
}

interface GameStore {
  gameId: string | null;
  watching: boolean;
  version: number;
  snapshot: Snapshot | null;
  spectate: SpectateSnapshot | null;
  events: GameEvent[];
  /** 起一局（或进入观战） */
  open: (gameId: string, options?: { watching?: boolean }) => void;
  /** 应用一次轮询结果：事件按 seq 去重追加 */
  apply: (payload: ApplyPayload) => void;
  /** 退出/结束后回首页 */
  close: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  gameId: null,
  watching: false,
  version: 0,
  snapshot: null,
  spectate: null,
  events: [],

  open: (gameId, options) => {
    try {
      localStorage.setItem(STORAGE_KEY, gameId);
    } catch {
      /* 隐私模式下可能不可用，忽略 */
    }
    set({ gameId, watching: options?.watching ?? false, version: 0, snapshot: null, spectate: null, events: [] });
  },

  apply: ({ events, version, snapshot, spectate }) =>
    set((state) => {
      const seen = new Set(state.events.map((e) => e.seq));
      const fresh = events.filter((e) => !seen.has(e.seq));
      const merged = fresh.length ? [...state.events, ...fresh] : state.events;
      return {
        version: Math.max(state.version, version),
        events: merged.length > MAX_EVENTS ? merged.slice(-MAX_EVENTS) : merged,
        snapshot: snapshot ?? state.snapshot,
        spectate: spectate ?? state.spectate,
      };
    }),

  close: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set({ gameId: null, watching: false, version: 0, snapshot: null, spectate: null, events: [] });
  },
}));
