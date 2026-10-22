import type { RoleKey } from '@shared/types';
import { ROLES } from '@shared/roles';

/** 玩家视角与观战视角的座位都能喂进来：观战多一个 role 字段 */
export interface SeatLike {
  id: number;
  seat: number;
  name: string;
  emoji: string;
  alive: boolean;
  isHuman: boolean;
  revealed?: RoleKey | null;
  role?: RoleKey;
}

interface SeatGridProps {
  players: SeatLike[];
  myId: number | null;
  speakingId: number | null;
  /** 观战（上帝视角）时直接展示身份 */
  revealRoles?: boolean;
}

export function SeatGrid({ players, myId, speakingId, revealRoles = false }: SeatGridProps): JSX.Element {
  return (
    <div className="seats">
      {players.map((player) => {
        const classes = ['seat'];
        if (player.id === myId) classes.push('me');
        if (!player.alive) classes.push('dead');
        if (player.id === speakingId) classes.push('speaking');

        const shownRole = revealRoles ? player.role : null;
        const status = shownRole
          ? `${ROLES[shownRole].name}${player.alive ? '' : ' · 出局'}`
          : player.alive
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
