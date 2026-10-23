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
import type { AppEnv } from '../shared/types.js';

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

export interface AppOptions extends Omit<ApiContext, 'env' | 'publicConfig'> {
  publicConfig?: ApiContext['publicConfig'];
  staticDir?: string;
  /** 不传则按 production 处理 */
  env?: AppEnv;
}

async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  staticDir: string,
  urlPath: string,
): Promise<void> {
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
    /**
     * 单页应用兜底只对「导航请求」生效：无扩展名 + Accept 含 text/html。
     * 绝不能把缺失的 /assets/*.js 也回成 index.html —— 那会让浏览器拿 HTML 当 JS 解析，
     * 报一个看不懂的 MIME 错误，而服务端日志里连 404 都没有。
     */
    const isNavigation = !path.extname(relative) && (req.headers.accept ?? '').includes('text/html');
    if (!isNavigation) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
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

/**
 * 安全响应头：单页应用的默认风险是「被别的站点框住」与「资源类型嗅探」，
 * CSP 在这里只做保守收紧（不允许内联脚本、不允许外域脚本），conncect 放开到 https
 * 是因为登录 SDK 需要直连云服务域名。
 */
function applySecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "form-action 'self'",
    ].join('; '),
  );
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim();
  if (proto === 'https') res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
}

export function createApp(options: AppOptions): http.Server {
  const staticDir = options.staticDir ?? STATIC_DIR;
  const ctx: ApiContext = {
    llm: options.llm,
    rooms: options.rooms,
    matchStore: options.matchStore,
    env: options.env ?? 'production',
    resolveOwner: options.resolveOwner,
    socialStore: options.socialStore,
    publicConfig: options.publicConfig,
    limiters: options.limiters,
    probeOwner: options.probeOwner,
  };

  return http.createServer((req, res) => {
    applySecurityHeaders(req, res);
    const url = req.url ?? '/';
    if (url.startsWith('/api/')) {
      void handleApi(req, res, ctx);
      return;
    }
    void serveStatic(req, res, staticDir, url);
  });
}
