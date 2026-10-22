import { describe, expect, it } from 'vitest';
import { roundBadge } from '../client/src/lib/format';

describe('roundBadge', () => {
  it('准备中：还未开局', () => {
    expect(roundBadge('night', 0)).toBe('准备中');
  });

  it('夜晚与白天', () => {
    expect(roundBadge('night', 2)).toBe('第 2 夜');
    expect(roundBadge('day', 3)).toBe('第 3 天');
  });

  it('投票阶段与大厅标签口径一致', () => {
    expect(roundBadge('vote', 3)).toBe('第 3 天 · 投票');
  });

  it('结束后不再显示轮次', () => {
    expect(roundBadge('over', 4)).toBe('对局结束');
  });
});
