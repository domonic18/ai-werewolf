import { useEffect, useState } from 'react';
import { completeOAuthCallback, stripOAuthParams } from './auth/actions';
import { setSession } from './auth/session';
import { HomePage } from './pages/HomePage';
import { LobbyPage } from './pages/LobbyPage';
import { MatchPage } from './pages/MatchPage';
import { ResultPage } from './pages/ResultPage';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { MePage } from './pages/MePage';
import { useMatchPolling } from './hooks/useMatchPolling';
import { clearSavedGame, readSavedGame } from './lib/storage';
import { useGameStore } from './store/gameStore';

type Screen = 'home' | 'lobby' | 'setup' | 'login' | 'me';

/**
 * 页面与地址栏 hash 同步：刷新后停在原页面，深链也能直达（#lobby / #setup / #login / #me）。
 * 用 replaceState 而不是 pushState —— 这几屏是同一页内的分屏，不该占浏览器历史。
 */
const SCREENS: readonly Screen[] = ['home', 'lobby', 'setup', 'login', 'me'];

function screenFromHash(): Screen {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return SCREENS.includes(raw as Screen) ? (raw as Screen) : 'home';
}

export function App(): JSX.Element {
  const gameId = useGameStore((s) => s.gameId);
  const snapshot = useGameStore((s) => s.snapshot);
  const spectate = useGameStore((s) => s.spectate);
  const watching = useGameStore((s) => s.watching);
  const open = useGameStore((s) => s.open);
  const close = useGameStore((s) => s.close);
  const { lost, reason } = useMatchPolling();

  const [screen, setScreen] = useState<Screen>(() => screenFromHash());

  /* 地址栏跟着当前分屏走（replaceState：不产生历史记录，但刷新后能回到这一屏） */
  useEffect(() => {
    /* 观战深链 #watch=… 优先，别被分屏同步覆盖掉 */
    if (/^#watch=/.test(window.location.hash)) return;
    const target = screen === 'home' ? window.location.pathname : `#${screen}`;
    if (screen === 'home' ? !window.location.hash : window.location.hash === `#${screen}`) return;
    window.history.replaceState({}, '', `${target}${window.location.search}`);
  }, [screen]);

  /* 用户手改 hash / 浏览器后退时，把页面切回去 */
  useEffect(() => {
    const onHashChange = (): void => setScreen(screenFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /*
   * 观战深链：#watch=<gameId> 直接进上帝视角。
   * 观战不需要凭证，所以这个链接可以直接分享给别人。
   */
  useEffect(() => {
    const matched = window.location.hash.match(/^#watch=([\w-]+)$/);
    if (matched?.[1]) open(matched[1], { watching: true });
  }, [open]);
  /* 第三方登录回调失败要说出来，不能让用户以为「点了没反应」 */
  const [oauthError, setOauthError] = useState<string | null>(null);
  /* 观战用的是上帝视角投影，玩家用私有快照 —— 判断「结束」要按当前视角取，否则观战永远看不到结算页 */
  const finished = (watching ? spectate?.phase : snapshot?.phase) === 'over';

  /* 对局结束：清掉本地断线恢复标记（进度已在结算页展示） */
  useEffect(() => {
    if (finished) clearSavedGame();
  }, [finished]);

  /*
   * 第三方登录回调必须在这里、在任何页面判断之前处理：
   * 落地瞬间还没有会话，先渲染首页也不会错，但必须立刻把 code 换掉。
   */
  useEffect(() => {
    void completeOAuthCallback().then((result) => {
      if (!result.ok) {
        setOauthError(result.error);
        stripOAuthParams();
        return;
      }
      if (!result.data) return; /* 不是回调，什么都不做 */
      setSession({ accessToken: result.data.accessToken, userId: result.data.userId, expiresAt: 0 });
      stripOAuthParams();
      setScreen('home');
    });
  }, []);

  const watch = (id: string): void => open(id, { watching: true });

  /* 从大厅回到自己那一局：必须带上凭证，否则服务端只会回 401 */
  const resume = (id: string): void => {
    const saved = readSavedGame();
    if (saved && saved.id === id) open(id, { token: saved.token });
  };

  return (
    <div id="app">
      {oauthError ? (
        <p className="login-msg err" onClick={() => setOauthError(null)}>
          第三方登录失败：{oauthError}（点此关闭）
        </p>
      ) : null}
      {!gameId && screen === 'home' ? (
        <HomePage
          onWatch={watch}
          onOpenLobby={() => setScreen('lobby')}
          onNewGame={() => setScreen('setup')}
          onOpenLogin={() => setScreen('login')}
          onOpenStats={() => setScreen('me')}
        />
      ) : null}
      {!gameId && screen === 'login' ? (
        <LoginPage onBack={() => setScreen('home')} onSignedIn={() => setScreen('home')} />
      ) : null}
      {!gameId && screen === 'me' ? (
        <MePage
          onBack={() => setScreen('home')}
          onLogin={() => setScreen('login')}
          onStart={() => setScreen('setup')}
          onResume={resume}
        />
      ) : null}
      {!gameId && screen === 'setup' ? (
        <SetupPage
          onBack={() => setScreen('home')}
          onStarted={(id, token) => open(id, { token })}
        />
      ) : null}
      {!gameId && screen === 'lobby' ? (
        <LobbyPage
          onBack={() => setScreen('home')}
          onWatch={watch}
          onResume={resume}
          onStart={() => setScreen('setup')}
        />
      ) : null}
      {gameId && !finished ? <MatchPage lost={lost} lostReason={reason} /> : null}
      {gameId && finished ? (
        <ResultPage
          onOpenStats={() => {
            close();
            setScreen('me');
          }}
        />
      ) : null}
    </div>
  );
}
