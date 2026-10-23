/**
 * 从「流式 JSON」里实时抽出 `speech` 字段的当前文本。
 *
 * 模型按要求输出 `{"speech":"……","vote":"……","reason":"……"}`，流式返回的是
 * 一串不完整的 JSON 片段（`{"speech":"我觉` …）。想边说边显示，就得在 JSON 还没
 * 闭合的时候把字符串值解出来 —— 这就是这个函数唯一的职责。
 *
 * 三条要求：
 * - 不完整的转义（末尾恰好是 `\`）要停住，不能吐出半个字符；
 * - `\uXXXX` 只解完整的四个十六进制位；
 * - 找不到 speech 键（模型没按格式来）就返回空串，交给最终解析去兜底。
 */
export function extractSpeechSoFar(raw: string): string {
  const key = /"speech"\s*:\s*"/.exec(raw);
  if (!key) return '';

  let i = key.index + key[0].length;
  let out = '';

  while (i < raw.length) {
    const ch = raw[i] as string;

    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === undefined) break; // 转义还没收完
      switch (next) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'u': {
          const hex = raw.slice(i + 2, i + 6);
          if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return out;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
          break;
        }
        default:
          out += next;
      }
      i += 2;
      continue;
    }

    if (ch === '"') break; // 这个字符串已结束
    out += ch;
    i += 1;
  }

  return out;
}
