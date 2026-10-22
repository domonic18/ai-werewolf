import type { LobbyGame } from '@shared/types';

interface LiveListProps {
  games: LobbyGame[] | null;
  onWatch: (gameId: string) => void;
}

export function LiveList({ games, onWatch }: LiveListProps): JSX.Element {
  if (!games) return <div className="empty">读取进行中对局…</div>;
  if (!games.length) return <div className="empty">现在没有进行中的对局，开一局让大家围观</div>;

  return (
    <div className="recent-list">
      {games.map((game) => (
        <div key={game.gameId} className="recent-item">
          <span className="who">👤 {game.host} 的对局</span>
          <span className="tag stage">{game.phaseLabel}</span>
          <span className="when">
            存活 {game.alive}/{game.players}
            {game.spectators > 0 ? ` · 👁 ${game.spectators}` : ''} ·{' '}
            <button className="link-btn" onClick={() => onWatch(game.gameId)}>
              观战
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
