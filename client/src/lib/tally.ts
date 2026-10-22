import type { GameEvent } from '@shared/types';

export interface VoteTally {
  /** 目标玩家 id → 得票数 */
  counts: Record<number, number>;
  /** 已投出的票数 */
  total: number;
  /** 本轮是否已出结果（用于条状图定稿上色） */
  settled: boolean;
}

const EMPTY: VoteTally = { counts: {}, total: 0, settled: false };

/**
 * 从事件流派生当前轮票型。
 *
 * 刻意不在引擎里单独存一份状态：票型完全由 `vote` 事件推导，
 * 事件流是唯一事实来源，所以刷新、断线恢复、观战都能得到同一结果。
 *
 * 复位规则：进入新的投票阶段（phase=vote）重新计数；离开投票阶段（夜晚/白天开始）清空。
 * 已出结果后保留最终票型，直到下一轮投票，这样玩家还能看到「刚才是怎么被投出去的」。
 */
export function deriveVoteTally(events: GameEvent[]): VoteTally {
  let tally: VoteTally = { ...EMPTY, counts: {} };

  for (const event of events) {
    if (event.type === 'phase') {
      const { phase } = event.payload;
      if (phase === 'vote') {
        tally = { counts: {}, total: 0, settled: false };
      } else if (!tally.settled) {
        /* 投票没出结果就进入下一阶段（例如中断），旧票型不再成立 */
        tally = { counts: {}, total: 0, settled: false };
      }
      continue;
    }

    if (event.type === 'vote') {
      const { target } = event.payload;
      tally.counts[target] = (tally.counts[target] ?? 0) + 1;
      tally.total += 1;
      continue;
    }

    if (event.type === 'vote-result') {
      tally = { ...tally, counts: { ...tally.counts }, settled: true };
    }
  }

  return tally;
}

export interface VoteRow {
  playerId: number;
  votes: number;
  /** 相对最高票的比例，用于条宽 */
  ratio: number;
}

/** 把票型整理成可直接渲染的排行（只保留得票 > 0 的人） */
export function voteRows(tally: VoteTally): VoteRow[] {
  const entries = Object.entries(tally.counts)
    .map(([id, votes]) => ({ playerId: Number(id), votes }))
    .filter((row) => row.votes > 0)
    .sort((a, b) => b.votes - a.votes || a.playerId - b.playerId);

  const max = entries[0]?.votes ?? 0;
  return entries.map((row) => ({ ...row, ratio: max > 0 ? row.votes / max : 0 }));
}
