import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, listRooms, parseLobbyQuery, phaseLabel, toEntry } from '../src/server/lobby.js';
import type { LobbyRoomLike } from '../src/server/lobby.js';
import type { LobbyGame, Phase } from '../src/shared/types.js';

interface FakeRoomOptions {
  id: string;
  host?: string;
  round?: number;
  phase?: Phase;
  alive?: number;
  total?: number;
  spectators?: number;
  createdAt?: number;
  hasHuman?: boolean;
  aborted?: boolean;
}

function fakeRoom(options: FakeRoomOptions): LobbyRoomLike {
  const total = options.total ?? 6;
  const alive = options.alive ?? total;
  return {
    createdAt: options.createdAt ?? 1_700_000_000_000,
    spectatorCount: options.spectators ?? 0,
    engine: {
      id: options.id,
      playerName: options.host ?? '房主',
      round: options.round ?? 1,
      phase: options.phase ?? 'day',
      aborted: options.aborted ? { reason: 'boom' } : null,
      players: Array.from({ length: total }, (_, i) => ({ isHuman: i === 0 ? (options.hasHuman ?? true) : false })),
      alivePlayers: () => new Array(alive).fill(null),
    },
  };
}

function asEntries(rooms: LobbyRoomLike[]): [string, LobbyRoomLike][] {
  return rooms.map((room) => [room.engine.id, room]);
}

describe('phaseLabel', () => {
  it('按阶段给出可读标签', () => {
    expect(phaseLabel('night', 2)).toBe('第 2 夜');
    expect(phaseLabel('day', 3)).toBe('第 3 天');
    expect(phaseLabel('vote', 3)).toBe('第 3 天 · 投票');
  });

  it('round=0 未开局显示准备中，而不是「第 0 夜」', () => {
    expect(phaseLabel('night', 0)).toBe('准备中');
    expect(phaseLabel('day', 0)).toBe('准备中');
    expect(phaseLabel('over', 0)).toBe('已结束');
  });
});

describe('toEntry', () => {
  it('生成大厅条目并带上观战人数与决赛圈标记', () => {
    const entry = toEntry(fakeRoom({ id: 'g1', spectators: 7, alive: 3, round: 2, phase: 'vote' }));
    expect(entry).not.toBeNull();
    expect(entry?.spectators).toBe(7);
    expect(entry?.isFinal).toBe(true);
    expect(entry?.phaseLabel).toBe('第 2 天 · 投票');
    expect(entry?.hasHuman).toBe(true);
    expect(entry?.spectatable).toBe(true);
  });

  it('已结束 / 已中止的对局不对外展示', () => {
    expect(toEntry(fakeRoom({ id: 'g2', phase: 'over' }))).toBeNull();
    expect(toEntry(fakeRoom({ id: 'g3', aborted: true }))).toBeNull();
  });
});

describe('parseLobbyQuery', () => {
  it('非法参数回落到默认值', () => {
    expect(parseLobbyQuery({})).toEqual({ filter: 'all', sort: 'spectators', limit: 10, after: null, mine: null });
    expect(parseLobbyQuery({ filter: 'nope', sort: 'nope', limit: '-3' })).toMatchObject({
      filter: 'all',
      sort: 'spectators',
      limit: 10,
    });
  });

  it('limit 上限 50，支持字符串数组取值', () => {
    expect(parseLobbyQuery({ limit: '999' }).limit).toBe(50);
    expect(parseLobbyQuery({ filter: ['human', 'final'] }).filter).toBe('human');
  });
});

describe('listRooms', () => {
  const many = (count: number): LobbyRoomLike[] =>
    Array.from({ length: count }, (_, i) =>
      fakeRoom({
        id: `g${String(i).padStart(3, '0')}`,
        spectators: count - i,
        createdAt: 1_700_000_000_000 + i,
        phase: i % 2 === 0 ? 'day' : 'night',
        alive: i < 3 ? 3 : 6,
      }),
    );

  it('默认按观战人数降序', () => {
    const page = listRooms(asEntries(many(5)), parseLobbyQuery({}));
    expect(page.games.map((g) => g.spectators)).toEqual([5, 4, 3, 2, 1]);
    expect(page.total).toBe(5);
  });

  it('按开局时间排序', () => {
    const page = listRooms(asEntries(many(3)), parseLobbyQuery({ sort: 'created' }));
    expect(page.games.map((g) => g.gameId)).toEqual(['g002', 'g001', 'g000']);
  });

  it('支持决赛圈与真人局筛选', () => {
    const rooms = asEntries([
      fakeRoom({ id: 'a', alive: 2, hasHuman: true }),
      fakeRoom({ id: 'b', alive: 5, hasHuman: true }),
      fakeRoom({ id: 'c', alive: 6, hasHuman: false }),
    ]);
    expect(listRooms(rooms, parseLobbyQuery({ filter: 'final' })).games.map((g) => g.gameId)).toEqual(['a']);
    expect(listRooms(rooms, parseLobbyQuery({ filter: 'human' })).games.map((g) => g.gameId)).toEqual(['a', 'b']);
  });

  it('30 局游标翻页：不重不漏，最后一页 nextCursor 为 null', () => {
    const rooms = asEntries(many(30));
    const seen: string[] = [];
    let after: string | null = null;
    let guard = 0;

    do {
      const page = listRooms(rooms, parseLobbyQuery({ limit: '10', ...(after ? { after } : {}) }));
      seen.push(...page.games.map((g) => g.gameId));
      after = page.nextCursor;
      guard += 1;
      expect(guard).toBeLessThanOrEqual(5);
    } while (after);

    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });

  it('空房间返回空列表而不是报错', () => {
    const page = listRooms([], parseLobbyQuery({}));
    expect(page.games).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(0);
  });
});

describe('游标编解码', () => {
  const entry: LobbyGame = {
    gameId: 'g-abc',
    host: '你',
    round: 2,
    phase: 'day',
    phaseLabel: '第 2 天',
    players: 6,
    maxPlayers: 6,
    alive: 5,
    spectators: 9,
    hasHuman: true,
    isFinal: false,
    spectatable: true,
    startedAt: 1_700_000_000_123,
  };

  it('可往返', () => {
    expect(decodeCursor(encodeCursor(entry, 'spectators'))).toEqual({ s: 9, id: 'g-abc' });
    expect(decodeCursor(encodeCursor(entry, 'created'))).toEqual({ s: 1_700_000_000_123, id: 'g-abc' });
  });

  it('非法游标返回 null，不抛错', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from('{"s":"x"}').toString('base64url'))).toBeNull();
  });
});

describe('规模与性能', () => {
  it('100 局时 list() 的 P95 低于 50ms（纯函数层）', () => {
    const rooms = Array.from({ length: 100 }, (_, i) =>
      fakeRoom({
        id: `g-${String(i).padStart(3, '0')}`,
        host: `房主${i}`,
        round: 1 + (i % 5),
        alive: 1 + (i % 6),
        spectators: i % 7,
        createdAt: 1_700_000_000_000 + i * 1000,
      }),
    );
    const query = parseLobbyQuery({ limit: '10' });

    /* 预热一次，避免把 JIT 编译算进来 */
    listRooms(asEntries(rooms), query);

    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const startedAt = performance.now();
      const page = listRooms(asEntries(rooms), query);
      samples.push(performance.now() - startedAt);
      expect(page.games).toHaveLength(10);
      expect(page.total).toBe(100);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples.at(-1) ?? 0;
    expect(p95).toBeLessThan(50);
  });

  it('游标翻完 100 局不重不漏', () => {
    const rooms = Array.from({ length: 100 }, (_, i) =>
      fakeRoom({ id: `g-${String(i).padStart(3, '0')}`, spectators: i % 5, createdAt: 1_700_000_000_000 + i }),
    );

    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 30; guard++) {
      const page = listRooms(asEntries(rooms), parseLobbyQuery({ limit: '10', ...(after ? { after } : {}) }));
      seen.push(...page.games.map((g) => g.gameId));
      after = page.nextCursor;
      if (!after) break;
    }

    expect(seen).toHaveLength(100);
    expect(new Set(seen).size).toBe(100);
  });
});

describe('我的对局（filter=mine）', () => {
  const rooms = [
    fakeRoom({ id: 'g-mine', host: '我', spectators: 1 }),
    fakeRoom({ id: 'g-other', host: '别人', spectators: 9 }),
  ];

  it('只返回本地存档的那一局', () => {
    const page = listRooms(asEntries(rooms), parseLobbyQuery({ filter: 'mine', mine: 'g-mine' }));
    expect(page.games.map((g) => g.gameId)).toEqual(['g-mine']);
    expect(page.total).toBe(1);
  });

  it('带 filter=mine 但没带对局 id 时返回空，而不是退化成全部', () => {
    const page = listRooms(asEntries(rooms), parseLobbyQuery({ filter: 'mine' }));
    expect(page.games).toHaveLength(0);
    expect(page.total).toBe(0);
  });

  it('对局已结束/被清理时返回空', () => {
    const page = listRooms(asEntries(rooms), parseLobbyQuery({ filter: 'mine', mine: 'g-gone' }));
    expect(page.games).toHaveLength(0);
  });
});
