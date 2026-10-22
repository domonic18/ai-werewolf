import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Footer } from '../components/Footer';
import { LiveList } from '../components/LiveList';
import { MatchWall } from '../components/MatchWall';
import { ResumeBanner } from '../components/ResumeBanner';
import { RulesPanel } from '../components/RulesPanel';
import { useHomeData } from '../hooks/useHomeData';
import { clearSavedGame, readSavedGame } from '../lib/storage';
import { useGameStore } from '../store/gameStore';

const APP_VERSION = __APP_VERSION__;

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

  const [name, setName] = useState('');
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
      const result = await api.createGame({ playerName: name.trim() || '你' });
      open(result.gameId, { token: result.playerToken });
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '开局失败');
    } finally {
      setStarting(false);
    }
  };

  /* 恢复必须带凭证：P0-a 之后玩家私有接口都要 X-Player-Token，漏了只会拿到 401 */
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

  /* 四种状态要分清：接口不通 / AI 通道启动中 / AI 通道不可用 / 一切正常 —— 混成一句会误导排障 */
  const dotClass = !data.health
    ? data.healthError
      ? 'bad'
      : 'warn'
    : aiReady
      ? 'ok'
      : llm?.state === 'initializing'
        ? 'warn'
        : 'bad';

  const statusText = !data.health
    ? data.healthError
      ? `服务不可达：${data.healthError}`
      : '正在检测服务与大模型通道…'
    : llm?.state === 'initializing'
      ? '服务已就绪，AI 通道正在启动（冷启动通常几秒）…'
      : llm?.state === 'failed'
        ? `AI 通道不可用：${llm.error ?? '未知'}`
        : llm?.ok
          ? `大模型通道正常 · ${llm.sec}s · ${llm.model}（服务端调用）`
          : `大模型通道异常：${llm?.error ?? '未知'}`;

  const stats = data.matches?.stats;

  return (
    <section className="screen">
      <div className="hero">
        <div className="hero-glow" />
        {env === 'staging' ? <div className="env-badge">STAGING · 测试环境（不写生产战绩）</div> : null}
        <div className="logo">🐺</div>
        <h1>AI 狼人杀</h1>
        <p className="tagline">Agent 补位局 · 一个人也能开桌</p>
        <p className="sub">5 个 AI 玩家各有性格和记忆，会撒谎、会结盟、会翻车 · 游戏逻辑运行在服务端</p>
      </div>

      {resumeId ? <ResumeBanner onResume={resumeGame} onDrop={() => void dropGame()} /> : null}

      <div className="panel">
        <label className="field-label" htmlFor="playerName">
          你的代号
        </label>
        <div className="row">
          <input
            id="playerName"
            className="input"
            maxLength={8}
            placeholder="留空则叫「你」"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" disabled={starting || !aiReady} onClick={() => void startGame()}>
            {starting ? '开局中…' : aiReady ? '快速开始（6 人）' : 'AI 通道准备中'}
          </button>
        </div>

        <label className="field-label" htmlFor="modelSelect" style={{ marginTop: 14 }}>
          AI 玩家模型（决定 5 个智能体的言行风格）
        </label>
        <select
          id="modelSelect"
          className="input"
          style={{ width: '100%' }}
          value={data.currentModel ?? ''}
          onChange={(e) => void data.selectModel(e.target.value)}
        >
          {data.models.length === 0 ? (
            <option value="">{aiReady ? '加载模型列表…' : 'AI 通道启动中…'}</option>
          ) : null}
          {data.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
              {model.credits ? ` · ${model.credits}` : ''}
            </option>
          ))}
        </select>

        <div className="ai-status">
          <span className={`dot ${dotClass}`} />
          <span>{statusText}</span>
        </div>
        {startError ? <p className="hint" style={{ color: 'var(--wolf)' }}>开局失败：{startError}</p> : null}
        <button className="btn ghost big" style={{ marginTop: 10 }} onClick={onNewGame}>
          新建对局 · 选人数与角色 ›
        </button>
        <button className="btn ghost" style={{ marginTop: 8, width: '100%' }} onClick={onOpenLogin}>
          👤 登录（跨设备继续对局 / 战绩归档）
        </button>
        <p className="hint">🚀 多人真人房（好友同局）已预留入口，敬请期待。</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">🔥 正在进行（可观战）</span>
          <button className="link-btn" onClick={onOpenLobby}>
            {data.live ? `全部 ${data.live.total} 局 ›` : '进入大厅 ›'}
          </button>
        </div>
        <LiveList games={data.live?.games.slice(0, 2) ?? null} onWatch={onWatch} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">全网战绩墙</span>
          <span className="panel-sub">
            {stats && stats.total ? `${stats.total} 局 · 好人胜率 ${Math.round((stats.good / stats.total) * 100)}%` : '0 局'}
          </span>
        </div>
        <MatchWall data={data.matches} />
      </div>

      <RulesPanel />
      <Footer version={APP_VERSION} env={env} />
    </section>
  );
}
