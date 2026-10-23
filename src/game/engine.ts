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
  NightRecord,
  LiveSpeech,
  Team,
  Thought,
} from '../shared/types.js';
import { ROLES, isWolf } from '../shared/roles.js';
import type { LLMClient } from '../ai/types.js';
import { AIPlayer } from '../ai/ai-player.js';
import { GAME_RULES, ROLE_DECK, AI_CAST, judgeWinner } from './roles.js';
import { NIGHT_BEHAVIORS } from './behaviors.js';
import type { NightHost } from './behaviors.js';
import type { GameView, Player } from './types.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 会被「长老之死」封印的好人技能角色 */
const GOOD_SKILL_ROLES = new Set(['seer', 'witch', 'guard']);

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
  /** 本局牌组（展开后的角色数组）；不传则用 6 人基础配置 */
  deck?: RoleKey[];
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
  /** 长老被好人误伤后，全体好人神职技能失效（预言家/女巫/守卫/猎人） */
  skillsDisabled = false;

  /**
   * 正在流式输出的发言（内存态，不进事件流）。
   * 一段发言有上百个增量，塞进事件流会把 500 条上限撑爆，历史就被挤没了。
   */
  liveSpeech: LiveSpeech | null = null;
  lastNightText = '';
  /** 复盘时间轴：每夜/每天一条，上帝视角全量；玩家视角只取其中公开部分 */
  timeline: NightRecord[] = [];
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
  private readonly deck: RoleKey[];
  private stopped = false;
  private resolveHuman: ((value: string | number | null) => void) | null = null;

  private nightKill: number | null = null;
  private saved = false;
  private poisonId: number | null = null;
  /** 本夜守卫目标 */
  private guardedId: number | null = null;
  /** 上一夜守卫目标（不能连续两晚守同一人） */
  private lastGuardedId: number | null = null;

  constructor({ playerName, deck, llm, emit, pace = 1 }: EngineOptions) {
    this.id = 'g' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    this.llm = llm;
    this.emit = emit ?? (() => {});
    this.pace = Math.max(0, pace);
    this.deck = deck && deck.length ? deck.slice() : ROLE_DECK.slice();
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

    const roles = shuffle(this.deck);
    const total = roles.length;
    const seats = shuffle(Array.from({ length: total }, (_, i) => i));
    const cast = shuffle(AI_CAST).slice(0, Math.max(0, total - 1));

    /* 每局给每个人抽一个「状态」，配合牌感抖动，让同一个角色两天表现不一样 */
    const MOODS = ['calm', 'sharp', 'tilted', 'lazy'] as const;
    const jitter = (base: number): number =>
      Math.min(0.95, Math.max(0.15, base + (Math.random() - 0.5) * 0.16));

    const mk = (
      partial: Pick<Player, 'name' | 'emoji' | 'persona' | 'role' | 'seat' | 'isHuman'> & {
        traits?: Player['traits'];
      },
    ): Player => ({
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
        emoji: '',
        persona: '你自己',
        role: roles[0] as RoleKey,
        seat: (seats[0] as number) + 1,
      }),
    ];
    for (let i = 0; i < total - 1; i++) {
      const member = cast[i] as (typeof AI_CAST)[number];
      const mood = MOODS[Math.floor(Math.random() * MOODS.length)] as (typeof MOODS)[number];
      this.players.push(
        mk({
          name: member.name,
          isHuman: false,
          emoji: member.emoji,
          persona: member.persona,
          role: roles[i + 1] as RoleKey,
          seat: (seats[i + 1] as number) + 1,
          traits: { ...member.traits, skill: jitter(member.traits.skill), mood },
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
      if (isWolf(p.role)) p.gameMates = this.players.filter((q) => isWolf(q.role) && q.id !== p.id);
      if (p.role === 'elder') p.elderImmune = true;
      if (p.canVote === undefined) p.canVote = true;
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
      /* 复盘：玩家只该知道「谁出局、谁被放逐」，死因与用药属于女巫私有信息 */
      review: this.timeline.map((r) => ({
        round: r.round,
        deadNames: r.deaths.map((d) => d.name),
        exiled: r.exiled ? { name: r.exiled.name, role: r.exiled.role } : null,
        tie: r.tie,
      })),
      pendingAction: this.pendingAction,
      players: seats,
    };
  }

  /**
   * 观战投影：上帝视角，全量身份。
   * 与 snapshot() 方向相反（一个"藏"、一个"亮"），两者物理分离，禁止合并成一个函数。
   * 刻意不含 pendingAction —— 「谁正在行动」永远不进观战数据。
   */
  /**
   * 观战投影。
   *
   * 与玩家快照的区别：观战能看到**已经公开**的身份，而不是**全部**身份。
   * 判据就是 `revealRole`（放逐翻牌 / 白痴亮牌 / 长老受罚时置 true）。
   *
   * 早期这里是全量下发，于是玩家在局内点「观战」、把链接粘到另一个窗口，
   * 就能边看全场身份边做决定 —— 单人局里只是自我作弊，但一旦上排行或真人房就是硬伤。
   * 现在：进行中只给已翻牌者；结算（winner / aborted）后全量。
   */
  spectateSnapshot(): SpectateSnapshot {
    const finished = this.winner !== null || this.aborted !== null || this.phase === 'over';
    const seats: SpectateSeat[] = this.players.map((p) => {
      const revealed = finished || p.revealRole;
      return {
        id: p.id,
        seat: p.seat,
        name: p.name,
        emoji: p.emoji,
        alive: p.alive,
        isHuman: p.isHuman,
        role: revealed ? p.role : null,
        camp: revealed ? ROLES[p.role].team : null,
      };
    });

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
      /* 进行中不给复盘：里面的狼刀/用药足以反推身份 */
      timeline: finished ? this.timeline : [],
      factions: { wolf: tally('wolf'), good: tally('good') },
    };
  }

  /** 实时状态投影：给轮询响应带上「此刻正在说的话」 */
  liveSpeechView(): LiveSpeech | null {
    return this.liveSpeech ? { ...this.liveSpeech } : null;
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
    /* 只给已实装角色写提示；未实装角色不会进牌组，留空兜底即可 */
    const tips: Partial<Record<RoleKey, string>> = {
      wolf: '队友会在夜里现身。白天记得藏好，别急着咬人。',
      wolfking: '你是黑狼王：出局时（被毒除外）可以开枪带走一人，别把这条命白给。',
      seer: '每晚可以验一个人，白天想办法把信息传出去又不被狼盯上。',
      witch: '一瓶解药、一瓶毒药，全局各一次。用错比不用更伤。',
      hunter: '出局时可以开枪带走一人，被毒杀则不能。',
      guard: '每晚守一人，不能连续两晚守同一个；同守同救会奶穿。',
      idiot: '第一次被投出会翻牌免死，但从此失去投票权。',
      elder: '第一次被狼刀不会死；但被毒、被枪、被放逐会让全体好人技能失效。',
      villager: '没有技能，靠听、靠问、靠票。',
      dreamweaver: '夜里标记一人，被标者免于被刀。',
    };
    await this.waitHuman(
      'ack',
      {
        title: '天黑了',
        html:
          `这一局你拿到的是 <b style="color:var(--gold)">${meta.name}</b>。` +
          `<br>${tips[this.human.role] ?? ''}`,
        confirm: '开始',
      },
      [],
    );
  }

  /* ---------- 夜晚（法官口令制：所有人听到同样的口令，无人知道谁在行动） ---------- */

  private async night(): Promise<void> {
    this.phase = 'night';
    this.pushEvent('phase', { label: `第 ${this.round} 夜`, phase: 'night', round: this.round });
    this.log(`—— 第 ${this.round} 夜 ——`, 'night');
    this.nightKill = null;
    this.saved = false;
    this.poisonId = null;
    /* 必须清零：否则守卫死亡或空守时，上一夜的守护目标会残留并「挡下」这一刀 */
    this.guardedId = null;

    /* 法官口令制：只有口令，不含任何"谁在行动" */
    this.nightCue('天黑请闭眼');
    await this.pause(900);

    /* 按角色注册表依次睁眼：新增角色只改 behaviors.ts，night() 不用动 */
    for (const behavior of NIGHT_BEHAVIORS) {
      /* 长老被误伤后好人的神职技能失效：预言家/女巫/守卫不再睁眼 */
      if (this.skillsDisabled && GOOD_SKILL_ROLES.has(behavior.role)) {
        continue;
      }
      const actors = this.alivePlayers().filter((p) => p.role === behavior.role);
      if (!actors.length) continue;

      this.nightCue(behavior.openCue);
      /* 有真人时由真人决定，否则交给 AI 领队 */
      const actor = actors.find((p) => p.isHuman) ?? (actors[0] as Player);
      await behavior.act(this.nightHost(), actor);
      this.nightCue(behavior.closeCue);
      await this.pause(600);
    }

    /* 5. 天亮，结算（死讯统一公布，不披露死因与用药） */
    const outcome = this.wolfKillOutcome();
    const { guarded, pierced, elderSaved: elderShrug } = outcome;

    const dead: Player[] = [];
    if (outcome.victim) dead.push(outcome.victim);
    if (this.poisonId != null) {
      const poisoned = this.byId(this.poisonId);
      if (poisoned && !dead.includes(poisoned)) dead.push(poisoned);
    }
    for (const p of dead) this.kill(p);

    /* 复盘记录：狼刀/解药/毒药/守卫/死因全部留档（观战可见，玩家视角会被裁剪） */
    const record = this.recordOf(this.round);
    const wolfVictim = this.nightKill != null ? this.byId(this.nightKill) : undefined;
    const poisonVictim = this.poisonId != null ? this.byId(this.poisonId) : undefined;
    const guardVictim = this.guardedId != null ? this.byId(this.guardedId) : undefined;
    record.wolfTarget = wolfVictim ? { playerId: wolfVictim.id, name: wolfVictim.name } : null;
    record.saved = this.saved;
    record.poisonTarget = poisonVictim ? { playerId: poisonVictim.id, name: poisonVictim.name } : null;
    record.guardTarget = guardVictim ? { playerId: guardVictim.id, name: guardVictim.name } : null;
    record.guarded = guarded && !pierced;
    record.pierced = pierced;
    if (elderShrug) record.elderImmuneUsed = true;

    /* 出局开枪：猎人 / 黑狼王（被毒杀一律不能开枪） */
    const shotDeaths = await this.resolveDeathShots(dead);
    const allDead = [...dead, ...shotDeaths];

    /* 长老被毒/被枪带走 → 全体好人技能失效（被狼刀不触发，这时他本来也不会死） */
    if (allDead.some((p) => p.role === 'elder')) this.disableGoodSkills('长老被好人误伤');

    record.deaths = allDead.map((p) => ({
      playerId: p.id,
      name: p.name,
      seat: p.seat,
      cause: this.deathCauseOf(p, {
        wolfKillLands: outcome.victim != null,
        shotByHunter: shotDeaths.includes(p),
      }),
    }));

    this.lastGuardedId = this.guardedId;
    /* 长老挡刀后夜里没有人出局，公告仍是「平安夜」，不暴露长老身份 */
    this.lastNightText = allDead.length ? `${allDead.map((p) => p.name).join('、')} 出局` : '平安夜';
    this.pushEvent('night-settle', { dead: allDead.map((p) => p.id), text: this.lastNightText });
  }

  /**
   * 狼刀是否真的落地：守卫 / 解药 / 同守同救（奶穿）/ 长老首次免疫。
   * 单独抽出来是为了让规则可以被直接断言，而不是只能靠整局模拟去碰。
   *
   * 同守同救：守卫守护与女巫解药同时作用于同一人时，该玩家依然死亡（官方赛事规则）。
   */
  private wolfKillOutcome(): {
    victim: Player | null;
    elderSaved: boolean;
    guarded: boolean;
    savedKill: boolean;
    pierced: boolean;
  } {
    const guarded = this.guardedId != null && this.guardedId === this.nightKill;
    const savedKill = this.saved && this.nightKill != null;
    const pierced = guarded && savedKill;
    const lands = this.nightKill != null && (pierced || (!savedKill && !guarded));
    const target = lands && this.nightKill != null ? this.byId(this.nightKill) ?? null : null;

    if (target && target.role === 'elder' && target.elderImmune !== false) {
      target.elderImmune = false;
      target.thoughts.push({ round: this.round, phase: '夜', text: '这刀我扛下来了，但只有一次。' });
      return { victim: null, elderSaved: true, guarded, savedKill, pierced };
    }

    return { victim: target, elderSaved: false, guarded, savedKill, pierced };
  }

  /** 死因标注：毒 > 猎人 > 刀（后两者同时成立时按猎人算，因为枪是直接原因） */
  private deathCauseOf(
    player: Player,
    ctx: { wolfKillLands: boolean; shotByHunter: boolean },
  ): 'wolf' | 'poison' | 'hunter' | 'vote' {
    if (ctx.shotByHunter) return 'hunter';
    if (player.id === this.poisonId) return 'poison';
    if (ctx.wolfKillLands && player.id === this.nightKill) return 'wolf';
    return 'wolf';
  }

  /**
   * 结算死讯后处理猎人开枪（Q7：当场开枪）。
   * 规则：除被毒杀外，以任何方式出局都可开枪，也可以压枪不开。
   * 返回被枪带走的人（可能为空）。
   */
  private async resolveDeathShots(dead: Player[]): Promise<Player[]> {
    const shot: Player[] = [];

    for (const player of dead) {
      const isHunter = player.role === 'hunter';
      const isWolfKing = player.role === 'wolfking';
      if (!isHunter && !isWolfKing) continue;
      const label = isWolfKing ? '黑狼王' : '猎人';

      /* 长老被误伤后，好人技能失效：猎人开不了枪（黑狼王是狼，不在此列） */
      if (isHunter && this.skillsDisabled) {
        this.log(`${player.name} 是猎人，但神职技能已失效，无法开枪`, 'sys');
        continue;
      }

      /* 被毒杀一律不能开枪（官方规则：被毒杀者不能发动技能） */
      if (player.id === this.poisonId) {
        this.log(`${player.name} 是${label}，但被毒杀无法开枪`, 'sys');
        this.recordOf(this.round).hunterShot = {
          hunterId: player.id,
          name: player.name,
          targetId: null,
          targetName: null,
          shooterRole: player.role,
        };
        continue;
      }

      let target: Player | null = null;
      if (player.isHuman) {
        const candidates = this.alivePlayers().filter((p) => p.id !== player.id);
        const value = await this.waitHuman(
          'pick',
          {
            title: `${label}开枪（只有你能决定）`,
            html: `你出局了，可以开枪带走一名存活玩家，也可以压枪不开。<br><span style="color:var(--muted)">带错人会直接改变局势</span>`,
            confirm: null,
          },
          [{ label: '压枪不开', value: '' }, ...candidates.map((p) => ({ label: `带走 ${p.name}`, value: p.id }))],
        );
        target = typeof value === 'number' ? this.byId(value) ?? null : null;
      } else {
        const result = await new AIPlayer(player, this.llm).deathShot(this, label);
        target = result ? this.byId(result.target) ?? null : null;
        if (result) player.thoughts.push({ round: this.round, phase: '昼', text: result.reason });
      }

      const record = this.recordOf(this.round);
      if (!target || !target.alive) {
        this.log(`${player.name}（${label}）选择压枪不开`, 'sys');
        record.hunterShot = {
          hunterId: player.id,
          name: player.name,
          targetId: null,
          targetName: null,
          shooterRole: player.role,
        };
        continue;
      }

      this.kill(target);
      shot.push(target);
      record.hunterShot = {
        hunterId: player.id,
        name: player.name,
        targetId: target.id,
        targetName: target.name,
        shooterRole: player.role,
      };
      this.log(`${player.name}（${label}）开枪带走了 ${target.name}`, 'death');
      this.pushEvent('hunter-shot', {
        hunterId: player.id,
        hunterName: player.name,
        targetId: target.id,
        targetName: target.name,
        shooterRole: player.role,
      });
    }

    return shot;
  }

  /**
   * 长老被好人误伤后的惩罚：预言家、女巫、守卫、猎人从此失去技能。
   * 这条规则必须公开宣告——否则玩家只会看到「神职突然不动作」而不知道原因。
   */
  private disableGoodSkills(reason: string): void {
    if (this.skillsDisabled) return;
    this.skillsDisabled = true;
    const elder = this.players.find((p) => p.role === 'elder');
    if (elder) elder.revealRole = true;
    this.recordOf(this.round).skillsDisabled = true;
    this.log(`${reason}，长老出局：好人神职技能全部失效`, 'death');
    this.publicLog.push(`第${this.round}天 长老出局，好人神职技能失效`);
    this.pushEvent('log', { text: '长老出局，好人神职技能失效', tone: 'death' });
  }

  /** 法官口令（夜晚唯一允许的事件类型，不含玩家名与行动者） */
  private nightCue(text: string): void {
    this.pushEvent('night-cue', { text, round: this.round });
  }

  /**
   * 角色行为的窄接口：行为只能通过它读写夜间状态，
   * 这样后续角色（猎人/守卫/摄梦人…）不需要碰引擎内部结构。
   */
  private nightHost(): NightHost {
    return {
      game: this,
      llm: this.llm,
      round: this.round,
      alivePlayers: () => this.alivePlayers(),
      byId: (id) => this.byId(id),
      waitHuman: (kind, prompt, options) => this.waitHuman(kind, prompt, options),
      cue: (text) => this.nightCue(text),
      pause: (ms) => this.pause(ms),
      getWolfKill: () => this.nightKill,
      setWolfKill: (id) => {
        this.nightKill = id;
      },
      getSaved: () => this.saved,
      setSaved: (v) => {
        this.saved = v;
      },
      setPoison: (id) => {
        this.poisonId = id;
      },
      getGuarded: () => this.guardedId,
      setGuarded: (id) => {
        this.guardedId = id;
      },
      getLastGuarded: () => this.lastGuardedId,
    };
  }

  /** 演出节奏：只影响等待时长，不影响任何规则判定 */
  /** 取（或创建）本轮的复盘记录；夜晚先写，白天投票后补 exiled */
  private recordOf(round: number): NightRecord {
    let record = this.timeline.find((r) => r.round === round);
    if (!record) {
      record = {
        round,
        wolfTarget: null,
        saved: false,
        poisonTarget: null,
        deaths: [],
        exiled: null,
        tie: false,
        guardTarget: null,
        guarded: false,
        pierced: false,
        hunterShot: null,
      };
      this.timeline.push(record);
    }
    return record;
  }

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
    this.pushEvent('phase', { label: `第 ${this.round} 天`, phase: 'day', round: this.round });
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
        /* 边生成边上屏：前端每 300ms 拉一次 live，看到的就是逐字说完再轮到下一位 */
        this.liveSpeech = { playerId: p.id, name: p.name, text: '' };
        let result;
        try {
          result = await new AIPlayer(p, this.llm).speak(this, (text) => {
            if (this.liveSpeech && this.liveSpeech.playerId === p.id) this.liveSpeech.text = text;
          });
        } finally {
          this.liveSpeech = null;
        }
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
    this.pushEvent('phase', { label: `第 ${this.round} 天 · 投票`, phase: 'vote', round: this.round });
    const alive = this.alivePlayers();
    const votes: { voter: number; target: number }[] = [];

    for (const p of alive) {
      if (this.stopped) return;
      /* 白痴翻牌后失去投票权：跳过，但要让场上知道这一票不会出现 */
      if (p.canVote === false) {
        this.log(`${p.name} 已翻牌，本轮没有投票权`, 'sys');
        continue;
      }
      let target = p.voteIntent ?? null;

      if (p.isHuman) {
        const value = await this.waitHuman(
          'pick',
          { title: '投票放逐', html: '你这一票投给谁？', confirm: null },
          alive.filter((x) => x.id !== p.id).map((x) => ({ label: x.name, value: x.id })),
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

    await this.resolveVotes(votes);
  }

  private async resolveVotes(votes: { voter: number; target: number }[]): Promise<void> {
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
      this.recordOf(this.round).tie = true;
      this.pushEvent('vote-result', { tie: true, names: top.map((id) => this.byId(id)?.name ?? '?') });
      return;
    }

    const out = this.byId(top[0] as number);
    if (!out) return;

    /* 白痴：第一次被投出翻牌免死，此后失去投票权；第二次被投出照常出局 */
    if (out.role === 'idiot' && !out.idiotRevealed) {
      out.idiotRevealed = true;
      out.revealRole = true;
      out.canVote = false;
      this.recordOf(this.round).exiled = {
        playerId: out.id,
        name: out.name,
        role: out.role,
        votes: max,
        survived: true,
      };
      this.log(`${out.name} 被投出，翻牌是白痴，免于放逐（此后没有投票权）`, 'death');
      this.publicLog.push(`第${this.round}天 ${out.name} 被投出，翻牌为白痴，免于放逐`);
      this.pushEvent('vote-result', {
        tie: false,
        playerId: out.id,
        name: out.name,
        role: out.role,
        votes: max,
        survived: true,
      });
      return;
    }

    out.alive = false;
    out.revealRole = true;
    out.deadRound = this.round;
    const name = ROLES[out.role].name;
    this.recordOf(this.round).exiled = { playerId: out.id, name: out.name, role: out.role, votes: max };

    /* 长老被好人误伤（放逐）：全体好人神职技能失效 */
    if (out.role === 'elder') this.disableGoodSkills('长老被放逐');

    /* Q7：被放逐时当场开枪（猎人 / 黑狼王；其他人是空操作） */
    const shot = await this.resolveDeathShots([out]);
    for (const p of shot) {
      this.recordOf(this.round).deaths.push({
        playerId: p.id,
        name: p.name,
        seat: p.seat,
        cause: 'hunter',
      });
    }
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
    const wolves = alive.filter((p) => isWolf(p.role)).length;
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
