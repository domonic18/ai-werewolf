/**
 * 埋点（4 个事件，不引第三方）。
 *
 * 为什么自己存：分享与邀请的效果要能被回答（战绩卡有没有人发、邀请链接带来多少人），
 * 但不该为一个 4 事件的漏斗接第三方 SDK —— 那会把用户标识送到外部。
 *
 * 只记四个名字，别的一律拒：
 *   share_click    分享按钮被点
 *   landing        带 ?ref 打开首页
 *   login          登录成功（带 ref 时即「邀请转化」）
 *   invite_bound   邀请关系建立（服务端写入，最可信）
 *
 * 隐私：`actor` 存的是**加盐哈希后 8 字节**，不是账号 id。
 * 表对 anon 可读（服务端用 publishable key），因此绝不能存原始 id。
 */
import { createHash } from 'node:crypto';
import type { WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk';

const TABLE = 'ww_events';

export const TRACK_EVENTS = ['share_click', 'landing', 'login', 'invite_bound'] as const;
export type TrackEvent = (typeof TRACK_EVENTS)[number];

export function isTrackEvent(value: unknown): value is TrackEvent {
  return typeof value === 'string' && (TRACK_EVENTS as readonly string[]).includes(value);
}

interface QueryResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  insert(row: Record<string, unknown>): QueryBuilder;
  select(columns?: string): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
}

interface DatabaseClient {
  from(table: string): QueryBuilder;
}

type CloudSource = WorkBuddyCloudClient | null | (() => WorkBuddyCloudClient | null);

/** 盐值：只防「拿哈希反查 id」这一层，不当作密钥 */
const SALT = 'ww-events-v1';

/**
 * 把账号 id 变成不可逆的短标识。
 * 目的只是「同一人能去重」，不是识别——因此截断到 16 个十六进制字符。
 */
export function hashActor(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return createHash('sha256').update(`${SALT}:${userId}`).digest('hex').slice(0, 16);
}

export interface EventSummaryRow {
  name: string;
  count: number;
}

export class EventStore {
  private readonly source: () => WorkBuddyCloudClient | null;
  private readonly readOnly: boolean;

  constructor(cloud: CloudSource, options: { readOnly?: boolean } = {}) {
    this.source = typeof cloud === 'function' ? cloud : () => cloud;
    this.readOnly = options.readOnly ?? false;
  }

  private get db(): DatabaseClient | null {
    const client = this.source();
    return client ? (client.database as unknown as DatabaseClient) : null;
  }

  get available(): boolean {
    return this.db !== null;
  }

  /** 记一个事件。失败不抛：埋点永远不该影响玩家正在做的事 */
  async record(name: TrackEvent, meta: { ownerId?: string | null; ref?: string | null } = {}): Promise<void> {
    if (this.readOnly) return;
    const db = this.db;
    if (!db) return;
    try {
      await db.from(TABLE).insert({
        name,
        actor: hashActor(meta.ownerId),
        ref_code: meta.ref ? meta.ref.slice(0, 12) : null,
      });
    } catch {
      /* 埋点失败静默：它只是统计，不是业务 */
    }
  }

  /**
   * 近 N 天各事件计数（聚合，不含任何身份）。
   * PostgREST 这条链上没有 group by，所以取最近若干行在内存里数——
   * 单量级下完全够用，也不值得为它写 RPC。
   */
  async summary(days = 7): Promise<EventSummaryRow[]> {
    const db = this.db;
    if (!db) return [];
    const since = Date.now() - days * 86_400_000;
    const { data, error } = await db
      .from(TABLE)
      .select('name,created_at')
      .order('created_at', { ascending: false })
      .limit(5000);
    if (error || !Array.isArray(data)) return [];

    const counts = new Map<string, number>();
    for (const raw of data as Record<string, unknown>[]) {
      const at = Date.parse(String(raw.created_at ?? ''));
      if (!Number.isFinite(at) || at < since) continue;
      const name = String(raw.name ?? '');
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    /* 固定顺序输出，前端不用再排 */
    return TRACK_EVENTS.filter((name) => counts.has(name)).map((name) => ({
      name,
      count: counts.get(name) ?? 0,
    }));
  }
}
