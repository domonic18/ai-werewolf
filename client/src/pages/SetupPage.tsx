import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Footer } from '../components/Footer';
import type { RoleKey, RolesResponse } from '@shared/types';

const APP_VERSION = __APP_VERSION__;

const CHOICES = [6, 8, 9, 10, 12];

interface SetupPageProps {
  onBack: () => void;
  onStarted: (gameId: string, playerToken: string) => void;
}

/**
 * 建局配置：人数 + 牌组。
 *
 * 推荐牌组来自服务端 `GET /api/roles`（与引擎校验同一套 catalog 数据），
 * 前端不自己算分档，避免两边各写一份规则后漂移。
 * 客户端只做「能不能点开始」的即时提示，真正的校验在服务端。
 */
export function SetupPage({ onBack, onStarted }: SetupPageProps): JSX.Element {
  const [players, setPlayers] = useState(6);
  const [data, setData] = useState<RolesResponse | null>(null);
  const [deck, setDeck] = useState<Partial<Record<RoleKey, number>>>({});
  const [name, setName] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (count: number) => {
    setError(null);
    try {
      const result = await api.roles(count);
      setData(result);
      /* 换人数时直接套用推荐牌组 */
      const next: Partial<Record<RoleKey, number>> = {};
      for (const slot of result.recommended) next[slot.key] = slot.count;
      setDeck(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '角色库加载失败');
    }
  }, []);

  useEffect(() => {
    void load(players);
  }, [load, players]);

  const total = useMemo(() => Object.values(deck).reduce<number>((a, n) => a + (n ?? 0), 0), [deck]);
  const wolves = useMemo(() => {
    if (!data) return 0;
    const wolfKeys = new Set(data.available.filter((c) => c.team === 'wolf').map((c) => c.key));
    return Object.entries(deck)
      .filter(([key]) => wolfKeys.has(key as RoleKey))
      .reduce<number>((a, [, n]) => a + (n ?? 0), 0);
  }, [data, deck]);

  const problem = useMemo(() => {
    if (!data) return '角色库加载中…';
    if (total !== players) return `角色数量 ${total} 人，与所选人数 ${players} 人不一致`;
    if (wolves < 2) return '狼人至少 2 名';
    if (wolves * 2 >= players) return '狼人不能达到半数';
    return null;
  }, [data, players, total, wolves]);

  const bump = (key: RoleKey, delta: number): void => {
    setDeck((prev) => {
      const next = { ...prev };
      const value = Math.max(0, (next[key] ?? 0) + delta);
      if (value === 0) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const start = async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      const payload = Object.entries(deck).map(([key, count]) => ({ key, count: count ?? 0 }));
      const result = await api.createGame({ playerName: name.trim() || '你', deck: payload });
      onStarted(result.gameId, result.playerToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : '开局失败');
    } finally {
      setStarting(false);
    }
  };

  return (
    <section className="screen">
      <div className="topbar">
        <button className="btn ghost small" onClick={onBack}>
          ‹ 返回
        </button>
        <div className="lobby-title">新建对局</div>
        <span style={{ width: 44 }} />
      </div>

      <div className="panel">
        <div className="panel-title">人数</div>
        <div className="chips" style={{ marginTop: 8 }}>
          {CHOICES.map((count) => (
            <button
              key={count}
              className={`chip ${players === count ? 'active' : ''}`}
              onClick={() => setPlayers(count)}
            >
              {count} 人
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          真人为 1 席，其余由 AI 补位。人数越多，神职越全，局也越长。
        </p>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">牌组</span>
          <span className="panel-sub">
            {total}/{players} 人{wolves ? ` · ${wolves} 狼` : ''}
          </span>
        </div>

        {!data ? <div className="empty">读取角色库…</div> : null}

        {data ? (
          <>
            {data.available.map((card) => {
              const count = deck[card.key] ?? 0;
              return (
                <div key={card.key} className="role-row">
                  <span className="role-emoji">{card.emoji}</span>
                  <span className="role-main">
                    <span className="role-name">
                      {card.name}
                      {card.team === 'wolf' ? <em className="lobby-flag">狼</em> : null}
                    </span>
                    <span className="role-ability">{card.ability}</span>
                  </span>
                  <span className="stepper">
                    <button className="step-btn" onClick={() => bump(card.key, -1)} disabled={count <= 0}>
                      −
                    </button>
                    <b>{count}</b>
                    <button className="step-btn" onClick={() => bump(card.key, 1)}>
                      ＋
                    </button>
                  </span>
                </div>
              );
            })}

            {data.locked.length ? (
              <>
                <div className="panel-title" style={{ marginTop: 14, fontSize: 12 }}>
                  暂不可用
                </div>
                {data.locked.map((card) => (
                  <div key={card.key} className="role-row locked">
                    <span className="role-emoji">{card.emoji}</span>
                    <span className="role-main">
                      <span className="role-name">{card.name}</span>
                      <span className="role-ability">
                        {card.implemented ? `需要 ${card.minPlayers} 人` : `${card.minPlayers} 人开放 · 开发中`}
                      </span>
                    </span>
                    <span className="role-lock">🔒</span>
                  </div>
                ))}
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="panel">
        <label className="field-label" htmlFor="setupName">
          你的代号
        </label>
        <input
          id="setupName"
          className="input"
          maxLength={8}
          placeholder="留空则叫「你」"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '100%', marginBottom: 12 }}
        />
        {problem ? <p className="hint">⚠ {problem}</p> : null}
        {error ? <p className="hint" style={{ color: 'var(--wolf)' }}>开局失败：{error}</p> : null}
        <button className="btn primary big" disabled={Boolean(problem) || starting} onClick={() => void start()}>
          {starting ? '开局中…' : '开始对局'}
        </button>
      </div>

      <Footer version={APP_VERSION} />
    </section>
  );
}
