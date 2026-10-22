import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { Avatar } from '../components/Avatar';
import { Icon, roleIcon } from '../components/Icon';
import { NightCurtain } from '../components/NightCurtain';
import { nightCuesForRound, nightLabel, shouldRaiseCurtain } from '../lib/night';
import { playDawnChime, setSoundEnabled, soundEnabled } from '../lib/sound';
import { highlightNames } from '../lib/highlight';
import { roundBadge } from '../lib/format';
import { deriveVoteTally } from '../lib/tally';
import { speakingPlayerId } from '../lib/stage';
import type { LostReason } from '../hooks/useMatchPolling';
import { useGameStore } from '../store/gameStore';
import { ROLES } from '@shared/roles';
import type { GameEvent, Phase } from '@shared/types';

const APP_VERSION = __APP_VERSION__;
const QUICK_LINES = ['我是平民', '我怀疑他', '我先过'];
const CHAT_LIMIT = 6;

interface MatchPageProps {
  lost: boolean;
  lostReason: LostReason;
}

type Seat = {
  id: number;
  seat: number;
  name: string;
  emoji: string;
  alive: boolean;
  isHuman: boolean;
  role?: string | null;
};

/**
 * 对局中（设计规范 v2「夜席」）：玩家视角与观战视角。
 * 观战走 SpectateView，对齐 04-spectate.html —— 两屏数据源互斥（私有快照 / 上帝视角），
 * 所以分成两个组件，绝不在一个组件里互相兜底。
 */
export function MatchPage({ lost, lostReason }: MatchPageProps): JSX.Element {
  const watching = useGameStore((s) => s.watching);
  const spectate = useGameStore((s) => s.spectate);

  if (lost) return <LostCard lostReason={lostReason} />;
  /* 观战用上帝视角投影（含身份），玩家视角的身份由 snapshot 自己管，两者不混用 */
  if (watching) return <SpectateView players={(spectate?.players ?? []) as unknown as Seat[]} />;
  return <PlayView />;
}

function LostCard({ lostReason }: { lostReason: LostReason }): JSX.Element {
  const close = useGameStore((s) => s.close);
  return (
    <section className="screen page-game">
      <div className="su-card" style={{ marginTop: 20 }}>
        <div className="su-head">
          <b>{lostReason === 'unauthorized' ? '对局凭证失效' : '对局已失效'}</b>
        </div>
        <p className="lg-hint" style={{ fontSize: 12, lineHeight: 1.7 }}>
          {lostReason === 'unauthorized'
            ? '这一局的玩家凭证不在这台设备上（换了设备或清了浏览器存档）。为了不让别人替你操作，服务端不会接受没有凭证的请求。'
            : '服务端已清理这局（超过 2 小时或服务重启）。'}
        </p>
        <button className="btn-create" onClick={close}>
          回首页
        </button>
      </div>
    </section>
  );
}

/** 发言列表 → 聊天气泡（只取最近几条，长局不撑爆屏幕） */
function useMessages(events: GameEvent[]) {
  return useMemo(() => {
    const speeches = events.filter((e): e is Extract<GameEvent, { type: 'speech' }> => e.type === 'speech');
    return speeches.slice(-CHAT_LIMIT);
  }, [events]);
}

function ChatBubbles({ events, names }: { events: GameEvent[]; names: string[] }): JSX.Element {
  const messages = useMessages(events);
  if (!messages.length) {
    return (
      <div className="ig-chat">
        <div className="ig-sys">天亮了，等第一个人开口</div>
      </div>
    );
  }
  return (
    <div className="ig-chat">
      {messages.map((event) => {
        const p = event.payload;
        return (
          <div key={event.seq} className={p.isHuman ? 'ig-msg me' : 'ig-msg'}>
            <div className="ig-msg-head">
              <Avatar name={p.name} seat={p.playerId} isHuman={p.isHuman} size={20} />
              <span className="nm">{p.isHuman ? '你' : p.name}</span>
              {p.order ? (
                <span className="tag">
                  {p.order}/{p.total} 位
                </span>
              ) : null}
            </div>
            <div className="ig-bubble">{highlightNames(p.text, names)}</div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 夜晚过场的状态门控：这一夜要不要拉起夜幕、演到哪、演完记住。
 * 两个视角（玩家 / 观战）共用一套规则，避免「观战有戏、自己打没有」。
 */
function useNight(phase: Phase, round: number, events: GameEvent[], hasPending: boolean) {
  const [watchedRound, setWatchedRound] = useState(0);
  const [openRound, setOpenRound] = useState<number | null>(null);
  const cues = useMemo(() => nightCuesForRound(events, round), [events, round]);

  /* 口令一到达就拉起夜幕；同一夜只拉一次，跳过/演完都记进 watchedRound */
  useEffect(() => {
    if (openRound !== null) return;
    if (shouldRaiseCurtain({ phase, round, hasPending, watchedRound, cueCount: cues.length })) {
      setOpenRound(round);
    }
  }, [phase, round, hasPending, watchedRound, cues.length, openRound]);

  return {
    openRound,
    cues,
    lastCue: cues.length ? (cues[cues.length - 1] as string) : null,
    onDone: () => {
      setOpenRound(null);
      setWatchedRound(round);
    },
  };
}

/** 天亮的一记上行动机：过场落幕、白天开场时响一次 */
function useDawnChime(phase: Phase): void {
  const prev = useRef<Phase | null>(null);
  useEffect(() => {
    if (prev.current === 'night' && phase === 'day') playDawnChime();
    prev.current = phase;
  }, [phase]);
}

/**
 * 夜幕条：过场演完（或玩家跳过）后，夜里的常驻状态。
 * 没有它，长夜里整屏只剩上一轮的旧发言，看起来像卡住了。
 */
function NightStrip({ round, cue }: { round: number; cue: string | null }): JSX.Element {
  const [on, setOn] = useState(() => soundEnabled());
  const toggle = (): void => {
    const next = !on;
    setOn(next);
    setSoundEnabled(next);
  };
  return (
    <div className="ig-night">
      <div className="ig-night-head">
        <span className="ig-night-title">
          <Icon name="cloudNight" size={14} />
          <span>{nightLabel(round)}</span>
        </span>
        <button
          className="ig-night-sound"
          onClick={toggle}
          aria-label={on ? '静音' : '开启声音'}
          title={on ? '静音' : '开启声音'}
        >
          <Icon name={on ? 'sound' : 'mute'} size={13} />
        </button>
      </div>
      <p className="ig-night-cue">{cue ?? '天黑请闭眼'}</p>
      <p className="ig-night-hint">AI 正在夜里行动，结果天亮后公布</p>
    </div>
  );
}

/* -------------------------------------------------------------- 玩家视角 */

function PlayView(): JSX.Element {
  const gameId = useGameStore((s) => s.gameId);
  const token = useGameStore((s) => s.token);
  const snapshot = useGameStore((s) => s.snapshot);
  const events = useGameStore((s) => s.events);
  const close = useGameStore((s) => s.close);

  const [answeredKey, setAnsweredKey] = useState<string | null>(null);
  const [text, setText] = useState('');

  const players: Seat[] = snapshot?.players ?? [];
  const names = useMemo(() => players.map((p) => p.name), [players]);
  const speakingId = speakingPlayerId(events);
  const round = snapshot?.round ?? 0;
  const phase: Phase = snapshot?.phase ?? 'night';

  const orderEvent = [...events]
    .reverse()
    .find((e): e is Extract<GameEvent, { type: 'speech-order' }> => e.type === 'speech-order');
  const order = orderEvent?.payload.order ?? [];
  const spokenIds = useMemo(() => {
    const set = new Set<number>();
    for (const event of events) {
      if (event.type === 'speech' && event.payload.round === round) set.add(event.payload.playerId);
    }
    return set;
  }, [events, round]);
  const spokenCount = order.filter((seat) => spokenIds.has(seat.id)).length;

  const tally = useMemo(() => deriveVoteTally(events), [events]);
  const ranked = useMemo(
    () => Object.entries(tally.counts)
      .map(([id, votes]) => ({ id: Number(id), votes }))
      .filter((row) => row.votes > 0)
      .sort((a, b) => b.votes - a.votes),
    [tally],
  );
  const nameOf = (id: number): string => players.find((p) => p.id === id)?.name ?? `座位 ${id}`;

  const pending = snapshot?.pendingAction ?? null;
  const promptKey = pending ? `${round}-${pending.kind}-${pending.prompt.title}-${pending.options.length}` : null;
  const active = pending && promptKey !== answeredKey ? pending : null;

  /* 夜里有挂起动作（验人/用药/狼刀）时过场必须让位，否则会挡住玩家自己的决策 */
  const night = useNight(phase, round, events, Boolean(active));
  useDawnChime(phase);

  const submit = async (value: string | number | null): Promise<void> => {
    if (!gameId || !token) return;
    setAnsweredKey(promptKey);
    setText('');
    try {
      await api.action(gameId, value, token);
    } catch {
      setAnsweredKey(null); /* 挂起点可能已变化，下一轮轮询给出真实状态 */
    }
  };

  const quit = async (): Promise<void> => {
    if (!gameId || !token) return;
    if (!window.confirm('确定退出这一局？退出后进度不会保留。')) return;
    try {
      await api.quit(gameId, token);
    } catch {
      /* ignore */
    }
    close();
  };

  const alive = players.filter((p) => p.alive).length;
  const myRole = snapshot?.myRole ?? null;

  return (
    <section className="screen page-game">
      {night.openRound !== null ? (
        <NightCurtain
          round={night.openRound}
          cues={night.cues}
          phase={phase}
          hasPending={Boolean(active)}
          onDone={night.onDone}
        />
      ) : null}

      <div className="ig-status">
        <div className="ig-status-left">
          <span className="ig-badge">{roundBadge(phase, round)}</span>
          <span className="ig-badge plain">
            存活 {alive} / {players.length}
          </span>
        </div>
        <div className="ig-status-right">
          {myRole ? (
            <span className="ig-badge role">
              <Icon name={roleIcon(myRole)} size={12} />
              {ROLES[myRole].name}
            </span>
          ) : null}
          <button className="ig-quit" onClick={() => void quit()}>
            <Icon name="close" size={12} /> 退出
          </button>
        </div>
      </div>

      {order.length ? (
        <div className="ig-order">
          <div className="ig-order-head">
            <div className="ig-order-title">
              <Icon name="note" size={13} />
              <span>发言顺序</span>
            </div>
            <span className="ig-order-progress">
              第 {Math.min(spokenCount + 1, order.length)} / {order.length} 位
            </span>
          </div>
          <div className="ig-strip">
            {order.map((ref) => {
              const seat = players.find((p) => p.id === ref.id);
              if (!seat) return null;
              const classes = ['ig-seat'];
              if (ref.id === speakingId) classes.push('on');
              if (!seat.alive) classes.push('dead');
              if (spokenIds.has(ref.id)) classes.push('spoken');
              return (
                <div key={ref.id} className={classes.join(' ')}>
                  <Avatar name={seat.name} seat={seat.seat} isHuman={seat.isHuman} size={32} />
                  <span className="nm">{seat.isHuman ? '你' : seat.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 夜里始终用夜幕条：即使轮到自己行动，上面的旧发言也不该顶在行动面板前 */}
      {phase === 'night' ? <NightStrip round={round} cue={night.lastCue} /> : <ChatBubbles events={events} names={names} />}

      {ranked.length ? (
        <div className="ig-vote">
          <div className="ig-vote-left">
            <Icon name="ballot" size={13} />
            <span>实时票型</span>
          </div>
          <div className="ig-vote-right">
            <span className="top">
              {nameOf(ranked[0]!.id)} {ranked[0]!.votes} 票
            </span>
            {ranked[1] ? (
              <>
                <span className="sep">·</span>
                <span className="other">
                  {nameOf(ranked[1].id)} {ranked[1].votes} 票
                </span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {active ? (
        <div className="ig-say">
          <div className="ig-say-head">
            <div className="ig-say-title">
              <Icon name="mic" size={14} />
              <span>{active.prompt.title}</span>
            </div>
            <span className="ig-say-hint">{active.kind === 'input' ? '不发言可点「过」' : ''}</span>
          </div>
          {active.prompt.html ? (
            <p
              className="ig-say-hint"
              style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--d-sub)' }}
              dangerouslySetInnerHTML={{ __html: active.prompt.html }}
            />
          ) : null}

          {active.kind === 'input' ? (
            <>
              <textarea
                rows={3}
                maxLength={200}
                autoFocus
                placeholder="说出你的判断，AI 会据此推理…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit(text.trim() || '我这轮先过，听你们的。');
                  }
                }}
              />
              <div className="ig-quick">
                {QUICK_LINES.map((line) => (
                  <button key={line} onClick={() => setText(line)}>
                    {line}
                  </button>
                ))}
              </div>
              <div className="ig-actions">
                <button className="send" onClick={() => void submit(text.trim() || '我这轮先过，听你们的。')}>
                  发送
                </button>
                <button className="pass" onClick={() => void submit('我这轮先过，听你们的。')}>
                  过
                </button>
              </div>
            </>
          ) : active.options.length ? (
            <div className="ig-actions">
              {active.options.map((option) => (
                <button key={String(option.value)} className="choice" onClick={() => void submit(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="ig-actions">
              <button className="send" onClick={() => void submit(1)}>
                {active.prompt.confirm ?? '继续'}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <footer className="d-footer">
        <p>by domonic · 17aitech.com</p>
        <p>WorkBuddy 1024 造物挑战 · v{APP_VERSION}</p>
      </footer>
    </section>
  );
}

/* -------------------------------------------------------------- 观战视角 */

function SpectateView({ players }: { players: Seat[] }): JSX.Element {
  const spectate = useGameStore((s) => s.spectate);
  const events = useGameStore((s) => s.events);
  const close = useGameStore((s) => s.close);
  const names = useMemo(() => players.map((p) => p.name), [players]);
  const messages = useMessages(events);
  const human = players.find((p) => p.isHuman);
  const factions = spectate?.factions;
  const phase: Phase = spectate?.phase ?? 'night';
  const round = spectate?.round ?? 0;
  /* 观战没有自己的决策，永远不会因为挂起动作让位 */
  const night = useNight(phase, round, events, false);
  useDawnChime(phase);

  const roleClass = (role?: string | null): string => {
    if (!role) return '';
    if (role === 'wolf') return 'wolf';
    if (role === 'witch') return 'witch';
    if (role === 'villager') return '';
    return 'god';
  };

  return (
    <section className="screen page-game">
      {night.openRound !== null ? (
        <NightCurtain round={night.openRound} cues={night.cues} phase={phase} hasPending={false} onDone={night.onDone} />
      ) : null}

      <div className="sp-bar">
        <div className="sp-bar-left">
          <span className="sp-live">
            <i />
            <span>观战中</span>
          </span>
          <span className="sp-owner">
            {human?.name ?? '匿名'} 的对局 · {players.length} 人局
          </span>
        </div>
        <button className="ig-quit" onClick={close}>
          <Icon name="close" size={12} /> 退出
        </button>
      </div>

      <div className="sp-god">
        <div className="sp-god-head">
          <div className="sp-god-title">
            <Icon name="eye" size={14} />
            <span>上帝视角 · 身份已公开</span>
          </div>
          <em>实时</em>
        </div>
        <p>观战无需凭证、不占座位，你的任何操作都不会进入牌局，避免影响对局公平</p>
      </div>

      <div className="sp-grid">
        {players.map((player) => {
          const card = player.role ? ROLES[player.role as keyof typeof ROLES] : null;
          const classes = ['sp-seat', roleClass(player.role)];
          if (!player.alive) classes.push('dead');
          if (player.isHuman) classes.push('human');
          return (
            <div key={player.id} className={classes.filter(Boolean).join(' ')}>
              <div className="sp-seat-top">
                <span className="sp-seat-no">{player.seat} 号位</span>
                <span className="sp-seat-state">{player.alive ? '存活' : '出局'}</span>
              </div>
              <div className="sp-seat-mid">
                <Avatar name={player.name} seat={player.seat} isHuman={player.isHuman} size={22} />
                <span className="nm">{player.name}</span>
              </div>
              <div className="sp-role">
                <Icon name={roleIcon(player.role)} size={11} />
                {card ? card.name : '未知'}
              </div>
            </div>
          );
        })}
      </div>

      {factions ? (
        <div className="sp-tally">
          <div className="sp-tally-head">
            <b>阵营存活</b>
            <span>
              {roundBadge(spectate?.phase ?? 'night', spectate?.round ?? 0)}
            </span>
          </div>
          <div className="sp-row good">
            <span>好人</span>
            <div className="sp-track good">
              <i style={{ width: `${Math.round((factions.good.alive / Math.max(1, factions.good.total)) * 100)}%` }} />
            </div>
            <span>{factions.good.alive} 人</span>
          </div>
          <div className="sp-row wolf">
            <span>狼人</span>
            <div className="sp-track wolf">
              <i style={{ width: `${Math.round((factions.wolf.alive / Math.max(1, factions.wolf.total)) * 100)}%` }} />
            </div>
            <span>{factions.wolf.alive} 人</span>
          </div>
        </div>
      ) : null}

      {phase === 'night' ? <NightStrip round={round} cue={night.lastCue} /> : null}

      <div className="sp-chat">
        {messages.length === 0 ? (
          <div className="ig-sys">还没有人发言</div>
        ) : (
          messages.map((event) => {
            const p = event.payload;
            return (
              <div key={event.seq} className="sp-msg">
                <div className="sp-msg-head">
                  <Avatar name={p.name} seat={p.playerId} isHuman={p.isHuman} size={18} />
                  <span className="nm">{p.name}</span>
                </div>
                <p>{highlightNames(p.text, names)}</p>
              </div>
            );
          })
        )}
      </div>

      <footer className="d-footer">
        <p>by domonic · 17aitech.com</p>
        <p>WorkBuddy 1024 造物挑战 · v{APP_VERSION}</p>
      </footer>
    </section>
  );
}
