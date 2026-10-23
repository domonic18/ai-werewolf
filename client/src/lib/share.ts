/**
 * 分享能力（客户端）。
 *
 * 三件事：拼分享链接、唤起系统分享、画二维码。
 *
 * 降级顺序按产品约定（PRD 8.7）：`navigator.share` → 复制链接 → 让用户自己截图二维码。
 * 微信内置浏览器不支持 `navigator.share`，那边会落到「复制链接 + 提示去右上角」。
 */
import qrcode from 'qrcode-generator';
import { withShareCode } from './url';

export { withShareCode };

/** 站点根地址（带 sharecode，否则平台网关会 403） */
export function siteOrigin(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/**
 * 我的邀请链接：`?ref=<邀请码>`。
 * 注意 ref 与 sharecode 是两个东西：sharecode 是平台网关要求，ref 是业务上的邀请人。
 */
export function inviteUrl(code: string, shareCode: string): string {
  return withShareCode(`${siteOrigin()}?ref=${encodeURIComponent(code)}`, shareCode);
}

/** 观战深链：观众不占座、不消耗模型调用，链接可以直接发给朋友 */
export function watchUrl(gameId: string, shareCode: string): string {
  return withShareCode(`${siteOrigin()}#watch=${gameId}`, shareCode);
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

interface ShareOptions {
  title: string;
  text?: string;
  url: string;
  /** 有图片文件时优先走"带文件分享"（系统相册/微信可直接发图） */
  file?: File;
}

/** 复制文本：优先 Clipboard API，失败退回 execCommand（老 Safari） */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 唤起系统分享。返回结果让调用方决定提示什么：
 * - shared：用户已经在系统面板里发出去了
 * - copied：浏览器不支持，已帮用户复制，提示他自己粘贴
 * - failed：连复制都失败（极少见，比如隐私模式禁剪贴板）
 */
export async function shareLink({ title, text, url, file }: ShareOptions): Promise<ShareOutcome> {
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData & { files?: File[] }) => boolean;
    share?: (data: ShareData & { files?: File[] }) => Promise<void>;
  };

  if (nav.share) {
    try {
      const payload: ShareData & { files?: File[] } = { title, text, url };
      if (file && nav.canShare?.({ files: [file] })) payload.files = [file];
      await nav.share(payload);
      return 'shared';
    } catch (e) {
      /* 用户主动取消不算失败，也不该退回"已复制"（会让人以为发出去了） */
      if ((e as Error)?.name === 'AbortError') return 'shared';
      /* 其它错误：继续走复制 */
    }
  }

  return (await copyText(text ? `${text} ${url}` : url)) ? 'copied' : 'failed';
}

/**
 * 生成二维码的 dataURL（供 <img> 直接显示）。
 *
 * 用 qrcode-generator 而不是远程接口：分享链接里带 user 身份，不该发给第三方。
 */
export function qrDataUrl(text: string, size = 200): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const scale = 4;
  const quiet = 2; // 静区，扫码识别率靠它
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = (count + quiet * 2) * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#EDE7DA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0A0A0B';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!qr.isDark(row, col)) continue;
      ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
    }
  }

  /* 用 CSS 控制显示尺寸，这里导出原始像素保证清晰 */
  void size;
  return canvas.toDataURL('image/png');
}
