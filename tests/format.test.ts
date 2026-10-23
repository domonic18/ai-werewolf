import { describe, expect, it } from 'vitest';
import { matchOutcome, roleFromLabel, roundBadge } from '../client/src/lib/format';

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

describe('战绩：一局的胜负', () => {
  it('狼阵营赢 = 我是狼才算胜（表里存的是中文角色名）', () => {
    expect(matchOutcome('狼人', 'wolf')).toBe('win');
    expect(matchOutcome('黑狼王', 'wolf')).toBe('win');
    expect(matchOutcome('狼人', 'good')).toBe('lose');
  });

  it('好人阵营赢 = 我不是狼才算胜', () => {
    expect(matchOutcome('预言家', 'good')).toBe('win');
    expect(matchOutcome('平民', 'good')).toBe('win');
    expect(matchOutcome('女巫', 'wolf')).toBe('lose');
  });

  it('兼容早期按 key 存的旧数据', () => {
    expect(matchOutcome('wolf', 'wolf')).toBe('win');
    expect(matchOutcome('villager', 'wolf')).toBe('lose');
  });

  it('中止的局不算胜负', () => {
    expect(matchOutcome('村民', 'aborted')).toBe('aborted');
    expect(matchOutcome('村民', '')).toBe('aborted');
  });
});

describe('战绩：角色名还原', () => {
  it('中文名与 key 都能还原成 RoleKey', () => {
    expect(roleFromLabel('黑狼王')).toBe('wolfking');
    expect(roleFromLabel('wolf')).toBe('wolf');
    expect(roleFromLabel('摄梦人')).toBe('dreamweaver');
  });

  it('认不出就不猜', () => {
    expect(roleFromLabel('路人甲')).toBeNull();
    expect(roleFromLabel('')).toBeNull();
    expect(roleFromLabel(null)).toBeNull();
  });
});
