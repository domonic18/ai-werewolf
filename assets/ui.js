/* 界面层：渲染、交互、结算 */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const UI = {
    game: null,
    pending: null,
    typing: true,

    /* ---------- 屏幕切换 ---------- */
    show(id) {
      ['screen-home', 'screen-game', 'screen-result'].forEach(x => {
        $(x).classList.toggle('active', x === id);
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* ---------- 首页 ---------- */
    async boot() {
      const ok = Cloud.init();
      const statusDot = $('aiStatus').querySelector('.dot');
      const statusText = $('aiStatusText');
      const modelSelect = $('modelSelect');

      if (!ok) {
        statusDot.className = 'dot bad';
        statusText.textContent = '云服务未连接：' + (Cloud.error || '未知原因');
        $('btnStart').disabled = true;
        modelSelect.disabled = true;
      } else {
        const ready = await AI.init(Cloud.client);
        if (!ready) {
          statusDot.className = 'dot bad';
          statusText.textContent = '模型列表不可用（' + (AI.lastError || AI.status) + '）';
          $('btnStart').disabled = true;
          modelSelect.disabled = true;
          this.loadRecent();
          return;
        }
        /* 填充模型下拉框 */
        modelSelect.innerHTML = AI.modelOptions().map(o =>
          '<option value="' + o.id + '">' + o.label.replace(/</g, '&lt;') + '</option>'
        ).join('');
        modelSelect.value = AI.model.id;
        modelSelect.onchange = () => {
          AI.selectModel(modelSelect.value);
          try { localStorage.setItem('ww_model', modelSelect.value); } catch (_) {}
          this.selfCheck();
        };
        try {
          const saved = localStorage.getItem('ww_model');
          if (saved && AI.models.some(m => m.id === saved)) {
            modelSelect.value = saved;
            AI.selectModel(saved);
          }
        } catch (_) {}
        await this.selfCheck();
      }
      this.loadRecent();
    },

    async selfCheck() {
      const statusDot = $('aiStatus').querySelector('.dot');
      const statusText = $('aiStatusText');
      statusDot.className = 'dot warn';
      statusText.textContent = '正在实测大模型通道…';
      $('btnStart').disabled = true;
      const t = await AI.selfTest();
      if (t.ok) {
        statusDot.className = 'dot ok';
        statusText.textContent = t.msg;
        $('btnStart').disabled = false;
      } else {
        statusDot.className = 'dot bad';
        statusText.textContent = t.msg;
        $('btnStart').disabled = true;
      }
    },

    async loadRecent() {
      const box = $('recentList');
      const res = await Cloud.recent(8);
      if (!res.ok) {
        box.innerHTML = '<div class="empty">云端战绩暂不可用</div>';
        $('matchStats').textContent = '—';
        return;
      }
      if (!res.rows.length) {
        box.innerHTML = '<div class="empty">还没有人对局过，你可以第一个</div>';
      } else {
        box.innerHTML = res.rows.map(r => {
          const win = r.result === 'good';
          const who = esc(r.player_name || '匿名玩家');
          const t = new Date(r.created_at);
          const when = isNaN(t.getTime()) ? '' :
            (t.getMonth() + 1) + '/' + t.getDate() + ' ' +
            String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
          return `<div class="recent-item">
            <span class="who">${who}</span>
            <span class="tag ${win ? 'win' : 'lose'}">${win ? '好人胜' : '狼人胜'}</span>
            <span class="when">${r.rounds || '?'}轮 · ${when}</span>
          </div>`;
        }).join('');
      }
      const st = await Cloud.stats();
      if (st && st.total) {
        const rate = Math.round((st.good / st.total) * 100);
        $('matchStats').textContent = `${st.total} 局 · 好人胜率 ${rate}%`;
      } else {
        $('matchStats').textContent = '0 局';
      }
    },

    /* ---------- 对局 ---------- */
    enter(game) {
      this.game = game;
      $('logList').innerHTML = '';
      $('speechList').innerHTML = '';
      this.show('screen-game');
      this.sync(game);
      const r = ROLE_DEF[game.me.role];
      $('myRoleChip').innerHTML = `你是 <b>${r.emoji} ${r.name}</b>`;
      return this.choice(
        '天黑了',
        `这一局你拿到的是 <b style="color:var(--gold)">${r.emoji} ${r.name}</b>。<br>` +
        (game.me.role === 'wolf'
          ? '队友会在夜里现身。白天记得藏好，别急着咬人。'
          : game.me.role === 'seer'
            ? '每晚可以验一个人，白天想办法把信息传出去又不被狼盯上。'
            : game.me.role === 'witch'
              ? '一瓶解药、一瓶毒药，全局各一次。用错比不用更伤。'
              : '没有技能，靠听、靠问、靠票。'),
        [{ label: '开始', value: 1, cls: 'choice' }]
      );
    },

    phase(label, role, alive) {
      $('roundBadge').textContent = label;
      const r = ROLE_DEF[role];
      $('myRoleChip').innerHTML = alive
        ? `你是 <b>${r.emoji} ${r.name}</b>`
        : `你是 <b>${r.emoji} ${r.name}</b> · 已出局（观战）`;
    },

    sync(game) {
      const box = $('seats');
      box.innerHTML = game.players.map(p => {
        const me = p.isHuman;
        const cls = [
          'seat',
          me ? 'me' : '',
          p.alive ? '' : 'dead',
          game.currentSpeaker === p.id ? 'speaking' : ''
        ].join(' ');
        const st = p.alive
          ? (me ? '你' : '在线')
          : (p.revealRole ? ROLE_DEF[p.role].name : '已出局');
        return `<div class="${cls}" id="seat-${p.id}">
          <div class="ava">${p.alive ? p.emoji : '💀'}</div>
          <div class="nm">${esc(p.name)}</div>
          <div class="st">${esc(st)}</div>
        </div>`;
      }).join('');
    },

    log(text, tone) {
      const el = document.createElement('div');
      el.className = 'log-item ' + (tone || '');
      el.textContent = text;
      $('logList').appendChild(el);
      $('logList').scrollTop = $('logList').scrollHeight;
    },

    /* 发言存档：逐人逐条沉淀，永不覆盖，可随时回看 */
    speech(round, player, text, isMe) {
      const box = $('speechList');
      if (!box) return;
      const lastMark = box.querySelector('.daymark:last-of-type');
      const wantMark = `第 ${round} 天`;
      if (!lastMark || lastMark.textContent !== wantMark) {
        const mk = document.createElement('div');
        mk.className = 'log-item night';
        mk.style.cssText = 'font-size:11px;color:#9fb2ff;margin-top:4px';
        mk.textContent = `— ${wantMark} —`;
        box.appendChild(mk);
      }
      const el = document.createElement('div');
      el.className = 'speech-item' + (isMe ? ' me-msg' : '');
      el.innerHTML = `<div class="who"><span class="e">${player.emoji}</span><span class="n">${esc(player.name)}</span></div>` +
        `<div class="txt">${esc(text)}</div>`;
      box.appendChild(el);
      box.scrollTop = box.scrollHeight;
    },

    /* 标签页切换 */
    bindTabs() {
      const tabs = $('recTabs');
      if (!tabs) return;
      tabs.addEventListener('click', e => {
        const btn = e.target.closest('.tab');
        if (!btn) return;
        tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
        $('speechList').style.display = btn.dataset.tab === 'speech' ? 'flex' : 'none';
        $('logList').style.display = btn.dataset.tab === 'events' ? 'flex' : 'none';
      });
    },

    /* AI 调用失败：亮明原因并终止对局（绝不拿假话术继续） */
    abortOnLLMFailure(err) {
      const msg = (err && err.message) || '未知错误';
      this.log('⚠ 大模型调用失败，对局中止：' + msg, 'death');
      $('stageTitle').textContent = 'AI 掉线了';
      $('stageBody').innerHTML = '这次对局的 AI 发言完全依赖云服务大模型，调用失败后不会用假话术顶替。<br><br>失败原因：<b style="color:var(--wolf)">' +
        msg.replace(/</g, '&lt;') + '</b><br><br>可以先回首页看通道状态，恢复后再开一局。';
      $('stageActions').innerHTML = '';
      if (window.__game) window.__game.stopped = true;
    },

    showStage(title, html) {
      $('stageTitle').textContent = title;
      $('stageBody').innerHTML = html;
      $('stageActions').innerHTML = '';
    },

    choice(title, bodyHtml, options) {
      return new Promise(resolve => {
        const g = this.game;
        if (g && g.stopped) return;
        $('stageTitle').textContent = title;
        $('stageBody').innerHTML = bodyHtml;
        const act = $('stageActions');
        act.innerHTML = '';
        options.forEach(o => {
          const b = document.createElement('button');
          b.className = 'btn ' + (o.cls || 'choice');
          b.textContent = o.label;
          b.onclick = () => {
            act.querySelectorAll('button').forEach(x => x.disabled = true);
            resolve(o.value);
          };
          act.appendChild(b);
        });
      });
    },

    input(title, bodyHtml, placeholder, chips) {
      return new Promise(resolve => {
        const g = this.game;
        if (g && g.stopped) return;
        $('stageTitle').textContent = title;
        $('stageBody').innerHTML = bodyHtml + `
          <div style="margin-top:12px">
            <textarea id="sayInput" rows="2" class="input" style="width:100%;resize:none;line-height:1.6"
              placeholder="${esc(placeholder)}"></textarea>
            <div class="chips" id="sayChips"></div>
          </div>`;
        const act = $('stageActions');
        act.innerHTML = '';
        const send = document.createElement('button');
        send.className = 'btn primary';
        send.textContent = '发言';
        send.onclick = () => {
          const v = ($('sayInput').value || '').trim();
          act.innerHTML = '';
          resolve(v);
        };
        act.appendChild(send);

        const chipBox = $('sayChips');
        (chips || []).forEach(c => {
          const s = document.createElement('span');
          s.className = 'chip';
          s.textContent = c;
          s.onclick = () => { $('sayInput').value = c; $('sayInput').focus(); };
          chipBox.appendChild(s);
        });
      });
    },

    thinking(playerId, label) {
      const p = this.game && this.game.byId(playerId);
      const name = p ? p.name : 'AI';
      $('stageTitle').textContent = `${name} 的回合`;
      $('stageBody').innerHTML = `<div class="think">${esc(label)}<i></i><i></i><i></i></div>`;
      $('stageActions').innerHTML = '';
      this.sync(this.game);
    },

    /* 把发言打在舞台上（打字机效果），同时存档到发言记录 */
    bubble(playerId, text) {
      const p = this.game.byId(playerId);
      $('stageTitle').textContent = `${p.emoji} ${p.name}`;
      const body = $('stageBody');
      body.innerHTML = '';
      $('stageActions').innerHTML = '';
      const span = document.createElement('span');
      const tail = document.createElement('span');
      tail.className = 'speaker';
      body.appendChild(span);
      body.appendChild(tail);

      /* 完整发言先入档，不怕舞台闪过 */
      if (this.game && this.game.round) {
        this.speech(this.game.round, p, String(text || ''), p.isHuman);
      }

      const full = String(text || '');
      if (!this.typing) { span.textContent = full; return Promise.resolve(); }

      return new Promise(resolve => {
        let i = 0;
        const step = Math.max(12, Math.min(30, 1100 / Math.max(full.length, 1)));
        const timer = setInterval(() => {
          i += 2;
          span.textContent = full.slice(0, i);
          if (i >= full.length) {
            clearInterval(timer);
            span.textContent = full;
            resolve();
          }
        }, step);
      });
    },

    /* ---------- 结算 ---------- */
    async end(game) {
      if (!game.winner) {
        // 超过轮次上限仍未结束
        game.winner = game.aliveWolves().length >= game.aliveOthers().length ? 'wolf' : 'good';
      }
      const humanWin = (game.winner === 'good') === (game.me.role !== 'wolf');
      const win = game.winner === 'good';

      $('resultIcon').textContent = humanWin ? '🏆' : '💀';
      $('resultTitle').textContent = win ? '好人阵营胜利' : '狼人阵营胜利';
      $('resultTitle').style.color = win ? 'var(--good)' : 'var(--wolf)';
      $('resultSub').innerHTML = humanWin
        ? `你扮演 ${ROLE_DEF[game.me.role].name}，这一局站对了边。`
        : `你扮演 ${ROLE_DEF[game.me.role].name}，这局输了 —— 但复盘里能看到 AI 是怎么骗你的。`;

      $('revealList').innerHTML = game.players.map(p => {
        const r = ROLE_DEF[p.role];
        return `<div class="reveal">
          <span class="e">${r.emoji}</span>
          <span class="n">${esc(p.name)}${p.isHuman ? '（你）' : ''}</span>
          <span class="r">${r.name}${p.alive ? '' : ' · 出局'}</span>
        </div>`;
      }).join('');

      const thoughts = [];
      game.players.filter(p => !p.isHuman).forEach(p => {
        (p.thoughts || []).forEach(t => {
          thoughts.push(`<div class="thought">
            <div class="h">${p.emoji} ${esc(p.name)}
              <span class="role">${ROLE_DEF[p.role].name} · 第${t.round}${t.phase}</span>
            </div>
            <p>${esc(t.text)}</p>
          </div>`);
        });
      });
      $('thoughts').innerHTML = thoughts.length
        ? thoughts.join('')
        : '<div class="empty">这一局 AI 没留下内心记录</div>';

      $('resultLog').innerHTML = game.publicLog
        .map(x => `<div class="log-item">${esc(x)}</div>`).join('') ||
        '<div class="empty">无记录</div>';

      this.show('screen-result');

      /* 保存到云端 */
      const state = $('saveState');
      state.textContent = '正在写入云端战绩…';
      const res = await Cloud.saveMatch({
        playerName: game.playerName,
        playerRole: ROLE_DEF[game.me.role].name,
        result: game.winner,
        rounds: game.round,
        survivors: game.alive().length,
        detail: {
          players: game.players.map(p => ({ name: p.name, role: p.role, alive: p.alive })),
          log: game.publicLog,
          thoughts: game.players.filter(p => !p.isHuman).map(p => ({ name: p.name, role: p.role, thoughts: p.thoughts }))
        }
      });
      state.textContent = res.ok
        ? `战绩已写入云端 #${res.id}，战绩墙上可见`
        : `战绩写入失败：${res.error}（不影响本局结果）`;
    }
  };

  window.UI = UI;

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    UI.boot();
    UI.bindTabs();

    $('btnStart').onclick = () => {
      const name = ($('playerName').value || '').trim() || '你';
      $('btnStart').disabled = true;
      const game = new Game(UI, { name });
      window.__game = game;
      game.run().finally(() => { $('btnStart').disabled = false; });
    };

    $('btnQuit').onclick = () => {
      if (window.__game) window.__game.stop();
      UI.show('screen-home');
      UI.loadRecent();
    };

    $('btnAgain').onclick = () => {
      UI.show('screen-home');
      UI.loadRecent();
      $('btnStart').click();
    };
  });
})();
