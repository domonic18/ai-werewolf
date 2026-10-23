import { describe, expect, it } from 'vitest';
import { pickCardQuote } from '../client/src/lib/share-card';

/**
 * 战绩卡上那句话的选取规则。
 *
 * 这张卡就靠这一句撑场面，所以规则要能被证伪：
 * 优先"翻出狼"的终局感，其次任何翻牌放逐，再其次玩家自己有效发言，
 * 最后退到信息量最大的一句。敷衍的默认发言（"我这轮先过"）必须被排除。
 */
describe('战绩卡 · 复盘片段选取', () => {
  it('有狼被放逐时，优先用最后一条翻出狼的记录', () => {
    const log = [
      '第1天 老K：我先听一圈。',
      '第2天 阿岚 被放逐，身份：平民',
      '第3天 老K 被放逐，身份：狼人',
      '第4天 小满 被放逐，身份：黑狼王',
    ];
    expect(pickCardQuote(log, '夜客')).toBe('第4天 小满 被放逐，身份：黑狼王');
  });

  it('没有翻出狼时，用任意翻牌放逐', () => {
    const log = ['第1天 夜客：我怀疑老K。', '第2天 阿岚 被放逐，身份：平民'];
    expect(pickCardQuote(log, '夜客')).toBe('第2天 阿岚 被放逐，身份：平民');
  });

  it('没有放逐记录时，用自己最后一句有效发言', () => {
    const log = ['第1天 老K：我怀疑阿岚。', '第1天 夜客：老K先说的，我跟他。', '第1天 阿岚：我是平民。'];
    expect(pickCardQuote(log, '夜客')).toBe('第1天 夜客：老K先说的，我跟他。');
  });

  it('默认的「我这轮先过」不算发言，不会被选上', () => {
    const log = ['第1天 夜客：我这轮先过，听你们的。', '第1天 老K：平安夜说明神职还在干活，我先听一圈。'];
    const quote = pickCardQuote(log, '夜客');
    expect(quote).not.toContain('我这轮先过');
    expect(quote).toContain('老K');
  });

  it('只有敷衍发言和空日志时给兜底文案，不抛错', () => {
    expect(pickCardQuote([], '夜客')).toBe('这一局没有留下记录。');
    expect(pickCardQuote(['第1天 夜客：我这轮先过，听你们的。'], '夜客')).toBe('第1天 夜客：我这轮先过，听你们的。');
  });
});

describe('战绩卡 · 截断', () => {
  it('长发言截到 46 字并补省略号，不会断在半句上又没提示', () => {
    const long = '第1天 老K：' + '这是一段很长很长的发言'.repeat(6);
    const quote = pickCardQuote([long], '夜客');
    expect(quote.endsWith('…')).toBe(true);
    expect(quote.length).toBeLessThanOrEqual(47);
  });

  it('有短发言时优先用短的那句，避免截断', () => {
    const log = ['第1天 老K：' + '铺开讲了很多细节'.repeat(8), '第1天 小满：我怀疑阿岚，他上一轮投得急。'];
    expect(pickCardQuote(log, '夜客')).toBe('第1天 小满：我怀疑阿岚，他上一轮投得急。');
  });
});
