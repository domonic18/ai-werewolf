import type { NightRecord, PublicRoundReview, RoleKey } from '@shared/types';
import { ROLES } from '@shared/roles';

/**
 * 复盘时间轴：把「玩家可见」与「上帝视角」两种来源整成同一种渲染结构。
 *
 * 差别只在细节：玩家只知道谁出局、谁被放逐（死因与用药是女巫私有信息），
 * 观战者能看到狼刀目标、是否被救、毒了谁。渲染层不需要关心来源。
 */

export type TimelineTone = 'wolf' | 'poison' | 'save' | 'vote' | 'calm';

export interface TimelineLine {
  tone: TimelineTone;
  text: string;
}

export interface TimelineEntry {
  round: number;
  /** 该轮发生的所有事：先夜后昼 */
  lines: TimelineLine[];
}

const roleName = (role: RoleKey): string => ROLES[role].name;

/** 玩家视角（公开信息） */
export function timelineFromReview(review: PublicRoundReview[]): TimelineEntry[] {
  return review.map((item) => {
    const lines: TimelineLine[] = [];

    if (item.deadNames.length) {
      lines.push({ tone: 'wolf', text: `出局：${item.deadNames.join('、')}` });
    } else {
      lines.push({ tone: 'calm', text: '平安夜' });
    }

    if (item.exiled) {
      lines.push({ tone: 'vote', text: `放逐 ${item.exiled.name}（${roleName(item.exiled.role)}）` });
    } else if (item.tie) {
      lines.push({ tone: 'calm', text: '投票平票，无人出局' });
    }

    return { round: item.round, lines };
  });
}

/** 上帝视角（含死因与用药） */
export function timelineFromRecords(records: NightRecord[]): TimelineEntry[] {
  return records.map((rec) => {
    const lines: TimelineLine[] = [];

    if (rec.wolfTarget) {
      const saved = rec.saved ? '（女巫用解药救下）' : '';
      lines.push({ tone: rec.saved ? 'save' : 'wolf', text: `狼刀 ${rec.wolfTarget.name}${saved}` });
    } else {
      lines.push({ tone: 'calm', text: '狼人没有出刀' });
    }

    if (rec.poisonTarget) {
      lines.push({ tone: 'poison', text: `女巫下毒 ${rec.poisonTarget.name}` });
    }

    if (rec.deaths.length) {
      const detail = rec.deaths.map((d) => `${d.name}（${d.cause === 'poison' ? '毒' : '刀'}）`).join('、');
      lines.push({ tone: 'wolf', text: `出局：${detail}` });
    } else {
      lines.push({ tone: 'calm', text: '平安夜，无人出局' });
    }

    if (rec.exiled) {
      lines.push({
        tone: 'vote',
        text: `放逐 ${rec.exiled.name}（${roleName(rec.exiled.role)}，${rec.exiled.votes} 票）`,
      });
    } else if (rec.tie) {
      lines.push({ tone: 'calm', text: '投票平票，无人出局' });
    }

    return { round: rec.round, lines };
  });
}
