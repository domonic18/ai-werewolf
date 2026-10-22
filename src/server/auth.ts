/**
 * 身份识别（不是授权）。
 *
 * 只回答一个问题：这个请求来自哪个账号？游戏规则与权限判定仍在服务端各处自己做，
 * 这里绝不承担「谁能做什么」的判断——那是宪法第 II 条（服务端权威）的边界。
 *
 * 设计要点：
 * - 校验器以依赖注入方式传入，便于在没有云服务配置时降级为「全部匿名」；
 * - 任何异常都视为未登录，不阻塞开局（登录是可选项，见 002 spec 的 Q8）；
 * - token 只从 Authorization: Bearer 读，不接受 URL 里传（会被日志与分享带出去）。
 */
import type { IncomingMessage } from 'node:http';

export interface TokenVerifier {
  /** 用 access token 换取账号 id；无效/过期返回 null */
  verify(accessToken: string): Promise<string | null>;
}

export type OwnerResolver = (req: IncomingMessage) => Promise<string | null>;

const BEARER = /^Bearer\s+(.+)$/i;

/** 从请求头取出 token（大小写不敏感，忽略多余空格） */
export function readBearer(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const matched = value.match(BEARER);
  return matched?.[1]?.trim() || null;
}

/** 组装解析器：无 token → null；校验失败/抛错 → null（降级为匿名） */
export function createOwnerResolver(verifier: TokenVerifier | null): OwnerResolver {
  return async (req) => {
    if (!verifier) return null;
    const token = readBearer(req);
    if (!token) return null;
    try {
      return await verifier.verify(token);
    } catch {
      return null;
    }
  };
}
