/**
 * 分享码（sharecode）处理。
 *
 * 平台的发布网关要求非导航请求也带上分享码，否则直接返回 403 的「链接不完整」页
 * （实测：同域 GET 放行，POST 不放行；浏览器侧表现为 fetch 直接失败）。
 * 所以前端所有 API 请求都要把当前页面的 sharecode 一并带上。
 * 这里做成纯函数，便于单测覆盖边界（无分享码、已有 query、需要转义）。
 */

/** 读取当前 URL 里的分享码；没有则返回空串 */
export function readShareCode(search: string): string {
  try {
    return new URLSearchParams(search).get('sharecode') ?? '';
  } catch {
    return '';
  }
}

/** 给路径追加 sharecode；没有分享码时原样返回（本地开发不需要） */
export function withShareCode(path: string, code: string): string {
  if (!code) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}sharecode=${encodeURIComponent(code)}`;
}
