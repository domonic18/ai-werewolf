import type { VoteTally } from '../lib/tally';
import { voteRows } from '../lib/tally';

interface VoteBarProps {
  tally: VoteTally;
  /** 座位 id → 显示名（含 emoji），来自当前视角的投影 */
  labelOf: (playerId: number) => string;
}

/**
 * 实时票型条。
 * 数据全部来自事件流派生，不额外维护状态——所以观战与玩家看到的是同一份票型。
 */
export function VoteBar({ tally, labelOf }: VoteBarProps): JSX.Element | null {
  const rows = voteRows(tally);
  if (!rows.length) return null;

  const top = rows[0];
  return (
    <div className={`votebar ${tally.settled ? 'settled' : ''}`}>
      <div className="votebar-head">
        <span className="votebar-title">🗳 实时票型</span>
        <span className="votebar-sub">
          {tally.settled ? '已出结果' : `已投 ${tally.total} 票`}
        </span>
      </div>
      {rows.map((row) => (
        <div key={row.playerId} className={`vote-row ${row === top && tally.settled ? 'top' : ''}`}>
          <span className="vote-name">{labelOf(row.playerId)}</span>
          <span className="vote-track">
            <span className="vote-fill" style={{ width: `${Math.max(6, Math.round(row.ratio * 100))}%` }} />
          </span>
          <span className="vote-count">{row.votes}</span>
        </div>
      ))}
    </div>
  );
}
