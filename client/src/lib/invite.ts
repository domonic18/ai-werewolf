/**
 * 邀请码的落地与补记。
 *
 * 传播路径上有两个时间点错开了：
 *   1. 点开链接时，人还没登录 —— 但他已经"被邀请"了；
 *   2. 登录时，URL 里的 `?ref=` 往往已经不在（玩家点了别的地方、刷新、或者走的是 SPA 路由）。
 *
 * 所以 ref 必须**落盘**（同一浏览器 24 小时内最后一次点击生效，PRD 8.7），
 * 等登录成功后再补记关系。这也是为什么这里不是"读一下 query 就完"。
 */

const REF_KEY = 'ww_ref';
const BOUND_KEY = 'ww_bound';
/** 24 小时：再久就不是"刚被谁邀请进来"，而是一次新的拜访 */
const REF_TTL_MS = 24 * 60 * 60 * 1000;

export interface CapturedRef {
  code: string;
  at: number;
}

/** 从地址栏取邀请码并落盘；同一浏览器以最后一次点击为准 */
export function captureRef(search: string, now = Date.now()): CapturedRef | null {
  const code = new URLSearchParams(search).get('ref') ?? '';
  const normalized = normalizeRef(code);
  if (!normalized) return null;
  const captured: CapturedRef = { code: normalized, at: now };
  try {
    globalThis.localStorage?.setItem(REF_KEY, JSON.stringify(captured));
  } catch {
    /* 隐私模式：这一次的落地横幅还能用（调用方持有返回值），只是登录后补记不了 */
  }
  return captured;
}

/** 读仍然有效的邀请码（超过 24 小时视为过期并清掉） */
export function currentRef(now = Date.now()): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(REF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CapturedRef>;
    const code = normalizeRef(parsed.code ?? '');
    const at = typeof parsed.at === 'number' ? parsed.at : 0;
    if (!code || now - at > REF_TTL_MS) {
      globalThis.localStorage?.removeItem(REF_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function clearRef(): void {
  try {
    globalThis.localStorage?.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}

/** 这个浏览器是否已经尝试过绑定（避免每次进页面都打一次接口） */
export function refAlreadyBound(): boolean {
  try {
    return globalThis.localStorage?.getItem(BOUND_KEY) === '1';
  } catch {
    return false;
  }
}

export function markRefBound(): void {
  try {
    globalThis.localStorage?.setItem(BOUND_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * 邀请码规范化：与后端同一套规则（4 字母 + 3 位，允许大小写/空格/缺连字符）。
 * 前端也做一遍，是为了在拿不到接口时仍能判断"这串东西像不像邀请码"，
 * 不至于把 `?ref=abc` 这种垃圾当邀请码写进 localStorage。
 */
export function normalizeRef(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{4}[0-9A-Z]{3}$/.test(cleaned)) return '';
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}
