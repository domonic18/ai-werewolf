import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { EventLog } from '../components/EventLog';
import { PromptPanel } from '../components/PromptPanel';
import { SeatGrid } from '../components/SeatGrid';
import { SpeechLog } from '../components/SpeechLog';
import { SpeechOrderBar } from '../components/SpeechOrderBar';
import { roundBadge } from '../lib/format';
import { buildStage, speakingPlayerId } from '../lib/stage';
import { useGameStore } from '../store/gameStore';
import { ROLES } from '@shared/roles';
import type { GameEvent } from '@shared/types';

type Tab = 'speech' | 'events';

export function MatchPage({ lost }: { lost: boolean }): JSX.Element {
  const gameId = useGameStore((s) => s.gameId);
  const watching = useGameStore((s) => s.watching);
  const snapshot = useGameStore((s) => s.snapshot);
  const events = useGameStore((s) => s.events);
  const close = useGameStore((s) => s.close);

  const [tab, setTab] = useState<Tab>('speech');
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);

  const players = snapshot?.players ?? [];
  const names = useMemo(() => players.map((p) => p.name), [players]);
  const myId = players.find((p) => p.isHuman)?.id ?? null;
  const speakingId = speakingPlayerId(events);

  const orderEvent = [...events]
    .reverse()
    .find((e): e is Extract<GameEvent, { type: 'speech-order' }> => e.type === 'speech-order');
  const order = orderEvent?.payload.order ?? [];

  const spokenIds = useMemo(() => {
    const set = new Set<number>();
    for (const event of events) {
      if (event.type === 'speech' && event.payload.round === snapshot?.round) set.add(event.payload.playerId);
    }
    return set;
  }, [events, snapshot?.round]);

  const stage = buildStage(events, snapshot);
  const pending = watching ? null : snapshot?.pendingAction ?? null;
  const promptKey = pending ? `${snapshot?.round}-${pending.kind}-${pending.prompt.title}-${pending.options.length}` : null;
  /* 有未回答的挂起动作时，舞台让位给 prompt：标题/说明都来自服务端，避免两份文案走偏 */
  const activePrompt = pending && promptKey !== answeredKey ? pending : null;

  const submit = async (value: string | number | null): Promise<void> => {
    if (!gameId) return;
    setAnsweredKey(promptKey);
    try {
      await api.action(gameId, value);
    } catch {
      /* 挂起点可能已变化（例如超时），下一轮轮询会给出真实状态 */
      setAnsweredKey(null);
    }
  };

  const quit = async (): Promise<void> => {
    if (!gameId) return;
    if (!window.confirm('确定退出这一局？退出后进度不会保留。')) return;
    try {
      await api.quit(gameId);
    } catch {
      /* ignore */
    }
    close();
  };

  const roleChip = watching
    ? '👁 观战模式'
    : snapshot?.myRole
      ? `你是 ${ROLES[snapshot.myRole].emoji} ${ROLES[snapshot.myRole].name}`
      : '—';

  return (
    <section className="screen">
      <div className="topbar">
        <div className="round-badge">{snapshot ? roundBadge(snapshot.phase, snapshot.round) : '准备中'}</div>
        <div className="role-chip">
          <b>{roleChip}</b>
        </div>
        <button className="btn ghost small" onClick={() => void quit()}>
          退出
        </button>
      </div>

      {lost ? (
        <div className="panel abort-box">
          <div className="panel-title">对局已失效</div>
          <p className="hint">服务端已清理这局（超过 2 小时或服务重启）。回首页可以开新的一局。</p>
          <button className="btn primary" onClick={close}>
            回首页
          </button>
        </div>
      ) : null}

      <SeatGrid players={players} myId={myId} speakingId={speakingId} />

      <div className="stage">
        <SpeechOrderBar order={order} speakingId={speakingId} spokenIds={spokenIds} />
        <div className="stage-title">{activePrompt ? activePrompt.prompt.title : stage.title}</div>
        <div className="stage-body">
          {activePrompt ? <div dangerouslySetInnerHTML={{ __html: activePrompt.prompt.html }} /> : stage.body}
        </div>
        {activePrompt ? (
          <PromptPanel key={promptKey ?? 'prompt'} pending={activePrompt} onSubmit={(value) => void submit(value)} />
        ) : null}
      </div>

      <div className="logbox">
        <div className="tabs">
          <button className={`tab ${tab === 'speech' ? 'active' : ''}`} onClick={() => setTab('speech')}>
            🗣 发言记录
          </button>
          <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>
            📋 事件记录
          </button>
        </div>
        {tab === 'speech' ? <SpeechLog events={events} names={names} /> : <EventLog events={events} />}
      </div>
    </section>
  );
}
