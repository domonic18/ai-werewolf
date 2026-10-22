/**
 * 部署兜底：sites 沙箱复用上一轮的持久目录，`dist/` 会原样留下来。
 * 早期版本只在产物缺失时才构建，结果线上一直发上一轮的旧包 ——
 * 「改了代码、重新发布、页面却还是老样子」就是这么来的（2026-10）。
 *
 * 所以这里改为每次启动都重建：构建失败但旧产物还在时，降级用旧产物继续起服务
 * （可用性优先，宁可页面旧也不能 504），两者都没有才让进程挂掉。
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const artifacts = ['dist/client/index.html', 'dist-server/server/index.js'];
const hasArtifacts = artifacts.every((file) => existsSync(file));

try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('[prestart] 构建完成');
} catch (error) {
  if (hasArtifacts) {
    console.error('[prestart] 构建失败，沿用已有产物起服务（页面可能不是最新代码）', error);
  } else {
    throw error;
  }
}
