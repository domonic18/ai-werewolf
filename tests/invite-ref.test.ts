import { describe, expect, it, vi, beforeEach } from 'vitest';
import { captureRef, clearRef, currentRef, markRefBound, normalizeRef, refAlreadyBound } from '../client/src/lib/invite.js';

/**
 * 邀请码落盘。
 *
 * 这段逻辑的价值在于「时间差」：点开链接时还没登录，登录时 URL 里的 ref 多半已经没了
 * （第三方回调会清 query）。所以 ref 必须先存下来，且要有有效期——不然一个月后
 * 点过的链接还会在今天登录时生效，把关系记到别人头上。
 */

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

describe('落地时抓取邀请码', () => {
  it('从 query 里取到并规范化', () => {
    const ref = captureRef('?ref=yeke7f2&sharecode=2IBHTRFFFL');
    expect(ref?.code).toBe('YEKE-7F2');
    expect(currentRef()).toBe('YEKE-7F2');
  });

  it('不像邀请码的值不落盘', () => {
    expect(captureRef('?ref=abc')).toBeNull();
    expect(captureRef('')).toBeNull();
    expect(currentRef()).toBeNull();
  });

  it('同一浏览器再点一个链接，以最后一次为准', () => {
    captureRef('?ref=AAAA234');
    captureRef('?ref=BBBB567');
    expect(currentRef()).toBe('BBBB-567');
  });
});

describe('有效期 24 小时', () => {
  it('24 小时内有效', () => {
    const now = Date.now();
    captureRef('?ref=ABCD234', now - 23 * 3600_000);
    expect(currentRef(now)).toBe('ABCD-234');
  });

  it('超过 24 小时视为过期，并清掉', () => {
    const now = Date.now();
    captureRef('?ref=ABCD234', now - 25 * 3600_000);
    expect(currentRef(now)).toBeNull();
    expect(store.get('ww_ref')).toBeUndefined();
  });
});

describe('绑定标记', () => {
  it('绑定过就不必反复请求', () => {
    expect(refAlreadyBound()).toBe(false);
    markRefBound();
    expect(refAlreadyBound()).toBe(true);
  });

  it('清掉 ref 不影响「已绑定」标记', () => {
    captureRef('?ref=ABCD234');
    markRefBound();
    clearRef();
    expect(currentRef()).toBeNull();
    expect(refAlreadyBound()).toBe(true);
  });
});

describe('规范化', () => {
  it('大小写/空格/连字符都宽容', () => {
    expect(normalizeRef('ye ke 7f2')).toBe('YEKE-7F2');
    expect(normalizeRef('YEKE-7F2')).toBe('YEKE-7F2');
  });

  it('位数不对不猜', () => {
    expect(normalizeRef('YEKE')).toBe('');
    expect(normalizeRef('YEKE-7F2X')).toBe('');
    expect(normalizeRef('1234ABC')).toBe('');
  });
});
