import { useEffect, useMemo, useState } from 'react';
import { ROLES } from '@shared/roles';
import type { GameEvent } from '@shared/types';
import { api } from '../api/client';
import { Icon, roleIcon } from '../components/Icon';
import { RoundTimeline } from '../components/RoundTimeline';
import { ShareSheet } from '../components/ShareSheet';
import { useSession } from '../auth/useSession';
import { downloadBlob, pickCardQuote, renderShareCard } from '../lib/share-card';
import { qrDataUrl, siteOrigin, withShareCode } from '../lib/share';
import { useDocTitle } from '../lib/doc-title';
import { readShareCode } from '../lib/url';
import { timelineFromRecords, timelineFromReview } from '../lib/timeline';
import { useGameStore } from '../store/gameStore';

export function ResultPage({ onOpenStats }: { onOpenStats?: () => void } = {}): JSX.Element {
  const events = useGameStore((s) => s.events);
  const snapshot = useGameStore((s) => s.snapshot);
  const spectate = useGameStore((s) => s.spectate);
  const watching = useGameStore((s) => s.watching);
  const close = useGameStore((s) => s.close);
  const { signedIn } = useSession();
  const [mine, setMine] = useState<{ total: number; wins: number } | null>(null);

  /* 登录后看得到自己的累计战绩；未登录不请求，也不显示这块 */
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void api
      .matches(true)
      .then((res) => {
        if (!cancelled) setMine(res.mine ?? null);
      })
      .catch(() => {
        /* 战绩拿不到不影响结算页 */
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  /* 观战者只有上帝视角投影；玩家只有公开复盘 —— 两种来源整成同一套渲染结构 */
  const timeline = useMemo(
    () => (watching ? timelineFromRecords(spectate?.timeline ?? []) : timelineFromReview(snapshot?.review ?? [])),
    [watching, spectate?.timeline, snapshot?.review],
  );

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
          <div className="result-icon">
            <Icon name="info" size={30} />
          </div>
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
            {watching ? '离开观战' : '再来一局'}
          </button>
        </div>
      </section>
    );
  }

  const { winner, reveal, thoughts, log } = over.payload;
  useDocTitle(winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利');
  const myRole = watching ? null : snapshot?.myRole ?? null;
  const humanWin = myRole ? (winner === 'good') === (myRole !== 'wolf') : false;

  return (
    <section className="screen">
      <div className="result-hero">
        <div className="result-icon" style={{ color: humanWin ? 'var(--brass)' : 'var(--ember)' }}>
          <Icon name={humanWin ? 'crown' : 'skull'} size={34} />
        </div>
        <h2 style={{ color: winner === 'good' ? 'var(--good)' : 'var(--wolf)' }}>
          {winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利'}
        </h2>
        <p>
          {myRole
            ? `你扮演 ${ROLES[myRole].name}，${humanWin ? '这一局站对了边' : '这局输了 —— 复盘里能看到 AI 怎么骗你的'}。`
            : watching
              ? '你是这一局的观众 —— 下面是上帝视角复盘。'
              : ''}
        </p>
      </div>

      {/* 观战者没有身份，不做战绩卡 */}
      {myRole ? (
        <ResultCard
          winner={winner}
          roleName={ROLES[myRole].name}
          rounds={snapshot?.round ?? 0}
          reveal={reveal}
          log={log}
          playerName={reveal.find((row) => row.isHuman)?.name ?? '你'}
        />
      ) : null}

      <div className="panel">
        <div className="panel-title">身份揭晓</div>
        <div className="reveal-list">
          {reveal.map((row) => (
            <div key={row.id} className="reveal">
              <span className="e">
                <Icon name={roleIcon(row.role)} size={16} />
              </span>
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
        <div className="panel-title">回合时间轴</div>
        <RoundTimeline entries={timeline} detailed={watching} />
      </div>

      <div className="panel">
        <div className="panel-title">AI 内心戏</div>
        <div className="thoughts">
          {thoughts.length === 0 ? <div className="empty">这一局 AI 没留下内心记录</div> : null}
          {thoughts.map((item) => (
            <div key={item.name} className="thought">
              <div className="h">
                <Icon name="seal" size={12} />
                {item.name} <span className="role">{ROLES[item.role].name}</span>
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

      {mine && mine.total > 0 ? (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">我的累计战绩</span>
            {onOpenStats ? (
              <button className="panel-more" onClick={onOpenStats}>
                全部战绩
                <Icon name="chevronRight" size={11} />
              </button>
            ) : null}
          </div>
          <div className="lobby-stats" style={{ marginTop: 10, marginBottom: 0 }}>
            <div className="lobby-stat">
              <b>{mine.total}</b>
              <span>总对局</span>
            </div>
            <div className="lobby-stat">
              <b>{mine.wins}</b>
              <span>胜场</span>
            </div>
            <div className="lobby-stat">
              <b>{Math.round((mine.wins / mine.total) * 100)}%</b>
              <span>胜率</span>
            </div>
          </div>
        </div>
      ) : null}

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

/* -------------------------------------------------------------- 战绩卡 */

/**
 * 战绩卡面板。
 *
 * 单独一个组件不是为了好看：canvas 生成与弹层状态都是 hooks，
 * 而父组件在「没有结算结果」时会提前 return —— hooks 写在它后面会违反调用顺序。
 */
function ResultCard({
  winner,
  roleName,
  rounds,
  reveal,
  log,
  playerName,
}: {
  winner: 'good' | 'wolf';
  roleName: string;
  rounds: number;
  reveal: { name: string; alive: boolean; isHuman: boolean }[];
  log: string[];
  playerName: string;
}): JSX.Element {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const shareCode = readShareCode(window.location.search);
  const url = withShareCode(siteOrigin(), shareCode);
  const qr = useMemo(() => qrDataUrl(url), [url]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const drawn = await renderShareCard({
        winner,
        roleName,
        rounds,
        survivors: reveal.filter((row) => row.alive).length,
        players: reveal.filter((row) => !row.isHuman).map((row) => row.name),
        quote: pickCardQuote(log, playerName),
        qrUrl: url,
        host: window.location.host,
        qrImage: qr || undefined,
      });
      if (cancelled) return;
      if (!drawn) {
        setError('这个浏览器不支持生成图片，可以改用「复制链接」分享');
        return;
      }
      setBlob(drawn);
      setPreview(URL.createObjectURL(drawn));
    })();
    return () => {
      cancelled = true;
    };
  }, [winner, roleName, rounds, reveal, log, playerName, url, qr]);

  /* objectURL 手动回收，否则连打几局会攒内存 */
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const save = (): void => {
    if (blob) downloadBlob(blob, '狼人杀战绩.png');
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">战绩卡</span>
        <span className="panel-sub">可直接发给朋友</span>
      </div>

      {preview ? (
        <img className="card-preview" src={preview} alt="本局战绩卡" />
      ) : (
        <div className="lb-empty">{error ?? '正在生成…'}</div>
      )}

      <div className="card-actions">
        <button className="btn ghost" style={{ flex: 1 }} disabled={!blob} onClick={save}>
          保存图片
        </button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => setOpen(true)}>
          分享给朋友
        </button>
      </div>

      <ShareSheet
        open={open}
        title="把这一局发给朋友"
        hint="对方点开能看这局的上帝视角，也能自己开一局。"
        url={url}
        text={`我刚打完一局狼人杀：${winner === 'good' ? '好人赢了' : '狼人赢了'}，我扮演${roleName}。`}
        qr={qr}
        file={blob ? new File([blob], '狼人杀战绩.png', { type: 'image/png' }) : undefined}
        extra={blob ? { label: '保存战绩卡', onClick: save } : undefined}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
