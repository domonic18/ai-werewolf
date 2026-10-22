/**
 * 房间管理：对局生命周期、事件缓存与轮询游标。
 * 单进程内存态（sites 沙箱约束），足够支撑参赛规模。
 */
import crypto from 'node:crypto';
import { GameEngine } from '../game/engine.js';
import type { LLMClient } from '../ai/types.js';
import type { MatchStore } from '../cloud/match-store.js';

const MAX_ROOMS = 20;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2h 后可清理
const SPECTATOR_TTL_MS = 30 * 1000; // 观战心跳超时

export class Room {
  readonly engine: GameEngine;
  readonly createdAt: number;
  /** 玩家凭证：只有持有者才能推进这一局（观战者不需要） */
  readonly playerToken: string;
  /** 观战心跳：clientId → 最后活跃时间。服务端统计，不信任客户端计数。 */
  private readonly spectators = new Map<string, number>();

  constructor(engine: GameEngine, playerToken?: string) {
    this.engine = engine;
    this.createdAt = Date.now();
    this.playerToken = playerToken ?? crypto.randomBytes(16).toString('hex');
  }

  get expired(): boolean {
    return this.engine.phase === 'over' && Date.now() - this.createdAt > ROOM_TTL_MS;
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
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly llm: LLMClient;
  private readonly matchStore?: MatchStore;
  private readonly pace: number;
  private readonly maxRooms: number;

  constructor({ llm, matchStore, pace = 1, maxRooms = MAX_ROOMS }: RoomManagerDeps) {
    this.llm = llm;
    this.matchStore = matchStore;
    this.pace = pace;
    this.maxRooms = maxRooms;
  }

  /**
   * 开新局：返回 room（引擎由调用方 `run()` 启动）。
   * 房间满时返回 null —— 只清理已结束且超时的房间，绝不为了腾位置踢掉进行中的对局。
   */
  create(playerName: string): Room | null {
    this.prune();
    if (this.rooms.size >= this.maxRooms) return null;

    const engine = new GameEngine({
      playerName,
      llm: this.llm,
      pace: this.pace,
      /* 事件已缓存在 engine.events，客户端轮询拉取，这里不额外广播 */
      emit: () => {},
    });
    const room = new Room(engine);
    this.rooms.set(engine.id, room);
    return room;
  }

  get(id: string): Room | null {
    return this.rooms.get(id) ?? null;
  }

  /** 对局结束落库（fire-and-forget，不阻塞对局） */
  async archive(engine: GameEngine): Promise<void> {
    if (!this.matchStore) return;
    try {
      const result = await this.matchStore.save(engine.archive());
      engine.pushEvent('archived', { ok: result.ok, id: result.id ?? null, error: result.error ?? null });
    } catch (e) {
      engine.pushEvent('archived', { ok: false, error: (e as Error).message });
    }
  }

  /** 只清理「已结束且超过 TTL」的房间；进行中的对局一律保留 */
  private prune(): void {
    for (const [id, room] of this.rooms) {
      if (room.expired) this.rooms.delete(id);
    }
  }
}
