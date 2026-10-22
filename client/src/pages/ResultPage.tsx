import { useMemo } from 'react';
import { ROLES } from '@shared/roles';
import type { GameEvent } from '@shared/types';
import { useGameStore } from '../store/gameStore';

export function ResultPage(): JSX.Element {
  const events = useGameStore((s) => s.events);
  const snapshot = useGameStore((s) => s.snapshot);
  const close = useGameStore((s) => s.close);

  const over = useMemo(
    () => [...events].reverse().find((e): e is Extract<GameEvent, { type: 'game-over' }> => e.type === 'game-over'),
    [events],
  );
  const aborted = useMemo(
    () => [...events].reverse().find((e): e is Extract<GameEvent, { type: 'aborted' }> => e.type === 'aborted'),
    [events],
  );
  const archived = useMemo(
    () => [...events].reverse().find((e): e is Extract<GameEvent, { type: 'archived' }> => e.type === 'archived'),
    [events],
  );

  if (!over) {
    return (
      <section className="screen">
        <div className="result-hero">
          <div className="result-icon">📡</div>
          <h2>对局中止</h2>
          <p>{aborted ? aborted.payload.reason : '这一局没有正常结束'}</p>
        </div>
        <div className="panel abort-box">
          <div className="panel-title">为什么不给个"体面"的结局</div>
          <p className="hint">
            AI 的发言与行动完全依赖云服务大模型。调用失败时我们选择明确中止，而不是用写死的话术把对局演完——
            否则你玩到的就不是智能体了。
          </p>
          <button className="btn primary big" onClick={close}>
            再来一局
          </button>
        </div>
      </section>
    );
  }

  const { winner, reveal, thoughts, log } = over.payload;
  const myRole = snapshot?.myRole ?? null;
  const humanWin = myRole ? (winner === 'good') === (myRole !== 'wolf') : false;

  return (
    <section className="screen">
      <div className="result-hero">
        <div className="result-icon">{humanWin ? '🏆' : '💀'}</div>
        <h2 style={{ color: winner === 'good' ? 'var(--good)' : 'var(--wolf)' }}>
          {winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利'}
        </h2>
        <p>
          {myRole
            ? `你扮演 ${ROLES[myRole].name}，${humanWin ? '这一局站对了边' : '这局输了 —— 复盘里能看到 AI 怎么骗你的'}。`
            : ''}
        </p>
      </div>

      <div className="panel">
        <div className="panel-title">身份揭晓</div>
        <div className="reveal-list">
          {reveal.map((row) => (
            <div key={row.id} className="reveal">
              <span className="e">{ROLES[row.role].emoji}</span>
              <span className="n">
                {row.name}
                {row.isHuman ? '（你）' : ''}
              </span>
              <span className="r">
                {ROLES[row.role].name}
                {row.alive ? '' : ' · 出局'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">AI 内心戏</div>
        <div className="thoughts">
          {thoughts.length === 0 ? <div className="empty">这一局 AI 没留下内心记录</div> : null}
          {thoughts.map((item) => (
            <div key={item.name} className="thought">
              <div className="h">
                🤖 {item.name} <span className="role">{ROLES[item.role].name}</span>
              </div>
              {item.thoughts.map((thought, index) => (
                <p key={index}>
                  第{thought.round}
                  {thought.phase}：{thought.text}
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">本局记录</div>
        <div className="result-log">
          {log.map((line, index) => (
            <div key={index} className="log-item">
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <button className="btn primary big" onClick={close}>
          再来一局
        </button>
        <p className="hint">
          {archived ? (archived.payload.ok ? '战绩已存入云端' : `战绩未存档：${archived.payload.error ?? '未知'}`) : ''}
        </p>
      </div>
    </section>
  );
}
