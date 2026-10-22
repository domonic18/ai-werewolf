import { useEffect } from 'react';
import { HomePage } from './pages/HomePage';
import { MatchPage } from './pages/MatchPage';
import { ResultPage } from './pages/ResultPage';
import { useMatchPolling } from './hooks/useMatchPolling';
import { STORAGE_KEY, useGameStore } from './store/gameStore';

export function App(): JSX.Element {
  const gameId = useGameStore((s) => s.gameId);
  const snapshot = useGameStore((s) => s.snapshot);
  const open = useGameStore((s) => s.open);
  const { lost } = useMatchPolling();

  const finished = snapshot?.phase === 'over';

  /* 对局结束：清掉本地断线恢复标记（进度已在结算页展示） */
  useEffect(() => {
    if (!finished) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [finished]);

  return (
    <div id="app">
      {!gameId ? <HomePage onWatch={(id) => open(id, { watching: true })} /> : null}
      {gameId && !finished ? <MatchPage lost={lost} /> : null}
      {gameId && finished ? <ResultPage /> : null}
    </div>
  );
}
