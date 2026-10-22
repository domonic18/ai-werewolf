/**
 * 登录态存储（T019 基础层）。
 *
 * 只负责「token 存在哪、怎么读、什么时候失效」，不碰 OAuth 流程，也不碰游戏逻辑。
 * 用 sessionStorage 而非 localStorage：关掉浏览器即失效，比长期驻留克制。
 */
const KEY = 'ww_session';

export interface Session {
  accessToken: string;
  userId: string;
  /** 过期时间戳（ms）；0 表示未知 */
  expiresAt: number;
}

type Listener = (session: Session | null) => void;
const listeners = new Set<Listener>();

function read(): Session | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!parsed.accessToken || !parsed.userId) return null;
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null;
    return { accessToken: parsed.accessToken, userId: parsed.userId, expiresAt: parsed.expiresAt ?? 0 };
  } catch {
    return null;
  }
}

export const getSession = (): Session | null => read();

export function setSession(session: Session): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(session));
  } catch {
    /* 隐私模式下不可写：内存态仍可用 */
  }
  for (const fn of listeners) fn(session);
}

export function clearSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn(null);
}

export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 有登录态就带 Bearer，没有就空对象（匿名局照常可玩） */
export function authHeaders(): Record<string, string> {
  const session = read();
  return session ? { Authorization: `Bearer ${session.accessToken}` } : {};
}
