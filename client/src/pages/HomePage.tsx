import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Footer } from '../components/Footer';
import { LiveList } from '../components/LiveList';
import { MatchWall } from '../components/MatchWall';
import { ResumeBanner } from '../components/ResumeBanner';
import { RulesPanel } from '../components/RulesPanel';
import { useHomeData } from '../hooks/useHomeData';
import { STORAGE_KEY, useGameStore } from '../store/gameStore';

const APP_VERSION = __APP_VERSION__;

export function HomePage({ onWatch }: { onWatch: (gameId: string) => void }): JSX.Element {
  const open = useGameStore((s) => s.open);
  const data = useHomeData();

  const [name, setName] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);

  /* 断线恢复：本地存的对局 id 若在服务端仍进行中，则展示恢复入口 */
  useEffect(() => {
    let cancelled = false;
    const saved = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    })();
    if (!saved) return;

    void api
      .snapshot(saved)
      .then((snapshot) => {
        if (cancelled) return;
        if (snapshot.winner || snapshot.aborted || snapshot.phase === 'over') {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        setResumeId(saved);
      })
      .catch(() => {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const startGame = async (): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      const result = await api.createGame(name.trim() || '你');
      open(result.gameId);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : '开局失败');
    } finally {
      setStarting(false);
    }
  };

  const dropGame = async (): Promise<void> => {
    if (!resumeId) return;
    try {
      await api.quit(resumeId);
    } catch {
      /* 对局可能已结束，忽略 */
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setResumeId(null);
  };

  const llm = data.health?.llm;
  const dotClass = data.healthError ? 'bad' : llm?.ok ? 'ok' : 'warn';
  const statusText = data.healthError
    ? `服务不可达：${data.healthError}`
    : llm
      ? llm.ok
        ? `大模型通道正常 · ${llm.sec}s · ${llm.model}（服务端调用）`
        : `大模型通道异常：${llm.error ?? '未知'}`
      : '正在检测服务与大模型通道…';

  const stats = data.matches?.stats;

  return (
    <section className="screen">
      <div className="hero">
        <div className="hero-glow" />
        <div className="logo">🐺</div>
        <h1>AI 狼人杀</h1>
        <p className="tagline">Agent 补位局 · 一个人也能开桌</p>
        <p className="sub">5 个 AI 玩家各有性格和记忆，会撒谎、会结盟、会翻车 · 游戏逻辑运行在服务端</p>
      </div>

      {resumeId ? <ResumeBanner onResume={() => open(resumeId)} onDrop={() => void dropGame()} /> : null}

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
          <button className="btn primary" disabled={starting} onClick={() => void startGame()}>
            {starting ? '开局中…' : '开始一局'}
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
          {data.models.length === 0 ? <option value="">加载模型列表…</option> : null}
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
        <p className="hint">🚀 多人真人房（好友同局）已预留入口，敬请期待。</p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">🔥 正在进行（可观战）</span>
          <span className="panel-sub">{data.live ? `${data.live.games.length} 局` : ''}</span>
        </div>
        <LiveList games={data.live?.games ?? null} onWatch={onWatch} />
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
      <Footer version={APP_VERSION} />
    </section>
  );
}
