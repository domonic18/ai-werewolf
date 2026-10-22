import type { Phase } from '@shared/types';

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
  return `第 ${round} 天`;
}
