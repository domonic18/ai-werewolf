#!/usr/bin/env node
/**
 * 线上回归冒烟：对已部署实例跑一遍关键链路。
 *
 * 与 tests/ 里的单测互补——那些用 Mock LLM 验逻辑，这个用真实实例验「部署之后是否真的能用」。
 * 每次发版后跑一遍，失败即以非 0 退出，可直接挂在发布脚本或 CI 后。
 *
 *   node tools/live-smoke.mjs
 *   node tools/live-smoke.mjs --base https://xxx.app.workbuddy.host --sharecode ABC123
 *   node tools/live-smoke.mjs --skip-game        # 只验静态与契约，不消耗模型额度
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = argOf('base', 'https://werewolf-ai-01048.app.workbuddy.host').replace(/\/$/, '');
const SHARECODE = argOf('sharecode', '2IBHTRFFFL');
const SKIP_GAME = args.includes('--skip-game');
const TIMEOUT_MS = Number(argOf('timeout', '30000'));

/** 分享链接靠 query 参数放行，所有请求都要带上 */
const url = (path, extra = '') => {
  const sep = path.includes('?') ? '&' : '?';
  const tail = extra ? `&${extra}` : '';
  return `${BASE}${path}${sep}sharecode=${encodeURIComponent(SHARECODE)}${tail}`;
};

const results = [];
let failed = 0;

const check = async (name, fn) => {
  const startedAt = Date.now();
  try {
    const detail = await fn();
    results.push({ ok: true, name, ms: Date.now() - startedAt, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (error) {
    failed += 1;
    results.push({ ok: false, name, ms: Date.now() - startedAt, detail: error.message });
    console.log(`  ✗ ${name} — ${error.message}`);
    return false;
  }
};

const skip = (name, reason) => {
  failed += 1;
  results.push({ ok: false, name, ms: 0, detail: reason, skipped: true });
  console.log(`  ⊘ ${name} — 跳过：${reason}`);
};

const assert = (cond, message) => {
  if (!cond) throw new Error(message);
};

const request = async (path, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url(path), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const json = async (path, init) => {
  const res = await request(path, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`期望 JSON，实际返回 ${res.status} ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
  }
  return { status: res.status, body };
};

const postJson = (path, payload, token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Player-Token'] = token;
  return json(path, { method: 'POST', headers, body: JSON.stringify(payload ?? {}) });
};

const getWith = (path, token) => {
  const headers = token ? { 'X-Player-Token': token } : undefined;
  return json(path, { headers });
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`\n线上回归 · ${BASE}\n`);

/* ---------- 1. 可用性 ---------- */
console.log('[1/7] 站点可用性');

await check('首页可访问且挂载 React 根节点', async () => {
  const res = await request('/');
  assert(res.status === 200, `HTTP ${res.status}`);
  const html = await res.text();
  assert(html.includes('id="root"'), 'HTML 里没有 #root');
  assert(html.includes('/assets/index-'), 'HTML 里没有构建产物引用');
  return `${html.length} bytes`;
});

let llmReady = false;

await check('/api/health 正常且 AI 通道就绪', async () => {
  const { status, body } = await json('/api/health');
  assert(status === 200, `HTTP ${status}`);
  assert(body.ok === true, 'ok 不为 true');
  assert(body.env === 'production' || body.env === 'staging', `env 缺失或非法：${body.env}`);
  assert(typeof body.llm?.state === 'string', 'llm.state 缺失');
  llmReady = body.llm.state === 'ready' && body.llm.ok === true;
  return `env=${body.env} llm=${body.llm.state}(${body.llm.model}, ${body.llm.sec}s)`;
});

/* ---------- 2. 静态资源与兜底（P0-3 回归） ---------- */
console.log('\n[2/7] 静态资源与 404 语义');

await check('构建产物 JS 可加载', async () => {
  const page = await request('/');
  const html = await page.text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  assert(asset, 'HTML 中没有 assets 引用');
  const res = await request(asset);
  assert(res.status === 200, `${asset} → HTTP ${res.status}`);
  const size = (await res.arrayBuffer()).byteLength;
  assert(size > 10000, `产物过小：${size} bytes`);
  return `${asset} · ${size} bytes`;
});

await check('前端产物里带分享码逻辑（否则网关会拦下 POST）', async () => {
  const page = await request('/');
  const html = await page.text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  assert(asset, 'HTML 中没有 assets 引用');
  const js = await (await request(asset)).text();
  /* 平台网关对 POST 要求带 sharecode；前端漏带时浏览器只报 Failed to fetch，
     所以这里对产物做一次静态断言，避免「curl 全绿、真人点不动」的回归 */
  assert(js.includes('sharecode='), '构建产物里没有 sharecode 处理逻辑');
  return 'ok';
});

await check('缺失的静态资源返回 404（不再伪装成 index.html）', async () => {
  const res = await request('/assets/definitely-missing-deadbeef.js');
  assert(res.status === 404, `期望 404，实际 ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  assert(!type.includes('text/html'), `404 却返回了 HTML：${type}`);
  return 'HTTP 404 text/plain';
});

await check('深链导航仍回落到 index.html', async () => {
  const res = await request('/some/deep/link', { headers: { Accept: 'text/html' } });
  assert(res.status === 200, `期望 200，实际 ${res.status}`);
  const html = await res.text();
  assert(html.includes('id="root"'), '回落内容不是 index.html');
  return 'SPA fallback OK';
});

/* ---------- 3. 大厅契约 ---------- */
console.log('\n[3/7] 大厅接口契约');

await check('/api/live 返回分页字段', async () => {
  const { status, body } = await json('/api/live');
  assert(status === 200, `HTTP ${status}`);
  assert(Array.isArray(body.games), 'games 不是数组');
  assert('nextCursor' in body, '缺少 nextCursor');
  assert(typeof body.total === 'number', '缺少 total');
  return `games=${body.games.length} total=${body.total} nextCursor=${body.nextCursor ?? 'null'}`;
});

await check('大厅条目不包含玩家私有字段', async () => {
  const { body } = await json('/api/live');
  for (const game of body.games) {
    assert(!('myRole' in game), '大厅条目泄露 myRole');
    assert(!('pendingAction' in game), '大厅条目泄露 pendingAction');
    assert(typeof game.phaseLabel === 'string', '缺少 phaseLabel');
  }
  return `${body.games.length} 条已校验`;
});

/* ---------- 4. 开局与凭证（P0-a 回归） ---------- */
console.log('\n[4/7] 开局与玩家凭证');

let gameId = null;
let token = null;

if (SKIP_GAME) {
  skip('开局下发 gameId 与 playerToken', '--skip-game');
} else if (!llmReady) {
  skip('开局下发 gameId 与 playerToken', 'AI 通道未就绪（llm.state !== ready）');
} else {
  await check('开局下发 gameId 与 playerToken', async () => {
    const { status, body } = await postJson('/api/games', { playerName: '回归' });
    assert(status === 200, `HTTP ${status} ${JSON.stringify(body).slice(0, 120)}`);
    assert(body.gameId, '缺少 gameId');
    assert(/^[0-9a-f]{32}$/.test(body.playerToken ?? ''), `playerToken 格式不对：${body.playerToken}`);
    gameId = body.gameId;
    token = body.playerToken;
    return `gameId=${gameId}`;
  });
}

await check('无凭证读快照被拒绝（401，而不是交出真人身份）', async () => {
  /* 用真实对局验才有意义：不存在的 id 会先命中 404 */
  assert(gameId, '需要一个真实对局才能验证');
  const res = await request(`/api/games/${gameId}`);
  assert(res.status === 401, `期望 401，实际 ${res.status}`);
  const body = await res.json();
  assert(body.error === 'player_token_required', `错误码不对：${body.error}`);
  return 'HTTP 401 player_token_required';
});

await check('错误凭证同样被拒绝', async () => {
  assert(gameId, '需要一个真实对局才能验证');
  const res = await request(`/api/games/${gameId}`, { headers: { 'X-Player-Token': 'f'.repeat(32) } });
  assert(res.status === 401, `期望 401，实际 ${res.status}`);
  return 'HTTP 401';
});

await check('无凭证也不能提交动作', async () => {
  assert(gameId, '需要一个真实对局才能验证');
  const res = await request(`/api/games/${gameId}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: 1 }),
  });
  assert(res.status === 401, `期望 401，实际 ${res.status}`);
  return 'HTTP 401';
});

await check('不存在的对局返回 404', async () => {
  const res = await request('/api/games/not-a-real-game');
  assert(res.status === 404, `期望 404，实际 ${res.status}`);
  return 'HTTP 404';
});

if (gameId) {
  /* ---------- 5. 对局链路 ---------- */
  console.log('\n[5/7] 真实对局链路');

  await check('带凭证可读快照，且不含观战专属字段', async () => {
    const { status, body } = await getWith(`/api/games/${gameId}`, token);
    assert(status === 200, `HTTP ${status}`);
    assert(body.myRole, '快照缺少 myRole（玩家视角应有）');
    assert(!('factions' in body), '玩家快照不应包含 factions');
    return `role=${body.myRole} round=${body.round}`;
  });

  let handled = 0;
  let aiSpeech = null;
  let cursor = 0;
  const deadline = Date.now() + 120_000;

  /* 边推进边收事件：夜间挂起点答完后还要等第一轮白天发言，所以不能「答满 3 次就停」 */
  while (Date.now() < deadline) {
    await sleep(1500);

    const { body: chunk } = await getWith(`/api/games/${gameId}/events?since=${cursor}`, token);
    for (const ev of chunk.events) {
      if (ev.seq > cursor) cursor = ev.seq;
      if (ev.type === 'speech' && ev.payload.isHuman === false) aiSpeech = ev.payload;
    }

    const { body: snap } = await getWith(`/api/games/${gameId}`, token);
    if (snap.aborted) throw new Error(`对局中止：${snap.aborted.reason}`);
    if (snap.phase === 'over') break;

    /* 既有 3 次真人应答，又已经看到 AI 发言，才认为链路验全了 */
    if (handled >= 3 && aiSpeech) break;

    if (snap.pendingAction) {
      const action = snap.pendingAction;
      const value = action.kind === 'input' ? '我是好人，先听一圈再判断。' : (action.options?.[0]?.value ?? 1);
      const { status } = await postJson(`/api/games/${gameId}/action`, { value }, token);
      assert(status === 200, `action ${action.kind} → HTTP ${status}`);
      handled += 1;
    }
  }

  await check('真人可推进至少 3 个决策点', async () => {
    assert(handled >= 3, `只推进了 ${handled} 次`);
    return `${handled} 次应答`;
  });

  await check('事件流可读，且 game-start 不泄露真人身份', async () => {
    const { status, body } = await getWith(`/api/games/${gameId}/events?since=0`, token);
    assert(status === 200, `HTTP ${status}`);
    assert(body.events.length > 0, '事件流为空');
    const start = body.events.find((e) => e.type === 'game-start');
    assert(start, '缺少 game-start 事件');
    assert(!('myRole' in start.payload), 'game-start 泄露了 myRole');
    assert(!('players' in start.payload), 'game-start 泄露了玩家私有数据');
    return `${body.events.length} events`;
  });

  await check('AI 发言由模型生成（非固定话术）', async () => {
    assert(aiSpeech, '整段流程里没有等到任何 AI 发言');
    const { body } = await getWith(`/api/games/${gameId}/events?since=0`, token);
    /* 只看 AI 的发言：真人自己输入本来就是短的，那是用户写的 */
    const aiSpeeches = body.events.filter((e) => e.type === 'speech' && e.payload.isHuman === false);
    const text = String(aiSpeech.text ?? '');
    assert(text.length >= 15, `AI 发言过短，疑似兜底话术：${text}`);
    return `${aiSpeeches.length} 条 · ${aiSpeech.name}：「${text.slice(0, 36)}…」`;
  });

  /* ---------- 6. 观战投影（P0-1 回归） ---------- */
  console.log('\n[6/7] 观战投影');

  await check('观战无需凭证，且返回上帝视角', async () => {
    const { status, body } = await json(`/api/games/${gameId}/spectate?since=0&client=smoke`);
    assert(status === 200, `HTTP ${status}`);
    assert(body.snapshot, '缺少 snapshot');
    const seats = body.snapshot.players ?? [];
    assert(seats.length > 0, '座位为空');
    assert(seats.every((s) => typeof s.role === 'string'), '有座位缺身份，上帝视角不成立');
    assert(seats.every((s) => s.camp === 'wolf' || s.camp === 'good'), '有座位缺阵营');
    const wolf = body.snapshot.factions?.wolf;
    assert(wolf && wolf.total > 0, 'factions 缺失');
    assert(!('pendingAction' in body.snapshot), '观战投影泄露了 pendingAction');
    assert(!('myRole' in body.snapshot), '观战投影不该有 myRole');
    assert(typeof body.spectators === 'number', '缺少 spectators');
    assert(Array.isArray(body.snapshot.timeline), '观战投影缺少 timeline');
    return `${seats.length} 座 · 狼 ${wolf.alive}/${wolf.total} · 观战 ${body.spectators} · 时间轴 ${body.snapshot.timeline.length} 轮`;
  });

  await check('观战者拿不到凭证也无法操作', async () => {
    const res = await request(`/api/games/${gameId}/quit`, { method: 'POST' });
    assert(res.status === 401, `期望 401，实际 ${res.status}`);
    return 'HTTP 401';
  });

  await check('退出对局可用', async () => {
    const { status } = await postJson(`/api/games/${gameId}/quit`, {}, token);
    assert(status === 200, `HTTP ${status}`);
    return 'HTTP 200';
  });
} else {
  skip('对局链路与观战投影', '没有可用的对局');
}

/* ---------- 7. 账号边界 ---------- */
console.log('\n[7/7] 账号边界（未登录/坏凭证都不能冒充身份）');

await check('匿名「我的对局」返回空，不退化成全部对局', async () => {
  const all = await json('/api/live?filter=all');
  const mine = await json('/api/live?filter=mine');
  assert(all.status === 200 && mine.status === 200, `HTTP ${all.status}/${mine.status}`);
  assert(mine.body.total === 0, `期望 0 局，实际 ${mine.body.total}`);
  assert(all.body.total >= mine.body.total, '「全部」反而不比「我的」多');
  return `全部 ${all.body.total} 局 · 我的 ${mine.body.total} 局`;
});

await check('伪造 Bearer 不会换来别人的对局（降级匿名）', async () => {
  const res = await json('/api/live?filter=mine', { headers: { Authorization: 'Bearer forged.token.value' } });
  assert(res.status === 200, `期望 200（降级匿名），实际 ${res.status}`);
  assert(res.body.total === 0, `伪造凭证竟然查到 ${res.body.total} 局`);
  return 'HTTP 200 · 0 局';
});

await check('战绩 mine=1 未登录回落全网，scope=all', async () => {
  const { status, body } = await json('/api/matches?mine=1');
  assert(status === 200, `HTTP ${status}`);
  assert(body.scope === 'all', `期望 scope=all，实际 ${body.scope}`);
  return `scope=${body.scope} · ${body.recent?.length ?? 0} 行`;
});

/* ---------- 8. 汇总 ---------- */
const passed = results.filter((r) => r.ok).length;
const skipped = results.filter((r) => r.skipped).length;
console.log(`\n${'─'.repeat(52)}`);
console.log(
  `通过 ${passed}/${results.length}${failed ? `，失败 ${failed}${skipped ? `（其中跳过 ${skipped}）` : ''}` : '，全部通过'}`,
);
if (failed) {
  console.log('\n失败项：');
  for (const r of results.filter((x) => !x.ok)) console.log(`  · ${r.name} — ${r.detail}`);
}
console.log('');
process.exit(failed ? 1 : 0);
