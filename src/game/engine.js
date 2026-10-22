/**
 * 对局引擎（服务端）：唯一权威的游戏状态与流程控制。
 * 真人玩家通过 HTTP 接口提交动作；AI 决策由 AIPlayer(LLM) 产生。
 * 事件通过事件总线广播（供轮询 / 未来 SSE 使用）。
 */
const crypto = require('crypto');
const { ROLES, ROLE_DECK, AI_CAST, GAME_RULES, judgeWinner } = require('./roles');
const { AIPlayer } = require('../ai/ai-player');

const sleep = ms => new Promise(r => setTimeout(r, ms));

let seq = 0;
function nextId() { return ++seq; }

class GameEngine {
  /**
   * @param {object} opts
   * @param {string} opts.playerName 真人玩家代号
   * @param {import('../ai/llm-gateway').LLMGateway} opts.llm
   * @param {(event:object, game:GameEngine)=>void} opts.emit 事件广播
   */
  constructor({ playerName, llm, emit }) {
    this.id = 'g' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    this.llm = llm;
    this.emit = emit || (() => {});
    this.playerName = playerName || GAME_RULES.humanPlayerName;
    this.players = [];
    this.round = 0;
    this.publicLog = [];
    this.lastNightText = '';
    this.winner = null;
    this.aborted = null;   // { reason } 非正常终止
    this.phase = 'lobby';  // lobby | night | day | vote | over
    this.events = [];      // 完整事件流（轮询用）
    this.version = 0;      // 每次事件 +1，客户端增量拉取
    this.pendingAction = null; // 等待真人输入的挂起点
    this._stopped = false;
  }

  /* ---------- 初始化 ---------- */

  setup() {
    const shuffle = a => {
      const arr = a.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    const roles = shuffle(ROLE_DECK);
    const seats = shuffle([0, 1, 2, 3, 4, 5]);
    const cast = shuffle(AI_CAST).slice(0, 5);

    const mk = (partial) => Object.assign({
      id: nextId(), alive: true, thoughts: [], checks: [],
      antidote: false, poison: false, revealRole: false
    }, partial);

    this.players = [mk({
      name: this.playerName, isHuman: true, emoji: '😎',
      persona: '你自己', role: roles[0], seat: seats[0] + 1
    })];
    for (let i = 0; i < 5; i++) {
      this.players.push(mk({
        name: cast[i].name, isHuman: false, emoji: cast[i].emoji,
        persona: cast[i].persona, role: roles[i + 1], seat: seats[i + 1] + 1
      }));
    }
    this.players.sort((a, b) => a.seat - b.seat);
    // 女巫初始双药
    this.players.filter(p => p.role === 'witch').forEach(p => { p.antidote = true; p.poison = true; });
    // 狼人互知队友
    this.players.filter(p => p.role === 'wolf').forEach(p => {
      p.gameMates = this.players.filter(q => q.role === 'wolf' && q.id !== p.id);
    });
    this.human = this.players.find(p => p.isHuman);
  }

  /* ---------- 查询（供接口/观战） ---------- */

  alivePlayers() { return this.players.filter(p => p.alive); }
  byId(id) { return this.players.find(p => p.id === id); }

  /** 客户端视角快照：真人拿私有信息，观战者只拿公开信息 */
  snapshot(forPlayerId) {
    const isSelf = forPlayerId === this.human.id;
    return {
      gameId: this.id,
      round: this.round,
      phase: this.phase,
      version: this.version,
      winner: this.winner,
      aborted: this.aborted,
      myRole: isSelf ? this.human.role : null,
      mySeat: isSelf ? this.human.seat : null,
      wolvesMates: isSelf && this.human.role === 'wolf'
        ? this.human.gameMates.map(m => ({ name: m.name, alive: m.alive }))
        : (isSelf ? [] : null),
      seerChecks: isSelf && this.human.role === 'seer' ? this.human.checks : (isSelf ? [] : null),
      witchPotions: isSelf && this.human.role === 'witch'
        ? { antidote: this.human.antidote, poison: this.human.poison } : (isSelf ? null : null),
      lastNightText: this.lastNightText,
      pendingAction: this.pendingAction,
      players: this.players.map(p => ({
        id: p.id, seat: p.seat, name: p.name, emoji: p.emoji,
        alive: p.alive, isHuman: p.isHuman,
        revealed: p.revealRole ? ROLES[p.role].key : null
      }))
    };
  }

  /* ---------- 事件与真人输入 ---------- */

  pushEvent(type, payload) {
    const ev = { seq: ++this.version, t: Date.now(), type, payload };
    this.events.push(ev);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    this.emit(ev, this);
    return ev;
  }

  /** 挂起等待真人选择；resolve 由 HTTP 接口触发 */
  waitHuman(kind, prompt, options) {
    return new Promise(resolve => {
      this.pendingAction = { kind, prompt, options };
      this.pushEvent('await-human', { kind, prompt, options });
      this._resolveHuman = value => {
        this.pendingAction = null;
        this._resolveHuman = null;
        resolve(value);
      };
    });
  }

  /** HTTP 侧提交真人选择 */
  submitHuman(value) {
    if (!this._resolveHuman) return false;
    this._resolveHuman(value);
    return true;
  }

  log(text, tone) {
    this.publicLog.push(text);
    this.pushEvent('log', { text, tone: tone || '' });
  }

  /* ---------- 主流程 ---------- */

  async run() {
    try {
      this.setup();
      this.phase = 'night';
      this.pushEvent('game-start', this.snapshot());
      await this.humanAckRole();
      while (!this._stopped && !this.winner && this.round < GAME_RULES.maxRounds) {
        this.round++;
        await this.night();
        if (this._checkEnd()) break;
        await this.day();
        if (this._checkEnd()) break;
      }
      if (!this._stopped && !this.winner) {
        this.winner = judgeWinner(this.alivePlayers().map(p => p.role))
          ? this.alivePlayers().length && this.alivePlayers().filter(p => p.role === 'wolf').length === 0 ? 'good' : 'wolf'
          : null;
        if (!this.winner) this.winner = 'wolf';
      }
      if (!this._stopped) {
        this.phase = 'over';
        this.pushEvent('game-over', {
          winner: this.winner,
          reveal: this.players.map(p => ({ id: p.id, name: p.name, role: p.role, alive: p.alive, isHuman: p.isHuman })),
          thoughts: this.players.filter(p => !p.isHuman).map(p => ({ name: p.name, role: p.role, thoughts: p.thoughts })),
          log: this.publicLog
        });
      }
    } catch (e) {
      if (!e.llmFailure) throw e;
      this.aborted = { reason: e.message };
      this.phase = 'over';
      this.pushEvent('aborted', { reason: e.message });
    }
  }

  async humanAckRole() {
    const r = ROLES[this.human.role];
    const tips = {
      wolf: '队友会在夜里现身。白天记得藏好，别急着咬人。',
      seer: '每晚可以验一个人，白天想办法把信息传出去又不被狼盯上。',
      witch: '一瓶解药、一瓶毒药，全局各一次。用错比不用更伤。',
      villager: '没有技能，靠听、靠问、靠票。'
    };
    await this.waitHuman('ack', {
      title: '天黑了',
      html: `这一局你拿到的是 <b style="color:var(--gold)">${r.emoji} ${r.name}</b>。<br>${tips[this.human.role]}`,
      confirm: '开始'
    }, []);
  }

  /* ---------- 夜晚 ---------- */

  async night() {
    this.phase = 'night';
    this.pushEvent('phase', { label: `第 ${this.round} 夜`, phase: 'night' });
    this.log(`—— 第 ${this.round} 夜 ——`, 'night');
    this.nightKill = null;
    this.saved = false;
    this.poisonId = null;

    const wolves = this.alivePlayers().filter(p => p.role === 'wolf');
    const humanWolf = wolves.find(p => p.isHuman);

    if (wolves.length) {
      if (humanWolf) {
        const cands = this.alivePlayers().filter(p => p.role !== 'wolf');
        if (cands.length) {
          const v = await this.waitHuman('pick', {
            title: '狼人行动',
            html: `你的队友：<b>${wolves.filter(p => !p.isHuman).map(p => p.name).join('、') || '（没有其他狼）'}</b><br>今晚要杀谁？`,
            confirm: null
          }, cands.map(p => ({ label: `${p.emoji} ${p.name}`, value: p.id })));
          this.nightKill = v;
          this.log('狼人选择了目标（你参与了决策）', 'night');
        }
      } else {
        const leader = wolves[0];
        this.pushEvent('ai-thinking', { playerId: leader.id, label: '和队友商议中…' });
        const ai = new AIPlayer(leader, this.llm);
        const r = await ai.wolfKill(this);
        this.nightKill = r.target;
        leader.thoughts.push({ round: this.round, phase: '夜', text: r.reason });
        this.log('狼人完成了选择', 'night');
      }
    }

    const seer = this.alivePlayers().find(p => p.role === 'seer');
    if (seer) {
      const checked = new Set(seer.checks.map(c => c.id));
      const cands = this.alivePlayers().filter(p => p.id !== seer.id && !checked.has(p.id));
      if (seer.isHuman) {
        if (cands.length) {
          const v = await this.waitHuman('pick', {
            title: '预言家查验',
            html: '今晚要验谁？验过的人不会重复出现。',
            confirm: null
          }, cands.map(p => ({ label: `${p.emoji} ${p.name}`, value: p.id })));
          const target = this.byId(v);
          const isWolf = target.role === 'wolf';
          seer.checks.push({ id: target.id, name: target.name, isWolf, round: this.round });
          await this.waitHuman('ack', {
            title: '查验结果',
            html: `<b>${target.name}</b> 的身份是：<b style="color:${isWolf ? 'var(--wolf)' : 'var(--good)'}">${isWolf ? '狼人' : '好人'}</b>`,
            confirm: '记下了'
          }, []);
        }
      } else if (cands.length) {
        this.pushEvent('ai-thinking', { playerId: seer.id, label: '正在查验…' });
        const ai = new AIPlayer(seer, this.llm);
        const r = await ai.seerCheck(this);
        const target = this.byId(r.target);
        seer.checks.push({ id: target.id, name: target.name, isWolf: target.role === 'wolf', round: this.round });
        seer.thoughts.push({ round: this.round, phase: '夜', text: r.reason });
      }
    }

    const witch = this.alivePlayers().find(p => p.role === 'witch');
    if (witch) {
      const victim = this.nightKill != null ? this.byId(this.nightKill) : null;
      if (witch.isHuman) {
        if (witch.antidote && victim) {
          const v = await this.waitHuman('pick', {
            title: '女巫的夜晚',
            html: `今晚被刀的是 <b>${victim.name}</b>。要用解药救他吗？`,
            confirm: null
          }, [
            { label: '用解药救他', value: 'save' },
            { label: '不救', value: 'no' }
          ]);
          if (v === 'save') { this.saved = true; witch.antidote = false; this.log('你使用了解药', 'night'); }
        }
        if (!this.saved && witch.poison) {
          const cands = this.alivePlayers().filter(p => p.id !== witch.id);
          const v = await this.waitHuman('pick', {
            title: '要下毒吗',
            html: '毒药只有一瓶，用错会害死好人。',
            confirm: null
          }, [{ label: '今晚不毒', value: '' }].concat(cands.map(p => ({ label: `毒 ${p.name}`, value: p.id }))));
          if (v !== '') { this.poisonId = v; witch.poison = false; this.log('你使用了毒药', 'night'); }
        }
      } else {
        this.pushEvent('ai-thinking', { playerId: witch.id, label: '正在权衡用药…' });
        const ai = new AIPlayer(witch, this.llm);
        const r = await ai.witchAction(this, victim);
        if (r.save && witch.antidote && victim) { this.saved = true; witch.antidote = false; }
        if (r.poison && witch.poison) { this.poisonId = r.poison; witch.poison = false; }
        witch.thoughts.push({ round: this.round, phase: '夜', text: r.reason });
      }
    }

    const dead = [];
    if (this.nightKill != null && !this.saved) dead.push(this.byId(this.nightKill));
    if (this.poisonId != null) {
      const p = this.byId(this.poisonId);
      if (p && !dead.includes(p)) dead.push(p);
    }
    dead.forEach(p => this._kill(p));
    this.lastNightText = dead.length ? `${dead.map(p => p.name).join('、')} 出局` : '平安夜';
    this.pushEvent('night-settle', { dead: dead.map(p => p.id), text: this.lastNightText });
  }

  _kill(p) {
    p.alive = false;
    p.deadRound = this.round;
  }

  /* ---------- 白天 ---------- */

  async day() {
    this.phase = 'day';
    this.pushEvent('phase', { label: `第 ${this.round} 天`, phase: 'day' });
    this.log(`—— 第 ${this.round} 天 ——`, 'day');

    const deaths = this.players.filter(p => !p.alive && p.deadRound === this.round);
    this.log(deaths.length ? `昨夜 ${deaths.map(p => p.name).join('、')} 出局` : '昨夜是平安夜', deaths.length ? 'death' : 'sys');

    // 发言：死者下一位开始
    const order = this._speechOrder();
    for (const p of order) {
      if (!p.alive || this._stopped) continue;
      if (p.isHuman) {
        const text = await this.waitHuman('input', {
          title: '轮到你发言',
          html: '说点什么？可以踩人、可以跳身份、也可以先过。',
          confirm: '发言'
        }, []);
        const say = String(text || '').trim() || '我这轮先过，听你们的。';
        this.publicLog.push(`第${this.round}天 ${p.name}：${say}`);
        this.pushEvent('speech', { playerId: p.id, name: p.name, emoji: p.emoji, text: say, isHuman: true });
      } else {
        this.pushEvent('ai-thinking', { playerId: p.id, label: '思考中…' });
        const ai = new AIPlayer(p, this.llm);
        const r = await ai.speak(this);
        this.publicLog.push(`第${this.round}天 ${p.name}：${r.speech}`);
        p.voteIntent = r.vote;
        p.thoughts.push({ round: this.round, phase: '昼', text: r.reason });
        this.pushEvent('speech', { playerId: p.id, name: p.name, emoji: p.emoji, text: r.speech, isHuman: false });
      }
    }

    // 投票
    this.phase = 'vote';
    const alive = this.alivePlayers();
    const votes = [];
    for (const p of alive) {
      if (this._stopped) return;
      let target = p.voteIntent;
      if (p.isHuman) {
        const v = await this.waitHuman('pick', {
          title: '投票放逐',
          html: '你这一票投给谁？',
          confirm: null
        }, alive.filter(x => x.id !== p.id).map(x => ({ label: `${x.emoji} ${x.name}`, value: x.id })));
        target = v;
      } else if (target == null || !this.byId(target) || !this.byId(target).alive || target === p.id) {
        const ai = new AIPlayer(p, this.llm);
        const r = await ai.vote(this);
        target = r.target;
        p.thoughts.push({ round: this.round, phase: '票', text: r.reason });
      }
      if (target != null) {
        votes.push({ voter: p.id, target });
        this.log(`${p.name} → ${this.byId(target).name}`, 'vote');
        this.pushEvent('vote', { voter: p.id, target });
      }
    }
    p_vote_done: {
      if (!votes.length) break p_vote_done;
      const counts = {};
      votes.forEach(v => { counts[v.target] = (counts[v.target] || 0) + 1; });
      let max = 0, top = [];
      Object.keys(counts).forEach(k => {
        if (counts[k] > max) { max = counts[k]; top = [Number(k)]; }
        else if (counts[k] === max) top.push(Number(k));
      });
      if (top.length > 1) {
        this.log('平票，本轮无人出局', 'sys');
        this.pushEvent('vote-result', { tie: true, names: top.map(id => this.byId(id).name) });
      } else {
        const out = this.byId(top[0]);
        out.alive = false;
        out.revealRole = true;
        out.deadRound = this.round;
        const rn = ROLES[out.role].name;
        this.log(`${out.name} 被放逐，身份是${rn}`, 'death');
        this.publicLog.push(`第${this.round}天 ${out.name} 被放逐，身份：${rn}`);
        this.pushEvent('vote-result', { tie: false, playerId: out.id, name: out.name, role: out.role, votes: max });
      }
    }
  }

  _speechOrder() {
    const alive = this.alivePlayers().slice().sort((a, b) => a.seat - b.seat);
    if (!alive.length) return [];
    const dead = this.players.filter(p => !p.alive && p.deadRound === this.round);
    let start = 0;
    if (dead.length) {
      const seat = dead[0].seat;
      start = alive.findIndex(p => p.seat > seat);
      if (start === -1) start = 0;
    } else {
      start = Math.floor(Math.random() * alive.length);
    }
    return alive.slice(start).concat(alive.slice(0, start));
  }

  _checkEnd() {
    const alive = this.alivePlayers();
    const wolves = alive.filter(p => p.role === 'wolf').length;
    const goods = alive.length - wolves;
    if (wolves === 0) { this.winner = 'good'; return true; }
    if (wolves >= goods) { this.winner = 'wolf'; return true; }
    return false;
  }

  stop() {
    this._stopped = true;
    if (this._resolveHuman) this._resolveHuman(null);
  }

  /** 归档数据（存战绩库） */
  archive() {
    return {
      playerName: this.playerName,
      playerRole: ROLES[this.human.role].name,
      result: this.winner || 'aborted',
      rounds: this.round,
      survivors: this.alivePlayers().length,
      detail: {
        players: this.players.map(p => ({ name: p.name, role: p.role, alive: p.alive })),
        log: this.publicLog,
        thoughts: this.players.filter(p => !p.isHuman).map(p => ({ name: p.name, role: p.role, thoughts: p.thoughts }))
      }
    };
  }
}

module.exports = { GameEngine };
