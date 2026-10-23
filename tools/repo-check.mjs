#!/usr/bin/env node
/**
 * 仓库卫生自查：确保临时文件、垃圾文件、构建产物、密钥没有被跟踪。
 *
 *   npm run repo:check
 *
 * 为什么需要它：.gitignore 只能挡住「还没被跟踪」的文件。一个文件一旦被提交过，
 * 之后再写进 .gitignore 也没用 —— 它会继续被跟踪、继续被改动带走。
 * 所以这里查的是 `git ls-files`（已入库清单），而不是工作区。
 *
 * 只查「确定不该入库」的东西，不做风格审查。
 */
import { execFileSync } from 'node:child_process';

/** 每一条都对应一类「一旦入库就是事故」的文件 */
const RULES = [
  { name: '依赖目录', test: (p) => p.includes('node_modules/') },
  { name: '构建产物', test: (p) => /^(dist|dist-server|build|out)\//.test(p) || p.endsWith('.tsbuildinfo') },
  { name: '测试产物', test: (p) => /^(coverage|\.nyc_output|test-results|playwright-report)\//.test(p) },
  { name: '临时文件', test: (p) => p.startsWith('tmp/') || /\.(tmp|bak|orig|swp)$/.test(p) || p.endsWith('~') },
  { name: '日志', test: (p) => /\.log$/.test(p) },
  { name: '环境变量/密钥', test: (p) => /(^|\/)\.env(\.|$)/.test(p) && !p.endsWith('.env.example') },
  { name: '云配置（真件）', test: (p) => p === 'config/cloud.json' || /^config\/.+\.local\.json$/.test(p) },
  { name: '证书私钥', test: (p) => /\.(pem|key|p12)$/.test(p) },
  { name: '系统垃圾', test: (p) => /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/.test(p) || p.includes('/._') },
  { name: '编辑器目录', test: (p) => /^(\.idea|\.vscode|\.history)\//.test(p) },
  { name: '压缩包', test: (p) => /\.(tgz|zip)$/.test(p) },
  { name: '生成的设计稿', test: (p) => p.startsWith('docs/designs-v2/') },
];

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const hits = [];
for (const file of files) {
  for (const rule of RULES) {
    if (rule.test(file)) hits.push({ rule: rule.name, file });
  }
}

if (!hits.length) {
  console.log(`✓ 仓库卫生检查通过：${files.length} 个已跟踪文件里没有垃圾/密钥/产物`);
  process.exit(0);
}

console.error('✗ 有不该入库的文件被跟踪了：\n');
for (const hit of hits) console.error(`  [${hit.rule}] ${hit.file}`);
console.error(`
处理办法（已经提交过的文件，写 .gitignore 是没用的）：
  git rm --cached <文件>      # 只从索引里移除，本地保留
  git commit -m "chore: 移除误入库的 <文件>"
如果里面有密钥，先作废再改写历史（git filter-repo），别只删文件。`);
process.exit(1);
