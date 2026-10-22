import { describe, expect, it } from 'vitest';
import { timelineFromRecords, timelineFromReview } from '../client/src/lib/timeline';
import type { NightRecord } from '../src/shared/types';

const record = (patch: Partial<NightRecord> = {}): NightRecord => ({
  round: 1,
  wolfTarget: null,
  saved: false,
  poisonTarget: null,
  deaths: [],
  exiled: null,
  tie: false,
  ...patch,
});

describe('上帝视角时间轴（timelineFromRecords）', () => {
  it('狼刀被救下时不谎报死亡', () => {
    const [entry] = timelineFromRecords([
      record({ wolfTarget: { playerId: 2, name: '老K' }, saved: true }),
    ]);
    expect(entry?.lines.map((l) => l.text)).toEqual(['狼刀 老K（女巫用解药救下）', '平安夜，无人出局']);
    expect(entry?.lines[0]?.tone).toBe('save');
  });

  it('同时有刀和毒时列出两个死因', () => {
    const [entry] = timelineFromRecords([
      record({
        wolfTarget: { playerId: 2, name: '老K' },
        poisonTarget: { playerId: 3, name: '小满' },
        deaths: [
          { playerId: 2, name: '老K', seat: 2, cause: 'wolf' },
          { playerId: 3, name: '小满', seat: 3, cause: 'poison' },
        ],
      }),
    ]);
    expect(entry?.lines.map((l) => l.text)).toEqual([
      '狼刀 老K',
      '女巫下毒 小满',
      '出局：老K（刀）、小满（毒）',
    ]);
  });

  it('放逐带上身份与票数，平票单独表达', () => {
    const [exiled, tie] = timelineFromRecords([
      record({ exiled: { playerId: 4, name: '七喜', role: 'wolf', votes: 4 } }),
      record({ round: 2, tie: true }),
    ]);
    expect(exiled?.lines.at(-1)).toEqual({ tone: 'vote', text: '放逐 七喜（狼人，4 票）' });
    expect(tie?.lines.at(-1)).toEqual({ tone: 'calm', text: '投票平票，无人出局' });
  });

  it('狼人没出刀时明确写出来，而不是显示平安夜了事', () => {
    const [entry] = timelineFromRecords([record()]);
    expect(entry?.lines[0]?.text).toBe('狼人没有出刀');
  });
});

describe('玩家视角时间轴（timelineFromReview）', () => {
  it('只说谁出局，不含死因与用药', () => {
    const [entry] = timelineFromReview([{ round: 1, deadNames: ['老K'], exiled: null, tie: false }]);
    const text = entry?.lines.map((l) => l.text).join('|') ?? '';
    expect(text).toBe('出局：老K');
    expect(text).not.toContain('女巫');
    expect(text).not.toContain('毒');
  });

  it('放逐公开身份（规则上本来就翻牌）', () => {
    const [entry] = timelineFromReview([
      { round: 2, deadNames: [], exiled: { name: '豆豆', role: 'seer' }, tie: false },
    ]);
    expect(entry?.lines.map((l) => l.text)).toEqual(['平安夜', '放逐 豆豆（预言家）']);
  });

  it('空复盘返回空数组', () => {
    expect(timelineFromReview([])).toEqual([]);
    expect(timelineFromRecords([])).toEqual([]);
  });
});
