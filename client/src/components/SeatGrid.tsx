import type { SeatView } from '@shared/types';
import { ROLES } from '@shared/roles';

interface SeatGridProps {
  players: SeatView[];
  myId: number | null;
  speakingId: number | null;
}

export function SeatGrid({ players, myId, speakingId }: SeatGridProps): JSX.Element {
  return (
    <div className="seats">
      {players.map((player) => {
        const classes = ['seat'];
        if (player.id === myId) classes.push('me');
        if (!player.alive) classes.push('dead');
        if (player.id === speakingId) classes.push('speaking');

        const status = player.alive
          ? player.isHuman
            ? '你'
            : '在线'
          : player.revealed
            ? ROLES[player.revealed].name
            : '已出局';

        return (
          <div key={player.id} className={classes.join(' ')}>
            <div className="ava">{player.alive ? player.emoji : '💀'}</div>
            <div className="nm">{player.name}</div>
            <div className="st">{status}</div>
          </div>
        );
      })}
    </div>
  );
}
