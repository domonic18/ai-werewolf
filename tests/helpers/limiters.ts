import { SlidingWindowLimiter } from '../../src/server/rate-limit.js';
import type { ApiLimiters } from '../../src/server/routes.js';

/**
 * 测试专用：把限流放宽到「等于不限」。
 *
 * 这些用例关心的是功能契约（牌组校验、账号归属、观战投影…），不是限流策略本身；
 * 而它们会在同一进程内连开十几局，默认的 3 局/10 分钟会直接把用例打成 429。
 * 真正验限流的用例在 tests/security-limits.test.ts 里，那里用的是严格档位。
 */
export function permissiveLimiters(): ApiLimiters {
  return {
    createGameActor: new SlidingWindowLimiter({ limit: 1_000, windowMs: 60_000 }),
    createGameGlobal: new SlidingWindowLimiter({ limit: 1_000, windowMs: 60_000 }),
    action: new SlidingWindowLimiter({ limit: 1_000, windowMs: 60_000 }),
    modelSelect: new SlidingWindowLimiter({ limit: 1_000, windowMs: 60_000 }),
    read: new SlidingWindowLimiter({ limit: 1_000, windowMs: 60_000 }),
  };
}
