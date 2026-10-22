/**
 * 对局引擎（服务端）：唯一权威的游戏状态与流程控制。
 * 真人玩家通过 HTTP 接口提交动作；AI 决策由 AIPlayer(LLM) 产生。
 *
 * 关键不变量：
 * 1) 身份、随机数、夜晚行动只存在于这里，快照按观察者裁剪；
 * 2) 夜晚事件流不含「谁在行动」，只有法官口令；
 * 3) 引擎不依赖任何 Web 框架，便于进程内测试。
 */
import crypto from 'node:crypto';
import type {
  EventKind,
  EventPayloads,
  GameEvent,
  Phase,
  Prompt,
  ChoiceOption,
  PendingAction,
  PendingKind,
  RoleKey,
  SeatView,
  Snapshot,
  SpectateSeat,
  SpectateSnapshot,
  Team,
  Thought,
} from '../shared/types.js';
import { ROLES } from '../shared/roles.js';
import type { LLMClient } from '../ai/types.js';
import { AIPlayer } from '../ai/ai-player.js';
import { GAME_RULES, ROLE_DECK, AI_CAST, judgeWinner } from './roles.js';
import type { GameView, Player } from './types.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let seatSeq = 0;
const nextId = (): number => ++seatSeq;

/** 归档到战绩库的一行 */
export interface ArchiveRow {
  playerName: string;
  playerRole: string;
  result: string;
  rounds: number;
  survivors: number;
  detail: {
    players: { name: string; role: RoleKey; alive: boolean }[];
    log: string[];
    thoughts: { name: string; role: RoleKey; thoughts: Thought[] }[];
  };
}

export interface EngineOptions {
  playerName: string;
  llm: LLMClient;
  emit?: (event: GameEvent, game: GameEngine) => void;
  /** 节奏系数：1 = 正常演出节奏；测试传小值把 900ms 的等待压缩掉 */
  pace?: number;
}

/** LLM 失败标记（fail-fast 专用，不做兜底话术） */
interface LLMFailure extends Error {
  llmFailure?: boolean;
}

function isLLMFailure(e: unknown): e is LLMFailure {
  return e instanceof Error && (e as LLMFailure).llmFailure === true;
}

export class GameEngine implements GameView {
  readonly id: string;
  readonly playerName: string;

  players: Player[] = [];
  round = 0;
  publicLog: string[] = [];
  lastNightText = '';
  winner: Team | null = null;
  aborted: { reason: string } | null = null;
  phase: Phase = 'lobby';
  events: GameEvent[] = [];
  version = 0;
  pendingAction: PendingAction | null = null;

  human!: Player;

  private llm: LLMClient;
  private emit: (event: GameEvent, game: GameEngine) => void;
  private readonly pace: number;
  private stopped = false;
  private resolveHuman: ((value: string | number | null) => void) | null = null;

  private nightKill: number | null = null;
  private saved = false;
  private poisonId: number | null = null;

  constructor({ playerName, llm, emit, pace = 1 }: EngineOptions) {
    this.id = 'g' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    this.llm = llm;
    this.emit = emit ?? (() => {});
    this.pace = Math.max(0, pace);
    this.playerName = playerName || GAME_RULES.humanPlayerName;
  }

  /* ---------- 初始化 ---------- */

  setup(): void {
    const shuffle = <T,>(input: readonly T[]): T[] => {
      const arr = input.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j] as T, arr[i] as T];
      }
      return arr;
    };

    const roles = shuffle(ROLE_DECK);
    const seats = shuffle([0, 1, 2, 3, 4, 5]);
    const cast = shuffle(AI_CAST).slice(0, 5);

    const mk = (partial: Pick<Player, 'name' | 'emoji' | 'persona' | 'role' | 'seat' | 'isHuman'>): Player => ({
      id: nextId(),
      alive: true,
      thoughts: [],
      checks: [],
      antidote: false,
      poison: false,
      revealRole: false,
      voteIntent: null,
      ...partial,
    });

    this.players = [
      mk({
        name: this.playerName,
        isHuman: true,
        emoji: '😎',
        persona: '你自己',
        role: roles[0] as RoleKey,
        seat: (seats[0] as number) + 1,
      }),
    ];
    for (let i = 0; i < 5; i++) {
      const member = cast[i] as (typeof AI_CAST)[number];
      this.players.push(
        mk({
          name: member.name,
          isHuman: false,
          emoji: member.emoji,
          persona: member.persona,
          role: roles[i + 1] as RoleKey,
          seat: (seats[i + 1] as number) + 1,
        }),
      );
    }
    this.players.sort((a, b) => a.seat - b.seat);

    for (const p of this.players) {
      if (p.role === 'witch') {
        p.antidote = true;
        p.poison = true;
      }
    }
    for (const p of this.players) {
      if (p.role === 'wolf') p.gameMates = this.players.filter((q) => q.role === 'wolf' && q.id !== p.id);
    }
    this.human = this.players.find((p) => p.isHuman) as Player;
  }

  /* ---------- 查询 ---------- */

  alivePlayers(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  byId(id: number): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  /**
   * 玩家视角快照：本人拿私有信息。
   * 观战视角（非本人）只拿公开字段 —— 与观战投影是两个函数，语义互斥，禁止合并。
   */
  snapshot(forPlayerId?: number): Snapshot {
    const isSelf = forPlayerId === this.human.id;
    const seats: SeatView[] = this.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      name: p.name,
      emoji: p.emoji,
      alive: p.alive,
      isHuman: p.isHuman,
      revealed: p.revealRole ? p.role : null,
    }));

    return {
      gameId: this.id,
      round: this.round,
      phase: this.phase,
      version: this.version,
      winner: this.winner,
      aborted: this.aborted,
      myRole: isSelf ? this.human.role : null,
      mySeat: isSelf ? this.human.seat : null,
      wolvesMates:
        isSelf && this.human.role === 'wolf'
          ? (this.human.gameMates ?? []).map((m) => ({ name: m.name, alive: m.alive }))
          : isSelf
            ? []
            : null,
      seerChecks: isSelf && this.human.role === 'seer' ? this.human.checks : isSelf ? [] : null,
      witchPotions:
        isSelf && this.human.role === 'witch'
          ? { antidote: this.human.antidote, poison: this.human.poison }
          : null,
      lastNightText: this.lastNightText,
      pendingAction: this.pendingAction,
      players: seats,
    };
  }

  /**
   * 观战投影：上帝视角，全量身份。
   * 与 snapshot() 方向相反（一个"藏"、一个"亮"），两者物理分离，禁止合并成一个函数。
   * 刻意不含 pendingAction —— 「谁正在行动」永远不进观战数据。
   */
  spectateSnapshot(): SpectateSnapshot {
    const seats: SpectateSeat[] = this.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      name: p.name,
      emoji: p.emoji,
      alive: p.alive,
      isHuman: p.isHuman,
      role: p.role,
      camp: ROLES[p.role].team,
    }));

    const tally = (team: Team): { alive: number; total: number } => {
      const members = this.players.filter((p) => ROLES[p.role].team === team);
      return { alive: members.filter((p) => p.alive).length, total: members.length };
    };

    return {
      gameId: this.id,
      round: this.round,
      phase: this.phase,
      version: this.version,
      winner: this.winner,
      aborted: this.aborted,
      players: seats,
      factions: { wolf: tally('wolf'), good: tally('good') },
    };
  }

  /* ---------- 事件与真人输入 ---------- */

  pushEvent<K extends EventKind>(type: K, payload: EventPayloads[K]): GameEvent {
    const event = { seq: ++this.version, t: Date.now(), type, payload } as GameEvent;
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    this.emit(event, this);
    return event;
  }

  /**
   * 挂起等待真人选择；resolve 由 HTTP 接口触发。
   * 注意：不推送事件 —— 前端从 snapshot.pendingAction 派生输入面板，
   * 避免"事件里的旧 prompt 与快照里的新 prompt"打架（v1.2.1 那类 bug 的根因）。
   */
  private waitHuman(kind: PendingKind, prompt: Prompt, options: ChoiceOption[]): Promise<string | number | null> {
    return new Promise<string | number | null>((resolve) => {
      this.pendingAction = { kind, prompt, options };
      this.resolveHuman = (value) => {
        this.pendingAction = null;
        this.resolveHuman = null;
        resolve(value);
      };
    });
  }

  /** HTTP 侧提交真人选择；无挂起点返回 false */
  submitHuman(value: string | number | null): boolean {
    if (!this.resolveHuman) return false;
    this.resolveHuman(value);
    return true;
  }

  log(text: string, tone?: string): void {
    this.publicLog.push(text);
    this.pushEvent('log', { text, tone: tone ?? '' });
  }

  /* ---------- 主流程 ---------- */

  async run(): Promise<void> {
    try {
      this.setup();
      this.phase = 'night';
      this.pushEvent('game-start', { gameId: this.id });
      await this.humanAckRole();

      while (!this.stopped && !this.winner && this.round < GAME_RULES.maxRounds) {
        this.round++;
        await this.night();
        if (this.checkEnd()) break;
        await this.day();
        if (this.checkEnd()) break;
      }

      if (!this.stopped && !this.winner) {
        this.winner = judgeWinner(this.alivePlayers().map((p) => p.role)) ?? 'wolf';
      }

      if (!this.stopped) {
        this.phase = 'over';
        this.pushEvent('game-over', {
          winner: this.winner ?? 'wolf',
          reveal: this.players.map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            alive: p.alive,
            isHuman: p.isHuman,
          })),
          thoughts: this.players
            .filter((p) => !p.isHuman)
            .map((p) => ({ name: p.name, role: p.role, thoughts: p.thoughts })),
          log: this.publicLog,
        });
      }
    } catch (e) {
      if (!isLLMFailure(e)) throw e;
      this.aborted = { reason: e.message };
      this.phase = 'over';
      this.pushEvent('aborted', { reason: e.message });
    }
  }

  private async humanAckRole(): Promise<void> {
    const meta = ROLES[this.human.role];
    const tips: Record<RoleKey, string> = {
      wolf: '队友会在夜里现身。白天记得藏好，别急着咬人。',
      seer: '每晚可以验一个人，白天想办法把信息传出去又不被狼盯上。',
      witch: '一瓶解药、一瓶毒药，全局各一次。用错比不用更伤。',
      villager: '没有技能，靠听、靠问、靠票。',
    };
    await this.waitHuman(
      'ack',
      {
        title: '天黑了',
        html: `这一局你拿到的是 <b style="color:var(--gold)">${meta.emoji} ${meta.name}</b>。<br>${tips[this.human.role]}`,
        confirm: '开始',
      },
      [],
    );
  }

  /* ---------- 夜晚（法官口令制：所有人听到同样的口令，无人知道谁在行动） ---------- */

  private async night(): Promise<void> {
    this.phase = 'night';
    this.pushEvent('phase', { label: `第 ${this.round} 夜`, phase: 'night' });
    this.log(`—— 第 ${this.round} 夜 ——`, 'night');
    this.nightKill = null;
    this.saved = false;
    this.poisonId = null;

    const cue = (text: string): GameEvent => this.pushEvent('night-cue', { text });

    /* 1. 天黑请闭眼 */
    cue('天黑请闭眼 🌙');
    await this.pause(900);

    /* 2. 狼人行动 */
    cue('狼人请睁眼，选择今晚的目标…');
    const wolves = this.alivePlayers().filter((p) => p.role === 'wolf');
    const humanWolf = wolves.find((p) => p.isHuman);
    if (wolves.length) {
      if (humanWolf) {
        const candidates = this.alivePlayers().filter((p) => p.role !== 'wolf');
        if (candidates.length) {
          const value = await this.waitHuman(
            'pick',
            {
              title: '狼人行动（只有你们知道）',
              html: `你的队友：<b>${wolves.filter((p) => !p.isHuman).map((p) => p.name).join('、') || '（没有其他狼）'}</b><br>今晚要杀谁？（可以自刀伪装）`,
              confirm: null,
            },
            candidates.map((p) => ({ label: `${p.emoji} ${p.name}`, value: p.id })),
          );
          this.nightKill = typeof value === 'number' ? value : null;
        }
      } else {
        /* AI 狼人：静默决策，不推送任何"谁在行动"的事件 */
        const leader = wolves[0] as Player;
        const result = await new AIPlayer(leader, this.llm).wolfKill(this);
        this.nightKill = result ? result.target : null;
        if (result) leader.thoughts.push({ round: this.round, phase: '夜', text: result.reason });
      }
    }
    cue('狼人请闭眼');
    await this.pause(600);

    /* 3. 预言家行动 */
    cue('预言家请睁眼，查验一名玩家…');
    const seer = this.alivePlayers().find((p) => p.role === 'seer');
    if (seer) {
      const checked = new Set(seer.checks.map((c) => c.id));
      const candidates = this.alivePlayers().filter((p) => p.id !== seer.id && !checked.has(p.id));
      if (seer.isHuman) {
        if (candidates.length) {
          const value = await this.waitHuman(
            'pick',
            {
              title: '预言家查验（只有你知道）',
              html: '今晚要验谁？验过的人不会重复出现。',
              confirm: null,
            },
            candidates.map((p) => ({ label: `${p.emoji} ${p.name}`, value: p.id })),
          );
          const target = this.byId(typeof value === 'number' ? value : -1);
          if (target) {
            const wolf = target.role === 'wolf';
            seer.checks.push({ id: target.id, name: target.name, isWolf: wolf, round: this.round });
            await this.waitHuman(
              'ack',
              {
                title: '查验结果（只有你知道）',
                html: `<b>${target.name}</b> 的身份是：<b style="color:${wolf ? 'var(--wolf)' : 'var(--good)'}">${wolf ? '狼人' : '好人'}</b>`,
                confirm: '记下了',
              },
              [],
            );
          }
        }
      } else if (candidates.length) {
        const result = await new AIPlayer(seer, this.llm).seerCheck(this);
        const target = result ? this.byId(result.target) : undefined;
        if (result && target) {
          seer.checks.push({ id: target.id, name: target.name, isWolf: target.role === 'wolf', round: this.round });
          seer.thoughts.push({ round: this.round, phase: '夜', text: result.reason });
        }
      }
    }
    cue('预言家请闭眼');
    await this.pause(600);

    /* 4. 女巫行动 */
    cue('女巫请睁眼，决定是否用药…');
    const witch = this.alivePlayers().find((p) => p.role === 'witch');
    if (witch) {
      const victim = this.nightKill != null ? this.byId(this.nightKill) : undefined;
      if (witch.isHuman) {
        /* 首夜可自救（规则允许），同一晚只能用一种药 */
        if (witch.antidote && victim) {
          const value = await this.waitHuman(
            'pick',
            {
              title: '女巫的夜晚（只有你知道）',
              html: `今晚被刀的是 <b>${victim.name}</b>。要用解药救他吗？（被刀的是你自己时，救不救由你）`,
              confirm: null,
            },
            [
              { label: '用解药救他', value: 'save' },
              { label: '不救', value: 'no' },
            ],
          );
          if (value === 'save') {
            this.saved = true;
            witch.antidote = false;
          }
        }
        if (!this.saved && witch.poison) {
          const candidates = this.alivePlayers().filter((p) => p.id !== witch.id);
          const value = await this.waitHuman(
            'pick',
            {
              title: '要下毒吗（只有你知道）',
              html: '毒药只有一瓶，用错会害死好人。同一晚只能用一种药。',
              confirm: null,
            },
            [{ label: '今晚不毒', value: '' }, ...candidates.map((p) => ({ label: `毒 ${p.name}`, value: p.id }))],
          );
          if (typeof value === 'number') {
            this.poisonId = value;
            witch.poison = false;
          }
        }
      } else {
        const result = await new AIPlayer(witch, this.llm).witchAction(this, victim ?? null);
        if (result.save && witch.antidote && victim) {
          this.saved = true;
          witch.antidote = false;
        }
        if (result.poison && witch.poison) {
          this.poisonId = result.poison;
          witch.poison = false;
        }
        witch.thoughts.push({ round: this.round, phase: '夜', text: result.reason });
      }
    }
    cue('女巫请闭眼');
    await this.pause(600);

    /* 5. 天亮，结算（死讯统一公布，不披露死因与用药） */
    const dead: Player[] = [];
    if (this.nightKill != null && !this.saved) {
      const victim = this.byId(this.nightKill);
      if (victim) dead.push(victim);
    }
    if (this.poisonId != null) {
      const poisoned = this.byId(this.poisonId);
      if (poisoned && !dead.includes(poisoned)) dead.push(poisoned);
    }
    for (const p of dead) this.kill(p);
    this.lastNightText = dead.length ? `${dead.map((p) => p.name).join('、')} 出局` : '平安夜';
    this.pushEvent('night-settle', { dead: dead.map((p) => p.id), text: this.lastNightText });
  }

  /** 演出节奏：只影响等待时长，不影响任何规则判定 */
  private pause(ms: number): Promise<void> {
    return this.pace === 1 ? sleep(ms) : sleep(Math.round(ms * this.pace));
  }

  private kill(p: Player): void {
    p.alive = false;
    p.deadRound = this.round;
  }

  /* ---------- 白天 ---------- */

  private async day(): Promise<void> {
    this.phase = 'day';
    this.pushEvent('phase', { label: `第 ${this.round} 天`, phase: 'day' });
    this.log(`—— 第 ${this.round} 天 ——`, 'day');

    const deaths = this.players.filter((p) => !p.alive && p.deadRound === this.round);
    this.log(
      deaths.length ? `昨夜 ${deaths.map((p) => p.name).join('、')} 出局` : '昨夜是平安夜',
      deaths.length ? 'death' : 'sys',
    );
    this.pushEvent('dawn', { dead: deaths.map((p) => p.id), firstNight: this.round === 1 });

    /* 首夜出局者有遗言；之后夜晚出局无遗言 */
    if (this.round === 1 && deaths.length) {
      for (const d of deaths) {
        const text = await this.lastWordsOf(d);
        if (!text) continue;
        this.publicLog.push(`第${this.round}天 ${d.name}（遗言）：${text}`);
        this.pushEvent('speech', {
          playerId: d.id,
          name: d.name,
          emoji: d.emoji,
          text,
          round: this.round,
          isHuman: d.isHuman,
          isLastWord: true,
        });
      }
    }

    /* 发言：死者下一位开始；先广播顺序条 */
    const order = this.speechOrder().filter((p) => p.alive);
    this.pushEvent('speech-order', {
      round: this.round,
      order: order.map((p) => ({ id: p.id, name: p.name, emoji: p.emoji })),
    });

    for (let i = 0; i < order.length; i++) {
      const p = order[i] as Player;
      if (!p.alive || this.stopped) continue;
      if (p.isHuman) {
        const value = await this.waitHuman(
          'input',
          {
            title: '轮到你发言',
            html: `你是本轮第 <b>${i + 1}/${order.length}</b> 位发言者。说点什么？可以踩人、可以跳身份、也可以先过。`,
            confirm: '发言',
          },
          [],
        );
        const say = String(value ?? '').trim() || '我这轮先过，听你们的。';
        this.publicLog.push(`第${this.round}天 ${p.name}：${say}`);
        this.pushEvent('speech', {
          playerId: p.id,
          name: p.name,
          emoji: p.emoji,
          text: say,
          round: this.round,
          isHuman: true,
          order: i + 1,
          total: order.length,
        });
      } else {
        /* 白天发言的"思考中"不含身份信息，安全 */
        this.pushEvent('ai-thinking', { playerId: p.id, label: `思考中（${i + 1}/${order.length}）…` });
        const result = await new AIPlayer(p, this.llm).speak(this);
        this.publicLog.push(`第${this.round}天 ${p.name}：${result.speech}`);
        p.voteIntent = result.vote;
        p.thoughts.push({ round: this.round, phase: '昼', text: result.reason });
        this.pushEvent('speech', {
          playerId: p.id,
          name: p.name,
          emoji: p.emoji,
          text: result.speech,
          round: this.round,
          isHuman: false,
          order: i + 1,
          total: order.length,
        });
      }
    }

    await this.vote();
  }

  private async lastWordsOf(player: Player): Promise<string> {
    if (player.isHuman) {
      const value = await this.waitHuman(
        'input',
        {
          title: '你的遗言（首夜出局）',
          html: '首夜出局有遗言。留下你的判断，帮好人一把。',
          confirm: '留下遗言',
        },
        [],
      );
      return String(value ?? '').trim();
    }
    const result = await new AIPlayer(player, this.llm).lastWords(this);
    return result?.text ?? '';
  }

  private async vote(): Promise<void> {
    this.phase = 'vote';
    /* 广播投票阶段：事件流要能自解释，前端票型与大厅阶段标签都靠它复位/展示 */
    this.pushEvent('phase', { label: `第 ${this.round} 天 · 投票`, phase: 'vote' });
    const alive = this.alivePlayers();
    const votes: { voter: number; target: number }[] = [];

    for (const p of alive) {
      if (this.stopped) return;
      let target = p.voteIntent ?? null;

      if (p.isHuman) {
        const value = await this.waitHuman(
          'pick',
          { title: '投票放逐', html: '你这一票投给谁？', confirm: null },
          alive.filter((x) => x.id !== p.id).map((x) => ({ label: `${x.emoji} ${x.name}`, value: x.id })),
        );
        target = typeof value === 'number' ? value : null;
      } else if (target == null || !this.byId(target)?.alive || target === p.id) {
        const result = await new AIPlayer(p, this.llm).vote(this);
        target = result ? result.target : null;
        if (result) p.thoughts.push({ round: this.round, phase: '票', text: result.reason });
      }

      if (target != null) {
        votes.push({ voter: p.id, target });
        this.log(`${p.name} → ${this.byId(target)?.name ?? '?'}`, 'vote');
        this.pushEvent('vote', { voter: p.id, target });
      }
    }

    this.resolveVotes(votes);
  }

  private resolveVotes(votes: { voter: number; target: number }[]): void {
    if (!votes.length) return;

    const counts = new Map<number, number>();
    for (const v of votes) counts.set(v.target, (counts.get(v.target) ?? 0) + 1);

    let max = 0;
    let top: number[] = [];
    for (const [target, count] of counts) {
      if (count > max) {
        max = count;
        top = [target];
      } else if (count === max) {
        top.push(target);
      }
    }

    if (top.length > 1) {
      this.log('平票，本轮无人出局', 'sys');
      this.pushEvent('vote-result', { tie: true, names: top.map((id) => this.byId(id)?.name ?? '?') });
      return;
    }

    const out = this.byId(top[0] as number);
    if (!out) return;
    out.alive = false;
    out.revealRole = true;
    out.deadRound = this.round;
    const name = ROLES[out.role].name;
    this.log(`${out.name} 被放逐，身份是${name}`, 'death');
    this.publicLog.push(`第${this.round}天 ${out.name} 被放逐，身份：${name}`);
    this.pushEvent('vote-result', {
      tie: false,
      playerId: out.id,
      name: out.name,
      role: out.role,
      votes: max,
    });
  }

  private speechOrder(): Player[] {
    const alive = this.alivePlayers().slice().sort((a, b) => a.seat - b.seat);
    if (!alive.length) return [];

    const dead = this.players.filter((p) => !p.alive && p.deadRound === this.round);
    let start: number;
    if (dead.length) {
      const seat = (dead[0] as Player).seat;
      const idx = alive.findIndex((p) => p.seat > seat);
      start = idx === -1 ? 0 : idx;
    } else {
      start = Math.floor(Math.random() * alive.length);
    }
    return [...alive.slice(start), ...alive.slice(0, start)];
  }

  private checkEnd(): boolean {
    const alive = this.alivePlayers();
    const wolves = alive.filter((p) => p.role === 'wolf').length;
    const goods = alive.length - wolves;
    if (wolves === 0) {
      this.winner = 'good';
      return true;
    }
    if (wolves >= goods) {
      this.winner = 'wolf';
      return true;
    }
    return false;
  }

  stop(): void {
    this.stopped = true;
    this.resolveHuman?.(null);
  }

  /** 归档数据（存战绩库） */
  archive(): ArchiveRow {
    return {
      playerName: this.playerName,
      playerRole: ROLES[this.human.role].name,
      result: this.winner ?? 'aborted',
      rounds: this.round,
      survivors: this.alivePlayers().length,
      detail: {
        players: this.players.map((p) => ({ name: p.name, role: p.role, alive: p.alive })),
        log: this.publicLog,
        thoughts: this.players
          .filter((p) => !p.isHuman)
          .map((p) => ({ name: p.name, role: p.role, thoughts: p.thoughts })),
      },
    };
  }
}
