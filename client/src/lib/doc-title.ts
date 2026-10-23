import { useEffect } from 'react';

const BASE = 'AI 狼人杀 · Agent 补位局';

/**
 * 页面标题随场景变化。
 *
 * 分享出去的链接在微信里显示的标题就是 `<title>`——我们接不了公众号 JS-SDK
 * （需要认证公众号 + 站点根目录校验文件），所以这是唯一能控制的"卡片标题"。
 */
export function useDocTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · AI 狼人杀` : BASE;
  }, [title]);
}
