import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { useGameStore } from '../store/gameStore';

const POLL_MS = 1200;
const SPECTATE_POLL_MS = 1600;
const MAX_FAILURES = 3;

/**
 * 对局轮询：真人局拉 /events（含快照），观战拉 /spectate + /snapshot。
 * 事件按 seq 去重追加；连读失败或 404 视为对局失效。
 */
export function useMatchPolling(): { lost: boolean } {
  const gameId = useGameStore((s) => s.gameId);
  const watching = useGameStore((s) => s.watching);
  const apply = useGameStore((s) => s.apply);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    setLost(false);
    if (!gameId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const tick = async (): Promise<void> => {
      const since = useGameStore.getState().version;
      try {
        if (watching) {
          const [stream, snapshot] = await Promise.all([api.spectate(gameId, since), api.snapshot(gameId)]);
          if (cancelled) return;
          apply({ events: stream.events, version: stream.version, snapshot });
        } else {
          const data = await api.events(gameId, since);
          if (cancelled) return;
          apply({ events: data.events, version: data.version, snapshot: data.snapshot });
        }
        failures = 0;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setLost(true);
          return;
        }
        failures += 1;
        if (failures >= MAX_FAILURES) {
          setLost(true);
          return;
        }
      }
      if (!cancelled) timer = setTimeout(() => void tick(), watching ? SPECTATE_POLL_MS : POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, watching, apply]);

  return { lost };
}
