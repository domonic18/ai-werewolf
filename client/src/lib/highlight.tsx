import type { ReactNode } from 'react';

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 发言文本中的玩家名金色高亮。
 * 用 React 节点而非 innerHTML，天然免疫注入。
 */
export function highlightNames(text: string, names: string[]): ReactNode {
  const unique = Array.from(new Set(names.filter(Boolean))).sort((a, b) => b.length - a.length);
  if (!unique.length) return text;

  const pattern = new RegExp(`(${unique.map(escapeRegExp).join('|')})`, 'g');
  return text.split(pattern).map((part, index) =>
    unique.includes(part) ? (
      <b key={index} className="name-hl">
        {part}
      </b>
    ) : (
      part
    ),
  );
}
