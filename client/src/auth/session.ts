/**
 * 登录态存储（T019 基础层）。
 *
 * 只负责「token 存在哪、怎么读、什么时候失效」，不碰 OAuth 流程，也不碰游戏逻辑。
 * 用 sessionStorage 而非 localStorage：关掉浏览器即失效，比长期驻留克制。
 */
import { currentAccessToken, refreshAccessToken, signOutCloud } from './actions';

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

/**
 * 启动时对齐一次：SDK 里还有有效会话就把 token 同步过来，没有就说明真的该退出了。
 * 返回 false 时调用方应清本地会话 —— 否则页面显示「已登录」，服务端却认不出人。
 */
export async function syncSession(): Promise<boolean> {
  const local = read();
  if (!local) return false;
  const fresh = await currentAccessToken();
  if (fresh) {
    patchToken(fresh);
    return true;
  }
  const renewed = await refreshAccessToken();
  if (renewed) {
    patchToken(renewed);
    return true;
  }
  return false;
}

/**
 * 退出：SDK 的会话（localStorage）必须先清。
 * 只清本地那份的话，下次进页面 SDK 会把 token 递回来，等于「退出无效」。
 */
export async function logout(): Promise<void> {
  await signOutCloud();
  clearSession();
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

/** 把续期后的 token 静默写回（不触发 UI 重渲染，token 不是展示数据） */
function patchToken(token: string): void {
  const current = read();
  if (!current || current.accessToken === token) return;
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify({ ...current, accessToken: token }));
    current.accessToken = token;
  } catch {
    /* 隐私模式：内存里的对象已经更新，够这一次请求用 */
  }
}

/**
 * 请求前取一个「现在能用」的 token。
 *
 * 顺序：SDK 的 getAccessToken（内部会按需续期）→ 主动 refreshSession → 最后退回本地快照。
 * 退回快照是为了让服务端自己判定（过期就 401），而不是客户端假装没登录过。
 */
export async function resolveAuthToken(): Promise<string | null> {
  const local = read();
  if (!local) return null;

  const fresh = await currentAccessToken();
  if (fresh) {
    patchToken(fresh);
    return fresh;
  }
  const renewed = await refreshAccessToken();
  if (renewed) {
    patchToken(renewed);
    return renewed;
  }
  return local.accessToken;
}
