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
  const open = useGameStore((s) => s.open);
  const { lost, reason } = useMatchPolling();

  const [screen, setScreen] = useState<Screen>('home');
  const finished = snapshot?.phase === 'over';

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
