import type { SpectateSnapshot } from '@shared/types';

interface FactionBarProps {
  factions: SpectateSnapshot['factions'];
}

/** 观战专属：双方阵营存活进度，一眼看出局势还剩多少 */
export function FactionBar({ factions }: FactionBarProps): JSX.Element {
  const rows: { key: 'wolf' | 'good'; label: string; alive: number; total: number }[] = [
    { key: 'wolf', label: '🐺 狼人', alive: factions.wolf.alive, total: factions.wolf.total },
    { key: 'good', label: '🛡 好人', alive: factions.good.alive, total: factions.good.total },
  ];

  return (
    <div className="factionbar">
      {rows.map((row) => {
        const ratio = row.total > 0 ? row.alive / row.total : 0;
        return (
          <div key={row.key} className={`faction-row ${row.key}`}>
            <span className="faction-label">{row.label}</span>
            <span className="faction-track">
              <span className="faction-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </span>
            <span className="faction-count">
              {row.alive}/{row.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}
