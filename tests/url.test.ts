import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentShareCode, readShareCode, withShareCode } from '../client/src/lib/url';

/**
 * 这组用例锁定一个平台约束：发布网关只对带 sharecode 的请求放行（POST 尤其严格）。
 * 前端漏带分享码时，浏览器会直接报 "Failed to fetch" —— 2026-10-22 真实踩过。
 */
describe('readShareCode', () => {
  it('从查询串里读出分享码', () => {
    expect(readShareCode('?sharecode=2IBHTRFFFL')).toBe('2IBHTRFFFL');
    expect(readShareCode('?a=1&sharecode=abc&b=2')).toBe('abc');
  });

  it('没有分享码时返回空串', () => {
    expect(readShareCode('')).toBe('');
    expect(readShareCode('?foo=bar')).toBe('');
  });
});

describe('withShareCode', () => {
  it('没有分享码时原样返回（本地开发不受影响）', () => {
    expect(withShareCode('/api/health', '')).toBe('/api/health');
  });

  it('无查询串时用 ? 追加', () => {
    expect(withShareCode('/api/games', 'abc')).toBe('/api/games?sharecode=abc');
  });

  it('已有查询串时用 & 追加', () => {
    expect(withShareCode('/api/games/g1/events?since=12', 'abc')).toBe(
      '/api/games/g1/events?since=12&sharecode=abc',
    );
  });

  it('对分享码做转义，避免破坏查询串', () => {
    expect(withShareCode('/api/live', 'a b&c')).toBe('/api/live?sharecode=a%20b%26c');
  });
});

/**
 * 回归：观战链接的分享码被拼到了 `#` 后面。
 *
 * `#watch=<id>` 是深链，`#` 之后的整段都是 fragment，浏览器不会发给服务器。
 * 于是服务端只看到「没有 sharecode」，回平台那张「链接不完整 / 当前地址缺少访问参数」页。
 * 2026-10-23 线上事故：分享给朋友的观战链接全部打不开。
 */
describe('withShareCode：必须插在 # 之前', () => {
  it('带 hash 的链接，参数落在 hash 前面', () => {
    expect(withShareCode('https://h.host/#watch=g1', 'abc')).toBe('https://h.host/?sharecode=abc#watch=g1');
  });

  it('已有 query 又有 hash：用 & 接在 query 上，hash 保持在末尾', () => {
    expect(withShareCode('https://h.host/?ref=YEKE-7F2#watch=g1', 'abc')).toBe(
      'https://h.host/?ref=YEKE-7F2&sharecode=abc#watch=g1',
    );
  });

  it('API 路径（本来就没有 hash）行为不变', () => {
    expect(withShareCode('/api/games?since=1', 'abc')).toBe('/api/games?since=1&sharecode=abc');
  });
});

describe('currentShareCode：地址栏优先，其次本机记住', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal('location', { search: '' });
  });

  it('地址栏有分享码时用它，并记到本机', () => {
    expect(currentShareCode('?sharecode=ABC')).toBe('ABC');
    expect([...store.values()]).toContain('ABC');
  });

  it('地址栏没有（从收藏夹/历史进来）时退回本机记住的那份', () => {
    currentShareCode('?sharecode=ABC');
    expect(currentShareCode('')).toBe('ABC');
  });

  it('两处都没有就返回空串（本地开发不为难）', () => {
    expect(currentShareCode('')).toBe('');
  });
});
