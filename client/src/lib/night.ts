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

export interface NightTiming {
  /** 第一句口令出现前的静场：让月亮先起来，别一进来就刷字 */
  leadInMs: number;
  /** 后面每句之间至少隔多久 */
  gapMs: number;
  /** 最短停留：夜里可能一秒就演完（村民没事做，AI 又很快），
   *  不留这点时间，过场会变成「闪一下黑屏」，比不做还糟 */
  minMs: number;
  /** 安全上限：夜里 AI 可能思考很久，过场不能无限压着屏幕 */
  maxMs: number;
}

export const NIGHT_TIMING: NightTiming = {
  leadInMs: 650,
  gapMs: 1100,
  minMs: 1100,
  maxMs: 9000,
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
export function nextCueDelay(index: number, timing: NightTiming = NIGHT_TIMING): number {
  return index <= 0 ? timing.leadInMs : timing.gapMs;
}

export interface CurtainGate {
  phase: Phase;
  round: number;
  /** 有挂起的真人动作时必须让位：那是玩家自己要做的决定 */
  hasPending: boolean;
  /** 已经看过（或手动跳过）的夜晚 */
  watchedRound: number;
  cueCount: number;
}

/**
 * 是否该拉起夜幕。四条不许放行的理由：
 * 天已经亮了、玩家正等你决策、这一夜已经演过、还没有任何口令可演。
 */
export function shouldRaiseCurtain({
  phase,
  round,
  hasPending,
  watchedRound,
  cueCount,
}: CurtainGate): boolean {
  if (phase !== 'night') return false;
  if (hasPending) return false;
  if (watchedRound >= round) return false;
  return cueCount > 0;
}

export interface CurtainCloseGate {
  phase: Phase;
  elapsedMs: number;
  hasPending: boolean;
  timing?: NightTiming;
}

/**
 * 过场该不该收。
 * 玩家要决策一律立刻收（晚一拍就可能点错）；天亮要收，但先让最短停留走完，
 * 免得「闪一下就黑屏」；夜里太久（AI 在思考）到上限也收，交给常驻的夜幕条接管 ——
 * 宁可少一段戏，也不能把屏幕长期盖住。
 */
export function shouldCloseCurtain({
  phase,
  elapsedMs,
  hasPending,
  timing = NIGHT_TIMING,
}: CurtainCloseGate): boolean {
  if (hasPending) return true;
  if (elapsedMs >= timing.maxMs) return true;
  if (phase !== 'night') return elapsedMs >= timing.minMs;
  return false;
}
