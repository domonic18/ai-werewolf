/* API 全链路自测：进程内启动服务并用 fetch 请求自己（绕开外部代理干扰） */
const assert = require('assert');

process.env.WB_ENDPOINT = process.env.WB_ENDPOINT || 'https://werewolf-ai-01048.app.workbuddy.host';
process.env.WB_PUBLISHABLE_KEY = process.env.WB_PUBLISHABLE_KEY || 'wbpk_SURA9O6OUcSeFbq1GDG40K_0O77zYi9SHc6fhZF5iVOvkcoGX6SP8kh';
process.env.PORT = '3987';

(async () => {
  const { main } = require('../src/server/index');
  const server = await main();
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const j = async (path, opts) => {
    const r = await fetch(base + path, opts);
    return { status: r.status, body: await r.json() };
  };

  /* health */
  const h = await j('/api/health');
  assert.strictEqual(h.status, 200);
  assert.ok(h.body.llm, 'health 应含 llm 状态');
  console.log('health OK:', h.body.llm.model, h.body.llm.sec + 's');

  /* models */
  const m = await j('/api/models');
  assert.ok(Array.isArray(m.body.models) && m.body.models.length > 0);
  console.log('models OK:', m.body.models.length, 'current:', m.body.current);

  /* 静态页 */
  const page = await fetch(base + '/');
  assert.strictEqual(page.status, 200);
  assert.ok((await page.text()).includes('AI 狼人杀'));
  console.log('static OK');

  /* 开局 */
  const g = await j('/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: '自测' })
  });
  assert.strictEqual(g.status, 200);
  const gameId = g.body.gameId;
  assert.ok(gameId);
  console.log('create game OK:', gameId);

  /* 轮询拿 pending 并自动应答几步（走真人确认 + 首夜） */
  let done = false;
  for (let i = 0; i < 40 && !done; i++) {
    await new Promise(r => setTimeout(r, 700));
    const s = await j(`/api/games/${gameId}`);
    const snap = s.body;
    if (snap.aborted) { console.log('aborted:', snap.aborted.reason); done = true; break; }
    if (snap.winner) { console.log('game over, winner =', snap.winner); done = true; break; }
    if (snap.pendingAction) {
      const pa = snap.pendingAction;
      let value = 1;
      if (pa.kind !== 'ack' && pa.kind !== 'input') {
        value = pa.options && pa.options.length ? pa.options[0].value : 1;
      }
      await j(`/api/games/${gameId}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value })
      });
    }
  }
  /* 事件流拉取 */
  const ev = await j(`/api/games/${gameId}/events?since=0`);
  assert.strictEqual(ev.status, 200);
  assert.ok(Array.isArray(ev.body.events) && ev.body.events.length > 0);
  console.log('events OK:', ev.body.events.length, '条');

  /* 快照隐私：不带真人 id 的观战视角不出身份（spectate 端点） */
  const sp = await fetch(base + `/api/games/${gameId}/spectate?since=0`);
  assert.strictEqual(sp.status, 200);
  console.log('spectate OK');

  /* 退出清理 */
  await j(`/api/games/${gameId}/quit`, { method: 'POST' });
  server.close();
  console.log('api selftest: ALL OK');
  process.exit(0);
})().catch(e => { console.error('SELFTEST FAIL:', e.message); process.exit(1); });
