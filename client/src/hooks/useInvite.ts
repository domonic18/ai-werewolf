import { useCallback, useEffect, useState } from 'react';
import type { InviteOverviewResponse } from '@shared/types';
import { api } from '../api/client';
import { currentRef, markRefBound, refAlreadyBound } from '../lib/invite';

/**
 * 我的邀请码与「我邀请的朋友」。
 *
 * `enabled=false`（未登录）时不发请求：这个接口对匿名一律 401，
 * 与其让控制台红一片，不如干脆不问。
 */
export function useMyInvite(enabled: boolean): {
  data: InviteOverviewResponse | null;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<InviteOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      setData(await api.invite());
    } catch {
      /* 云库不可用 / 会话失效：页面显示降级文案，不影响战绩部分 */
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, reload };
}

/**
 * 登录后补记「谁邀请了我」。
 *
 * 只在真的拿到服务端结论时清除 ref：
 * - bound / exists / self / bad-code 都算「问过了」，清掉，不再反复请求；
 * - 网络失败或 401 保留，下次进页面再试（此时 token 可能还没就绪）。
 */
export async function flushPendingRef(): Promise<void> {
  const ref = currentRef();
  if (!ref || refAlreadyBound()) return;
  try {
    const result = await api.bindInvite(ref);
    if (result.status !== 'unavailable') markRefBound();
  } catch {
    /* 网络/鉴权问题：保留 ref，下一次再说 */
  }
}
