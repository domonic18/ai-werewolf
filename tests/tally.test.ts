import { describe, expect, it } from 'vitest';
import { deriveVoteTally, voteRows } from '../client/src/lib/tally';
import type { GameEvent } from '../src/shared/types';

/** 只构造票型推导关心的事件，其余字段用不到 */
const ev = {
  phase: (phase: string): GameEvent => ({ type: 'phase', payload: { phase, label: phase } }) as unknown as GameEvent,
  vote: (voter: number, target: number): GameEvent => ({ type: 'vote', payload: { voter, target } }) as unknown as GameEvent,
  result: (): GameEvent => ({ type: 'vote-result', payload: { tie: false } }) as unknown as GameEvent,
  other: (): GameEvent => ({ type: 'log', payload: { text: 'x' } }) as unknown as GameEvent,
};

describe('票型派生（deriveVoteTally）', () => {
  it('没有事件时票型为空', () => {
    const tally = deriveVoteTally([]);
    expect(tally.total).toBe(0);
    expect(tally.counts).toEqual({});
    expect(tally.settled).toBe(false);
  });

  it('同一目标的多票累加', () => {
    const tally = deriveVoteTally([ev.phase('vote'), ev.vote(1, 3), ev.vote(2, 3), ev.vote(4, 1)]);
    expect(tally.counts).toEqual({ 3: 2, 1: 1 });
    expect(tally.total).toBe(3);
  });

  it('无关事件不影响票型', () => {
    const tally = deriveVoteTally([ev.phase('vote'), ev.vote(1, 2), ev.other(), ev.other()]);
    expect(tally.counts).toEqual({ 2: 1 });
    expect(tally.total).toBe(1);
  });

  it('进入新一轮投票时清零', () => {
    const tally = deriveVoteTally([
      ev.phase('vote'),
      ev.vote(1, 3),
      ev.result(),
      ev.phase('night'),
      ev.phase('vote'),
      ev.vote(5, 6),
    ]);
    expect(tally.counts).toEqual({ 6: 1 });
    expect(tally.total).toBe(1);
    expect(tally.settled).toBe(false);
  });

  it('出结果后保留最终票型并标记 settled', () => {
    const tally = deriveVoteTally([ev.phase('vote'), ev.vote(1, 3), ev.vote(2, 3), ev.result()]);
    expect(tally.counts).toEqual({ 3: 2 });
    expect(tally.settled).toBe(true);
  });

  it('投票未出结果就离开投票阶段，旧票型不再成立', () => {
    const tally = deriveVoteTally([ev.phase('vote'), ev.vote(1, 3), ev.phase('day')]);
    expect(tally.counts).toEqual({});
    expect(tally.total).toBe(0);
  });
});

describe('票型排行（voteRows）', () => {
  it('按票数降序，最高票比例为 1', () => {
    const rows = voteRows({ counts: { 1: 1, 2: 3, 3: 2 }, total: 6, settled: false });
    expect(rows.map((r) => r.playerId)).toEqual([2, 3, 1]);
    expect(rows[0]?.ratio).toBe(1);
    expect(rows[1]?.ratio).toBeCloseTo(2 / 3);
  });

  it('过滤掉 0 票，空票型返回空数组', () => {
    expect(voteRows({ counts: { 1: 0, 2: 2 }, total: 2, settled: false })).toHaveLength(1);
    expect(voteRows({ counts: {}, total: 0, settled: false })).toEqual([]);
  });

  it('同票时按座位 id 稳定排序', () => {
    const rows = voteRows({ counts: { 5: 2, 3: 2 }, total: 4, settled: false });
    expect(rows.map((r) => r.playerId)).toEqual([3, 5]);
  });
});
