/* AI 玩家：全部言行由云服务大模型实时生成，无任何写死的台词或规则话术 */
(function () {
  const ROLE_CN = { wolf: '狼人', seer: '预言家', witch: '女巫', villager: '平民' };

  const SYS_BASE = [
    '你正在参加一场中文「狼人杀」对局，扮演其中一个玩家。你的每一句话都必须像真实玩家：有情绪、有推理、会试探，也会为了阵营撒谎。',
    '规则：6 人局，狼人 2、预言家 1、女巫 1、平民 2。夜晚狼人刀人、预言家验人、女巫可用解药或毒药各一次；白天依次发言后投票放逐一人。狼人全灭好人胜；狼人数 ≥ 好人数狼人胜。',
    '严格输出：只输出一个 JSON 对象，不要 markdown 代码块，不要任何多余文字。'
  ].join('\n');

  const AI = {
    client: null,
    model: null,
    models: [],
    available: false,
    status: 'idle',
    lastError: '',
    lastCode: '',
    llmCalls: 0,

    /* 首选模型：速度快、消耗低，适合一局多轮调用 */
    PREFER_IDS: ['glm-5.3-flash', 'deepseek-v4.1-flash', 'hy3', 'auto'],

    async init(cloudClient) {
      this.client = cloudClient;
      if (!cloudClient) { this.status = 'no-cloud'; return false; }
      try {
        const models = await cloudClient.llm.models.list();
        const usable = (models || []).filter(m => m && m.disabled !== true && m.enabled !== false);
        this.models = usable;
        if (!usable.length) {
          this.status = 'no-model';
          this.lastError = '模型列表为空';
          return false;
        }
        const prefer = this.PREFER_IDS.map(id => usable.find(m => m.id === id)).filter(Boolean);
        this.model = prefer[0] || usable[0];
        this.available = true;
        this.status = 'ready';
        return true;
      } catch (e) {
        this.status = 'error';
        this.lastError = (e && (e.message || (e.error && e.error.code))) || String(e);
        return false;
      }
    },

    /* 供首页下拉框展示的选项 */
    modelOptions() {
      const preferSet = new Set(this.PREFER_IDS);
      const sorted = this.models.slice().sort((a, b) => {
        const pa = preferSet.has(a.id) ? 0 : 1;
        const pb = preferSet.has(b.id) ? 0 : 1;
        return pa - pb;
      });
      return sorted.map(m => ({
        id: m.id,
        label: (m.name || m.id) + (m.credits ? ' · ' + m.credits : '')
      }));
    },

    selectModel(id) {
      const m = this.models.find(x => x.id === id);
      if (m) this.model = m;
    },

    modelLabel() {
      return this.model ? (this.model.name || this.model.id) : '';
    },

    async raw(messages, temperature) {
      if (!this.available) throw new Error('AI 未就绪');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      let text = '';
      let reasoning = '';
      try {
        this.llmCalls++;
        for await (const chunk of this.client.llm.chat.completions.create({
          model: this.model.id,
          messages,
          stream: true,
          temperature: temperature == null ? 0.9 : temperature,
          response_format: { type: 'json_object' },
          signal: controller.signal
        })) {
          const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
          if (d && d.content) text += d.content;
          if (d && d.reasoning_content) reasoning += d.reasoning_content;
        }
      } finally {
        clearTimeout(timer);
      }
      /* 思考型模型可能把结果留在思考流里：content 为空时用 reasoning 兆底提取 */
      if (!text.trim() && reasoning.trim()) text = reasoning;
      this.lastRaw = text;
      return text;
    },

    parseJSON(text) {
      if (!text) return null;
      let t = String(text).trim();
      t = t.replace(/```(?:json)?/gi, '');
      /* 剥掉模型自己加的前后解释，提取第一个完整 JSON 对象 */
      const s = t.indexOf('{');
      if (s === -1) return null;
      let depth = 0, inStr = false, esc = false;
      for (let i = s; i < t.length; i++) {
        const c = t[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(t.slice(s, i + 1)); } catch (_) { return null; }
          }
        }
      }
      return null;
    },

    /* 单一入口：成功返回 JSON；失败抛出带原因的错误（不降级、不兜底、不造假话术） */
    async task(system, user, temperature) {
      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ];
      let lastErr = '未知错误';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const text = await this.raw(messages, temperature);
          const obj = this.parseJSON(text);
          if (obj) return obj;
          lastErr = '模型输出不是合法 JSON，原文前 80 字：' + String(this.lastRaw || text || '').slice(0, 80);
        } catch (e) {
          const code = e && e.error && e.error.code ? e.error.code : '';
          if (code) this.lastCode = code;
          lastErr = code
            ? code + ' ' + ((e.error && e.error.message) || '')
            : (e && e.name === 'AbortError' ? '请求超时(45s)' : ((e && e.message) || String(e)));
          if (code && code.indexOf('request_') === 0) break; /* 参数类错误，重试无意义 */
        }
      }
      this.lastError = lastErr;
      const err = new Error(lastErr);
      err.llmFailure = true;
      throw err;
    },

    /* 首页自检：真实调用一次大模型，确认整条链路（用当前选中的模型） */
    async selfTest() {
      if (!this.client) return { ok: false, msg: '云服务未初始化' };
      if (!this.model) {
        const models = await this.client.llm.models.list().catch(() => []);
        const usable = (models || []).filter(m => m && m.disabled !== true && m.enabled !== false);
        if (!usable.length) return { ok: false, msg: '模型列表为空，无法自检' };
        this.model = usable[0];
        this.available = true;
      }
      const t0 = Date.now();
      try {
        const obj = await this.task(
          'You are a precise assistant. Reply with JSON only.',
          '请只输出 {"ok":true} 这一个 JSON。',
          0.1
        );
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        if (obj && obj.ok) return { ok: true, msg: '大模型通道正常 · ' + sec + 's · ' + this.modelLabel() };
        return { ok: false, msg: '通道异常（' + sec + 's）：返回未通过校验' };
      } catch (e) {
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        return { ok: false, msg: '调用失败（' + sec + 's）：' + e.message };
      }
    },

    /* ---------- 局面描述 ---------- */
    publicBrief(game) {
      const alive = game.players.filter(p => p.alive).map(p => p.name);
      const lines = [];
      lines.push(`- 这是第 ${game.round} 天。`);
      lines.push(`- 存活玩家：${alive.join('、')}。`);
      if (game.lastNightText) lines.push(`- 昨夜：${game.lastNightText}`);
      const out = game.players.filter(p => !p.alive);
      if (out.length) {
        lines.push('- 已出局：' + out.map(p => `${p.name}（${p.revealRole ? ROLE_CN[p.role] : '身份未公开'}）`).join('、'));
      }
      if (game.publicLog.length) {
        lines.push('- 本局此前的发言与事件：');
        game.publicLog.slice(-24).forEach(x => lines.push(`  ${x}`));
      } else {
        lines.push('- 目前还没有人发言。');
      }
      return lines.join('\n');
    },

    privateBrief(game, me) {
      const parts = [`你的名字：${me.name}。你的性格：${me.persona}。你的身份：${ROLE_CN[me.role]}。请始终用这种性格说话和做决定。`];
      if (me.role === 'wolf') {
        const mates = game.players.filter(p => p.role === 'wolf' && p.id !== me.id);
        parts.push(`你的狼队友：${mates.map(m => `${m.name}${m.alive ? '' : '（已出局）'}`).join('、')}。你要隐藏身份，可以悍跳预言家或带节奏，但绝不要暴露队友。`);
      }
      if (me.role === 'seer') {
        const checks = game.seerChecks.map(c => `${c.name} 是${c.isWolf ? '狼人' : '好人'}`).join('；');
        parts.push(checks ? `你的查验记录：${checks}。` : '你还没有验过人。');
      }
      if (me.role === 'witch') {
        parts.push(`你的药：解药${me.antidote ? '还在' : '已用完'}，毒药${me.poison ? '还在' : '已用完'}。`);
      }
      if (me.thoughts && me.thoughts.length) {
        parts.push('你此前各回合的内心判断（保持连贯，不要自相矛盾）：');
        me.thoughts.slice(-6).forEach(t => parts.push(`  第${t.round}${t.phase}：${t.text}`));
      }
      return parts.join('\n');
    },

    /* ---------- 白天发言 + 投票意图 ---------- */
    async speak(game, me) {
      const sys = SYS_BASE + '\n你现在要完成：白天发言，并给出你这一轮打算投谁。';
      const user = [
        this.publicBrief(game),
        '',
        this.privateBrief(game, me),
        '',
        '请输出 JSON：{"speech":"你的发言（第一人称口语，贴合你的性格，40~80字）","vote":"你要投的存活玩家名字（不能是自己）","reason":"你真实的内心判断，一句话"}'
      ].join('\n');

      const obj = await this.task(sys, user, 0.95);
      const target = this.matchName(game, obj.vote, me);
      return {
        speech: String(obj.speech || '').slice(0, 160),
        vote: target,
        reason: String(obj.reason || '')
      };
    },

    /* ---------- 夜晚：狼人刀人 ---------- */
    async wolfKill(game, me) {
      const cands = game.players.filter(p => p.alive && p.role !== 'wolf');
      if (!cands.length) return null;
      const sys = SYS_BASE + '\n现在是夜晚，你（狼人）要和队友商定今晚杀谁。';
      const user = [
        this.publicBrief(game),
        '',
        this.privateBrief(game, me),
        '',
        `可以下手的对象：${cands.map(p => p.name).join('、')}。优先杀威胁大的（发言像预言家、带票能力强的人）。`,
        '请输出 JSON：{"target":"要杀的玩家名字","reason":"一句话理由"}'
      ].join('\n');

      const obj = await this.task(sys, user, 0.85);
      const t = this.matchName(game, obj.target, me);
      return { target: (t && cands.some(c => c.id === t)) ? t : cands[0].id, reason: String(obj.reason || '') };
    },

    /* ---------- 夜晚：预言家验人 ---------- */
    async seerCheck(game, me) {
      const done = new Set(game.seerChecks.map(c => c.id));
      const cands = game.players.filter(p => p.alive && p.id !== me.id && !done.has(p.id));
      if (!cands.length) return null;
      const sys = SYS_BASE + '\n现在是夜晚，你是预言家，要决定查验谁。';
      const user = [
        this.publicBrief(game),
        '',
        this.privateBrief(game, me),
        '',
        `还没验过的存活玩家：${cands.map(p => p.name).join('、')}。`,
        '请输出 JSON：{"target":"要查验的玩家名字","reason":"一句话理由"}'
      ].join('\n');

      const obj = await this.task(sys, user, 0.85);
      const t = this.matchName(game, obj.target, me);
      return { target: (t && cands.some(c => c.id === t)) ? t : cands[0].id, reason: String(obj.reason || '') };
    },

    /* ---------- 夜晚：女巫 ---------- */
    async witchAction(game, me, victim) {
      const sys = SYS_BASE + '\n现在是夜晚，你是女巫。你要决定用不用药。';
      const cands = game.players.filter(p => p.alive && p.id !== me.id);
      const user = [
        this.publicBrief(game),
        '',
        this.privateBrief(game, me),
        '',
        victim ? `今晚被狼人刀的是：${victim.name}。` : '今晚狼人似乎没有刀人。',
        me.antidote ? '你还有解药，可以救他。' : '你的解药已经用完了。',
        me.poison ? `你还有毒药，可以毒死场上任意一人：${cands.map(p => p.name).join('、')}。` : '你的毒药已经用完了。',
        '同一晚只能使用一种药。救人是善举但也可能救到狼；毒错人会害死好人。',
        '请输出 JSON：{"save":true或false,"poison":"要毒的玩家名字，不用就填空字符串","reason":"一句话理由"}'
      ].join('\n');

      const obj = await this.task(sys, user, 0.85);
      const out = { save: false, poison: null, reason: String(obj.reason || '') };
      if (obj.save === true && me.antidote && victim) out.save = true;
      if (!out.save && me.poison && obj.poison) {
        const t = this.matchName(game, obj.poison, me);
        if (t && cands.some(c => c.id === t)) out.poison = t;
      }
      return out;
    },

    /* ---------- 白天：补投票 ---------- */
    async vote(game, me) {
      const cands = game.players.filter(p => p.alive && p.id !== me.id);
      if (!cands.length) return null;
      const sys = SYS_BASE + '\n现在投票放逐一人。';
      const user = [
        this.publicBrief(game),
        '',
        this.privateBrief(game, me),
        '',
        `可投对象：${cands.map(p => p.name).join('、')}。`,
        '请输出 JSON：{"vote":"你要投的玩家名字","reason":"一句话理由"}'
      ].join('\n');
      const obj = await this.task(sys, user, 0.8);
      const t = this.matchName(game, obj.vote, me);
      return { target: (t && cands.some(c => c.id === t)) ? t : cands[0].id, reason: String(obj.reason || '') };
    },

    /* ---------- 工具 ---------- */
    matchName(game, raw, me) {
      if (!raw) return null;
      const s = String(raw).trim();
      const alive = game.players.filter(p => p.alive && p.id !== me.id);
      let hit = alive.find(p => p.name === s);
      if (hit) return hit.id;
      hit = alive.find(p => s.indexOf(p.name) !== -1);
      if (hit) return hit.id;
      const idx = parseInt(s.replace(/[^\d]/g, ''), 10);
      if (!isNaN(idx)) {
        const bySeat = game.players.find(p => p.seat === idx && p.alive && p.id !== me.id);
        if (bySeat) return bySeat.id;
      }
      return null;
    }
  };

  window.AI = AI;
})();
