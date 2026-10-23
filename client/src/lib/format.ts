import type { Phase, RoleKey } from '@shared/types';
import { ROLES } from '@shared/roles';

export function formatWhen(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 顶栏徽章：第 N 夜 / 第 N 天 / 对局结束 */
export function roundBadge(phase: Phase, round: number): string {
  if (phase === 'over') return '对局结束';
  if (round === 0) return '准备中';
  if (phase === 'night') return `第 ${round} 夜`;
  if (phase === 'vote') return `第 ${round} 天 · 投票`;
  return `第 ${round} 天`;
}

/* ------------------------------------------------------------------ 战绩 */

/**
 * 战绩表里 `player_role` 存的是中文名（引擎写的是 `ROLES[...].name`），早期数据里也出现过 key。
 * 两种都认，否则胜负会判反：认不出狼阵营时，狼人赢的局会被算成「好人赢 → 我输」。
 */
const WOLF_LABELS = new Set<string>(
  Object.values(ROLES)
    .filter((role) => role.team === 'wolf')
    .flatMap((role) => [role.key as string, role.name]),
);

const LABEL_TO_KEY = new Map<string, RoleKey>(
  Object.values(ROLES).flatMap((role) => [
    [role.name, role.key] as [string, RoleKey],
    [role.key as string, role.key] as [string, RoleKey],
  ]),
);

/** 中文名或 key 都能还原成 RoleKey；认不出返回 null（不猜） */
export function roleFromLabel(label: string | null | undefined): RoleKey | null {
  return label ? LABEL_TO_KEY.get(label) ?? null : null;
}

export type MatchOutcome = 'win' | 'lose' | 'aborted';

/**
 * 一局战绩的输赢：`result` 是获胜阵营（good / wolf / aborted），
 * 得知道自己当时是不是狼，才能判断「阵营赢了」是否等于「我赢了」。
 */
export function matchOutcome(
  playerRole: string | null | undefined,
  result: string | null | undefined,
): MatchOutcome {
  if (result !== 'good' && result !== 'wolf') return 'aborted';
  const iAmWolf = WOLF_LABELS.has(playerRole ?? '');
  const wolfWon = result === 'wolf';
  return iAmWolf === wolfWon ? 'win' : 'lose';
}
