/**
 * 滑动窗口限流（进程内）。
 *
 * 为什么不是漏桶/令牌桶：这里的诉求是「防止有人用脚本把 LLM 额度烧光」，
 * 需要的是「最近 N 秒内最多 M 次」这种能对用户解释清楚的规则，而不是平滑速率。
 *
 * 为什么内存态就够：服务本身就是单进程沙箱（见 rooms.ts），重启即清零；
 * 多实例部署时应换成共享存储，这个文件是唯一需要替换的地方。
 */
export interface LimitResult {
  ok: boolean;
  /** 还需要等多少秒才允许下一次（ok=true 时为 0） */
  retryAfterSec: number;
  /** 本窗口内还剩几次 */
  remaining: number;
}

export interface LimiterOptions {
  /** 窗口内允许的次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 最多跟踪多少个 key，超出后清理最旧的一半，防止被随机 key 撑爆内存 */
  maxKeys?: number;
  /** 注入时钟，便于单测 */
  now?: () => number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: LimiterOptions) {
    this.limit = Math.max(1, Math.floor(options.limit));
    this.windowMs = Math.max(1, Math.floor(options.windowMs));
    this.maxKeys = options.maxKeys ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  /** 记一次访问；返回是否放行与建议的重试秒数 */
  take(key: string): LimitResult {
    const now = this.now();
    const from = now - this.windowMs;

    let bucket = this.hits.get(key);
    if (bucket) {
      /* 只有窗口内的记录有意义，先裁掉过期的 */
      while (bucket.length && bucket[0]! <= from) bucket.shift();
    } else {
      bucket = [];
      this.hits.set(key, bucket);
    }

    if (bucket.length >= this.limit) {
      const waitMs = bucket[0]! + this.windowMs - now;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)), remaining: 0 };
    }

    bucket.push(now);
    if (this.hits.size > this.maxKeys) this.shrink();
    return { ok: true, retryAfterSec: 0, remaining: this.limit - bucket.length };
  }

  /** 只读查询，不消费额度（用于测试与观测） */
  peek(key: string): number {
    const now = this.now();
    const from = now - this.windowMs;
    const bucket = this.hits.get(key) ?? [];
    return bucket.filter((t) => t > from).length;
  }

  /** 定期清扫：把整窗都过期的 key 删掉 */
  sweep(): void {
    const from = this.now() - this.windowMs;
    for (const [key, bucket] of this.hits) {
      const alive = bucket.filter((t) => t > from);
      if (alive.length) this.hits.set(key, alive);
      else this.hits.delete(key);
    }
  }

  get size(): number {
    return this.hits.size;
  }

  private shrink(): void {
    /* Map 保持插入顺序：删掉最早的一半 key，比全清更平滑 */
    const drop = Math.ceil(this.hits.size / 2);
    let i = 0;
    for (const key of this.hits.keys()) {
      if (i++ >= drop) break;
      this.hits.delete(key);
    }
  }
}

/** 取请求来源：登录用户按账号，匿名按 IP（IPv6 取到 /64 前缀，避免单机轮换地址绕过） */
export function actorKey(ownerId: string | null, ip: string | undefined): string {
  if (ownerId) return `u:${ownerId}`;
  const raw = (ip ?? '').replace(/^::ffff:/, '');
  if (!raw) return 'ip:unknown';
  if (raw.includes(':')) return `ip6:${raw.split(':').slice(0, 4).join(':')}`;
  return `ip:${raw}`;
}

/** 从 x-forwarded-for / x-real-ip / socket 里取客户端 IP（反向代理后只有前两个有意义） */
export function clientIp(headers: Record<string, string | string[] | undefined>): string {
  const pick = (value: string | string[] | undefined): string =>
    (Array.isArray(value) ? value[0] : value ?? '').split(',')[0]!.trim();
  const forwarded = pick(headers['x-forwarded-for']);
  if (forwarded) return forwarded;
  const real = pick(headers['x-real-ip']);
  if (real) return real;
  return '';
}
