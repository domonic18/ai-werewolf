import type { MatchesResponse } from '@shared/types';
import { formatWhen } from '../lib/format';

interface MatchWallProps {
  data: MatchesResponse | null;
}

export function MatchWall({ data }: MatchWallProps): JSX.Element {
  if (!data) return <div className="empty">读取云端对局…</div>;
  if (!data.recent.length) return <div className="empty">还没有人对局过，你可以第一个</div>;

  return (
    <div className="recent-list">
      {data.recent.map((row) => {
        const goodWin = row.result === 'good';
        return (
          <div key={row.id} className="recent-item">
            <span className="who">{row.player_name}</span>
            <span className={`tag ${goodWin ? 'win' : 'lose'}`}>{goodWin ? '好人胜' : '狼人胜'}</span>
            <span className="when">
              {row.rounds || '?'}轮 · {formatWhen(row.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
