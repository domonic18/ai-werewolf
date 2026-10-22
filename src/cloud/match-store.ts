/**
 * 云数据库封装：战绩存取（PostgREST 风格，supabase 兼容）。
 * 表 ww_matches 由部署前 migrate 创建（见 README「云资源」）。
 *
 * 这里只依赖链式查询的最小接口，避免把 SDK 的泛型细节漏进业务层。
 */
import type { WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk';
import type { ArchiveRow } from '../game/engine.js';
import type { MatchRow } from '../shared/types.js';

const TABLE = 'ww_matches';

interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  insert(row: Record<string, unknown>): QueryBuilder;
  select(columns?: string): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  single(): Promise<QueryResult>;
}

interface DatabaseClient {
  from(table: string): QueryBuilder;
}

export interface SaveResult {
  ok: boolean;
  id?: string | null;
  error?: string;
}

export interface MatchStoreOptions {
  /** 测试环境默认只读：避免压测/联调数据写进生产战绩墙 */
  readOnly?: boolean;
}

export interface RecentResult {
  ok: boolean;
  rows: MatchRow[];
}

export interface MatchStats {
  total: number;
  good: number;
  wolf: number;
}

/** 云客户端可能是延迟就绪的（LLM 通道后台初始化），因此允许传 getter */
type CloudSource = WorkBuddyCloudClient | null | (() => WorkBuddyCloudClient | null);

export class MatchStore {
  private readonly source: () => WorkBuddyCloudClient | null;
  private readonly readOnly: boolean;

  constructor(cloud: CloudSource, options: MatchStoreOptions = {}) {
    this.source = typeof cloud === 'function' ? cloud : () => cloud;
    this.readOnly = options.readOnly ?? false;
  }

  private get db(): DatabaseClient | null {
    const client = this.source();
    return client ? (client.database as unknown as DatabaseClient) : null;
  }

  /** 写入一局战绩；`ownerId` 有值就记账号归属（匿名局写 null，战绩墙照常全量展示） */
  async save(row: ArchiveRow, ownerId: string | null = null): Promise<SaveResult> {
    if (this.readOnly) return { ok: false, error: 'staging_read_only' };
    if (!this.db) return { ok: false, error: 'cloud-not-initialized' };
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        player_name: row.playerName || '匿名玩家',
        player_role: row.playerRole || '',
        result: row.result || '',
        rounds: row.rounds || 0,
        survivors: row.survivors || 0,
        detail: row.detail ?? {},
        owner_id: ownerId,
      })
      .select('id')
      .single();

    if (error) return { ok: false, error: error.message ?? String(error) };
    const id = data && typeof data === 'object' ? (data as { id?: string }).id : undefined;
    return { ok: true, id: id ?? null };
  }

  /** 最近战绩；给 ownerId 时只看这个账号的 */
  async recent(limit = 8, ownerId?: string | null): Promise<RecentResult> {
    if (!this.db) return { ok: false, rows: [] };
    const base = this.db.from(TABLE).select('id,player_name,player_role,result,rounds,created_at');
    const scoped = ownerId ? base.eq('owner_id', ownerId) : base;
    const { data, error } = await scoped.order('created_at', { ascending: false }).limit(limit);

    if (error) return { ok: false, rows: [] };
    return { ok: true, rows: Array.isArray(data) ? (data as MatchRow[]) : [] };
  }

  /**
   * 个人累计战绩：本账号打了多少局、赢了多少。
   * 「赢」要按自己那一局的身份判：狼人阵赢 = 自己是狼；好人阵赢 = 自己不是狼。
   */
  async personalStats(ownerId: string): Promise<{ total: number; wins: number } | null> {
    if (!this.db) return null;
    const { data, error } = await this.db
      .from(TABLE)
      .select('result,player_role')
      .eq('owner_id', ownerId)
      .limit(500);
    if (error) return null;
    const rows = Array.isArray(data) ? (data as { result?: string; player_role?: string }[]) : [];
    const wins = rows.filter((row) => {
      const isWolf = row.player_role === 'wolf';
      return isWolf ? row.result === 'wolf' : row.result === 'good';
    }).length;
    return { total: rows.length, wins };
  }

  /** 胜率统计；给 ownerId 时只统计这个账号的 */
  async stats(ownerId?: string | null): Promise<MatchStats | null> {
    if (!this.db) return null;
    const base = this.db.from(TABLE).select('result');
    const scoped = ownerId ? base.eq('owner_id', ownerId) : base;
    const { data, error } = await scoped.limit(200);
    if (error) return null;

    const rows = Array.isArray(data) ? (data as { result?: string }[]) : [];
    return {
      total: rows.length,
      good: rows.filter((r) => r.result === 'good').length,
      wolf: rows.filter((r) => r.result === 'wolf').length,
    };
  }
}

export { TABLE as MATCH_TABLE };
