import { useEffect, useState } from 'react';
import { HomePage } from './pages/HomePage';
import { LobbyPage } from './pages/LobbyPage';
import { MatchPage } from './pages/MatchPage';
import { ResultPage } from './pages/ResultPage';
import { useMatchPolling } from './hooks/useMatchPolling';
import { clearSavedGame } from './lib/storage';
import { useGameStore } from './store/gameStore';

type Screen = 'home' | 'lobby';

export function App(): JSX.Element {
  const gameId = useGameStore((s) => s.gameId);
  const snapshot = useGameStore((s) => s.snapshot);
  const spectate = useGameStore((s) => s.spectate);
  const watching = useGameStore((s) => s.watching);
  const open = useGameStore((s) => s.open);
  const { lost, reason } = useMatchPolling();

  const [screen, setScreen] = useState<Screen>('home');
  /* 观战用的是上帝视角投影，玩家用私有快照 —— 判断「结束」要按当前视角取，否则观战永远看不到结算页 */
  const finished = (watching ? spectate?.phase : snapshot?.phase) === 'over';

  /* 对局结束：清掉本地断线恢复标记（进度已在结算页展示） */
  useEffect(() => {
    if (finished) clearSavedGame();
  }, [finished]);

  const watch = (id: string): void => open(id, { watching: true });

  return (
    <div id="app">
      {!gameId && screen === 'home' ? (
        <HomePage onWatch={watch} onOpenLobby={() => setScreen('lobby')} />
      ) : null}
      {!gameId && screen === 'lobby' ? (
        <LobbyPage onBack={() => setScreen('home')} onWatch={watch} onStart={() => setScreen('home')} />
      ) : null}
      {gameId && !finished ? <MatchPage lost={lost} lostReason={reason} /> : null}
      {gameId && finished ? <ResultPage /> : null}
    </div>
  );
}
