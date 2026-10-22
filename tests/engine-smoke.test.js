/* 对局引擎冒烟测试：Mock LLM，验证流程闭环与胜负判定 */
const assert = require('assert');
const { GameEngine } = require('../src/game/engine');

/* Mock LLM：返回合法 JSON，行为可预期 */
function mockLLM() {
  return {
    label: () => 'mock',
    async task(sys, user) {
      const w = /狼人.*杀|要杀/.test(sys + user);
      const s = /预言家.*查验|要查验/.test(sys + user);
      const h = /女巫/.test(sys);
      const sp = /白天发言/.test(sys);
      const vt = /投票放逐/.test(sys) || /现在投票/.test(sys);
      if (w) return { target: 'TARGET', reason: 'r' };
      if (s) return { target: 'TARGET', reason: 'r' };
      if (h) return { save: false, poison: '', reason: 'r' };
      if (sp) return { speech: '我是好人。', vote: 'TARGET', reason: 'r' };
      if (vt) return { vote: 'TARGET', reason: 'r' };
      return { ok: true };
    }
  };
}

/* matchPlayerByName 在 AIPlayer 中处理名字；这里 mock 直接回 TARGET 需引擎兼容，
   因此用 AIPlayer 的真实路径太重——本测试聚焦引擎流程：真人全选第一个选项 */
async function runOnce(i) {
  const events = [];
  const engine = new GameEngine({
    playerName: '测试' + i,
    llm: mockLLM(),
    emit: ev => events.push(ev)
  });
  /* 自动应答真人输入：永远选第一个选项 / 固定发言 */
  const autoAnswer = setInterval(() => {
    if (engine.pendingAction && engine._resolveHuman) {
      const kind = engine.pendingAction.kind;
      if (kind === 'input') engine.submitHuman('我听一轮。');
      else if (kind === 'ack') engine.submitHuman(1);
      else engine.submitHuman(engine.pendingAction.options.length ? engine.pendingAction.options[0].value : 1);
    }
  }, 5);
  try {
    await engine.run();
  } finally {
    clearInterval(autoAnswer);
  }
  return { engine, events };
}

(async () => {
  let good = 0, wolf = 0, aborted = 0;
  const rounds = [];
  for (let i = 0; i < 10; i++) {
    const { engine, events } = await runOnce(i);
    if (engine.aborted) { aborted++; console.log('ABORTED', engine.aborted.reason); continue; }
    assert(engine.winner === 'good' || engine.winner === 'wolf', 'winner 必须有值');
    engine.winner === 'good' ? good++ : wolf++;
    rounds.push(engine.round);
    /* 事件流完整性 */
    assert(events.some(e => e.type === 'game-start'), '应有 game-start');
    assert(events.some(e => e.type === 'speech'), '应有 speech');
    assert(events.some(e => e.type === 'vote-result'), '应有 vote-result');
    assert(engine.snapshot(engine.human.id).myRole, '真人视角应含身份');
    /* 快照不泄露身份给观战者 */
    const spec = engine.snapshot(-1);
    assert(spec.myRole === null, '观战者不能看到真人身份');
  }
  console.log(`engine smoke: 10 局 OK (good=${good}, wolf=${wolf}, aborted=${aborted}, avgRounds=${(rounds.reduce((a, b) => a + b, 0) / rounds.length).toFixed(2)})`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
