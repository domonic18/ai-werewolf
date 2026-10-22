import { describe, expect, it } from 'vitest';
import { extractJSON, matchPlayerByName } from '../src/ai/json.js';

describe('extractJSON', () => {
  const cases: [string, Record<string, unknown> | null][] = [
    ['{"ok":true}', { ok: true }],
    ['好的，这是结果：{"speech":"你好","vote":"老K"} 以上。', { speech: '你好', vote: '老K' }],
    ['```json\n{"a":1}\n```', { a: 1 }],
    ['前缀 {"a":{"b":"包含}花括号"}} 后缀', { a: { b: '包含}花括号' } }],
    ['{"text":"转义\\"引号和\\\\反斜杠"}', { text: '转义"引号和\\反斜杠' }],
    ['完全不是JSON', null],
    ['', null],
    ['思考...答案 {"x":1}，补充 {"y":2}', { x: 1 }],
  ];

  it.each(cases)('解析 %s', (input, expected) => {
    expect(extractJSON(input)).toEqual(expected);
  });
});

describe('matchPlayerByName', () => {
  const candidates = [
    { id: 1, seat: 2, name: '老K' },
    { id: 2, seat: 3, name: '小满' },
    { id: 3, seat: 5, name: '阿岚' },
  ];
  const self = { id: 9, seat: 1, name: '你' };

  it('完全匹配优先', () => {
    expect(matchPlayerByName('老K', candidates, self)?.id).toBe(1);
  });

  it('支持包含匹配', () => {
    expect(matchPlayerByName('我觉得老K最可疑', candidates, self)?.id).toBe(1);
    expect(matchPlayerByName('小满吧', candidates, self)?.id).toBe(2);
  });

  it('支持座位号', () => {
    expect(matchPlayerByName('3号', candidates, self)?.id).toBe(2);
  });

  it('匹配不到返回 null', () => {
    expect(matchPlayerByName('不存在', candidates, self)).toBeNull();
    expect(matchPlayerByName('', candidates, self)).toBeNull();
  });

  it('不会匹配到自己', () => {
    expect(matchPlayerByName('你', [{ id: 9, seat: 1, name: '你' }], self)).toBeNull();
  });
});
