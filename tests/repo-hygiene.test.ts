import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 仓库卫生：垃圾文件、密钥、构建产物不能被跟踪。
 *
 * 为什么放进测试而不是只做 .gitignore：
 * .gitignore 只能挡住「还没被跟踪」的文件，一旦某个文件被提交过，它就永远不会再被忽略。
 * 而「提交前跑一遍测试」是现有工作流里唯一稳定的拦截点，所以把它做成一条用例。
 *
 * 不是 git 仓库时（比如从压缩包解出来的源码）直接跳过，不误报。
 */
const ROOT = path.resolve(__dirname, '..');
const isRepo = existsSync(path.join(ROOT, '.git'));

describe('仓库卫生', () => {
  it.skipIf(!isRepo)('已跟踪文件里没有垃圾、密钥与构建产物', () => {
    const result = spawnSync(process.execPath, ['tools/repo-check.mjs'], { cwd: ROOT, encoding: 'utf8' });
    /* 失败时把脚本的说明原样带出来，别让报错停在「exit code 1」 */
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it.skipIf(!isRepo)('关键忽略规则没被误删（防止手滑改动 .gitignore）', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');

    /* 这几个必须入库：仓库没有它们就跑不起来 / 没法照着部署 */
    for (const mustHave of ['package.json', 'README.md', 'docs/PRD.md', 'config/cloud.example.json']) {
      expect(tracked, `${mustHave} 应该入库`).toContain(mustHave);
    }

    /* 这几个绝不能入库 */
    const forbidden = tracked.filter((file) =>
      /^(node_modules|dist|dist-server|coverage|tmp)\//.test(file) || /(^|\/)\.env(\.|$)/.test(file),
    );
    expect(forbidden).toEqual([]);
  });
});
