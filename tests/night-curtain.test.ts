import { describe, expect, it } from 'vitest';
import {
  NIGHT_TIMING,
  nightLabel,
  nightCuesForRound,
  nextCueDelay,
  shouldCloseCurtain,
  shouldRaiseCurtain,
} from '../client/src/lib/night.js';
import type { GameEvent } from '../src/shared/types.js';

let seq = 0;
const ev = (type: GameEvent['type'], payload: unknown): GameEvent =>
  ({ seq: ++seq, t: 0, type, payload }) as GameEvent;

const nightEvent = (round: number) => ev('phase', { label: `第 ${round} 夜`, phase: 'night', round });
const dayEvent = (round: number) => ev('phase', { label: `第 ${round} 天`, phase: 'day', round });
const cue = (text: string, round?: number) => ev('night-cue', round === undefined ? { text } : { text, round });

describe('夜晚过场：口令归属', () => {
  it('只取当前这一夜的口令，前一夜的不重演', () => {
    const events = [
      nightEvent(1),
      cue('天黑请闭眼', 1),
      cue('预言家请睁眼', 1),
      dayEvent(1),
      nightEvent(2),
      cue('天黑请闭眼', 2),
      cue('守卫请睁眼', 2),
    ];
    expect(nightCuesForRound(events, 2)).toEqual(['天黑请闭眼', '守卫请睁眼']);
    expect(nightCuesForRound(events, 1)).toEqual(['天黑请闭眼', '预言家请睁眼']);
  });

  it('历史事件没有 round 字段时，按最后一段夜晚区间回推', () => {
    const events = [
      nightEvent(1),
      cue('天黑请闭眼'),
      cue('预言家请睁眼'),
      ev('dawn', { dead: [], firstNight: true }),
      dayEvent(1),
      cue('白天不该被算进来（异常数据也要挡住）'),
    ];
    /* 没有 night 阶段的第二条，最后一段夜晚就是第一夜 */
    expect(nightCuesForRound(events, 9)).toEqual(['天黑请闭眼', '预言家请睁眼']);
  });

  it('空白口令被丢掉，不会渲染成空行', () => {
    const events = [nightEvent(1), cue('  ', 1), cue('天黑请闭眼', 1)];
    expect(nightCuesForRound(events, 1)).toEqual(['天黑请闭眼']);
  });
});

describe('夜晚过场：叫法', () => {
  it('开局等开始时 round 还是 0，这时候说「入夜」而不是「第 0 夜」', () => {
    expect(nightLabel(0)).toBe('入夜');
    expect(nightLabel(1)).toBe('第 1 夜');
    expect(nightLabel(4)).toBe('第 4 夜');
  });
});

describe('夜晚过场：节奏', () => {
  it('第一句前是静场，之后按句间隔走', () => {
    expect(nextCueDelay(0)).toBe(NIGHT_TIMING.leadInMs);
    expect(nextCueDelay(1)).toBe(NIGHT_TIMING.gapMs);
    expect(nextCueDelay(7)).toBe(NIGHT_TIMING.gapMs);
    expect(NIGHT_TIMING.leadInMs).toBeLessThan(NIGHT_TIMING.maxMs);
  });

  it('一句一句铺开也不会超过上限：口令数 × 间隔 + 静场要留出余量', () => {
    const worst = NIGHT_TIMING.leadInMs + NIGHT_TIMING.gapMs * 7;
    expect(worst).toBeLessThanOrEqual(NIGHT_TIMING.maxMs + 1000);
  });
});

describe('夜晚过场：该不该拉起 / 收起', () => {
  const base = { phase: 'night' as const, round: 2, hasPending: false, watchedRound: 0, cueCount: 2 };

  it('夜里且有口令 → 拉起', () => {
    expect(shouldRaiseCurtain(base)).toBe(true);
  });

  it('天亮了不拉', () => {
    expect(shouldRaiseCurtain({ ...base, phase: 'day' })).toBe(false);
  });

  it('玩家有待决策的动作时不拉：那是他自己的回合，不能挡', () => {
    expect(shouldRaiseCurtain({ ...base, hasPending: true })).toBe(false);
  });

  it('同一夜只演一次：已看过/已跳过就不再拉', () => {
    expect(shouldRaiseCurtain({ ...base, watchedRound: 2 })).toBe(false);
    expect(shouldRaiseCurtain({ ...base, watchedRound: 3 })).toBe(false);
  });

  it('还没有口令可演时不拉（避免空屏一片黑）', () => {
    expect(shouldRaiseCurtain({ ...base, cueCount: 0 })).toBe(false);
  });

  it('待决策立刻收：晚一拍玩家就可能点错', () => {
    expect(shouldCloseCurtain({ phase: 'night', elapsedMs: 200, hasPending: true })).toBe(true);
    expect(shouldCloseCurtain({ phase: 'day', elapsedMs: 200, hasPending: true })).toBe(true);
  });

  it('天亮要收，但先走完最短停留，避免闪一下黑屏', () => {
    expect(shouldCloseCurtain({ phase: 'day', elapsedMs: 300, hasPending: false })).toBe(false);
    expect(shouldCloseCurtain({ phase: 'vote', elapsedMs: 300, hasPending: false })).toBe(false);
    expect(shouldCloseCurtain({ phase: 'day', elapsedMs: NIGHT_TIMING.minMs, hasPending: false })).toBe(true);
  });

  it('夜里到上限也收（AI 思考太久，不能长期盖住屏幕）', () => {
    expect(shouldCloseCurtain({ phase: 'night', elapsedMs: NIGHT_TIMING.maxMs, hasPending: false })).toBe(true);
  });

  it('夜里没到上限、也没待决策时继续演', () => {
    expect(shouldCloseCurtain({ phase: 'night', elapsedMs: 3000, hasPending: false })).toBe(false);
  });
});
