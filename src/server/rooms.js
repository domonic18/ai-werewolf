/**
 * 房间管理：对局生命周期、事件缓存与轮询游标。
 * 单进程内存态（sites 沙箱约束），足够支撑参赛规模。
 */
const { GameEngine } = require('../game/engine');

const MAX_ROOMS = 20;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2h 后可清理

class Room {
  constructor(engine) {
    this.engine = engine;
    this.createdAt = Date.now();
  }
  get expired() {
    return this.engine.phase === 'over' && Date.now() - this.createdAt > ROOM_TTL_MS;
  }
}

class RoomManager {
  constructor({ llm, matchStore }) {
    this.llm = llm;
    this.matchStore = matchStore;
    this.rooms = new Map();
  }

  /** 开新局：返回 { room, engine } */
  create(playerName) {
    this._gc();
    const engine = new GameEngine({
      playerName,
      llm: this.llm,
      emit: () => {} /* 事件已缓存在 engine.events，轮询拉取 */
    });
    const room = new Room(engine);
    this.rooms.set(engine.id, room);
    return room;
  }

  get(id) {
    return this.rooms.get(id) || null;
  }

  /** 对局结束落库（fire-and-forget） */
  async archive(engine) {
    if (!this.matchStore) return;
    try {
      const res = await this.matchStore.save(engine.archive());
      engine.pushEvent('archived', { ok: res.ok, id: res.id || null, error: res.error || null });
    } catch (e) {
      engine.pushEvent('archived', { ok: false, error: e.message });
    }
  }

  _gc() {
    for (const [id, room] of this.rooms) {
      if (room.expired || this.rooms.size > MAX_ROOMS) this.rooms.delete(id);
    }
  }
}

module.exports = { RoomManager, Room };
