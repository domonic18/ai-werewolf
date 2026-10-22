/* 游戏引擎：6 人局，人类 + AI Agent 补位 */
(function () {
  const ROLE_DEF = {
    wolf: { name: '狼人', emoji: '🐺', team: 'wolf' },
    seer: { name: '预言家', emoji: '🔮', team: 'good' },
    witch: { name: '女巫', emoji: '🧪', team: 'good' },
    villager: { name: '平民', emoji: '🧑‍🌾', team: 'good' }
  };

  const CAST = [
    { name: '老K', emoji: '🕶️', persona: '沉稳老练，说话短促，喜欢抓别人话里的逻辑漏洞' },
    { name: '小满', emoji: '🍊', persona: '热情话多，爱打比方，容易冲动站边' },
    { name: '阿岚', emoji: '🧊', persona: '冷静理性，爱讲概率和可能性，句子像简报' },
    { name: '豆豆', emoji: '🍬', persona: '新手感，语气软，凭直觉说话但经常意外地准' },
    { name: '七喜', emoji: '🎭', persona: '阴阳怪气，爱反讽拱火，喜欢逼人表态' }
  ];

  const SPEECH_CHIPS = [
    '我是好人，先听后面怎么说',
    '我怀疑他发言太虚，先给个压力',
    '我是预言家，手里有验人信息',
    '别急着票，先把信息过一轮'
  ];

  function shuffle(a) {
    const arr = a.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  class Game {
    constructor(ui, opts) {
      this.ui = ui;
      this.playerName = (opts && opts.name) || '你';
      this.players = [];
      this.round = 0;
      this.publicLog = [];
      this.seerChecks = [];
      this.seerChecksPrivate = [];
      this.lastNightText = '';
      this.stopped = false;
      this.winner = null;
      this.humanId = 0;
    }

    /* ---------- 初始化 ---------- */
    setup() {
      const roles = shuffle(['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager']);
      const seats = shuffle([0, 1, 2, 3, 4, 5]);
      const cast = shuffle(CAST).slice(0, 5);

      this.players = [];
      this.players.push({
        id: 0, seat: seats[0] + 1, name: this.playerName, isHuman: true,
        emoji: '😎', persona: '你自己', role: roles[0], alive: true,
        antidote: roles[0] === 'witch', poison: roles[0] === 'witch',
        thoughts: [], voteIntent: null
      });
      for (let i = 0; i < 5; i++) {
        this.players.push({
          id: i + 1, seat: seats[i + 1] + 1, name: cast[i].name, isHuman: false,
          emoji: cast[i].emoji, persona: cast[i].persona, role: roles[i + 1], alive: true,
          antidote: roles[i + 1] === 'witch', poison: roles[i + 1] === 'witch',
          thoughts: [], voteIntent: null
        });
      }
      this.players.sort((a, b) => a.seat - b.seat);
      this.me = this.players.find(p => p.isHuman);
    }

    byId(id) { return this.players.find(p => p.id === id); }
    alive() { return this.players.filter(p => p.alive); }
    aliveWolves() { return this.alive().filter(p => p.role === 'wolf'); }
    aliveOthers() { return this.alive().filter(p => p.role !== 'wolf'); }
    roleOf(p) { return ROLE_DEF[p.role]; }

    log(text, tone) {
      this.ui.log(text, tone || '');
    }

    /* ---------- 主流程 ---------- */
    async run() {
      this.setup();
      await this.ui.enter(this);
      if (this.stopped) return;
      await this.pause(300);

      while (!this.stopped) {
        this.round++;
        await this.night();
        if (this.checkEnd()) break;
        await this.day();
        if (this.checkEnd()) break;
        if (this.round > 8) break;
      }

      if (this.stopped) return;
      this.finish();
    }

    pause(ms) { return new Promise(r => setTimeout(r, ms)); }

    /* ---------- 夜晚 ---------- */
    async night() {
      this.phase = 'night';
      this.ui.phase(`第 ${this.round} 夜`, this.me.role, this.me.alive);
      this.log(`—— 第 ${this.round} 夜 ——`, 'night');
      this.nightKill = null;
      this.saved = false;
      this.poisonId = null;

      const wolves = this.aliveWolves();
      const humanWolf = wolves.find(p => p.isHuman);

      /* 狼人刀人 */
      if (wolves.length) {
        if (humanWolf) {
          const cands = this.alive().filter(p => p.role !== 'wolf');
          const mates = wolves.filter(p => !p.isHuman).map(p => p.name);
          if (cands.length) {
            const v = await this.ui.choice(
              '狼人行动',
              `你的队友：<b>${mates.join('、') || '（没有其他狼）'}</b><br>今晚要杀谁？`,
              cands.map(p => ({ label: `${p.emoji} ${p.name}`, value: p.id, cls: 'choice' }))
            );
            if (v === null) return;
            this.nightKill = v;
            this.log(`狼人选择了目标（你参与了决策）`, 'night');
          }
        } else {
          const leader = wolves[0];
          this.ui.thinking(leader.id, '和队友商议中…');
          let r;
          try {
            r = await AI.wolfKill(this, leader);
          } catch (e) {
            return this.ui.abortOnLLMFailure(e);
          }
          if (r && r.target != null) {
            this.nightKill = r.target;
            if (r.reason) leader.thoughts.push({ round: this.round, phase: '夜', text: r.reason });
            this.log('狼人完成了选择', 'night');
          }
        }
      }

      /* 预言家验人 */
      const seer = this.alive().find(p => p.role === 'seer');
      if (seer) {
        const checked = new Set(this.seerChecks.map(c => c.id));
        const cands = this.alive().filter(p => p.id !== seer.id && !checked.has(p.id));
        let target = null;
        if (seer.isHuman) {
          if (cands.length) {
            const v = await this.ui.choice(
              '预言家查验',
              '今晚要验谁？验过的人不会重复出现。',
              cands.map(p => ({ label: `${p.emoji} ${p.name}`, value: p.id, cls: 'choice' }))
            );
            if (v === null) return;
            target = v;
          }
        } else {
          this.ui.thinking(seer.id, '正在查验…');
          let r;
          try {
            r = await AI.seerCheck(this, seer);
          } catch (e) {
            return this.ui.abortOnLLMFailure(e);
          }
          target = r && r.target;
          if (r && r.reason) seer.thoughts.push({ round: this.round, phase: '夜', text: r.reason });
        }
        if (target != null) {
          const p = this.byId(target);
          const isWolf = p.role === 'wolf';
          this.seerChecks.push({ id: p.id, name: p.name, isWolf: isWolf, round: this.round });
          if (seer.isHuman) {
            await this.ui.choice(
              '查验结果',
              `<b>${p.name}</b> 的身份是：<b style="color:${isWolf ? 'var(--wolf)' : 'var(--good)'}">${isWolf ? '狼人' : '好人'}</b>`,
              [{ label: '记下了', value: 1, cls: 'choice' }]
            );
          }
        }
      }

      /* 女巫 */
      const witch = this.alive().find(p => p.role === 'witch');
      if (witch) {
        const victim = this.nightKill != null ? this.byId(this.nightKill) : null;
        if (witch.isHuman) {
          if (witch.antidote && victim) {
            const v = await this.ui.choice(
              '女巫的夜晚',
              `今晚被刀的是 <b>${victim.name}</b>。要用解药救他吗？`,
              [
                { label: '用解药救他', value: 'save', cls: 'safe' },
                { label: '不救', value: 'no', cls: 'choice' }
              ]
            );
            if (v === null) return;
            if (v === 'save') { this.saved = true; witch.antidote = false; this.log('你使用了解药', 'night'); }
          }
          if (!this.saved && witch.poison) {
            const cands = this.alive().filter(p => p.id !== witch.id);
            const opts = [{ label: '今晚不毒', value: '', cls: 'choice' }]
              .concat(cands.map(p => ({ label: `毒 ${p.name}`, value: p.id, cls: 'danger' })));
            const v = await this.ui.choice('要下毒吗', '毒药只有一瓶，用错会害死好人。', opts);
            if (v === null) return;
            if (v !== '') { this.poisonId = v; witch.poison = false; this.log('你使用了毒药', 'night'); }
          }
        } else {
          this.ui.thinking(witch.id, '正在权衡用药…');
          let r;
          try {
            r = await AI.witchAction(this, witch, victim);
          } catch (e) {
            return this.ui.abortOnLLMFailure(e);
          }
          if (r && r.save && witch.antidote && victim) { this.saved = true; witch.antidote = false; }
          if (r && r.poison && witch.poison) { this.poisonId = r.poison; witch.poison = false; }
          if (r && r.reason) witch.thoughts.push({ round: this.round, phase: '夜', text: r.reason });
        }
      }

      /* 结算 */
      const dead = [];
      if (this.nightKill != null && !this.saved) dead.push(this.byId(this.nightKill));
      if (this.poisonId != null) {
        const p = this.byId(this.poisonId);
        if (p && !dead.includes(p)) dead.push(p);
      }
      dead.forEach(p => this.kill(p));
      this.lastNightText = dead.length ? `${dead.map(p => p.name).join('、')} 出局` : '平安夜';
      this.ui.sync(this);
      this.ui.phase(`第 ${this.round} 夜`, this.me.role, this.me.alive);
    }

    kill(p) {
      p.alive = false;
      p.deadRound = this.round;
    }

    /* ---------- 白天 ---------- */
    async day() {
      this.phase = 'day';
      this.ui.phase(`第 ${this.round} 天`, this.me.role, this.me.alive);
      this.log(`—— 第 ${this.round} 天 ——`, 'day');

      const deaths = this.players.filter(p => !p.alive && p.deadRound === this.round);
      if (deaths.length) {
        this.log(`昨夜 ${deaths.map(p => p.name).join('、')} 出局`, 'death');
      } else {
        this.log('昨夜是平安夜', 'sys');
      }
      this.ui.showStage(
        `第 ${this.round} 天 · 天亮了`,
        deaths.length
          ? `昨晚倒下的是 <b style="color:var(--wolf)">${deaths.map(p => p.name).join('、')}</b>，身份不明。<br>存活 ${this.alive().length} 人，开始发言。`
          : `昨晚是<b style="color:var(--good)">平安夜</b>，没有人出局。<br>存活 ${this.alive().length} 人，开始发言。`
      );
      await this.pause(1100);
      this.ui.sync(this);
      if (this.checkEnd()) return;

      /* 发言 */
      const order = this.speechOrder();
      for (const p of order) {
        if (!p.alive || this.stopped) continue;
        this.currentSpeaker = p.id;
        this.ui.sync(this);

        if (p.isHuman) {
          const text = await this.ui.input(
            '轮到你发言',
            '说点什么？可以踩人、可以跳身份、也可以先过。',
            '例如：我是好人，我怀疑老K在带节奏…',
            SPEECH_CHIPS
          );
          if (text === null) { this.currentSpeaker = null; return; }
          const say = (text || '').trim() || '我这轮先过，听你们的。';
          this.publicLog.push(`第${this.round}天 ${p.name}：${say}`);
          this.ui.bubble(p.id, say);
          await this.pause(400);
        } else {
          this.ui.thinking(p.id, '思考中…');
          let r;
          try {
            r = await AI.speak(this, p);
          } catch (e) {
            return this.ui.abortOnLLMFailure(e);
          }
          const say = (r && r.speech) || '……';
          this.ui.bubble(p.id, say);
          this.publicLog.push(`第${this.round}天 ${p.name}：${say}`);
          if (r && r.reason) p.thoughts.push({ round: this.round, phase: '昼', text: r.reason });
          p.voteIntent = r ? r.vote : null;
          await this.pause(500);
        }
      }
      this.currentSpeaker = null;
      this.ui.sync(this);

      /* 投票 */
      const alive = this.alive();
      const votes = [];
      for (const p of alive) {
        if (this.stopped) return;
        let target = p.voteIntent;
        if (p.isHuman) {
          const opts = alive.filter(x => x.id !== p.id)
            .map(x => ({ label: `${x.emoji} ${x.name}`, value: x.id, cls: 'choice' }));
          const v = await this.ui.choice('投票放逐', '你这一票投给谁？', opts);
          if (v === null) return;
          target = v;
        } else if (target == null || !this.byId(target) || !this.byId(target).alive || target === p.id) {
          let r;
          try {
            r = await AI.vote(this, p);
          } catch (e) {
            return this.ui.abortOnLLMFailure(e);
          }
          target = r && r.target;
          if (r && r.reason) p.thoughts.push({ round: this.round, phase: '票', text: r.reason });
        }
        if (target != null) {
          votes.push({ voter: p.id, target: target });
          this.log(`${p.name} → ${this.byId(target).name}`, 'vote');
        }
        this.ui.sync(this);
      }

      if (!votes.length) return;

      const counts = {};
      votes.forEach(v => { counts[v.target] = (counts[v.target] || 0) + 1; });
      let max = 0, top = [];
      Object.keys(counts).forEach(k => {
        if (counts[k] > max) { max = counts[k]; top = [Number(k)]; }
        else if (counts[k] === max) top.push(Number(k));
      });

      if (top.length > 1) {
        this.log('平票，本轮无人出局', 'sys');
        this.ui.showStage('投票结果', `平票（${top.map(id => this.byId(id).name).join('、')} 各 ${max} 票），本轮无人被放逐。`);
        await this.pause(1400);
      } else {
        const out = this.byId(top[0]);
        out.alive = false;
        out.revealRole = true;
        out.deadRound = this.round;
        const rn = this.roleOf(out).name;
        this.log(`${out.name} 被放逐，身份是${rn}`, 'death');
        this.publicLog.push(`第${this.round}天 ${out.name} 被放逐，身份：${rn}`);
        this.ui.showStage(
          '投票结果',
          `<b>${out.name}</b> 以 ${max} 票被放逐，身份是 <b>${this.roleOf(out).emoji} ${rn}</b>。`
        );
        await this.pause(1500);
      }
      this.ui.sync(this);
    }

    speechOrder() {
      const alive = this.alive().slice().sort((a, b) => a.seat - b.seat);
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

    checkEnd() {
      const w = this.aliveWolves().length;
      const g = this.aliveOthers().length;
      if (w === 0) { this.winner = 'good'; return true; }
      if (w >= g) { this.winner = 'wolf'; return true; }
      return false;
    }

    finish() {
      this.over = true;
      if (!this.winner) {
        this.winner = this.aliveWolves().length >= this.aliveOthers().length ? 'wolf' : 'good';
      }
      this.ui.end(this);
    }

    stop() {
      this.stopped = true;
    }
  }

  window.Game = Game;
  window.ROLE_DEF = ROLE_DEF;
})();
