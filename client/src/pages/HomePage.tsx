import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../auth/useSession';
import { AccountCard } from '../components/AccountCard';
import { Avatar } from '../components/Avatar';
import { SiteFooter } from '../components/SiteFooter';
import { Icon } from '../components/Icon';
import { useHomeData } from '../hooks/useHomeData';
import { clearSavedGame, readSavedGame } from '../lib/storage';
import { useGameStore } from '../store/gameStore';

/**
 * 首页（设计规范 v2「夜席」）。
 * 主视觉是月夜狼影插画，文字压在暗部；人物用插画头像，界面图标用 SVG，不再出现 emoji。
 */
interface HomePageProps {
  onWatch: (gameId: string) => void;
  onOpenLobby: () => void;
  /** 开始一局：进配置页（选人数/牌组），不在首页直接开局 */
  onNewGame: () => void;
  /** 登录入口（可选增强，不做登录墙） */
  onOpenLogin: () => void;
  /** 我的战绩（#me）：登录后才有的入口 */
  onOpenStats: () => void;
}

export function HomePage({ onWatch, onOpenLobby, onNewGame, onOpenLogin, onOpenStats }: HomePageProps): JSX.Element {
  const open = useGameStore((s) => s.open);
  const data = useHomeData();
  const { signedIn } = useSession();

  const [quickStarting, setQuickStarting] = useState(false);
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

  /* 快速开始（6 人）：跳过配置页直接按服务端默认阵容开局。T016 旧路径保留 */
  const quickStart = async (): Promise<void> => {
    setQuickStarting(true);
    setStartError(null);
    try {
      const result = await api.createGame({ playerName: '你' });
      open(result.gameId, { token: result.playerToken });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '开局失败');
    } finally {
      setQuickStarting(false);
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
      ? '服务不可达，正在重试'
      : '正在连接服务'
    : llm?.state === 'initializing'
      ? 'AI 通道启动中'
      : aiReady
        ? '5 名 AI 已就位'
        : 'AI 通道不可用';
  const badgeTone = aiReady ? 'ok' : data.health ? 'bad' : 'warn';

  return (
    <section className="screen page-home">
      <div className="home-top">
        <div className="home-brand">
          <div className="home-brand-logo" aria-hidden>
            狼
          </div>
          <div className="home-brand-text">
            <b>AI 狼人杀</b>
            <span>Agent 补位局</span>
          </div>
        </div>
        <div className="home-actions">
          <button className="home-lobby-btn" onClick={onOpenLobby}>
            大厅
          </button>
          <button
            className="home-avatar"
            onClick={onOpenLogin}
            aria-label={signedIn ? '已登录，查看账号' : '登录'}
          >
            <Icon name={signedIn ? 'shieldCheck' : 'villager'} size={16} />
          </button>
        </div>
      </div>

      <div className="hero-card">
        <div className="hero-art" aria-hidden />
        <div className="hero-body">
        <div className="hero-badge">
          <span className={`dot ${badgeTone}`} />
          <span>{badgeText}</span>
        </div>
        <div className="hero-title">
          <b>五个会说谎的 AI</b>
          <b>等你入席</b>
        </div>
        <p className="hero-desc">发言、怀疑、投票都由大模型当场生成，没有一句写死的台词</p>
        <div className="hero-cast">
          <div className="hero-cast-avas">
            {['老K', '小满', '阿岚', '豆豆', '七喜'].map((name, index) => (
              <Avatar key={name} name={name} seat={index + 1} size={26} />
            ))}
          </div>
          <p className="hero-cast-names">老K · 小满 · 阿岚 · 豆豆 · 七喜</p>
        </div>
        <button className="hero-start" disabled={!aiReady} onClick={onNewGame}>
          {aiReady ? '开始一局' : 'AI 通道准备中'}
          <Icon name="chevronRight" size={16} />
        </button>
        <button
          className="hero-secondary"
          disabled={quickStarting || !aiReady}
          onClick={() => void quickStart()}
        >
          <span>{quickStarting ? '开局中…' : '快速开始 · 默认 6 人标准局'}</span>
          <Icon name="chevronRight" size={12} />
        </button>
        {startError ? <p className="login-msg err">开局失败：{startError}</p> : null}
        </div>
      </div>

      {resumeId ? (
        <div className="resume-card">
          <div className="resume-left">
            <span className="icon">
              <Icon name="pause" size={16} />
            </span>
            <div className="resume-text">
              <b>有一局还没打完</b>
              <span>进度存在服务端，刷新不丢</span>
            </div>
          </div>
          <div className="resume-actions">
            <button className="resume-drop" onClick={() => void dropGame()} aria-label="结束这一局">
              <Icon name="close" size={14} />
            </button>
            <button className="resume-go" onClick={resumeGame}>
              继续
            </button>
          </div>
        </div>
      ) : null}

      <AccountCard onOpenStats={onOpenStats} />

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
          <b>进行中</b>
          <span>{liveTotal} 局可观战</span>
        </div>
        <button className="live-all" onClick={onOpenLobby}>
          全部 <Icon name="chevronRight" size={12} />
        </button>
      </div>

      <div className="live-cards">
        {live.length === 0 ? (
          <div className="live-empty">此刻没有进行中的对局。开一局，第一个观众就是你。</div>
        ) : (
          live.map((game, index) => (
            <button
              key={game.gameId}
              className={index === 0 ? 'live-card' : 'live-card good'}
              onClick={() => onWatch(game.gameId)}
            >
              <div className="lc-top">
                <span className="lc-stage">{game.phaseLabel}</span>
                <span className="lc-view">
                  <Icon name="eye" size={11} /> {game.spectators}
                </span>
              </div>
              <div className="lc-mid">
                <div className="lc-avas">
                  <Avatar name={game.host} seat={1} isHuman={game.hasHuman} size={20} />
                  <Avatar name="老K" seat={2} size={20} />
                  <Avatar name="小满" seat={3} size={20} />
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
        <Icon name="note" size={13} />
        <span>今日 {totalGames} 局已结束 · 进大厅看全部对局</span>
        <span className="arrow">›</span>
      </button>

      <SiteFooter env={env} />
    </section>
  );
}
