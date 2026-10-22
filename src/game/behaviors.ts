/**
 * 角色夜间行为注册表。
 *
 * 为什么要有这个文件：角色能力原先散落在 engine.night() 里，每加一个角色要在
 * 3~8 处 if 分支里改（口令、真人等待、AI 决策、结算前的状态写回）。v1.5 要加猎人/
 * 守卫/白痴/长老/黑狼王/摄梦人，按老写法每加一个角色都要动引擎主体，且很容易漏。
 *
 * 现在的约定：
 * - 每个角色一个行为对象，引擎只负责「按顺序遍历 + 发口令 + 结算」；
 * - 行为里既能等真人输入，也能调 AI，但只通过 NightHost 暴露的窄接口；
 * - 新增角色 = 新建行为对象 + 注册进 NIGHT_BEHAVIORS，引擎主体不动。
 */
import type { ChoiceOption, PendingKind, Prompt, RoleKey } from '../shared/types.js';
import type { Player, GameView } from './types.js';
import type { LLMClient } from '../ai/types.js';
import { AIPlayer } from '../ai/ai-player.js';

/** 行为可以调用的引擎能力（刻意收窄：行为不该直接改引擎内部结构） */
export interface NightHost {
  /** 只读视图，转交给 AIPlayer */
  readonly game: GameView;
  readonly llm: LLMClient;
  readonly round: number;
  alivePlayers(): Player[];
  byId(id: number): Player | undefined;
  waitHuman(kind: PendingKind, prompt: Prompt, options: ChoiceOption[]): Promise<string | number | null>;
  /** 法官口令（night-cue 事件） */
  cue(text: string): void;
  pause(ms: number): Promise<void>;
  getWolfKill(): number | null;
  setWolfKill(id: number | null): void;
  getSaved(): boolean;
  setSaved(saved: boolean): void;
  setPoison(id: number | null): void;
}

export interface RoleBehavior {
  role: RoleKey;
  /** 法官口令：睁眼 */
  openCue: string;
  /** 法官口令：闭眼 */
  closeCue: string;
  /** 睁眼期间做什么；actor 是该角色的行动者（有真人则优先真人） */
  act(host: NightHost, actor: Player): Promise<void>;
}

/* ---------- 狼人：选刀（可以自刀） ---------- */
const wolfBehavior: RoleBehavior = {
  role: 'wolf',
  openCue: '狼人请睁眼，选择今晚的目标…',
  closeCue: '狼人请闭眼',
  async act(host, actor) {
    const wolves = host.alivePlayers().filter((p) => p.role === 'wolf');
    if (!wolves.length) return;

    if (actor.isHuman) {
      const candidates = host.alivePlayers().filter((p) => p.role !== 'wolf');
      if (!candidates.length) return;
      const teammates = wolves.filter((p) => !p.isHuman).map((p) => p.name).join('、');
      const value = await host.waitHuman(
        'pick',
        {
          title: '狼人行动（只有你们知道）',
          html: `你的队友：<b>${teammates || '（没有其他狼）'}</b><br>今晚要杀谁？（可以自刀伪装）`,
          confirm: null,
        },
        candidates.map((p) => ({ label: `${p.emoji} ${p.name}`, value: p.id })),
      );
      host.setWolfKill(typeof value === 'number' ? value : null);
      return;
    }

    /* AI 狼人：静默决策，不推送任何"谁在行动"的事件 */
    const leader = wolves[0] as Player;
    const result = await new AIPlayer(leader, host.llm).wolfKill(host.game);
    host.setWolfKill(result ? result.target : null);
    if (result) leader.thoughts.push({ round: host.round, phase: '夜', text: result.reason });
  },
};

/* ---------- 预言家：查验（验过的人不再出现） ---------- */
const seerBehavior: RoleBehavior = {
  role: 'seer',
  openCue: '预言家请睁眼，查验一名玩家…',
  closeCue: '预言家请闭眼',
  async act(host, actor) {
    const checked = new Set(actor.checks.map((c) => c.id));
    const candidates = host.alivePlayers().filter((p) => p.id !== actor.id && !checked.has(p.id));
    if (!candidates.length) return;

    if (actor.isHuman) {
      const value = await host.waitHuman(
        'pick',
        {
          title: '预言家查验（只有你知道）',
          html: '今晚要验谁？验过的人不会重复出现。',
          confirm: null,
        },
        candidates.map((p) => ({ label: `${p.emoji} ${p.name}`, value: p.id })),
      );
      const target = host.byId(typeof value === 'number' ? value : -1);
      if (!target) return;
      const isWolf = target.role === 'wolf';
      actor.checks.push({ id: target.id, name: target.name, isWolf, round: host.round });
      await host.waitHuman(
        'ack',
        {
          title: '查验结果（只有你知道）',
          html: `<b>${target.name}</b> 的身份是：<b style="color:${isWolf ? 'var(--wolf)' : 'var(--good)'}">${isWolf ? '狼人' : '好人'}</b>`,
          confirm: '记下了',
        },
        [],
      );
      return;
    }

    const result = await new AIPlayer(actor, host.llm).seerCheck(host.game);
    const target = result ? host.byId(result.target) : undefined;
    if (result && target) {
      actor.checks.push({ id: target.id, name: target.name, isWolf: target.role === 'wolf', round: host.round });
      actor.thoughts.push({ round: host.round, phase: '夜', text: result.reason });
    }
  },
};

/* ---------- 女巫：解药/毒药，同一晚只能用一种 ---------- */
const witchBehavior: RoleBehavior = {
  role: 'witch',
  openCue: '女巫请睁眼，决定是否用药…',
  closeCue: '女巫请闭眼',
  async act(host, actor) {
    const killId = host.getWolfKill();
    const victim = killId != null ? host.byId(killId) : undefined;

    if (actor.isHuman) {
      /* 首夜可自救（规则允许），同一晚只能用一种药 */
      if (actor.antidote && victim) {
        const value = await host.waitHuman(
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
          host.setSaved(true);
          actor.antidote = false;
        }
      }

      /* 同一晚只能用一种药：刚用了解药就不能再下毒 */
      const savedThisNight = actor.antidote === false && victim != null && host.getSaved();
      if (!savedThisNight && actor.poison) {
        const candidates = host.alivePlayers().filter((p) => p.id !== actor.id);
        const value = await host.waitHuman(
          'pick',
          {
            title: '要下毒吗（只有你知道）',
            html: '毒药只有一瓶，用错会害死好人。同一晚只能用一种药。',
            confirm: null,
          },
          [{ label: '今晚不毒', value: '' }, ...candidates.map((p) => ({ label: `毒 ${p.name}`, value: p.id }))],
        );
        if (typeof value === 'number') {
          host.setPoison(value);
          actor.poison = false;
        }
      }
      return;
    }

    const result = await new AIPlayer(actor, host.llm).witchAction(host.game, victim ?? null);
    if (result.save && actor.antidote && victim) {
      host.setSaved(true);
      actor.antidote = false;
    }
    if (result.poison && actor.poison) {
      host.setPoison(result.poison);
      actor.poison = false;
    }
    actor.thoughts.push({ round: host.round, phase: '夜', text: result.reason });
  },
};

/** 夜间睁眼顺序即数组顺序：狼人 → 预言家 → 女巫 */
export const NIGHT_BEHAVIORS: readonly RoleBehavior[] = [wolfBehavior, seerBehavior, witchBehavior];
