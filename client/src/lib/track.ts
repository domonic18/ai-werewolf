import type { TrackEventName } from '@shared/types';
import { api } from '../api/client';

/**
 * 埋点（4 个事件，PRD 8.7）。
 *
 * 三条原则：
 * 1. **绝不打扰玩家**：上报失败一律吞掉，不重试、不提示；
 * 2. **同一会话只记一次**（landing / login）：否则每切一次页面就多一条；
 * 3. 事件名只能从这里传，服务端还有一层白名单 —— 两边都窄，才不会慢慢长成「什么都记」。
 */

const SESSION_KEY = 'ww_tracked';

function alreadyTracked(key: string): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem(SESSION_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    return list.includes(key);
  } catch {
    return false;
  }
}

function markTracked(key: string): void {
  try {
    const raw = globalThis.sessionStorage?.getItem(SESSION_KEY);
    const list = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(key)) list.push(key);
    globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式：记不住就多报一次，不影响业务 */
  }
}

/** 每次都会上报（例如分享点击） */
export function trackEvent(event: TrackEventName, ref?: string | null): void {
  void api.track(event, ref).catch(() => {
    /* 静默 */
  });
}

/** 同一会话只上报一次（落地、登录） */
export function trackOnce(key: string, event: TrackEventName, ref?: string | null): void {
  if (alreadyTracked(key)) return;
  markTracked(key);
  trackEvent(event, ref);
}
