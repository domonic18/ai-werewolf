import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { Avatar } from '../components/Avatar';
import { Icon, roleIcon } from '../components/Icon';
import { NightCurtain } from '../components/NightCurtain';
import { ShareSheet } from '../components/ShareSheet';
import { SiteFooter } from '../components/SiteFooter';
import { nightCuesForRound, nightLabel, shouldRaiseCurtain } from '../lib/night';
import { qrDataUrl, watchUrl } from '../lib/share';
import { readShareCode } from '../lib/url';
import { playDawnChime, setSoundEnabled, soundEnabled } from '../lib/sound';
import { highlightNames } from '../lib/highlight';
import { useDocTitle } from '../lib/doc-title';
import { roundBadge } from '../lib/format';
import { deriveVoteTally } from '../lib/tally';
import { speakingPlayerId } from '../lib/stage';
import type { LostReason } from '../hooks/useMatchPolling';
import { useGameStore } from '../store/gameStore';
import { ROLES } from '@shared/roles';
import type { GameEvent, LiveSpeech, Phase } from '@shared/types';

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

/**
 * 正在输出时的句末指示：三个点依次亮。
 *
 * 之前用的是闪烁竖线（`|`），玩家第一反应是「这里可以打字」——那是个输入光标的形状。
 * 换成点阵之后语义就明确了：话还没说完，正在往外吐。
 */
function TypingDots(): JSX.Element {
  return (
    <span className="ig-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** 发言列表 → 聊天气泡（只取最近几条，长局不撑爆屏幕） */
function useMessages(events: GameEvent[]) {
  return useMemo(() => {
    const speeches = events.filter((e): e is Extract<GameEvent, { type: 'speech' }> => e.type === 'speech');
    return speeches.slice(-CHAT_LIMIT);
  }, [events]);
}

function ChatBubbles({
  events,
  names,
  live,
}: {
  events: GameEvent[];
  names: string[];
  live?: LiveSpeech | null;
}): JSX.Element {
  const messages = useMessages(events);
  if (!messages.length && !live) {
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
              <span className="nm">
                {p.name}
                {p.isHuman ? <em className="me-badge">你</em> : null}
              </span>
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

      {/* 还没吐第一个字：先给一行「正在组织语言」，避免出现只有一个边框的空框 */}
      {live && !live.text ? <div className="ig-sys">{live.name} 正在组织语言…</div> : null}

      {/* 正在生成的那一句：逐字长出来，最后一条 speech 事件到达后由 live=null 收走 */}
      {live && live.text ? (
        <div className="ig-msg streaming">
          <div className="ig-msg-head">
            <Avatar name={live.name} seat={live.playerId} isHuman={false} size={20} />
            <span className="nm">{live.name}</span>
            <span className="tag live">
              输出中
              <TypingDots />
            </span>
          </div>
          <div className="ig-bubble">{highlightNames(live.text, names)}</div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 夜晚过场的状态门控：这一夜要不要拉起夜幕、从第几句演起、演完记住。
 * 两个视角（玩家 / 观战）共用一套规则，避免「观战有戏、自己打没有」。
 *
 * 关键：按「口令数」而不是「轮次」记进度。
 * 旧写法「同一夜只演一次」会让排在最后的角色（女巫）永远赶不上 ——
 * 前面一位思考十几秒，夜幕早就到上限落幕了，后面的口令只能在扁平条里滚过去。
 */
function useNight(phase: Phase, round: number, events: GameEvent[]) {
  const cues = useMemo(() => nightCuesForRound(events, round), [events, round]);
  /*
   * 「哪一夜 + 演到第几句 + 是否跳过 + 是否正在演 + 天亮的幕是否放过了」合在一个状态里：
   * 换夜时自然失效，不需要额外的重置 effect。
   */
  const [state, setState] = useState({ round: -1, shown: 0, skipped: false, open: false, dawn: false });

  const sameRound = state.round === round;
  const shownCount = sameRound ? state.shown : 0;
  const skipped = sameRound && state.skipped;
  const dawnShown = sameRound && state.dawn;
  const open = sameRound && state.open;

  useEffect(() => {
    if (open) return;

    /* 夜里：还有没演过的口令就拉起 */
    if (shouldRaiseCurtain({ phase, shownCount, cueCount: cues.length, skipped })) {
      setState({ round, shown: shownCount, skipped, open: true, dawn: dawnShown });
      return;
    }

    /*
     * 天亮：单独放一次幕，交代「昨夜谁出局」。
     *
     * 不能只靠「夜里那次幕一直演到天亮」—— 实测线上，玩家自己用药的那一夜，
     * 幕在待决策时就收了，天亮时根本没有幕可切，天亮就只剩一行日志。
     * 条件里的 `shownCount > 0` 是为了避免「中途加载进第 N 天」时凭空弹一句天亮了。
     */
    if (phase === 'day' && !skipped && !dawnShown && shownCount > 0) {
      setState({ round, shown: shownCount, skipped, open: true, dawn: dawnShown });
    }
  }, [open, phase, round, shownCount, skipped, cues.length, dawnShown]);

  const close = (shownTotal: number, isDawn: boolean): void =>
    setState({ round, shown: shownTotal, skipped: false, open: false, dawn: dawnShown || isDawn });

  return {
    open,
    cues,
    startAt: shownCount,
    lastCue: cues.length ? (cues[cues.length - 1] as string) : null,
    onDone: (shownTotal: number) => close(shownTotal, phase !== 'night'),
    onSkip: () => setState({ round, shown: cues.length, skipped: true, open: false, dawn: true }),
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
  const live = useGameStore((s) => s.live);
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

  /* 有挂起动作（验人/用药/狼刀）时过场只停留一个最短节拍，随后让位给玩家自己的决策面板 */
  const night = useNight(phase, round, events);
  useDawnChime(phase);

  /* 天亮后过场要多说一句「昨夜谁出局」——不然落幕那一刻只剩一行日志，太素 */
  const dawnText = useMemo(() => {
    const dawn = [...events].reverse().find((e) => e.type === 'dawn');
    if (!dawn) return null;
    return dawn.payload.dead.length ? `昨夜 ${dawn.payload.dead.length} 人出局` : '昨夜是平安夜';
  }, [events]);

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
  useDocTitle(roundBadge(phase, round));

  /*
   * 「叫朋友来看」：不发玩家链接（对方拿了凭证能替你操作），只给观战深链。
   * 观众是只读投影，不占座、也不消耗模型调用。
   */
  const [shareOpen, setShareOpen] = useState(false);
  const spectateUrl = gameId ? watchUrl(gameId, readShareCode(window.location.search)) : '';

  return (
    <section className="screen page-game">
      {night.open ? (
        <NightCurtain
          round={round}
          cues={night.cues}
          startAt={night.startAt}
          phase={phase}
          hasPending={Boolean(active)}
          dawnText={dawnText}
          onDone={night.onDone}
          onSkip={night.onSkip}
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
          <button className="ig-quit share" onClick={() => setShareOpen(true)} aria-label="叫朋友来看">
            <Icon name="eye" size={12} /> 观战
          </button>
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
                  <span className="nm">
                    {seat.name}
                    {seat.isHuman ? <em className="me-badge">你</em> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 夜里始终用夜幕条：即使轮到自己行动，上面的旧发言也不该顶在行动面板前 */}
      {phase === 'night' ? (
        <NightStrip round={round} cue={night.lastCue} />
      ) : (
        <ChatBubbles events={events} names={names} live={live} />
      )}

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

      <ShareSheet
        open={shareOpen}
        title="叫个朋友来看"
        hint="他打开是上帝视角，能看全场身份，但不能替你操作。对局结束后 2 小时内可看。"
        url={spectateUrl}
        text={`来看我这局狼人杀：${roundBadge(phase, round)}，${alive} 人存活。`}
        qr={spectateUrl ? qrDataUrl(spectateUrl) : undefined}
        onClose={() => setShareOpen(false)}
      />

      <SiteFooter />
    </section>
  );
}

/* -------------------------------------------------------------- 观战视角 */

function SpectateView({ players }: { players: Seat[] }): JSX.Element {
  const spectate = useGameStore((s) => s.spectate);
  const events = useGameStore((s) => s.events);
  const live = useGameStore((s) => s.live);
  const close = useGameStore((s) => s.close);
  const names = useMemo(() => players.map((p) => p.name), [players]);
  const messages = useMessages(events);
  const human = players.find((p) => p.isHuman);
  const factions = spectate?.factions;
  const phase: Phase = spectate?.phase ?? 'night';
  const round = spectate?.round ?? 0;
  /*
   * 观战**不拉全屏夜幕**：过场是给玩家制造悬念的，观众本来就是上帝视角，
   * 黑屏只会挡住身份和棋盘 —— 观战要能一直看着全场。
   * 折中做法：夜里给整屏压一层极淡的冷调（sp-night-mode），并把当前口令
   * 做成月光色的一行挂在阵营卡下面，和玩家侧的过场用同一套语气。
   */
  const nightCues = useMemo(() => nightCuesForRound(events, round), [events, round]);
  const lastCue = nightCues.length ? (nightCues[nightCues.length - 1] as string) : null;
  useDawnChime(phase);

  const roleClass = (role?: string | null): string => {
    if (!role) return '';
    if (role === 'wolf') return 'wolf';
    if (role === 'witch') return 'witch';
    if (role === 'villager') return '';
    return 'god';
  };

  return (
    <section className={phase === 'night' ? 'screen page-game sp-night-mode' : 'screen page-game'}>
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

      {phase === 'night' ? (
        <div className="sp-night">
          <Icon name="cloudNight" size={13} />
          <span className="cue">{lastCue ?? '天黑请闭眼'}</span>
          <span className="hint">{round > 0 ? `第 ${round} 夜` : '入夜'}</span>
        </div>
      ) : null}

      <div className="sp-chat">
        {messages.length === 0 ? (
          <div className="ig-sys">还没有人发言</div>
        ) : (
          messages.map((event) => {
            const p = event.payload;
            const seat = players.find((row) => row.id === p.playerId);
            const role = seat?.role ?? null;
            const card = role ? ROLES[role as keyof typeof ROLES] : null;
            return (
              <div key={event.seq} className="sp-msg">
                <div className="sp-msg-head">
                  <Avatar name={p.name} seat={p.playerId} isHuman={p.isHuman} size={18} />
                  <span className="nm">{p.name}</span>
                  {/* 上帝视角的价值就在这儿：说话的人是什么身份，看的时候不用回忆 */}
                  {card ? (
                    <span className={role === 'wolf' || role === 'wolfking' ? 'role-tag wolf' : 'role-tag'}>
                      <Icon name={roleIcon(role)} size={10} />
                      {card.name}
                    </span>
                  ) : null}
                </div>
                <p>{highlightNames(p.text, names)}</p>
              </div>
            );
          })
        )}

        {live && live.text ? (
          <div className="sp-msg streaming">
            <div className="sp-msg-head">
              <Avatar name={live.name} seat={live.playerId} isHuman={false} size={18} />
              <span className="nm">{live.name}</span>
              <span className="tag live">
              输出中
              <TypingDots />
            </span>
            </div>
            <p>
              {highlightNames(live.text, names)}
              <i className="ig-caret" aria-hidden />
            </p>
          </div>
        ) : null}
      </div>

      <SiteFooter />
    </section>
  );
}
