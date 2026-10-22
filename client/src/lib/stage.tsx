import type { ReactNode } from 'react';
import type { GameEvent, RoleKey } from '@shared/types';
import { ROLES } from '@shared/roles';
import { highlightNames } from './highlight';

export interface StageSeat {
  id: number;
  name: string;
  emoji: string;
}

export interface StageContext {
  round: number;
  players: StageSeat[];
}

export interface StageView {
  title: string;
  body: ReactNode;
  tone: 'idle' | 'night' | 'dawn' | 'vote' | 'abort';
}

const IDLE: StageView = { title: '', body: '准备开始…', tone: 'idle' };

/**
 * 舞台内容 = 事件流里最后一个"需要上屏"的事件。
 * 纯函数派生，没有隐藏状态，也不依赖渲染时机 —— 这是 v1.2.1 那类
 * "旧提示把新面板顶掉"问题的结构性解法。
 */
export function buildStage(events: GameEvent[], context: StageContext): StageView {
  const names = context.players.map((p) => p.name);

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as GameEvent;
    switch (event.type) {
      case 'night-cue':
        return {
          title: `第 ${context.round} 夜`,
          body: <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 15, letterSpacing: 1 }}>{event.payload.text}</div>,
          tone: 'night',
        };
      case 'dawn':
        return {
          title: '天亮了',
          body: event.payload.dead.length ? (
            <>
              天亮了，昨夜 <b style={{ color: 'var(--wolf)' }}>{event.payload.dead.length} 人</b> 出局。
              {event.payload.firstNight ? '（首夜出局有遗言）' : ''}
            </>
          ) : (
            <>
              天亮了，昨夜是<b style={{ color: 'var(--good)' }}>平安夜</b>。
            </>
          ),
          tone: 'dawn',
        };
      case 'speech':
        return {
          title: `${event.payload.emoji} ${event.payload.name}`,
          body: highlightNames(event.payload.text, names),
          tone: 'idle',
        };
      case 'ai-thinking': {
        const player = context.players.find((p) => p.id === event.payload.playerId);
        return {
          title: player ? `${player.emoji} ${player.name}` : 'AI',
          body: (
            <div className="think">
              {event.payload.label}
              <i />
              <i />
              <i />
            </div>
          ),
          tone: 'idle',
        };
      }
      case 'vote-result':
        return event.payload.tie ? {
          title: '投票结果',
          body: <>平票（{(event.payload.names ?? []).join('、')}），本轮无人被放逐。</>,
          tone: 'vote',
        } : {
          title: '投票结果',
          body: (
            <>
              <b>{event.payload.name}</b> 被放逐，身份是{' '}
              <b>{roleLabel(event.payload.role)}</b>。
            </>
          ),
          tone: 'vote',
        };
      case 'hunter-shot':
        return {
          title: '🔫 猎人开枪',
          body: event.payload.targetName ? (
            <>
              <b>{event.payload.hunterName}</b>（猎人）出局后开枪，带走了{' '}
              <b style={{ color: 'var(--wolf)' }}>{event.payload.targetName}</b>。
            </>
          ) : (
            <>
              <b>{event.payload.hunterName}</b>（猎人）出局后选择压枪不开。
            </>
          ),
          tone: 'dawn',
        };
      case 'aborted':
        return {
          title: 'AI 掉线了',
          body: (
            <>
              本局 AI 发言完全依赖云服务大模型，调用失败后不用假话术顶替。
              <br />
              <br />
              失败原因：<b style={{ color: 'var(--wolf)' }}>{event.payload.reason}</b>
            </>
          ),
          tone: 'abort',
        };
      default:
        continue;
    }
  }

  return IDLE;
}

function roleLabel(role: RoleKey | undefined): string {
  if (!role) return '未知身份';
  const meta = ROLES[role];
  return `${meta.emoji} ${meta.name}`;
}

/** 当前正在发言/思考的玩家 id（用于座位高亮与顺序条） */
export function speakingPlayerId(events: GameEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as GameEvent;
    if (event.type === 'speech' || event.type === 'ai-thinking') return event.payload.playerId;
    if (event.type === 'dawn' || event.type === 'night-cue' || event.type === 'vote-result') return null;
  }
  return null;
}
