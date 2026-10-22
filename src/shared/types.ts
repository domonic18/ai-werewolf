/**
 * 前后端唯一事实来源：对局事件、快照、REST 契约的类型定义。
 * 前端 `switch (event.type)` 漏分支、后端新增事件忘记同步，都会在 tsc 阶段报错。
 */

/* ---------- 基础枚举 ---------- */

export type RoleKey = 'wolf' | 'seer' | 'witch' | 'villager';
export type Team = 'wolf' | 'good';
export type Phase = 'lobby' | 'night' | 'day' | 'vote' | 'over';
export type PendingKind = 'ack' | 'pick' | 'input';
export type ThoughtPhase = '夜' | '昼' | '票';

/* ---------- 玩家与私有信息 ---------- */

export interface RoleMeta {
  key: RoleKey;
  name: string;
  emoji: string;
  team: Team;
}

export interface Thought {
  round: number;
  phase: ThoughtPhase;
  text: string;
}

export interface SeerCheck {
  id: number;
  name: string;
  isWolf: boolean;
  round: number;
}

/** 公开座位视图：不含任何身份字段 */
export interface SeatView {
  id: number;
  seat: number;
  name: string;
  emoji: string;
  alive: boolean;
  isHuman: boolean;
  /** 仅出局后翻开身份时为 RoleKey，否则 null */
  revealed: RoleKey | null;
}

/* ---------- 待人类输入 ---------- */

export interface ChoiceOption {
  label: string;
  value: string | number;
}

export interface Prompt {
  title: string;
  /** 受控富文本片段（仅服务端生成，前端按 HTML 渲染） */
  html: string;
  confirm?: string | null;
}

export interface PendingAction {
  kind: PendingKind;
  prompt: Prompt;
  options: ChoiceOption[];
}

/* ---------- 快照（玩家视角） ---------- */

export interface Snapshot {
  gameId: string;
  round: number;
  phase: Phase;
  version: number;
  winner: Team | null;
  aborted: { reason: string } | null;
  /** 真人自己的身份；观战视角为 null */
  myRole: RoleKey | null;
  mySeat: number | null;
  wolvesMates: { name: string; alive: boolean }[] | null;
  seerChecks: SeerCheck[] | null;
  witchPotions: { antidote: boolean; poison: boolean } | null;
  lastNightText: string;
  pendingAction: PendingAction | null;
  players: SeatView[];
}

/* ---------- 事件流 ---------- */

export interface RevealedPlayer {
  id: number;
  name: string;
  role: RoleKey;
  alive: boolean;
  isHuman: boolean;
}

export interface SpeechPayload {
  playerId: number;
  name: string;
  emoji: string;
  text: string;
  /** 该发言属于第几天，前端用它给发言记录分组 */
  round: number;
  isHuman?: boolean;
  isLastWord?: boolean;
  /** 本轮第几位发言（从 1 开始） */
  order?: number;
  total?: number;
}

export interface VoteResultPayload {
  tie: boolean;
  /** 平票时为平票玩家名字 */
  names?: string[];
  playerId?: number;
  name?: string;
  role?: RoleKey;
  votes?: number;
}

/** 事件类型 → 负载。新增事件必须同时在此登记，否则 tsc 报错。 */
export interface EventPayloads {
  'game-start': { gameId: string };
  phase: { label: string; phase: Phase };
  'night-cue': { text: string };
  dawn: { dead: number[]; firstNight: boolean };
  'night-settle': { dead: number[]; text: string };
  speech: SpeechPayload;
  'speech-order': { round: number; order: { id: number; name: string; emoji: string }[] };
  'ai-thinking': { playerId: number; label: string };
  vote: { voter: number; target: number };
  'vote-result': VoteResultPayload;
  log: { text: string; tone?: string };
  'game-over': {
    winner: Team;
    reveal: RevealedPlayer[];
    thoughts: { name: string; role: RoleKey; thoughts: Thought[] }[];
    log: string[];
  };
  aborted: { reason: string };
  archived: { ok: boolean; id?: string | null; error?: string | null };
}

export type EventKind = keyof EventPayloads;

export type GameEvent = {
  [K in EventKind]: { seq: number; t: number; type: K; payload: EventPayloads[K] };
}[EventKind];

export type GameEventOf<K extends EventKind> = Extract<GameEvent, { type: K }>;

/* ---------- REST 契约 ---------- */

export interface HealthResponse {
  ok: boolean;
  llm: { ok: boolean; model: string; sec: string; error: string | null; calls: number };
  rooms: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  credits?: string | null;
}

export interface ModelsResponse {
  models: ModelInfo[];
  current?: string;
}

export interface LobbyGame {
  gameId: string;
  host: string;
  round: number;
  phase: Phase;
  players: number;
  alive: number;
  startedAt: number;
}

export interface LiveResponse {
  games: LobbyGame[];
}

export interface MatchRow {
  id: string;
  player_name: string;
  player_role: string;
  result: string;
  rounds: number;
  created_at: string;
}

export interface MatchesResponse {
  recent: MatchRow[];
  stats: { total: number; good: number; wolf: number } | null;
}

export interface EventsResponse {
  version: number;
  events: GameEvent[];
  snapshot: Snapshot;
}

export interface SpectateResponse {
  version: number;
  events: GameEvent[];
}

export interface CreateGameResponse {
  gameId: string;
}

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  error: string;
}
