import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { tsExtensionResolver } from './tools/ts-extension-resolver';

/**
 * 测试与被测代码都用 ESM + 显式 .js 后缀（NodeNext 的要求），
 * 但磁盘上是 .ts。这里做一个最小解析插件，把 `./x.js` 映射到 `./x.ts`，
 * 让 vitest（esbuild）与 tsc 的输出保持同一套 import 写法。
 */
export default defineConfig({
  plugins: [tsExtensionResolver()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
