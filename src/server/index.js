/**
 * HTTP 服务器：静态文件（public/）+ API（/api/**）。
 * 零运行时依赖（云 SDK 除外），单端口，绑定 0.0.0.0 + PORT（sites 沙箱要求）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('./routes');
const { createLLMGateway } = require('../ai/llm-gateway');
const { MatchStore } = require('../cloud/match-store');
const { RoomManager } = require('./rooms');

const PUB = path.join(__dirname, '..', '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

async function main() {
  /* 配置查找顺序（开源仓库零密钥）：
     1) 环境变量 WB_ENDPOINT / WB_PUBLISHABLE_KEY
     2) config/cloud.json（本地开发用，已被 .gitignore 忽略；模板见 config/cloud.example.json）
     3) .workbuddy/deploy-config.json —— sites 沙箱内由发布配置写入的部署期配置 */
  let fileCfg = {};
  const cfgPaths = [path.join(__dirname, '..', '..', 'config', 'cloud.json'), '/workspace/.workbuddy/deploy-config.json'];
  for (const p of cfgPaths) {
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      fileCfg = Object.assign(fileCfg, c);
    } catch (_) { /* 缺失即跳过 */ }
  }
  const publicConfig = {
    endpoint: process.env.WB_ENDPOINT || fileCfg.endpoint,
    publishableKey: process.env.WB_PUBLISHABLE_KEY || fileCfg.publishableKey,
    oauthRelayBaseUrl: process.env.WB_OAUTH_RELAY || fileCfg.oauthRelayBaseUrl || undefined
  };
  if (!publicConfig.endpoint || !publicConfig.publishableKey) {
    throw new Error('缺少云服务配置：请设置 WB_* 环境变量，或复制 config/cloud.example.json 为 config/cloud.json 填入 publicConfig');
  }

  const llm = await createLLMGateway(publicConfig);
  const cloud = llm.cloud; /* 同一客户端：DB 与 LLM 共用 */
  const matchStore = new MatchStore(cloud);
  const rooms = new RoomManager({ llm, matchStore });
  const ctx = { llm, rooms, matchStore };

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return handleApi(req, res, ctx);
    return serveStatic(req, res);
  });

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`[werewolf-ai] listening on :${port}, llm=${llm.label()}, models=${llm.models.length}`);
  });
  return server;
}

if (require.main === module) {
  main().catch(e => { console.error('[werewolf-ai] fatal:', e); process.exit(1); });
}

module.exports = { main };
