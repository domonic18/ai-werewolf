import type { GameEvent, Phase } from '@shared/types';

/**
 * 夜晚过场的编排逻辑。
 *
 * 拆成纯函数是为了可测：过场是「时序 + 状态门控」，一旦混进组件里，
 * 就只能靠肉眼看动画对不对。这里所有判断都能在 node 里跑断言。
 *
 * 关键取舍：过场不预设总时长。法官口令是随对局推进陆续到达的
 * （预言家验人、女巫用药都会让引擎多停几秒），预排一场固定剧本的结果
 * 是要么过早落幕、要么空等。所以这里只管三件事：
 *   1. 这一夜有哪些口令；
 *   2. 下一句该等多久；
 *   3. 什么时候必须落幕（天亮 / 玩家要决策 / 超过安全上限）。
 */

/**
 * 夜的叫法。开局等「开始」那一下时 round 还是 0 —— 直接写「第 0 夜」很出戏，
 * 这时候该说「入夜」。
 */
export function nightLabel(round: number): string {
  return round > 0 ? `第 ${round} 夜` : '入夜';
}

export interface NightTiming {
  /** 第一句口令出现前的静场：让月亮先起来，别一进来就刷字 */
  leadInMs: number;
  /** 续演时的静场：这一夜已经开过场，别再走一遍「月亮升起」 */
  resumeMs: number;
  /** 后面每句之间至少隔多久 */
  gapMs: number;
  /** 最短停留：夜里可能一秒就演完（村民没事做，AI 又很快），
   *  不留这点时间，过场会变成「闪一下黑屏」，比不做还糟 */
  minMs: number;
  /** 待决策时的最短停留：让「女巫请睁眼」这句先落地再弹药盘，别闪一下就跳面板 */
  pendingFloorMs: number;
  /** 天亮后「天亮了」停多久再落幕 */
  dawnMs: number;
  /** 静场上限：超过这么久没有新口令，说明 AI 在思考，先让出屏幕 */
  idleMs: number;
  /** 硬上限：无论有没有新口令，都不能一直盖着 */
  maxMs: number;
}

export const NIGHT_TIMING: NightTiming = {
  leadInMs: 650,
  resumeMs: 220,
  gapMs: 1100,
  minMs: 1100,
  pendingFloorMs: 1400,
  dawnMs: 1600,
  /*
   * 这两个数字是 2026-10-23 线上口径调出来的：
   * 预言家一次查验实测要 10.8 秒（模型思考），旧上限 9 秒会在它闭眼之前落幕，
   * 于是排在最后的女巫只剩扁平夜幕条 —— 而且落幕之后同一夜不再拉起，永远补不回来。
   * 现在只要还有口令没演，就继续演；只有「静场过久」才让出屏幕，之后新口令还能拉起。
   */
  idleMs: 12000,
  maxMs: 24000,
};

/**
 * 取「第 round 夜」这一夜的全部口令。
 *
 * 优先用事件自带的 round（服务端会带）；老事件没有 round 时按阶段切换回推：
 * 从后往前找最后一条 night 阶段的 phase 事件，再收集它之后的口令。
 */
export function nightCuesForRound(events: GameEvent[], round: number): string[] {
  const withRound = events.filter(
    (e): e is Extract<GameEvent, { type: 'night-cue' }> =>
      e.type === 'night-cue' && e.payload.round === round,
  );
  if (withRound.length) {
    return withRound.map((e) => e.payload.text).filter((text) => text.trim().length > 0);
  }

  /* 兼容：没有 round 字段的历史事件 —— 找最后一段「夜晚区间」：最后一个 night 阶段之后、第一个 dawn 之前 */
  let start = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as GameEvent;
    if (event.type === 'phase' && event.payload.phase === 'night') {
      start = i;
      break;
    }
  }
  if (start < 0) return [];

  const cues: string[] = [];
  for (let i = start + 1; i < events.length; i++) {
    const event = events[i] as GameEvent;
    if (event.type === 'dawn') break;
    if (event.type === 'night-cue') cues.push(event.payload.text);
  }
  return cues.filter((text) => text.trim().length > 0);
}

/** 已显示 index 句后，下一句要等多久（第一句是静场，其余是句间间隔） */
export function nextCueDelay(index: number, timing: NightTiming = NIGHT_TIMING, resumed = false): number {
  if (index > 0) return timing.gapMs;
  /* 续演时这一夜已经开过场、月亮也升过了，再走一遍静场会像「又过了一夜」 */
  return resumed ? timing.resumeMs : timing.leadInMs;
}

export interface CurtainGate {
  phase: Phase;
  /** 这一夜已经演过的口令数（跳过/落幕都算） */
  shownCount: number;
  cueCount: number;
  /** 玩家在这一夜手动跳过过：后面的口令不再拉起，别有完没完 */
  skipped: boolean;
}

/**
 * 是否该拉起夜幕。
 *
 * 判据只有一条：**这一夜还有没演过的口令**。
 * 早期版本是「同一夜只演一次」，于是排在后面的角色（女巫在最后）永远赶不上 ——
 * 夜幕在前一位思考时就落幕了，剩下的口令只能在扁平条里滚过去。
 * 改成按口令计数之后，中场落幕也会在下一句到达时续演。
 */
export function shouldRaiseCurtain({ phase, shownCount, cueCount, skipped }: CurtainGate): boolean {
  if (phase !== 'night') return false;
  if (skipped) return false;
  return cueCount > shownCount;
}

export interface CurtainCloseGate {
  phase: Phase;
  /** 从拉起（或续演）到现在 */
  elapsedMs: number;
  /** 距上一句口令落屏多久 */
  sinceCueMs: number;
  hasPending: boolean;
  timing?: NightTiming;
}

/**
 * 过场该不该收。
 *
 * 顺序有讲究：
 * 1. 玩家要决策 —— 走完最短停留就收（面板晚一步出现，但不闪）；
 * 2. 天亮了 —— 让「天亮了」这句停一下再落幕；
 * 3. 静场过久（AI 在思考）—— 先让出屏幕，等下一句口令到达再续演；
 * 4. 硬上限 —— 无论如何不能长期盖住屏幕。
 */
export function shouldCloseCurtain({
  phase,
  elapsedMs,
  sinceCueMs,
  hasPending,
  timing = NIGHT_TIMING,
}: CurtainCloseGate): boolean {
  if (hasPending) return elapsedMs >= timing.pendingFloorMs;
  if (phase !== 'night') return elapsedMs >= timing.dawnMs;
  if (sinceCueMs >= timing.idleMs) return true;
  return elapsedMs >= timing.maxMs;
}
