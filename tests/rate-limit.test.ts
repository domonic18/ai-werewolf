import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter, actorKey, clientIp } from '../src/server/rate-limit.js';

/** 可手动推进的时钟，避免用真实时间把测试拖慢 */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('滑动窗口限流', () => {
  it('窗口内达到上限后拒绝，并给出重试秒数', () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 3, windowMs: 10_000, now: c.now });

    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(true);
    const third = limiter.take('a');
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);

    const blocked = limiter.take('a');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(10);
  });

  it('窗口滑过之后重新放行', () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 5_000, now: c.now });
    limiter.take('a');
    limiter.take('a');
    expect(limiter.take('a').ok).toBe(false);

    c.advance(5_001);
    expect(limiter.take('a').ok).toBe(true);
  });

  it('不同 key 互不影响（一个人刷爆不该影响别人）', () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 10_000, now: c.now });
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
    expect(limiter.take('b').ok).toBe(true);
  });

  it('sweep 清掉过期 key，避免内存随访客数增长', () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1_000, now: c.now });
    limiter.take('a');
    limiter.take('b');
    expect(limiter.size).toBe(2);

    c.advance(2_000);
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });

  it('peek 只读不消费额度', () => {
    const c = clock();
    const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1_000, now: c.now });
    limiter.take('a');
    expect(limiter.peek('a')).toBe(1);
    expect(limiter.peek('a')).toBe(1);
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
  });
});

describe('来源键', () => {
  it('登录用户按账号算，匿名按 IP', () => {
    expect(actorKey('u-1', '1.2.3.4')).toBe('u:u-1');
    expect(actorKey(null, '1.2.3.4')).toBe('ip:1.2.3.4');
  });

  it('IPv6 收窄到 /64，防止单机轮换地址绕过', () => {
    expect(actorKey(null, '2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('ip6:2001:db8:1:2');
  });

  it('IPv4 映射地址去掉前缀', () => {
    expect(actorKey(null, '::ffff:127.0.0.1')).toBe('ip:127.0.0.1');
  });

  it('没有 IP 时归到同一个 unknown 桶，避免绕过', () => {
    expect(actorKey(null, undefined)).toBe('ip:unknown');
  });
});

describe('代理头解析', () => {
  it('优先 x-forwarded-for 的第一跳', () => {
    expect(clientIp({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })).toBe('203.0.113.7');
  });

  it('其次 x-real-ip', () => {
    expect(clientIp({ 'x-real-ip': '203.0.113.8' })).toBe('203.0.113.8');
  });

  it('都没有时返回空串（调用方会落到 unknown 桶）', () => {
    expect(clientIp({})).toBe('');
  });
});
