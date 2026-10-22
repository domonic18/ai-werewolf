#!/usr/bin/env node
/**
 * 把 Ardot 导出的设计稿 HTML 抽成可读大纲。
 *
 * 设计稿是机器生成的：每个元素带 data-name，尺寸/颜色主要写在 Tailwind 的
 * 任意值类名（w-[167px]、text-[13px]）和内联 style 里。直接读 2 万字符的单行
 * HTML 效率太低，这里还原成「缩进树 + 关键样式」，用来逐页对齐实现。
 *
 *   node tools/design-outline.mjs docs/designs/01-home.html
 *   node tools/design-outline.mjs docs/designs/*.html --all
 */

const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);

/** 从 class 里挑出对还原有用的 Tailwind 任意值写法 */
function classHints(className) {
  const hints = [];
  const patterns = [
    /\bw-\[([^\]]+)\]/g,
    /\bh-\[([^\]]+)\]/g,
    /\btext-\[([^\]]+)\]/g,
    /\brounded-\[([^\]]+)\]/g,
    /\b(?:px|py|p|gap|pt|pb|pl|pr|mt|mb)-\[([^\]]+)\]/g,
    /\b(bg-\[[^\]]+\])/g,
    /\b(flex-(?:row|col))\b/g,
    /\b(justify-[a-z]+)\b/g,
    /\b(items-[a-z]+)\b/g,
  ];
  for (const re of patterns) {
    for (const m of className.matchAll(re)) {
      const raw = m[1] ?? m[0];
      const prefix = m[0].startsWith(raw) ? '' : m[0].replace(/\[.*$/, '');
      hints.push(prefix ? `${prefix}${raw}` : raw);
    }
  }
  return hints;
}

/** 内联 style 只保留几何/颜色相关声明 */
function styleHints(style) {
  if (!style) return [];
  return style
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^(background|border|border-radius|color|width|height|padding|margin|gap|font|line-height)/.test(s));
}

function outline(html) {
  const lines = [];
  const stack = [];
  let depth = 0;
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)(\/?)>/g;
  let match;
  let lastIndex = 0;

  const textBetween = (endIndex) => {
    const raw = html.slice(lastIndex, endIndex);
    const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
  };

  while ((match = tagRe.exec(html))) {
    const [, closing, rawTag, attrs, selfClose] = match;
    const tag = rawTag.toLowerCase();

    if (closing) {
      /* 闭合时把该元素自己的文本补上（叶子节点的文字最有用） */
      const text = textBetween(match.index);
      if (text && stack.length) {
        const node = stack.pop();
        const indent = '  '.repeat(node.depth);
        lines.push(`${indent}· "${text.slice(0, 60)}"`);
      } else if (stack.length) {
        stack.pop();
      }
      depth = Math.max(0, depth - 1);
      lastIndex = tagRe.lastIndex;
      continue;
    }

    const nameMatch = attrs.match(/data-name="([^"]*)"/);
    const classMatch = attrs.match(/class="([^"]*)"/);
    const styleMatch = attrs.match(/style="([^"]*)"/);
    const name = nameMatch?.[1] ?? '';
    const hints = [...classHints(classMatch?.[1] ?? ''), ...styleHints(styleMatch?.[1])];

    const indent = '  '.repeat(depth);
    lines.push(`${indent}<${tag}${name ? ` ${name}` : ''}${hints.length ? `  [${hints.join(' ')}]` : ''}>`);

    if (selfClose || VOID.has(tag)) {
      lastIndex = tagRe.lastIndex;
      continue;
    }
    stack.push({ depth });
    depth += 1;
    lastIndex = tagRe.lastIndex;
  }
  return lines.join('\n');
}

const args = process.argv.slice(2).filter((a) => a !== '--all');
const fs = await import('node:fs');
for (const file of args) {
  const html = fs.readFileSync(file, 'utf8');
  console.log(`\n${'='.repeat(70)}\n${file}\n${'='.repeat(70)}`);
  console.log(outline(html));
}
