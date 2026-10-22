/* JSON 提取 + 引擎冒烟 串行执行 */
const { spawnSync } = require('child_process');
const path = require('path');
const tests = ['json.test.js', 'engine-smoke.test.js', 'api-selftest.test.js'];
let failed = 0;
for (const t of tests) {
  const r = spawnSync(process.executablePath || 'node', [path.join(__dirname, t)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
if (failed) { console.error(`${failed} test file(s) failed`); process.exit(1); }
console.log('all tests passed');
