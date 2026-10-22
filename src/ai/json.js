/**
 * JSON 提取：从模型输出（可能带思考过程、markdown 代码块、前后解释文字）中
 * 提取第一个完整 JSON 对象。括号深度扫描，正确处理字符串内的 } 与转义符。
 */

/** 提取第一个完整 JSON 对象；无法提取返回 null */
function extractJSON(text) {
  if (!text) return null;
  const t = String(text).replace(/```(?:json)?/gi, '');
  const s = t.indexOf('{');
  if (s === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = s; i < t.length; i++) {
    const c = t[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(s, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

/** 玩家名字模糊匹配：完全匹配 → 包含匹配 → 座位号 */
function matchPlayerByName(raw, candidates, self) {
  if (!raw) return null;
  const s = String(raw).trim();
  const pool = candidates.filter(p => p.id !== self.id);
  let hit = pool.find(p => p.name === s);
  if (hit) return hit;
  hit = pool.find(p => s.includes(p.name));
  if (hit) return hit;
  const seat = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  if (!Number.isNaN(seat)) {
    hit = pool.find(p => p.seat === seat);
    if (hit) return hit;
  }
  return null;
}

module.exports = { extractJSON, matchPlayerByName };
