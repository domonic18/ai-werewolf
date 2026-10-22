/**
 * 房间管理：对局生命周期、事件缓存与轮询游标。
 * 单进程内存态（sites 沙箱约束），足够支撑参赛规模。
 */
import crypto from 'node:crypto';
import { GameEngine } from '../game/engine.js';
import type { RoleKey } from '../shared/types.js';
import type { LLMClient } from '../ai/types.js';
import type { MatchStore } from '../cloud/match-store.js';

const MAX_ROOMS = 20;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 已结束的对局：2h 后清理（留时间给结算页读事件）
const SPECTATOR_TTL_MS = 30 * 1000; // 观战心跳超时
/**
 * 进行中的对局如果 30 分钟没有任何玩家动作，视为弃局。
 * 没有这条，「开一局然后关页面」会永久占用 20 个房间名额之一，累计 20 次开局接口就再也开不出来。
 */
const IDLE_TTL_MS = 30 * 60 * 1000;

export class Room {
  readonly engine: GameEngine;
  readonly createdAt: number;
  /** 玩家最后一次真实活动（拉快照 / 拉事件 / 提交动作）；弃局判定用它，不用创建时间 */
  lastActiveAt: number;
  /** 弃局判定阈值（可注入，测试里调小） */
  readonly idleTtlMs: number;
  /** 玩家凭证：只有持有者才能推进这一局（观战者不需要） */
  readonly playerToken: string;
  /** 开局者账号 id；匿名局为 null（登录是可选项，见 002 spec Q8） */
  readonly ownerId: string | null;
  /** 观战心跳：clientId → 最后活跃时间。服务端统计，不信任客户端计数。 */
  private readonly spectators = new Map<string, number>();

  constructor(engine: GameEngine, playerToken?: string, ownerId: string | null = null, idleTtlMs = IDLE_TTL_MS) {
    this.engine = engine;
    this.createdAt = Date.now();
    this.lastActiveAt = this.createdAt;
    this.idleTtlMs = idleTtlMs;
    this.playerToken = playerToken ?? crypto.randomBytes(16).toString('hex');
    this.ownerId = ownerId;
  }

  /** 玩家还在看这一局（任何私有接口的调用都算） */
  touch(): void {
    this.lastActiveAt = Date.now();
  }

  /** 已结束 → 按创建时间过期；仍在进行但长时间无人操作 → 按静默时间过期 */
  get expired(): boolean {
    const now = Date.now();
    const finished = this.engine.phase === 'over' || Boolean(this.engine.aborted) || Boolean(this.engine.winner);
    if (finished) return now - this.createdAt > ROOM_TTL_MS;
    return now - this.lastActiveAt > this.idleTtlMs;
  }

  /** 是否「挂起」：进行中但已经超过静默阈值（仍可用于恢复，只是不再出现在大厅） */
  get stale(): boolean {
    const finished = this.engine.phase === 'over' || Boolean(this.engine.aborted) || Boolean(this.engine.winner);
    return !finished && Date.now() - this.lastActiveAt > this.idleTtlMs;
  }

  /** 观战者心跳（每次拉取观战事件时调用） */
  touchSpectator(clientId: string): void {
    if (!clientId) return;
    this.spectators.set(clientId, Date.now());
  }

  /** 30 秒无心跳的观战者视为离开 */
  pruneSpectators(ttlMs = SPECTATOR_TTL_MS): void {
    const now = Date.now();
    for (const [clientId, lastSeenAt] of this.spectators) {
      if (now - lastSeenAt > ttlMs) this.spectators.delete(clientId);
    }
  }

  get spectatorCount(): number {
    this.pruneSpectators();
    return this.spectators.size;
  }
}

export interface RoomManagerDeps {
  llm: LLMClient;
  matchStore?: MatchStore;
  /** 演出节奏系数（生产用默认 1；测试可压缩等待） */
  pace?: number;
  /** 同时进行的对局上限（测试可调小） */
  maxRooms?: number;
  /** 进行中但无人操作的回收阈值（测试可调小） */
  idleTtlMs?: number;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly idleTtlMs: number;
  private readonly llm: LLMClient;
  private readonly matchStore?: MatchStore;
  private readonly pace: number;
  private readonly maxRooms: number;

  constructor({ llm, matchStore, pace = 1, maxRooms = MAX_ROOMS, idleTtlMs = IDLE_TTL_MS }: RoomManagerDeps) {
    this.llm = llm;
    this.matchStore = matchStore;
    this.pace = pace;
    this.maxRooms = maxRooms;
    this.idleTtlMs = idleTtlMs;
  }

  /**
   * 开新局：返回 room（引擎由调用方 `run()` 启动）。
   * 房间满时返回 null —— 只清理已结束且超时的房间，绝不为了腾位置踢掉进行中的对局。
   */
  create(playerName: string, deck?: RoleKey[], ownerId: string | null = null): Room | null {
    this.sweep();
    if (this.rooms.size >= this.maxRooms) return null;

    const engine = new GameEngine({
      playerName,
      deck,
      llm: this.llm,
      pace: this.pace,
      /* 事件已缓存在 engine.events，客户端轮询拉取，这里不额外广播 */
      emit: () => {},
    });
    const room = new Room(engine, undefined, ownerId, this.idleTtlMs);
    this.rooms.set(engine.id, room);
    return room;
  }

  get(id: string): Room | null {
    return this.rooms.get(id) ?? null;
  }

  /** 对局结束落库（fire-and-forget，不阻塞对局）。ownerId 决定这局战绩归谁。 */
  async archive(engine: GameEngine, ownerId: string | null = null): Promise<void> {
    if (!this.matchStore) return;
    try {
      const result = await this.matchStore.save(engine.archive(), ownerId);
      engine.pushEvent('archived', { ok: result.ok, id: result.id ?? null, error: result.error ?? null });
    } catch (e) {
      engine.pushEvent('archived', { ok: false, error: (e as Error).message });
    }
  }

  /**
   * 回收房间：
   * - 已结束且超过 2h → 删（结算页早就读完了）
   * - 进行中但静默超过 idleTtl → 停掉引擎再删（不停会让 AI 继续空转、继续消耗模型额度）
   * 注意：只回收「无人」的房间，绝不为了腾位置踢掉正在操作的对局。
   */
  sweep(): number {
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (!room.expired) continue;
      const finished = room.engine.phase === 'over' || Boolean(room.engine.aborted);
      if (!finished) room.engine.stop();
      this.rooms.delete(id);
      removed++;
    }
    return removed;
  }

  /** 大厅只展示「还在有人玩」的对局，挂起的不占位 */
  liveRooms(): Map<string, Room> {
    const live = new Map<string, Room>();
    for (const [id, room] of this.rooms) {
      if (room.stale) continue;
      live.set(id, room);
    }
    return live;
  }
}
