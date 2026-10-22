/**
 * 房间管理：对局生命周期、事件缓存与轮询游标。
 * 单进程内存态（sites 沙箱约束），足够支撑参赛规模。
 */
import { GameEngine } from '../game/engine.js';
import type { LLMClient } from '../ai/types.js';
import type { MatchStore } from '../cloud/match-store.js';

const MAX_ROOMS = 20;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2h 后可清理

export class Room {
  readonly engine: GameEngine;
  readonly createdAt: number;

  constructor(engine: GameEngine) {
    this.engine = engine;
    this.createdAt = Date.now();
  }

  get expired(): boolean {
    return this.engine.phase === 'over' && Date.now() - this.createdAt > ROOM_TTL_MS;
  }
}

export interface RoomManagerDeps {
  llm: LLMClient;
  matchStore?: MatchStore;
  /** 演出节奏系数（生产用默认 1；测试可压缩等待） */
  pace?: number;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly llm: LLMClient;
  private readonly matchStore?: MatchStore;
  private readonly pace: number;

  constructor({ llm, matchStore, pace = 1 }: RoomManagerDeps) {
    this.llm = llm;
    this.matchStore = matchStore;
    this.pace = pace;
  }

  /** 开新局：返回 room（引擎由调用方 `run()` 启动） */
  create(playerName: string): Room {
    this.gc();
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

  private gc(): void {
    for (const [id, room] of this.rooms) {
      if (room.expired || this.rooms.size > MAX_ROOMS) this.rooms.delete(id);
    }
  }
}
