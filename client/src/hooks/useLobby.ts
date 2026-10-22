import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { LiveQuery } from '../api/client';
import type { LobbyGame } from '@shared/types';
import { readSavedGame } from '../lib/storage';

const PAGE_SIZE = 10;

export interface LobbyState {
  games: LobbyGame[];
  /** 本地是否有进行中的对局（「我的对局」筛选的依据） */
  hasMine: boolean;
  /** 各筛选条件下的总局数（筛选 chip 上的角标，设计稿要求带数字） */
  counts: Record<'all' | 'human' | 'final' | 'mine', number | null>;
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  filter: NonNullable<LiveQuery['filter']>;
  sort: NonNullable<LiveQuery['sort']>;
  setFilter: (filter: NonNullable<LiveQuery['filter']>) => void;
  setSort: (sort: NonNullable<LiveQuery['sort']>) => void;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * 大厅数据：首屏一页 + 游标续页。
 *
 * 换筛选/排序一律重置列表（游标是按排序值编码的，跨条件复用会拿错页）。
 * 用请求序号丢弃过期响应 —— 快速连点筛选时，先发的请求可能后到。
 */
export function useLobby(): LobbyState {
  const [games, setGames] = useState<LobbyGame[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<NonNullable<LiveQuery['filter']>>('all');
  const [sort, setSortState] = useState<NonNullable<LiveQuery['sort']>>('spectators');
  const [counts, setCounts] = useState<LobbyState['counts']>({ all: null, human: null, final: null, mine: null });

  const requestId = useRef(0);

  const fetchPage = useCallback(
    async (nextFilter: NonNullable<LiveQuery['filter']>, nextSort: NonNullable<LiveQuery['sort']>, after: string | null) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        /* 「我的对局」把本地存档的 id 带给服务端——服务端不认识「我」，也不该认识 */
        const mine = readSavedGame()?.id ?? null;
        const page = await api.live({ filter: nextFilter, sort: nextSort, limit: PAGE_SIZE, after, mine });
        if (id !== requestId.current) return; /* 已有更新的请求，丢弃这次结果 */
        setGames((prev) => (after ? [...prev, ...page.games] : page.games));
        setCursor(page.nextCursor);
        setTotal(page.total);
      } catch (e) {
        if (id !== requestId.current) return;
        setError(e instanceof Error ? e.message : '大厅加载失败');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [],
  );

  const reload = useCallback(async () => {
    await fetchPage(filter, sort, null);
  }, [fetchPage, filter, sort]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    await fetchPage(filter, sort, cursor);
  }, [cursor, fetchPage, filter, loading, sort]);

  const setFilter = useCallback(
    (next: NonNullable<LiveQuery['filter']>) => {
      if (next === filter) return;
      setFilterState(next);
      setGames([]);
      setCursor(null);
      void fetchPage(next, sort, null);
    },
    [fetchPage, filter, sort],
  );

  const setSort = useCallback(
    (next: NonNullable<LiveQuery['sort']>) => {
      if (next === sort) return;
      setSortState(next);
      setGames([]);
      setCursor(null);
      void fetchPage(filter, next, null);
    },
    [fetchPage, filter, sort],
  );

  useEffect(() => {
    void fetchPage('all', 'spectators', null);
  }, [fetchPage]);

  /*
   * 各筛选的角标数字：limit=1 只为了拿 total（服务端返回的总数是过滤后的全量）。
   * 四个请求都很轻（内存房间），失败就显示 "—"，不阻塞列表。
   */
  useEffect(() => {
    const mine = readSavedGame()?.id ?? null;
    let cancelled = false;
    const keys = ['all', 'human', 'final', 'mine'] as const;
    void Promise.all(
      keys.map((key) =>
        api
          .live({ filter: key, limit: 1, mine })
          .then((page) => [key, page.total] as const)
          .catch(() => [key, null] as const),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setCounts(Object.fromEntries(pairs) as LobbyState['counts']);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    games,
    hasMine: Boolean(readSavedGame()?.id),
    counts,
    total,
    hasMore: Boolean(cursor),
    loading,
    error,
    filter,
    sort,
    setFilter,
    setSort,
    loadMore,
    reload,
  };
}
