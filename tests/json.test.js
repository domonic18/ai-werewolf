/* JSON 提取器单元测试 */
const assert = require('assert');
const { extractJSON, matchPlayerByName } = require('../src/ai/json');

const cases = [
  ['{"ok":true}', { ok: true }],
  ['好的，这是结果：{"speech":"你好","vote":"老K"} 以上。', { speech: '你好', vote: '老K' }],
  ['```json\n{"a":1}\n```', { a: 1 }],
  ['前缀 {"a":{"b":"包含}花括号"}} 后缀', { a: { b: '包含}花括号' } }],
  ['{"text":"转义\\"引号和\\\\反斜杠"}', { text: '转义"引号和\\反斜杠' }],
  ['完全不是JSON', null],
  ['', null],
  ['思考...答案 {"x":1}，补充 {"y":2}', { x: 1 }]
];
cases.forEach(([inp, want], i) => {
  const got = extractJSON(inp);
  assert.deepStrictEqual(got, want, `case ${i} 失败: ${JSON.stringify(inp)}`);
});
console.log('json extract: 8/8 OK');

/* 名字匹配 */
const cands = [
  { id: 1, seat: 2, name: '老K' },
  { id: 2, seat: 3, name: '小满' },
  { id: 3, seat: 5, name: '阿岚' }
];
const self = { id: 9, seat: 1, name: '你' };
assert.strictEqual(matchPlayerByName('老K', cands, self).id, 1);
assert.strictEqual(matchPlayerByName('我觉得老K最可疑', cands, self).id, 1);
assert.strictEqual(matchPlayerByName('3号', cands, self).id, 2);
assert.strictEqual(matchPlayerByName('小满吧', cands, self).id, 2);
assert.strictEqual(matchPlayerByName('不存在', cands, self), null);
console.log('name match: 5/5 OK');
