import { describe, expect, it } from 'vitest';
import { extractSpeechSoFar } from '../src/ai/speech-stream.js';

/**
 * 流式发言的关键：模型吐的是**没闭合的 JSON**，要在它还没写完的时候
 * 把 `speech` 的值解出来。解析错一个字符，玩家看到的就是乱码。
 */
describe('从流式 JSON 里抽发言', () => {
  it('只写了一半也能拿到当前文本', () => {
    expect(extractSpeechSoFar('{"speech":"我觉得')).toBe('我觉得');
  });

  it('键与值之间允许空白', () => {
    expect(extractSpeechSoFar('{"speech" :  "他说')).toBe('他说');
  });

  it('字符串闭合后不再往后读（后面的 vote 不算发言）', () => {
    expect(extractSpeechSoFar('{"speech":"我投他","vote":"老K"')).toBe('我投他');
  });

  it('转义换行与引号按真实字符还原', () => {
    expect(extractSpeechSoFar('{"speech":"第一句\\n第二句\\"引用\\"')).toBe('第一句\n第二句"引用"');
  });

  it('末尾恰好停在反斜杠上，不吐半个字符', () => {
    expect(extractSpeechSoFar('{"speech":"他说\\')).toBe('他说');
  });

  it('\\u 转义只有收满四位十六进制才解', () => {
    /* 收到 "\\u4f" 时还差两位，先不解，免得吐出半个汉字 */
    expect(extractSpeechSoFar('{"speech":"\\u4f')).toBe('');
    expect(extractSpeechSoFar('{"speech":"\\u4f60\\u597d')).toBe('你好');
  });

  it('模型没按格式输出时返回空串，交给最终解析兜底', () => {
    expect(extractSpeechSoFar('我不是 JSON')).toBe('');
    expect(extractSpeechSoFar('{"vote":"老K"}')).toBe('');
  });

  it('speech 不在第一位也能找到', () => {
    expect(extractSpeechSoFar('{"reason":"想想","speech":"先听他')).toBe('先听他');
  });
});
