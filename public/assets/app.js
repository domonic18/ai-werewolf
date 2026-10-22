/* 前端控制器：轮询服务端事件流，渲染 UI，提交真人动作。
 * 游戏逻辑全部在服务端（src/），本文件只做「显示 + 输入」。 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ROLE = { wolf: ['狼人', '🐺'], seer: ['预言家', '🔮'], witch: ['女巫', '🧪'], villager: ['平民', '🧑‍🌾'] };
  const POLL_MS = 1200;

  const App = {
    gameId: null,
    version: 0,
    pollTimer: null,
    lastSnapshot: null,

    async api(path, opts) {
      const r = await fetch('/api' + path, opts ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts)
      } : undefined);
      return r.json();
    },

    show(id) {
      ['screen-home', 'screen-game', 'screen-result'].forEach(x =>
        $(x).classList.toggle('active', x === id));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* ---------- 首页 ---------- */
    async boot() {
      const dot = $('aiStatus').querySelector('.dot');
      const text = $('aiStatusText');
      dot.className = 'dot warn';
      text.textContent = '正在检测服务与大模型通道…';
      try {
        const h = await this.api('/health');
        if (h.llm && h.llm.ok) {
          dot.className = 'dot ok';
          text.textContent = `大模型通道正常 · ${h.llm.sec}s · ${h.llm.model}（服务端调用）`;
          $('btnStart').disabled = false;
        } else {
          dot.className = 'dot bad';
          text.textContent = '大模型通道异常：' + ((h.llm && h.llm.error) || '未知') ;
        }
      } catch (e) {
        dot.className = 'dot bad';
        text.textContent = '服务不可达：' + e.message;
      }
      /* 模型下拉 */
      try {
        const m = await this.api('/models');
        const sel = $('modelSelect');
        sel.innerHTML = m.models.map(x =>
          `<option value="${esc(x.id)}">${esc(x.name)}${x.credits ? ' · ' + esc(x.credits) : ''}</option>`).join('');
        sel.value = m.current;
        sel.onchange = async () => {
          await this.api('/models/select', { id: sel.value });
          this.boot();
        };
      } catch (_) {}
      this.loadMatches();
    },

    async loadMatches() {
      try {
        const d = await this.api('/matches');
        const box = $('recentList');
        if (!d.recent || !d.recent.length) {
          box.innerHTML = '<div class="empty">还没有人对局过，你可以第一个</div>';
        } else {
          box.innerHTML = d.recent.map(r => {
            const win = r.result === 'good';
            const t = new Date(r.created_at);
            const when = isNaN(t.getTime()) ? '' : `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
            return `<div class="recent-item"><span class="who">${esc(r.player_name)}</span>` +
              `<span class="tag ${win ? 'win' : 'lose'}">${win ? '好人胜' : '狼人胜'}</span>` +
              `<span class="when">${r.rounds || '?'}轮 · ${when}</span></div>`;
          }).join('');
        }
        const st = d.stats;
        $('matchStats').textContent = st && st.total
          ? `${st.total} 局 · 好人胜率 ${Math.round(st.good / st.total * 100)}%` : '0 局';
      } catch (_) {}
    },

    /* ---------- 对局 ---------- */
    async startGame() {
      const name = ($('playerName').value || '').trim() || '你';
      $('btnStart').disabled = true;
      try {
        const r = await this.api('/games', { playerName: name });
        this.gameId = r.gameId;
        this.version = 0;
        $('speechList').innerHTML = '';
        $('logList').innerHTML = '';
        this.show('screen-game');
        this.pollLoop();
      } catch (e) {
        alert('开局失败：' + e.message);
        $('btnStart').disabled = false;
      }
    },

    async pollLoop() {
      if (!this.gameId) return;
      try {
        const d = await this.api(`/games/${this.gameId}/events?since=${this.version}`);
        this.version = d.version;
        this.render(d.snapshot, d.events);
      } catch (e) {
        /* 对局可能已被清理 */
      }
      if (this.gameId) this.pollTimer = setTimeout(() => this.pollLoop(), POLL_MS);
    },

    render(snap, events) {
      if (!snap) return;
      this.lastSnapshot = snap;
      /* 顶栏 */
      $('roundBadge').textContent = snap.phase === 'over'
        ? '对局结束' : (snap.phase === 'night' ? `第 ${snap.round} 夜` : `第 ${snap.round} 天`);
      if (snap.myRole) {
        const [n, e] = ROLE[snap.myRole];
        $('myRoleChip').innerHTML = `你是 <b>${e} ${n}</b>${snap.players.find(p => p.isHuman && !p.alive) ? ' · 已出局（观战）' : ''}`;
      }
      /* 座位 */
      $('seats').innerHTML = snap.players.map(p =>
        `<div class="seat${p.isHuman ? ' me' : ''}${p.alive ? '' : ' dead'}">` +
        `<div class="ava">${p.alive ? p.emoji : '💀'}</div>` +
        `<div class="nm">${esc(p.name)}</div>` +
        `<div class="st">${p.alive ? (p.isHuman ? '你' : '在线') : (p.revealed ? ROLE[p.revealed][0] : '已出局')}</div></div>`
      ).join('');
      /* 事件 */
      (events || []).forEach(ev => this.renderEvent(ev, snap));
      /* 待输入动作 */
      this.renderPending(snap);
    },

    renderEvent(ev, snap) {
      const p = ev.payload || {};
      if (ev.type === 'speech') {
        const box = $('speechList');
        const lastMark = box.querySelector('.daymark:last-of-type');
        const want = `第 ${snap.round} 天`;
        if (!lastMark || lastMark.textContent !== want) {
          const mk = document.createElement('div');
          mk.className = 'log-item night';
          mk.style.cssText = 'font-size:11px;color:#9fb2ff;margin-top:4px';
          mk.textContent = `— ${want} —`;
          box.appendChild(mk);
        }
        const el = document.createElement('div');
        el.className = 'speech-item' + (p.isHuman ? ' me-msg' : '');
        el.innerHTML = `<div class="who"><span class="e">${p.emoji}</span><span class="n">${esc(p.name)}</span></div>` +
          `<div class="txt">${esc(p.text)}</div>`;
        box.appendChild(el);
        box.scrollTop = box.scrollHeight;
        /* 舞台同步展示最新发言 */
        $('stageTitle').textContent = `${p.emoji} ${p.name}`;
        $('stageBody').innerHTML = esc(p.text);
        $('stageActions').innerHTML = '';
      } else if (ev.type === 'log') {
        const el = document.createElement('div');
        el.className = 'log-item ' + (p.tone || '');
        el.textContent = p.text;
        $('logList').appendChild(el);
        $('logList').scrollTop = $('logList').scrollHeight;
      } else if (ev.type === 'await-human') {
        this.showPrompt(p);
      } else if (ev.type === 'ai-thinking') {
        const pl = snap.players.find(x => x.id === p.playerId);
        $('stageTitle').textContent = pl ? `${pl.emoji} ${pl.name}` : 'AI';
        $('stageBody').innerHTML = `<div class="think">${esc(p.label)}<i></i><i></i><i></i></div>`;
      } else if (ev.type === 'night-settle') {
        $('stageTitle').textContent = '天亮了';
        $('stageBody').innerHTML = p.dead.length
          ? `昨晚倒下的是 <b style="color:var(--wolf)">${esc(p.text.replace(' 出局', ''))}</b>。`
          : '昨晚是<b style="color:var(--good)">平安夜</b>。';
      } else if (ev.type === 'vote-result') {
        $('stageTitle').textContent = '投票结果';
        $('stageBody').innerHTML = p.tie
          ? `平票（${p.names.map(esc).join('、')}），本轮无人被放逐。`
          : `<b>${esc(p.name)}</b> 被放逐，身份是 <b>${ROLE[p.role][1]} ${ROLE[p.role][0]}</b>。`;
      } else if (ev.type === 'aborted') {
        $('stageTitle').textContent = 'AI 掉线了';
        $('stageBody').innerHTML = '本局 AI 发言完全依赖云服务大模型，调用失败后不用假话术顶替。<br><br>失败原因：<b style="color:var(--wolf)">' + esc(p.reason) + '</b>';
        this.stopGame(false);
      } else if (ev.type === 'game-over') {
        this.showResult(p);
        this.stopGame(false);
      }
    },

    showPrompt(p) {
      $('stageTitle').textContent = p.prompt.title;
      $('stageBody').innerHTML = p.prompt.html;
      const act = $('stageActions');
      act.innerHTML = '';
      if (p.prompt.confirm) {
        const b = document.createElement('button');
        b.className = 'btn primary';
        b.textContent = p.prompt.confirm;
        b.onclick = () => this.submit(1);
        act.appendChild(b);
      } else if (p.kind === 'input') {
        const ta = document.createElement('textarea');
        ta.rows = 2; ta.className = 'input'; ta.style.cssText = 'width:100%;resize:none;margin-bottom:10px';
        ta.placeholder = '例如：我是好人，我怀疑老K在带节奏…';
        act.appendChild(ta);
        const b = document.createElement('button');
        b.className = 'btn primary';
        b.textContent = '发言';
        b.onclick = () => this.submit(ta.value);
        act.appendChild(b);
      } else if (p.options && p.options.length) {
        p.options.forEach(o => {
          const b = document.createElement('button');
          b.className = 'btn choice';
          b.textContent = o.label;
          b.onclick = () => this.submit(o.value);
          act.appendChild(b);
        });
      }
    },

    renderPending(snap) {
      /* 轮询恢复：若界面还没有提示而服务端在等待，重新渲染 */
      if (snap.pendingAction && !$('stageActions').children.length) {
        this.showPrompt({
          kind: snap.pendingAction.kind,
          prompt: snap.pendingAction.prompt,
          options: snap.pendingAction.options
        });
      }
    },

    async submit(value) {
      if (!this.gameId) return;
      $('stageActions').innerHTML = '';
      await this.api(`/games/${this.gameId}/action`, { value });
      /* 立刻拉一次，降低等待感 */
      clearTimeout(this.pollTimer);
      this.pollLoop();
    },

    async stopGame(callQuit) {
      if (callQuit && this.gameId) {
        try { await this.api(`/games/${this.gameId}/quit`, {}); } catch (_) {}
      }
      clearTimeout(this.pollTimer);
      this.gameId = null;
    },

    showResult(p) {
      const humanRole = this.lastSnapshot && this.lastSnapshot.myRole;
      const humanWin = humanRole && ((p.winner === 'good') === (humanRole !== 'wolf'));
      $('resultIcon').textContent = humanWin ? '🏆' : '💀';
      $('resultTitle').textContent = p.winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利';
      $('resultTitle').style.color = p.winner === 'good' ? 'var(--good)' : 'var(--wolf)';
      $('resultSub').textContent = humanRole ? `你扮演 ${ROLE[humanRole][0]}，${humanWin ? '这一局站对了边' : '这局输了 —— 复盘里能看到 AI 怎么骗你的'}。` : '';
      $('revealList').innerHTML = p.reveal.map(r =>
        `<div class="reveal"><span class="e">${ROLE[r.role][1]}</span>` +
        `<span class="n">${esc(r.name)}${r.isHuman ? '（你）' : ''}</span>` +
        `<span class="r">${ROLE[r.role][0]}${r.alive ? '' : ' · 出局'}</span></div>`).join('');
      $('thoughts').innerHTML = p.thoughts.map(t =>
        `<div class="thought"><div class="h">🤖 ${esc(t.name)} <span class="role">${ROLE[t.role][0]}</span></div>` +
        t.thoughts.map(x => `<p>第${x.round}${x.phase}：${esc(x.text)}</p>`).join('') + '</div>'
      ).join('') || '<div class="empty">这一局 AI 没留下内心记录</div>';
      $('resultLog').innerHTML = p.log.map(x => `<div class="log-item">${esc(x)}</div>`).join('');
      this.show('screen-result');
    }
  };

  window.App = App;
  document.addEventListener('DOMContentLoaded', () => {
    App.boot();
    $('btnStart').onclick = () => App.startGame();
    $('btnQuit').onclick = async () => { await App.stopGame(true); App.show('screen-home'); App.loadMatches(); };
    $('btnAgain').onclick = async () => { await App.stopGame(false); App.show('screen-home'); App.boot(); };
    $('recTabs').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      $('recTabs').querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      $('speechList').style.display = btn.dataset.tab === 'speech' ? 'flex' : 'none';
      $('logList').style.display = btn.dataset.tab === 'events' ? 'flex' : 'none';
    });
  });
})();
