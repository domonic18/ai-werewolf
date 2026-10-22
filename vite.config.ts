import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { tsExtensionResolver } from './tools/ts-extension-resolver';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * 前端构建：源码在 client/，产物落到 dist/client，
 * 由 src/server 以单端口同时托管 /api 与静态文件（不用 vite preview 当线上服务）。
 */
export default defineConfig({
  root: 'client',
  plugins: [tsExtensionResolver(), react()],
  define: {
    /* 版本号只有一个来源：package.json */
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // 本地开发：前端 HMR 服务把 API 转发到本地 Node 服务（npm run dev:server）
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
});
