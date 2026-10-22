import { describe, expect, it } from 'vitest';
import { readShareCode, withShareCode } from '../client/src/lib/url';

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
