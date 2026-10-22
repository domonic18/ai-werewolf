import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../auth/useSession';
import { AccountCard } from '../components/AccountCard';
import { useHomeData } from '../hooks/useHomeData';
import { clearSavedGame, readSavedGame } from '../lib/storage';
import { useGameStore } from '../store/gameStore';

const APP_VERSION = __APP_VERSION__;

/**
 * 首页：逐项对齐 docs/designs/01-home.html。
 * 结构 = 品牌栏 / Hero 卡（徽标·标题·AI 阵容·开始一局）/ 断线恢复条 / 数据条 /
 *        正在进行（两张横向卡）/ 收官条 / 页脚。
 * 代号与 AI 模型不在这屏（设计稿没有），挪到「新建对局」里调。
 */
/* 与 src/game/roles.ts 的 AI_CAST 前 5 位保持一致，仅用于首页展示 */
const HERO_CAST = [
  { emoji: '🕶️', name: '老K' },
  { emoji: '🍊', name: '小满' },
  { emoji: '🧊', name: '阿岚' },
  { emoji: '🍬', name: '豆豆' },
  { emoji: '🎭', name: '七喜' },
];

interface HomePageProps {
  onWatch: (gameId: string) => void;
  onOpenLobby: () => void;
  /** 进配置页（选人数/牌组） */
  onNewGame: () => void;
  /** 登录入口（可选增强，不做登录墙） */
  onOpenLogin: () => void;
}

export function HomePage({ onWatch, onOpenLobby, onNewGame, onOpenLogin }: HomePageProps): JSX.Element {
  const open = useGameStore((s) => s.open);
  const data = useHomeData();
  const { signedIn } = useSession();

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);

  /* 断线恢复：本地存的对局 id 若在服务端仍进行中，则展示恢复入口 */
  useEffect(() => {
    let cancelled = false;
    const saved = readSavedGame();
    if (!saved) return;

    void api
      .snapshot(saved.id, saved.token)
      .then((snapshot) => {
        if (cancelled) return;
        if (snapshot.winner || snapshot.aborted || snapshot.phase === 'over') {
          clearSavedGame();
          return;
        }
        setResumeId(saved.id);
      })
      .catch(() => {
        /* 401（凭证失效）或 404（对局被清理）都不再提供恢复入口 */
        clearSavedGame();
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* AI 通道还在后台初始化时，每 3 秒自动重问一次，就绪后按钮自动变可用 */
  const llmState = data.health?.llm.state;
  useEffect(() => {
    if (llmState !== 'initializing') return;
    const timer = window.setTimeout(() => void data.refresh(), 3000);
    return () => window.clearTimeout(timer);
  }, [llmState, data.refresh]);

  const startGame = async (): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      const result = await api.createGame({ playerName: '你' });
      open(result.gameId, { token: result.playerToken });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '开局失败');
    } finally {
      setStarting(false);
    }
  };

  /* 恢复必须带凭证：玩家私有接口都要 X-Player-Token，漏了只会拿到 401 */
  const resumeGame = (): void => {
    const saved = readSavedGame();
    if (saved) open(saved.id, { token: saved.token });
  };

  const dropGame = async (): Promise<void> => {
    if (!resumeId) return;
    const saved = readSavedGame();
    try {
      if (saved) await api.quit(saved.id, saved.token);
    } catch {
      /* 对局可能已结束，忽略 */
    }
    clearSavedGame();
    setResumeId(null);
  };

  const env = data.health?.env ?? 'production';
  const llm = data.health?.llm;
  const aiReady = Boolean(data.health && llm?.state === 'ready' && llm.ok);
  const stats = data.matches?.stats;
  const totalGames = stats?.total ?? 0;
  const goodRate = totalGames ? Math.round(((stats?.good ?? 0) / totalGames) * 100) : 0;
  const wolfRate = totalGames ? Math.round(((stats?.wolf ?? 0) / totalGames) * 100) : 0;
  const live = data.live?.games.slice(0, 2) ?? [];
  const liveTotal = data.live?.total ?? 0;

  /* 徽标要反映真实状态，不能永远写「已就位」 */
  const badgeText = !data.health
    ? data.healthError
      ? '服务不可达，正在重试…'
      : '正在连接服务…'
    : llm?.state === 'initializing'
      ? 'AI 通道正在启动…'
      : aiReady
        ? '5 个 AI 玩家已就位'
        : 'AI 通道不可用';

  return (
    <section className="screen page-home">
      <div className="home-top">
        <div className="home-brand">
          <div className="home-brand-logo">🐺</div>
          <div className="home-brand-text">
            <b>AI 狼人杀</b>
            <span>Agent 补位局</span>
          </div>
        </div>
        <div className="home-actions">
          <button className="home-lobby-btn" onClick={onOpenLobby}>
            大厅
          </button>
          <button className="home-avatar" onClick={onOpenLogin} aria-label={signedIn ? '已登录' : '登录'}>
            {signedIn ? '🙋' : '👤'}
          </button>
        </div>
      </div>

      <div className="hero-card">
        <div className="hero-badge">
          <span className="dot" />
          <span>{badgeText}</span>
        </div>
        <div className="hero-title">
          <b>5 个 AI 会说话，</b>
          <b>也会怀疑你</b>
        </div>
        <p className="hero-desc">发言、怀疑、投票全部由大模型实时生成，不是固定话术</p>
        <div className="hero-cast">
          <div className="hero-cast-avas">
            {HERO_CAST.map((member) => (
              <div key={member.name} className="hero-cast-ava">
                {member.emoji}
              </div>
            ))}
          </div>
          <p className="hero-cast-names">{HERO_CAST.map((m) => m.name).join(' · ')}</p>
        </div>
        <button className="hero-start" disabled={starting || !aiReady} onClick={() => void startGame()}>
          {starting ? '开局中…' : aiReady ? '开始一局' : 'AI 通道准备中'}
          <span>→</span>
        </button>
        <button className="hero-secondary" onClick={onNewGame}>
          <span>自定义阵容 · 6 / 8 / 9 / 10 / 12 人</span>
          <span>›</span>
        </button>
        {startError ? <p className="lg-hint" style={{ color: 'var(--wolf)' }}>开局失败：{startError}</p> : null}
      </div>

      {resumeId ? (
        <div className="resume-card">
          <div className="resume-left">
            <span className="icon">⏸️</span>
            <div className="resume-text">
              <b>进行中 · 有一局没打完</b>
              <span>刷新不丢进度 · 对局存在服务端</span>
            </div>
          </div>
          <div className="resume-actions">
            <button className="resume-drop" onClick={() => void dropGame()} aria-label="结束这一局">
              ✕
            </button>
            <button className="resume-go" onClick={resumeGame}>
              继续
            </button>
          </div>
        </div>
      ) : null}

      <AccountCard />

      <div className="stats-card">
        <div className="stat">
          <b>{totalGames}</b>
          <span>总对局</span>
        </div>
        <div className="stat-div" />
        <div className="stat good">
          <b>{goodRate}%</b>
          <span>好人胜率</span>
        </div>
        <div className="stat-div" />
        <div className="stat gold">
          <b>{wolfRate}%</b>
          <span>狼人胜率</span>
        </div>
      </div>

      <div className="live-head">
        <div className="live-head-left">
          <span className="dot" />
          <b>正在进行</b>
          <span>{liveTotal} 局 · 可随时观战</span>
        </div>
        <button className="live-all" onClick={onOpenLobby}>
          全部 <span>›</span>
        </button>
      </div>

      <div className="live-cards">
        {live.length === 0 ? (
          <div className="live-empty">暂时没有进行中的对局，开一局就有观众了</div>
        ) : (
          live.map((game, index) => (
            <button
              key={game.gameId}
              className={index === 0 ? 'live-card' : 'live-card good'}
              onClick={() => onWatch(game.gameId)}
            >
              <div className="lc-top">
                <span className="lc-stage">{game.phaseLabel}</span>
                <span className="lc-view">👁 {game.spectators}</span>
              </div>
              <div className="lc-mid">
                <div className="lc-avas">
                  <div className="lc-ava">{game.hasHuman ? '🙋' : '🕶️'}</div>
                  <div className="lc-ava">🍊</div>
                  <div className="lc-ava">🧊</div>
                </div>
                <p className="lc-name">{game.host} 的局</p>
              </div>
              <div className="lc-bar">
                <div className="lc-track">
                  <div
                    className="lc-fill"
                    style={{ width: `${Math.round((game.alive / Math.max(1, game.players)) * 100)}%` }}
                  />
                </div>
                <span className="lc-alive">
                  {game.alive}/{game.players}
                </span>
              </div>
              <div className="lc-bottom">
                <span className="lc-hint">{game.isFinal ? '决赛圈' : game.hasHuman ? '真人玩家局' : 'AI 补位局'}</span>
                <span className="lc-watch">观战 ›</span>
              </div>
            </button>
          ))
        )}
      </div>

      <button className="replay-row" onClick={onOpenLobby}>
        <span>🎬</span>
        <span>今日 {totalGames} 局已结束 · 进大厅看全部对局</span>
        <span className="arrow">›</span>
      </button>

      <footer className="d-footer">
        <p>by domonic · 17aitech.com</p>
        <p>
          WorkBuddy 1024 造物挑战 · v{APP_VERSION}
          {env === 'staging' ? ' · STAGING' : ''}
        </p>
      </footer>
    </section>
  );
}
