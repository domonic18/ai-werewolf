/**
 * 部署兜底：sites 沙箱可能只执行 `npm start`（不一定跑 build），
 * 这里在启动前检查产物，缺失就补一次构建，避免线上出现 404 空页。
 * 已有产物时是零成本 no-op。
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const artifacts = ['dist/client/index.html', 'dist-server/server/index.js'];
const missing = artifacts.filter((file) => !existsSync(file));

if (missing.length) {
  console.log(`[prestart] 构建产物缺失（${missing.join(', ')}），执行 npm run build…`);
  execSync('npm run build', { stdio: 'inherit' });
} else {
  console.log('[prestart] 构建产物已存在，跳过构建');
}
