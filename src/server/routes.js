/**
 * API 路由（零依赖，基于原生 http）：
 *   GET  /api/health          服务与 LLM 通道状态
 *   GET  /api/models          可用模型列表
 *   POST /api/games           开局 { playerName } → { gameId }
 *   GET  /api/games/:id       对局快照（真人视角）
 *   GET  /api/games/:id/events?since=N  增量事件（轮询）
 *   POST /api/games/:id/action 提交真人动作 { value }
 *   POST /api/games/:id/quit  退出对局
 *   GET  /api/matches         战绩墙
 */
const { parse: parseUrl } = require('url');

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(s);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { return {}; }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ llm: import('../ai/llm-gateway').LLMGateway, rooms: import('./rooms').RoomManager, matchStore: import('../cloud/match-store').MatchStore }} ctx
 */
async function handleApi(req, res, ctx) {
  const parsed = parseUrl(req.url, true);
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  try {
    /* ---------- 服务状态 ---------- */
    if (path === '/api/health' && method === 'GET') {
      const t = await ctx.llm.selfTest();
      return json(res, 200, {
        ok: true,
        llm: { ok: t.ok, model: t.model || ctx.llm.label(), sec: t.sec, error: t.error || null, calls: ctx.llm.callCount },
        rooms: ctx.rooms.rooms.size
      });
    }

    if (path === '/api/models' && method === 'GET') {
      return json(res, 200, { models: ctx.llm.listModels(), current: ctx.llm.model && ctx.llm.model.id });
    }

    if (path === '/api/models/select' && method === 'POST') {
      const body = await readBody(req);
      if (!body.id) return json(res, 400, { error: 'missing id' });
      try {
        ctx.llm.selectModel(body.id);
        return json(res, 200, { ok: true, current: ctx.llm.model.id });
      } catch (e) {
        return json(res, 404, { error: e.message });
      }
    }

    /* ---------- 战绩 ---------- */
    if (path === '/api/matches' && method === 'GET') {
      const recent = await ctx.matchStore.recent(8);
      const stats = await ctx.matchStore.stats();
      return json(res, 200, { recent: recent.rows || [], stats });
    }

    /* ---------- 对局 ---------- */
    let m = path.match(/^\/api\/games\/([^/]+)(?:\/(events|action|quit|spectate))?$/);
    if (m) {
      const roomId = m[1];
      const sub = m[2] || '';
      const room = ctx.rooms.get(roomId);
      if (!room) return json(res, 404, { error: 'game not found' });

      if (method === 'GET' && !sub) {
        return json(res, 200, room.engine.snapshot(room.engine.human.id));
      }
      if (method === 'GET' && sub === 'events') {
        const since = Number(parsed.query.since || 0);
        const evs = room.engine.events.filter(e => e.seq > since);
        return json(res, 200, {
          version: room.engine.version,
          events: evs,
          snapshot: room.engine.snapshot(room.engine.human.id)
        });
      }
      if (method === 'POST' && sub === 'action') {
        const body = await readBody(req);
        const ok = room.engine.submitHuman(body.value === undefined ? null : body.value);
        if (!ok) return json(res, 409, { error: 'no pending action' });
        return json(res, 200, { ok: true });
      }
      if (method === 'POST' && sub === 'quit') {
        room.engine.stop();
        return json(res, 200, { ok: true });
      }
      /* 观战：只读事件流 */
      if (method === 'GET' && sub === 'spectate') {
        const since = Number(parsed.query.since || 0);
        const evs = room.engine.events.filter(e => e.seq > since);
        return json(res, 200, { version: room.engine.version, events: evs });
      }
    }

    if (path === '/api/games' && method === 'POST') {
      const body = await readBody(req);
      const room = ctx.rooms.create(String(body.playerName || '').slice(0, 8) || '你');
      /* 异步开跑：对局循环挂起在 waitHuman 上等待前端 action */
      room.engine.run().then(() => {
        if (room.engine.winner) ctx.rooms.archive(room.engine);
      }).catch(e => {
        room.engine.aborted = { reason: e.message };
        room.engine.pushEvent('aborted', { reason: e.message });
      });
      return json(res, 200, { gameId: room.engine.id });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

module.exports = { handleApi };
