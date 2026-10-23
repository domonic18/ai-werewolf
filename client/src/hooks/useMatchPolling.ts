import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { getClientId } from '../lib/clientId';
import { useGameStore } from '../store/gameStore';

const POLL_MS = 1200;
const SPECTATE_POLL_MS = 1600;
/** 有人正在流式发言时的轮询间隔：逐字效果靠它，1.2s 一次会变成一段一段蹦 */
const LIVE_POLL_MS = 300;
const MAX_FAILURES = 3;

export type LostReason = 'expired' | 'unauthorized' | null;

/**
 * 对局轮询：真人局拉 /events（带玩家凭证），观战拉 /spectate。
 * 事件按 seq 去重追加；401 视为凭证缺失，404 视为对局已被清理。
 */
export function useMatchPolling(): { lost: boolean; reason: LostReason } {
  const gameId = useGameStore((s) => s.gameId);
  const watching = useGameStore((s) => s.watching);
  const token = useGameStore((s) => s.token);
  const apply = useGameStore((s) => s.apply);
  const [reason, setReason] = useState<LostReason>(null);

  useEffect(() => {
    setReason(null);
    if (!gameId) return;

    /* 真人局没有凭证就不用轮询了 —— 服务端只会回 401 */
    if (!watching && !token) {
      setReason('unauthorized');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const tick = async (): Promise<void> => {
      const since = useGameStore.getState().version;
      try {
        if (watching) {
          /* 观战只认 /spectate：它返回上帝视角投影，不再借用真人快照接口（那会泄露身份） */
          const stream = await api.spectate(gameId, since, getClientId());
          if (cancelled) return;
          apply({
            events: stream.events,
            version: stream.version,
            spectate: stream.snapshot,
            live: stream.live ?? null,
          });
        } else {
          const data = await api.events(gameId, since, token as string);
          if (cancelled) return;
          apply({ events: data.events, version: data.version, snapshot: data.snapshot, live: data.live ?? null });
        }
        failures = 0;
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) {
            setReason('unauthorized');
            return;
          }
          if (e.status === 404) {
            setReason('expired');
            return;
          }
        }
        failures += 1;
        if (failures >= MAX_FAILURES) {
          setReason('expired');
          return;
        }
      }
      if (!cancelled) {
        const streaming = Boolean(useGameStore.getState().live);
        const delay = watching ? (streaming ? LIVE_POLL_MS : SPECTATE_POLL_MS) : streaming ? LIVE_POLL_MS : POLL_MS;
        timer = setTimeout(() => void tick(), delay);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [gameId, watching, token, apply]);

  return { lost: reason !== null, reason };
}
