/**
 * 把线上页面导出成 Ardot 可导入的静态设计稿 HTML。
 *
 *   node tools/ardot-export.mjs http://localhost:4399 docs/designs-v2 assets.json
 *
 * - 去掉脚本，只留结构与样式（设计稿不需要跑逻辑）
 * - 内联构建产物里的 CSS，避免 Ardot 拉不到相对路径
 * - 图片内联成 base64：设计稿必须是「一个文件就能打开」，对方也访问不到本地资源
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = (process.argv[2] ?? 'http://localhost:4399').replace(/\/$/, '');
const outDir = process.argv[3] ?? 'docs/designs-v2';
const assetMapPath = process.argv[4];
mkdirSync(outDir, { recursive: true });

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const css = readFileSync('dist/client/assets/' + readFileSync('dist/client/index.html', 'utf8').match(/assets\/(index-[^"]+\.css)/)[1], 'utf8');
/* 图片内联：Ardot 的 HTML 解析在远端进行，本地相对路径一律读不到 */
const artDir = process.env.ART_DIR ?? 'tmp/design-art';
const artBase64 = new Map(
  readdirSync(artDir)
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => [f, `data:image/jpeg;base64,${readFileSync(join(artDir, f)).toString('base64')}`]),
);

const screens = [
  { name: '01-home-v2', path: '/' },
  { name: '02-setup-v2', path: '#setup' },
  { name: '03-match-v2', path: '/', game: true },
  { name: '04-spectate-v2', path: null },
  { name: '05-login-v2', path: '#login' },
  { name: '06-lobby-v2', path: '#lobby' },
];

async function api(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function playUntilSpeeches(gameId, token, want = 4) {
  for (let i = 0; i < 40; i++) {
    const { events } = await api(`/api/games/${gameId}/events?since=0`, { headers: { 'x-player-token': token } });
    if (events.filter((e) => e.type === 'speech').length >= want) return;
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

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'zh-CN' });
const page = await ctx.newPage();

const game = await api('/api/games', { method: 'POST', body: JSON.stringify({ playerName: '你' }) });
await playUntilSpeeches(game.gameId, game.playerToken, 4);

for (const screen of screens) {
  if (screen.game) {
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate((saved) => localStorage.setItem('ww_game', JSON.stringify(saved)), {
      id: game.gameId,
      token: game.playerToken,
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByText('继续').first().click();
    await page.waitForTimeout(1200);
  } else if (screen.path === null) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${base}/?s=${screen.name}#watch=${game.gameId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
  } else {
    /* 带唯一 query 强制重新加载：只改 hash 不会重新挂载 React，会拍到上一屏 */
    const [pathname, hash = ''] = screen.path.split('#');
    await page.goto(`${base}/?s=${screen.name}${hash ? `#${hash}` : ''}${pathname.length > 1 ? '' : ''}`, {
      waitUntil: 'networkidle',
    });
  }
  await page.waitForTimeout(800);

  /*
   * Ardot 的 HTML 转换会把内联 SVG 图标的描边吃掉（变成短横线），
   * 所以导出前把每个 svg 序列化成 data-URI 图片：视觉 100% 保真，也不会丢线宽。
   */
  await page.evaluate(() => {
    document.querySelectorAll('svg').forEach((svg) => {
      const w = svg.getAttribute('width') || '18';
      const h = svg.getAttribute('height') || '18';
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const cs = getComputedStyle(svg);
      const color = cs.stroke && cs.stroke !== 'none' ? cs.stroke : 'rgb(166, 161, 153)';
      clone.setAttribute('stroke', color);
      clone.setAttribute('fill', 'none');
      clone.addEventListener('DOMNodeInserted', () => {});
      const markup = new XMLSerializer().serializeToString(clone).replace(/currentColor/g, color);
      const img = document.createElement('img');
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
      img.setAttribute('width', w);
      img.setAttribute('height', h);
      img.style.width = `${w}px`;
      img.style.height = `${h}px`;
      img.style.display = 'block';
      svg.replaceWith(img);
    });
  });

  const html = await page.evaluate(() => document.documentElement.outerHTML);
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<link[^>]+rel="stylesheet"[^>]*>/gi, '')
    .replace(/<\/head>/, `<style>${css}</style></head>`)
    /* 视口 CSS 归 Ardot 所有，避免双重定位 */
    .replace(/body\s*{[^}]*}/, '')
    /* 图片内联 */
    .replace(/\/art\/([a-z-]+\.jpg)/g, (m, file) => artBase64.get(file) ?? m)
    .replace(/url\(["']?data:image\/jpeg;base64,([^"')]+)["']?\)/g, (m, b64) => `url("data:image/jpeg;base64,${b64}")`);

  writeFileSync(join(outDir, `${screen.name}.html`), cleaned);
  console.log(`✓ ${screen.name}.html`);
}

await browser.close();
