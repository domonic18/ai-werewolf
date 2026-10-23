/**
 * 服务端身份核实：把前端带来的 access token 换成账号 id。
 *
 * 为什么不能只看 JWT 里的 sub：签名是云服务签的，我们自己解 payload 等于不验签，
 * 任何人手写一段 base64 就能冒充别人。所以这里走云服务的 `/.cloud/auth/v1/user/me`
 * 实打实问一次「这个 token 是谁」。
 *
 * 两个必须遵守的细节（读 SDK 实现得到的，不是猜）：
 * - 请求头要带 `x-wb-webapp-access-key: <publishableKey>`，否则网关只回
 *   `invalid_client`（客户端凭据无效），看起来像 token 坏了；
 * - 路径是 `${endpoint}/.cloud/auth/v1/user/me`，endpoint 就是本应用自己的公网域名。
 *
 * 三条设计原则：
 * - 超时短（默认 3s）：身份核实失败只能降级成匿名，绝不能把开局卡住（Q8 允许匿名玩）；
 * - 短 TTL 缓存：一次开局/一次大厅查询都会调用它，不必每次都打云端；
 * - 不落日志、缓存键用 token 的哈希：token 本身就是密码级凭据。
 */
import crypto from 'node:crypto';
import type { TokenVerifier } from './auth.js';

export interface CloudIdentityOptions {
  endpoint: string;
  publishableKey: string;
  /** 注入 fetch 便于单测；默认用全局 fetch */
  fetchImpl?: typeof fetch;
  /** 有效 token 的缓存时长 */
  ttlMs?: number;
  /** 无效 token 的缓存时长（防止拿坏 token 反复打云端，但也不能记太久） */
  negativeTtlMs?: number;
  timeoutMs?: number;
}

interface CacheEntry {
  userId: string | null;
  expiresAt: number;
}

const MAX_CACHE = 500;

/** 云服务返回的用户结构里，id 可能叫 sub 或 uid（SDK 的 parseUser 两个都认） */
function pickUserId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { sub?: unknown; uid?: unknown; user?: unknown };
  if (typeof record.sub === 'string' && record.sub) return record.sub;
  if (typeof record.uid === 'string' && record.uid) return record.uid;
  if (record.user && typeof record.user === 'object') {
    const inner = record.user as { id?: unknown; sub?: unknown };
    if (typeof inner.id === 'string' && inner.id) return inner.id;
    if (typeof inner.sub === 'string' && inner.sub) return inner.sub;
  }
  return null;
}

export function createCloudTokenVerifier(options: CloudIdentityOptions): TokenVerifier {
  const base = options.endpoint.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const ttl = options.ttlMs ?? 60_000;
  const negativeTtl = options.negativeTtlMs ?? 10_000;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const cache = new Map<string, CacheEntry>();

  const keyOf = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

  const remember = (key: string, userId: string | null): void => {
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, { userId, expiresAt: Date.now() + (userId ? ttl : negativeTtl) });
  };

  return {
    async verify(accessToken: string): Promise<string | null> {
      if (!accessToken) return null;
      const key = keyOf(accessToken);
      const hit = cache.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.userId;

      try {
        const res = await doFetch(`${base}/.cloud/auth/v1/user/me`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'x-wb-webapp-access-key': options.publishableKey,
            /*
             * 会话是按「appId + Origin」绑定的（SDK 的 refreshToken 文档写得很明确）。
             * 服务端到服务端调用默认没有 Origin，网关会把它当成另一个客户端，
             * 回 invalid_grant —— 现象就是「明明刚登录，却说登录态失效」。
             */
            Origin: base,
            Referer: `${base}/`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        /* 401/403 是确定的「这个 token 不行」，可以短期记住；其它状态码不缓存，避免把云端故障当成身份结论 */
        if (res.status === 401 || res.status === 403) {
          remember(key, null);
          return null;
        }
        if (!res.ok) return null;
        const userId = pickUserId(await res.json());
        remember(key, userId);
        return userId;
      } catch {
        /* 断网/超时：不缓存，也不阻断对局，按匿名处理 */
        return null;
      }
    },
  };
}
