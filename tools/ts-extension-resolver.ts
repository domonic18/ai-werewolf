import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * 服务端代码用 ESM + 显式 `.js` 后缀（tsc NodeNext 的要求），但磁盘上是 `.ts`。
 * 前端构建与测试都走 esbuild，不认识这种映射，这里补一个最小解析插件，
 * 让同一份 import 写法在 tsc / vite / vitest 三处都成立。
 */
export function tsExtensionResolver(): Plugin {
  return {
    name: 'ts-extension-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null;
      const tsPath = path.resolve(path.dirname(importer), source.replace(/\.js$/, '.ts'));
      return existsSync(tsPath) ? tsPath : null;
    },
  };
}
