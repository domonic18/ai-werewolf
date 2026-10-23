/**
 * 云数据库封装：账号资料与邀请关系（PostgREST 风格，与 match-store 同构）。
 *
 * 表结构（2026-10-23 建）：
 *   ww_profiles (user_id PK, nickname, avatar_url, invite_code UNIQUE, hide_stats, created_at)
 *   ww_invites  (invitee_id PK, inviter_id, created_at)
 *
 * 为什么 invitee_id 是主键：一个账号只归属**第一个**邀请他的人（PRD 8.6 决策 2）。
 * 主键约束让「只记第一条」由数据库保证，不依赖应用层的先查后写（并发下会漏）。
 *
 * 写入方只有服务端，走的是 publishable key（anon 角色）。RLS 策略因此是
 * 「读全开、写入只做形状校验」——与既有的 ww_matches 同一套取舍，见 SECURITY.md。
 */
import { randomInt } from 'node:crypto';
import type { WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk';
import { isWolfLabel } from './match-store.js';

const PROFILES = 'ww_profiles';
const INVITES = 'ww_invites';
/** 好友列表上限（PRD 8.7）：按最近活跃排序取前 N，避免一次拉几百人 */
const FRIEND_LIMIT = 20;
/** 多久没来算「很久没来」：保留但排最后，不静默删除（PRD 8.6 决策 9） */
const STALE_DAYS = 180;

interface QueryResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  insert(row: Record<string, unknown>): QueryBuilder;
  select(columns?: string): QueryBuilder;
  update(patch: Record<string, unknown>): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  in(column: string, values: string[]): QueryBuilder;
  order(column: string, options: { ascending: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
}

interface DatabaseClient {
  from(table: string): QueryBuilder;
}

type CloudSource = WorkBuddyCloudClient | null | (() => WorkBuddyCloudClient | null);

/* ---------- 邀请码 ---------- */

/** 去掉 I / O：手抄、念给对方时最容易看错的两个字母 */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** 数字从 2 起：0/1 与 O/I 同样易混 */
const TAIL = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * 邀请码：4 字母 + 3 位（数字或字母），形如 `YEKE-7F2`（PRD Q8）。
 * 32^4 × 34^3 ≈ 5.6e9 组合，撞码概率可以忽略；真撞了由 UNIQUE 约束兜底重试。
 */
export function makeInviteCode(rand: (max: number) => number = (max) => randomInt(max)): string {
  const head = Array.from({ length: 4 }, () => LETTERS[rand(LETTERS.length)]).join('');
  const tail = Array.from({ length: 3 }, () => TAIL[rand(TAIL.length)]).join('');
  return `${head}-${tail}`;
}

/**
 * 把用户输入/链接里带的东西整理成标准邀请码。
 * 宽容一点：大小写、空格、少了连字符都认，但形状不对就返回空串（不猜）。
 */
export function normalizeInviteCode(raw: string | null | undefined): string {
  if (!raw) return '';
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{4}[0-9A-Z]{3}$/.test(cleaned)) return '';
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
}

/* ---------- 类型 ---------- */

export interface ProfileRow {
  user_id: string;
  nickname: string | null;
  avatar_url: string | null;
  invite_code: string;
  hide_stats: boolean;
}

export interface FriendSummary {
  name: string;
  games: number;
  wins: number;
  /** 最近一局时间（ISO）；从没打过为 null */
  lastPlayedAt: string | null;
  /** 对方关了战绩公开：只显示「在玩」 */
  hidden: boolean;
  /** 超过 180 天没活跃 */
  stale: boolean;
}

export type BindStatus = 'bound' | 'exists' | 'self' | 'bad-code' | 'unavailable';

export interface BindResult {
  status: BindStatus;
  /** 邀请人昵称，用于「已记录，来自 XX」的提示 */
  inviterName?: string;
}

export interface InviterPreview {
  code: string;
  name: string;
  games: number;
  wins: number;
}

export interface SocialStoreOptions {
  /** 测试/预发默认只读：不往生产库里写邀请关系（与战绩表同一开关） */
  readOnly?: boolean;
}

export class SocialStore {
  private readonly source: () => WorkBuddyCloudClient | null;
  private readonly readOnly: boolean;

  constructor(cloud: CloudSource, options: SocialStoreOptions = {}) {
    this.source = typeof cloud === 'function' ? cloud : () => cloud;
    this.readOnly = options.readOnly ?? false;
  }

  private get db(): DatabaseClient | null {
    const client = this.source();
    return client ? (client.database as unknown as DatabaseClient) : null;
  }

  /** 云库不可用时给前端一个明确的降级信号，而不是假装成功 */
  get available(): boolean {
    return this.db !== null;
  }

  async findByUserId(userId: string): Promise<ProfileRow | null> {
    const db = this.db;
    if (!db) return null;
    const { data, error } = await db.from(PROFILES).select('*').eq('user_id', userId).limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    return asProfile(data[0]);
  }

  async findByCode(code: string): Promise<ProfileRow | null> {
    const normalized = normalizeInviteCode(code);
    if (!normalized) return null;
    const db = this.db;
    if (!db) return null;
    const { data, error } = await db.from(PROFILES).select('*').eq('invite_code', normalized).limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    return asProfile(data[0]);
  }

  /**
   * 取（或创建）本人资料。邀请码一个账号一个、稳定不变。
   * 并发下两个请求同时创建时，靠 user_id 主键让其中一个失败，随后重新读一次即可。
   */
  async ensureProfile(userId: string, nickname?: string | null): Promise<ProfileRow | null> {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;

    const db = this.db;
    if (!db) return null;
    if (this.readOnly) return null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = makeInviteCode();
      const { error } = await db.from(PROFILES).insert({
        user_id: userId,
        nickname: nickname ?? null,
        invite_code: code,
      });
      if (!error) {
        return { user_id: userId, nickname: nickname ?? null, avatar_url: null, invite_code: code, hide_stats: false };
      }
      /* 23505：要么这个账号已有资料（并发），要么码撞了。前者直接返回，后者重试 */
      const again = await this.findByUserId(userId);
      if (again) return again;
    }
    return null;
  }

  /** 改昵称 / 公开开关。只允许改这两项，邀请码一旦发出就不再变 */
  async updateProfile(
    userId: string,
    patch: { nickname?: string | null; hideStats?: boolean },
  ): Promise<ProfileRow | null> {
    if (this.readOnly) return null;
    const db = this.db;
    if (!db) return null;

    const row: Record<string, unknown> = {};
    if (patch.nickname !== undefined) row.nickname = patch.nickname;
    if (patch.hideStats !== undefined) row.hide_stats = patch.hideStats;
    if (!Object.keys(row).length) return this.findByUserId(userId);

    const { error } = await db.from(PROFILES).update(row).eq('user_id', userId);
    if (error) return null;
    return this.findByUserId(userId);
  }

  /** 建立邀请关系：一个账号只认第一个邀请人 */
  async bind(inviterCode: string, inviteeId: string): Promise<BindResult> {
    if (this.readOnly) return { status: 'unavailable' };
    const inviter = await this.findByCode(inviterCode);
    if (!inviter) return { status: 'bad-code' };
    if (inviter.user_id === inviteeId) return { status: 'self' };

    const db = this.db;
    if (!db) return { status: 'unavailable' };

    const { error } = await db.from(INVITES).insert({ invitee_id: inviteeId, inviter_id: inviter.user_id });
    if (!error) return { status: 'bound', inviterName: inviter.nickname ?? '一位玩家' };

    /* 23505 = 我已经被谁邀请过了：幂等返回，不报错 */
    const mine = await this.inviterOf(inviteeId);
    if (mine) {
      const profile = await this.findByUserId(mine);
      return { status: 'exists', inviterName: profile?.nickname ?? '一位玩家' };
    }
    return { status: 'unavailable' };
  }

  async inviterOf(inviteeId: string): Promise<string | null> {
    const db = this.db;
    if (!db) return null;
    const { data, error } = await db.from(INVITES).select('inviter_id').eq('invitee_id', inviteeId).limit(1);
    if (error || !Array.isArray(data) || !data.length) return null;
    const row = data[0] as { inviter_id?: string };
    return row.inviter_id ?? null;
  }

  /**
   * 我邀请来的朋友（聚合口径，不含任何单局明细）。
   *
   * 口径：只统计他们**自己坐庄打完**的局（`owner_id` = 他们），胜负按各自那一局的身份判。
   * 关闭公开的人只留「在玩」，胜负一律不返回 —— 这是承诺，不能靠前端遮。
   */
  async listFriends(inviterId: string): Promise<FriendSummary[]> {
    const db = this.db;
    if (!db) return [];

    const { data, error } = await db
      .from(INVITES)
      .select('invitee_id,created_at')
      .eq('inviter_id', inviterId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data) || !data.length) return [];

    const invites = data as { invitee_id?: string; created_at?: string }[];
    const ids = invites.map((row) => row.invitee_id).filter((id): id is string => Boolean(id));
    if (!ids.length) return [];

    const [profiles, matches] = await Promise.all([
      db.from(PROFILES).select('user_id,nickname,hide_stats').in('user_id', ids).limit(FRIEND_LIMIT * 4),
      db
        .from('ww_matches')
        .select('owner_id,player_name,result,player_role,created_at')
        .in('owner_id', ids)
        .order('created_at', { ascending: false })
        .limit(800),
    ]);

    const profileById = new Map<string, { nickname: string | null; hide: boolean }>();
    if (Array.isArray(profiles.data)) {
      for (const raw of profiles.data as Record<string, unknown>[]) {
        const id = String(raw.user_id ?? '');
        if (!id) continue;
        profileById.set(id, { nickname: (raw.nickname as string | null) ?? null, hide: raw.hide_stats === true });
      }
    }

    const agg = new Map<string, { games: number; wins: number; last: string | null; lastName: string | null }>();
    if (Array.isArray(matches.data)) {
      for (const raw of matches.data as Record<string, unknown>[]) {
        const id = String(raw.owner_id ?? '');
        if (!id) continue;
        const at = String(raw.created_at ?? '');
        const entry = agg.get(id) ?? { games: 0, wins: 0, last: null, lastName: null };
        /* 同一批数据按时间倒序，第一次见到的就是最近一局 */
        if (!entry.last) {
          entry.last = at || null;
          entry.lastName = (raw.player_name as string | null) ?? null;
        }
        const result = String(raw.result ?? '');
        if (result === 'good' || result === 'wolf') {
          entry.games += 1;
          const won = isWolfLabel(raw.player_role as string) ? result === 'wolf' : result === 'good';
          if (won) entry.wins += 1;
        }
        agg.set(id, entry);
      }
    }

    const now = Date.now();
    const list: FriendSummary[] = ids.map((id) => {
      const stat = agg.get(id);
      const profile = profileById.get(id);
      const lastPlayedAt = stat?.last ?? null;
      const stale = lastPlayedAt ? now - Date.parse(lastPlayedAt) > STALE_DAYS * 86_400_000 : false;
      const hidden = profile?.hide === true;
      return {
        name: profile?.nickname ?? stat?.lastName ?? '一位玩家',
        /* 关了公开就**不把数字发出去**：前端遮一层不算数，抓包一样能看见 */
        games: hidden ? 0 : (stat?.games ?? 0),
        wins: hidden ? 0 : (stat?.wins ?? 0),
        lastPlayedAt,
        hidden,
        stale,
      };
    });

    /* 排序：活跃的在前（按最近一局时间倒序）；很久没来的沉底（PRD 8.6 决策 9） */
    list.sort((a, b) => {
      if (a.stale !== b.stale) return a.stale ? 1 : -1;
      const at = a.lastPlayedAt ? Date.parse(a.lastPlayedAt) : 0;
      const bt = b.lastPlayedAt ? Date.parse(b.lastPlayedAt) : 0;
      if (at !== bt) return bt - at;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });

    return list.slice(0, FRIEND_LIMIT);
  }

  /**
   * 邀请落地页用：凭邀请码看邀请人的昵称与战绩。
   * 只回聚合，不回账号 id，也不需要登录 —— 他正要把链接发出去。
   */
  async preview(inviterCode: string): Promise<InviterPreview | null> {
    const profile = await this.findByCode(inviterCode);
    if (!profile) return null;

    const db = this.db;
    if (!db) {
      return { code: profile.invite_code, name: profile.nickname ?? '一位玩家', games: 0, wins: 0 };
    }

    const { data, error } = await db
      .from('ww_matches')
      .select('result,player_role')
      .eq('owner_id', profile.user_id)
      .limit(500);

    let games = 0;
    let wins = 0;
    if (!error && Array.isArray(data)) {
      for (const raw of data as Record<string, unknown>[]) {
        const result = String(raw.result ?? '');
        if (result !== 'good' && result !== 'wolf') continue;
        games += 1;
        const won = isWolfLabel(raw.player_role as string) ? result === 'wolf' : result === 'good';
        if (won) wins += 1;
      }
    }

    return {
      code: profile.invite_code,
      name: profile.nickname ?? '一位玩家',
      games,
      wins,
    };
  }
}

function asProfile(raw: unknown): ProfileRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const userId = String(row.user_id ?? '');
  const code = String(row.invite_code ?? '');
  if (!userId || !code) return null;
  return {
    user_id: userId,
    nickname: (row.nickname as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    invite_code: code,
    hide_stats: row.hide_stats === true,
  };
}
