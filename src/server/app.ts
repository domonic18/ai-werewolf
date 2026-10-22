/**
 * HTTP 应用装配：/api/** 走路由，其余走前端产物（dist/client）。
 * 与进程启动解耦，便于测试里在进程内起服务。
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './routes.js';
import type { ApiContext } from './routes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** dist-server/server/ 与 src/server/ 都在项目的第二层，因此统一上跳两级 */
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');
export const STATIC_DIR = path.join(PROJECT_ROOT, 'dist', 'client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export interface AppOptions extends ApiContext {
  staticDir?: string;
}

async function serveStatic(res: http.ServerResponse, staticDir: string, urlPath: string): Promise<void> {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = decoded === '/' ? '/index.html' : decoded;
  const file = path.normalize(path.join(staticDir, relative));

  if (!file.startsWith(staticDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await fs.readFile(file);
    const ext = path.extname(file);
    /* Vite 产物带内容 hash，可长缓存；index.html 必须每次校验，避免"看到旧界面" */
    const isHashed = relative.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
    });
    res.end(body);
  } catch {
    /* 单页应用兜底：非静态资源路径一律回 index.html */
    try {
      const html = await fs.readFile(path.join(staticDir, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] as string, 'Cache-Control': 'no-cache, must-revalidate' });
      res.end(html);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('前端产物缺失：请先执行 npm run build');
    }
  }
}

export function createApp(options: AppOptions): http.Server {
  const staticDir = options.staticDir ?? STATIC_DIR;
  const ctx: ApiContext = { llm: options.llm, rooms: options.rooms, matchStore: options.matchStore };

  return http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      void handleApi(req, res, ctx);
      return;
    }
    void serveStatic(res, staticDir, url);
  });
}
