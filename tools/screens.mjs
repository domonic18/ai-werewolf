/**
 * 逐屏截图：用本机 Chrome（playwright-core 不下载浏览器）按 390×844 移动视口截六屏，
 * 用于设计走查与 README 配图。
 *
 *   npm run build && PORT=4399 npm start &
 *   node tools/screens.mjs http://localhost:4399 tmp/screens
 *
 * 对局中与观战需要一个真实对局：脚本自己调 /api/games 开局，
 * 然后把 playerToken 注入 localStorage（key: ww_game）再进页面，跟真人路径一致。
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:4399').replace(/\/$/, '');
const outDir = process.argv[3] ?? 'tmp/screens';
mkdirSync(outDir, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function api(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/**
 * 推进对局直到攒够发言：截图要拍到真实的发言气泡、发言顺序和票型，
 * 而不是刚开局的一片空白。
 */
async function playUntilSpeeches(gameId, token, want = 4, maxSteps = 40) {
  let speeches = 0;
  for (let i = 0; i < maxSteps; i++) {
    const events = await api(`/api/games/${gameId}/events?since=0`, { headers: { 'x-player-token': token } });
    speeches = events.events.filter((e) => e.type === 'speech').length;
    if (speeches >= want) return;
    const snapshot = await api(`/api/games/${gameId}`, { headers: { 'x-player-token': token } });
    const pending = snapshot.pendingAction;
    if (!pending) {
      await new Promise((r) => setTimeout(r, 900));
      continue;
    }
    const value = pending.kind === 'input' ? '我先听一圈，暂时不站边。' : (pending.options[0]?.value ?? 1);
    await api(`/api/games/${gameId}/action`, {
      method: 'POST',
      headers: { 'x-player-token': token },
      body: JSON.stringify({ value }),
    });
  }
}

const shots = [
  { name: 'home', hash: '' },
  { name: 'setup', hash: '#setup' },
  { name: 'lobby', hash: '#lobby' },
  { name: 'login', hash: '#login' },
];

/* 先开一局并推进到白天，首页/大厅才有「进行中」的真实内容 */
const game = await api('/api/games', { method: 'POST', body: JSON.stringify({ playerName: '你' }) });
await playUntilSpeeches(game.gameId, game.playerToken, 4);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
});
const page = await context.newPage();

for (const shot of shots) {
  await page.goto(`${base}/${shot.hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(outDir, `${shot.name}.png`), fullPage: true });
  console.log(`✓ ${shot.name}`);
}

/* 对局中：注入凭证后从首页「继续」进入，跟真人恢复路径一致 */
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.evaluate((saved) => localStorage.setItem('ww_game', JSON.stringify(saved)), {
  id: game.gameId,
  token: game.playerToken,
});
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('继续').first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(outDir, 'match.png'), fullPage: true });
console.log('✓ match');

/*
 * 夜幕：这是唯一「按时间才有」的画面 —— 天亮后过场就收了。
 * 一边用接口推进对局，一边看页面上有没有 .nc（过场）或 .ig-night（夜幕条），
 * 抓到就截图；抓不到不算失败（对局随机，真人可能是夜里要决策的那个角色）。
 */
async function captureNight(page, gameId, token, maxTries = 90) {
  for (let i = 0; i < maxTries; i++) {
    const snap = await api(`/api/games/${gameId}`, { headers: { 'x-player-token': token } });
    if (snap.phase === 'over') return false;

    /* 先答掉自己的夜间决策：轮到自己时过场会让位，等在这里只会拍到夜幕条 */
    if (snap.pendingAction) {
      const a = snap.pendingAction;
      const value = a.kind === 'input' ? '我先听一圈，暂时不站边。' : (a.options[0]?.value ?? 1);
      await api(`/api/games/${gameId}/action`, {
        method: 'POST',
        headers: { 'x-player-token': token },
        body: JSON.stringify({ value }),
      });
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    if (snap.phase === 'night') {
      if (await page.locator('.nc').count()) {
        await page.waitForTimeout(1500);
        await page.screenshot({ path: join(outDir, 'night.png') });
        return 'curtain';
      }
      /* 过场已经落幕（超过上限或刚跳过）才退而求其次拍夜幕条 */
      if (i > 10 && (await page.locator('.ig-night').count())) {
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, 'night.png'), fullPage: true });
        return 'strip';
      }
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

try {
  const kind = await captureNight(page, game.gameId, game.playerToken);
  console.log(kind ? `✓ night (${kind})` : '- night 未捕获（对局没走到夜里）');
} catch (e) {
  console.log(`- night 跳过：${e.message}`);
}

/* 观战：同一个对局，用一个干净的无凭证上下文打开 #watch 深链 */
const viewer = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
});
const watchPage = await viewer.newPage();
await watchPage.goto(`${base}/#watch=${game.gameId}`, { waitUntil: 'networkidle' });
await watchPage.waitForTimeout(1500);
await watchPage.screenshot({ path: join(outDir, 'spectate.png'), fullPage: true });
console.log('✓ spectate');

await browser.close();
