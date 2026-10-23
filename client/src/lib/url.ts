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

/**
 * 给地址追加 sharecode；没有分享码时原样返回（本地开发不需要）。
 *
 * **必须插在 `#` 之前**：`#` 之后是 fragment，浏览器根本不会把它发给服务器。
 * 这条曾经踩过 —— 观战链接是 `…#watch=<id>`，分享码被拼到 `#` 后面，
 * 朋友点开就是平台那张「链接不完整」的报错页（2026-10-23 线上事故）。
 */
export function withShareCode(path: string, code: string): string {
  if (!code) return path;
  const hashAt = path.indexOf('#');
  const base = hashAt < 0 ? path : path.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : path.slice(hashAt);
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}sharecode=${encodeURIComponent(code)}${hash}`;
}

const SHARE_CODE_KEY = 'ww_sharecode';

/** 把分享码记在本机：链接一旦发出去就改不回来，宁可不依赖「当前地址」这一份 */
export function rememberShareCode(code: string): void {
  if (!code) return;
  try {
    globalThis.localStorage?.setItem(SHARE_CODE_KEY, code);
  } catch {
    /* 隐私模式：记不住就算了，下一次还会从地址栏读到 */
  }
}

/**
 * 当前可用的分享码。
 *
 * 地址栏优先（同一台机器可能打开过别的环境的链接），没有就退回本机记住的那份。
 * 只读地址栏的写法有洞：别人从收藏夹/历史记录进来时 query 已经没了，
 * 这时再生成的分享链接会缺 sharecode，对方一律打不开。
 */
export function currentShareCode(search?: string): string {
  const fromUrl = readShareCode(search ?? globalThis.location?.search ?? '');
  if (fromUrl) {
    rememberShareCode(fromUrl);
    return fromUrl;
  }
  try {
    return globalThis.localStorage?.getItem(SHARE_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * 拼「分屏地址」：`/path?query#screen`。
 *
 * 顺序不能反 —— 早期写成 `#${screen}${search}`，结果是 `#setup?sharecode=…`：
 * 查询串被塞进 hash，刷新时 `screenFromHash()` 读到的就是 `setup?sharecode=…`，
 * 认不出任何分屏，直接掉回首页（2026-10-23 实测）。走邀请链接时最明显，
 * 因为那时 query 里同时有 sharecode 和 ref。
 */
export function screenUrl(screen: string, location: { pathname: string; search: string }): string {
  const hash = screen === 'home' ? '' : `#${screen}`;
  return `${location.pathname}${location.search}${hash}`;
}
