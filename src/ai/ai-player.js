/**
 * AI 玩家决策引擎：全部言行由 LLM 实时生成。
 * 每个决策点构造「公开信息 + 私有信息（人设/身份/记忆）」的 prompt，
 * 输出 JSON（发言/投票/目标/内心戏），无任何写死话术。
 */
const { ROLES } = require('../game/roles');
const { matchPlayerByName } = require('./json');

const SYS_BASE = [
  '你正在参加一场中文「狼人杀」对局，扮演其中一个玩家。你的每一句话都必须像真实玩家：有情绪、有推理、会试探，也会为了阵营撒谎。',
  '规则：6 人局，狼人 2、预言家 1、女巫 1、平民 2。夜晚狼人刀人、预言家验人、女巫可用解药或毒药各一次；白天依次发言后投票放逐一人。狼人全灭好人胜；狼人数 ≥ 好人数狼人胜。',
  '严格输出：只输出一个 JSON 对象，不要 markdown 代码块，不要任何多余文字。'
].join('\n');

class AIPlayer {
  /**
   * @param {object} player 对局玩家对象（name/emoji/persona/role/thoughts...）
   * @param {import('../ai/llm-gateway').LLMGateway} llm 共享的 LLM 网关
   */
  constructor(player, llm) {
    this.p = player;
    this.llm = llm;
  }

  /* ---------- prompt 组装 ---------- */

  publicBrief(game) {
    const alive = game.players.filter(p => p.alive).map(p => p.name);
    const lines = [`- 这是第 ${game.round} 天。`, `- 存活玩家：${alive.join('、')}。`];
    if (game.lastNightText) lines.push(`- 昨夜：${game.lastNightText}`);
    const out = game.players.filter(p => !p.alive);
    if (out.length) {
      lines.push('- 已出局：' + out.map(p => `${p.name}（${p.revealRole ? ROLES[p.role].name : '身份未公开'}）`).join('、'));
    }
    if (game.publicLog.length) {
      lines.push('- 本局此前的发言与事件：');
      game.publicLog.slice(-24).forEach(x => lines.push(`  ${x}`));
    } else {
      lines.push('- 目前还没有人发言。');
    }
    return lines.join('\n');
  }

  privateBrief() {
    const p = this.p;
    const parts = [`你的名字：${p.name}。你的性格：${p.persona}。你的身份：${ROLES[p.role].name}。请始终用这种性格说话和做决定。`];
    if (p.role === 'wolf') {
      const mates = p.gameMates || [];
      parts.push(`你的狼队友：${mates.map(m => `${m.name}${m.alive ? '' : '（已出局）'}`).join('、')}。你要隐藏身份，可以悍跳预言家或带节奏，但绝不要暴露队友。`);
    }
    if (p.role === 'seer' && p.checks && p.checks.length) {
      parts.push('你的查验记录：' + p.checks.map(c => `${c.name} 是${c.isWolf ? '狼人' : '好人'}`).join('；') + '。');
    }
    if (p.role === 'witch') {
      parts.push(`你的药：解药${p.antidote ? '还在' : '已用完'}，毒药${p.poison ? '还在' : '已用完'}。`);
    }
    if (p.thoughts && p.thoughts.length) {
      parts.push('你此前各回合的内心判断（保持连贯，不要自相矛盾）：');
      p.thoughts.slice(-6).forEach(t => parts.push(`  第${t.round}${t.phase}：${t.text}`));
    }
    return parts.join('\n');
  }

  /* ---------- 决策点（每个都真实调用 LLM） ---------- */

  /** 白天发言 + 投票意图 */
  async speak(game) {
    const sys = SYS_BASE + '\n你现在要完成：白天发言，并给出你这一轮打算投谁。';
    const user = [
      this.publicBrief(game), '', this.privateBrief(), '',
      '请输出 JSON：{"speech":"你的发言（第一人称口语，贴合你的性格，40~80字）","vote":"你要投的存活玩家名字（不能是自己）","reason":"你真实的内心判断，一句话"}'
    ].join('\n');
    const obj = await this.llm.task(sys, user, { temperature: 0.95 });
    const target = matchPlayerByName(obj.vote, game.alivePlayers(), this.p);
    return { speech: String(obj.speech || '').slice(0, 160), vote: target ? target.id : null, reason: String(obj.reason || '') };
  }

  /** 夜晚：狼人刀人 */
  async wolfKill(game) {
    const cands = game.alivePlayers().filter(p => p.role !== 'wolf');
    if (!cands.length) return null;
    const sys = SYS_BASE + '\n现在是夜晚，你（狼人）要和队友商定今晚杀谁。';
    const user = [
      this.publicBrief(game), '', this.privateBrief(), '',
      `可以下手的对象：${cands.map(p => p.name).join('、')}。优先杀威胁大的（发言像预言家、带票能力强的人）。`,
      '请输出 JSON：{"target":"要杀的玩家名字","reason":"一句话理由"}'
    ].join('\n');
    const obj = await this.llm.task(sys, user, { temperature: 0.85 });
    const t = matchPlayerByName(obj.target, cands, this.p) || cands[0];
    return { target: t.id, reason: String(obj.reason || '') };
  }

  /** 夜晚：预言家验人 */
  async seerCheck(game) {
    const checked = new Set((this.p.checks || []).map(c => c.id));
    const cands = game.alivePlayers().filter(p => p.id !== this.p.id && !checked.has(p.id));
    if (!cands.length) return null;
    const sys = SYS_BASE + '\n现在是夜晚，你是预言家，要决定查验谁。';
    const user = [
      this.publicBrief(game), '', this.privateBrief(), '',
      `还没验过的存活玩家：${cands.map(p => p.name).join('、')}。`,
      '请输出 JSON：{"target":"要查验的玩家名字","reason":"一句话理由"}'
    ].join('\n');
    const obj = await this.llm.task(sys, user, { temperature: 0.85 });
    const t = matchPlayerByName(obj.target, cands, this.p) || cands[0];
    return { target: t.id, reason: String(obj.reason || '') };
  }

  /** 夜晚：女巫用药 */
  async witchAction(game, victim) {
    const sys = SYS_BASE + '\n现在是夜晚，你是女巫。你要决定用不用药。';
    const cands = game.alivePlayers().filter(p => p.id !== this.p.id);
    const user = [
      this.publicBrief(game), '', this.privateBrief(), '',
      victim ? `今晚被狼人刀的是：${victim.name}。` : '今晚狼人似乎没有刀人。',
      this.p.antidote ? '你还有解药，可以救他。' : '你的解药已经用完了。',
      this.p.poison ? `你还有毒药，可以毒死场上任意一人：${cands.map(p => p.name).join('、')}。` : '你的毒药已经用完了。',
      '同一晚只能使用一种药。救人是善举但也可能救到狼；毒错人会害死好人。',
      '请输出 JSON：{"save":true或false,"poison":"要毒的玩家名字，不用就填空字符串","reason":"一句话理由"}'
    ].join('\n');
    const obj = await this.llm.task(sys, user, { temperature: 0.85 });
    const out = { save: false, poison: null, reason: String(obj.reason || '') };
    if (obj.save === true && this.p.antidote && victim) out.save = true;
    if (!out.save && this.p.poison && obj.poison) {
      const t = matchPlayerByName(obj.poison, cands, this.p);
      if (t) out.poison = t.id;
    }
    return out;
  }

  /** 白天：补投票 */
  async vote(game) {
    const cands = game.alivePlayers().filter(p => p.id !== this.p.id);
    if (!cands.length) return null;
    const sys = SYS_BASE + '\n现在投票放逐一人。';
    const user = [
      this.publicBrief(game), '', this.privateBrief(), '',
      `可投对象：${cands.map(p => p.name).join('、')}。`,
      '请输出 JSON：{"vote":"你要投的玩家名字","reason":"一句话理由"}'
    ].join('\n');
    const obj = await this.llm.task(sys, user, { temperature: 0.8 });
    const t = matchPlayerByName(obj.vote, cands, this.p) || cands[0];
    return { target: t.id, reason: String(obj.reason || '') };
  }
}

module.exports = { AIPlayer, SYS_BASE };
