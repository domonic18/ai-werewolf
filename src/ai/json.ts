/**
 * JSON 提取：从模型输出（可能带思考过程、markdown 代码块、前后解释文字）中
 * 提取第一个完整 JSON 对象。括号深度扫描，正确处理字符串内的 } 与转义符。
 */

/** 提取第一个完整 JSON 对象；无法提取返回 null */
export function extractJSON(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  const raw = String(text).replace(/```(?:json)?/gi, '');
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const char = raw[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(raw.slice(start, i + 1));
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface NameCandidate {
  id: number;
  seat: number;
  name: string;
}

/** 玩家名字模糊匹配：完全匹配 → 包含匹配 → 座位号 */
export function matchPlayerByName<T extends NameCandidate>(
  raw: unknown,
  candidates: T[],
  self: { id: number },
): T | null {
  if (!raw) return null;
  const text = String(raw).trim();
  const pool = candidates.filter((p) => p.id !== self.id);
  if (!pool.length) return null;

  const exact = pool.find((p) => p.name === text);
  if (exact) return exact;

  const contains = pool.find((p) => text.includes(p.name));
  if (contains) return contains;

  const seat = Number.parseInt(text.replace(/[^\d]/g, ''), 10);
  if (!Number.isNaN(seat)) {
    const bySeat = pool.find((p) => p.seat === seat);
    if (bySeat) return bySeat;
  }
  return null;
}
