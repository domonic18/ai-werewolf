/**
 * 对局内部类型：引擎与 AI 玩家共用，避免二者循环依赖。
 */
import type { RoleKey, SeerCheck, Thought, ThoughtPhase } from '../shared/types.js';
import type { CastTraits } from './roles.js';

export interface Player {
  id: number;
  name: string;
  emoji: string;
  /** 性格 prompt（仅 AI） */
  persona: string;
  /** 牌感与行为倾向（仅 AI）：决定推理深度、发言长度、是否容易被带节奏 */
  traits?: CastTraits;
  role: RoleKey;
  seat: number;
  isHuman: boolean;
  alive: boolean;
  deadRound?: number;
  /** 内心判断（用于让 AI 保持前后一致，同时是结算页的"内心戏"） */
  thoughts: Thought[];
  checks: SeerCheck[];
  /** 女巫双药状态 */
  antidote: boolean;
  poison: boolean;
  /** 被放逐时翻开身份 */
  revealRole: boolean;
  /** 狼队友（仅狼人） */
  gameMates?: Player[];
  /** 本轮发言时给出的投票意图，投票阶段复用，省一次调用 */
  voteIntent?: number | null;
}

/** AI 玩家看到的对局只读视图 */
export interface GameView {
  round: number;
  lastNightText: string;
  publicLog: string[];
  players: Player[];
  alivePlayers(): Player[];
}

export type { Thought, ThoughtPhase, SeerCheck, RoleKey };
