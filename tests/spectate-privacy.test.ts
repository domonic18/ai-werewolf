import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine.js';
import { createMockLLM } from './helpers/mock-llm.js';

/**
 * 观战的信息边界。
 *
 * 曾经这里全量下发身份：玩家在局内点「观战」、把链接粘到另一个窗口，
 * 就能边看谁是狼边做决定。现在规则是「观战只能看到**已经公开**的信息」——
 * 判据就是引擎的 revealRole（放逐翻牌 / 白痴亮牌 / 长老受罚 / 结算）。
 */

/** 只发牌、不跑对局：观战的隐私断言都需要「进行中」这个状态 */
function newEngine(): GameEngine {
  const engine = new GameEngine({
    playerName: '观战者',
    llm: createMockLLM(),
    pace: 0,
    emit: () => {},
  });
  engine.setup();
  return engine;
}

describe('观战投影：身份只在翻牌后公开', () => {
  it('对局刚开始时，所有存活玩家的身份与阵营都是空的', () => {
    const engine = newEngine();
    const snap = engine.spectateSnapshot();
    expect(snap.players.length).toBe(6);
    expect(snap.players.every((s) => s.role === null && s.camp === null)).toBe(true);
  });

  it('被放逐翻牌的人，身份立刻对观战可见', () => {
    const engine = newEngine();
    const target = engine.players.find((p) => !p.isHuman);
    expect(target).toBeTruthy();
    /* 模拟放逐翻牌：引擎在出局 / 白痴亮牌时会置 revealRole */
    target!.revealRole = true;
    target!.alive = false;

    const snap = engine.spectateSnapshot();
    const seat = snap.players.find((s) => s.id === target!.id);
    expect(seat?.role).toBe(target!.role);
    expect(seat?.camp).toBeTruthy();
    /* 其余人仍然未知 */
    expect(snap.players.filter((s) => s.role !== null)).toHaveLength(1);
  });

  it('复盘时间轴在对局进行中不下发', () => {
    const engine = newEngine();
    /* 造一条夜间记录：真实运行时由 night() 写入 */
    engine.timeline.push({
      round: 1,
      wolfTarget: { playerId: 1, name: 'x' },
      saved: true,
      poisonTarget: null,
      deaths: [],
      exiled: null,
      tie: false,
      guardTarget: null,
      guarded: false,
      pierced: false,
      hunterShot: null,
    });
    expect(engine.spectateSnapshot().timeline).toEqual([]);
  });

  it('结算后全量公开：身份 + 时间轴都给', () => {
    const engine = newEngine();
    engine.winner = 'good';
    engine.phase = 'over';

    const snap = engine.spectateSnapshot();
    expect(snap.players.every((s) => s.role !== null && s.camp !== null)).toBe(true);
    expect(snap.timeline.length).toBe(engine.timeline.length);
  });

  it('中止的对局也全量公开（没有“继续玩”的动机了）', () => {
    const engine = newEngine();
    engine.aborted = { reason: '测试中止' };
    expect(engine.spectateSnapshot().players.every((s) => s.role !== null)).toBe(true);
  });

  it('阵营存活统计仍然给：那是公开信息（配置与存活数谁都能数）', () => {
    const engine = newEngine();
    const snap = engine.spectateSnapshot();
    expect(snap.factions.wolf.total + snap.factions.good.total).toBe(6);
    expect(snap.factions.good.alive + snap.factions.wolf.alive).toBe(6);
  });
});
