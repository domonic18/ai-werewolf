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
  });

  it('续演时不再走整段静场：月亮已经升过了', () => {
    expect(nextCueDelay(0, NIGHT_TIMING, true)).toBe(NIGHT_TIMING.resumeMs);
    expect(NIGHT_TIMING.resumeMs).toBeLessThan(NIGHT_TIMING.leadInMs);
  });

  it('句间间隔要短于静场上限，否则每句都会被当成「AI 在思考」而让出屏幕', () => {
    expect(NIGHT_TIMING.gapMs).toBeLessThan(NIGHT_TIMING.idleMs);
    expect(NIGHT_TIMING.idleMs).toBeLessThan(NIGHT_TIMING.maxMs);
  });
});

describe('夜晚过场：该不该拉起', () => {
  const base = { phase: 'night' as const, shownCount: 2, cueCount: 3, skipped: false };

  it('还有没演过的口令 → 拉起', () => {
    expect(shouldRaiseCurtain(base)).toBe(true);
  });

  it('这一夜的口令都演完了 → 不拉', () => {
    expect(shouldRaiseCurtain({ ...base, shownCount: 3 })).toBe(false);
  });

  it('天亮了不拉', () => {
    expect(shouldRaiseCurtain({ ...base, phase: 'day' })).toBe(false);
  });

  it('玩家这一夜点过跳过 → 后面的口令也不再打扰', () => {
    expect(shouldRaiseCurtain({ ...base, skipped: true })).toBe(false);
  });

  it('还没有口令可演时不拉（避免空屏一片黑）', () => {
    expect(shouldRaiseCurtain({ ...base, shownCount: 0, cueCount: 0 })).toBe(false);
  });

  /**
   * 回归：线上实测「女巫不出现氛围」。
   * 夜间顺序是 狼人 → 守卫 → 预言家 → 女巫，女巫永远排在最后；
   * 旧规则「同一夜只演一次」让它在夜幕落幕之后才开口，只能在扁平条里滚过去。
   */
  it('最后一位（女巫）的口令在夜幕落幕之后到达，仍然要拉起', () => {
    const shown = ['天黑请闭眼', '狼人请睁眼', '狼人请闭眼', '预言家请睁眼'];
    /* 这四句演完后落幕 */
    expect(
      shouldRaiseCurtain({ phase: 'night', shownCount: shown.length, cueCount: shown.length, skipped: false }),
    ).toBe(false);
    /* 女巫开口：多出一句没演过的 */
    expect(
      shouldRaiseCurtain({
        phase: 'night',
        shownCount: shown.length,
        cueCount: [...shown, '女巫请睁眼'].length,
        skipped: false,
      }),
    ).toBe(true);
  });
});

describe('夜晚过场：该不该落幕', () => {
  const base = { phase: 'night' as const, elapsedMs: 2000, sinceCueMs: 300, hasPending: false };

  it('夜里正常演：不落', () => {
    expect(shouldCloseCurtain(base)).toBe(false);
  });

  it('玩家要决策：走完最短停留才落，不会闪一下黑屏就跳面板', () => {
    expect(shouldCloseCurtain({ ...base, elapsedMs: 300, hasPending: true })).toBe(false);
    expect(shouldCloseCurtain({ ...base, elapsedMs: NIGHT_TIMING.pendingFloorMs, hasPending: true })).toBe(true);
  });

  it('天亮：让「天亮了」停一下再落幕', () => {
    expect(shouldCloseCurtain({ ...base, phase: 'day', elapsedMs: 400 })).toBe(false);
    expect(shouldCloseCurtain({ ...base, phase: 'day', elapsedMs: NIGHT_TIMING.dawnMs })).toBe(true);
  });

  it('静场过久（AI 在思考）先让出屏幕，口令到了再续演', () => {
    expect(shouldCloseCurtain({ ...base, sinceCueMs: NIGHT_TIMING.idleMs })).toBe(true);
  });

  it('无论有没有新口令，都不能超过硬上限', () => {
    expect(shouldCloseCurtain({ ...base, elapsedMs: NIGHT_TIMING.maxMs, sinceCueMs: 500 })).toBe(true);
  });

  it('预言家想 11 秒这种常见情况不该被中途砍掉（旧上限 9 秒正是女巫缺席的原因）', () => {
    expect(shouldCloseCurtain({ ...base, elapsedMs: 9000, sinceCueMs: 2000 })).toBe(false);
  });
});
