import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { copyText, shareLink } from '../lib/share';
import { trackEvent } from '../lib/track';

/**
 * 分享弹层（底部 sheet）。
 *
 * 三处复用：结算页、局中「叫朋友来看」、我的战绩页「邀请朋友」。
 * 行为按产品约定：先试系统分享，不支持再复制链接，最后给二维码让人当面扫。
 */
interface ShareSheetProps {
  open: boolean;
  title: string;
  /** 一句话说明「对方点开会看到什么」 */
  hint?: string;
  url: string;
  /** 分享文案（不含链接） */
  text: string;
  /** 二维码图（dataURL）；不传则不显示二维码项 */
  qr?: string;
  /** 有图片时优先走"带文件分享"（系统里可以直接发给微信好友） */
  file?: File;
  /** 额外动作（比如"保存战绩卡"） */
  extra?: { label: string; onClick: () => void };
  onClose: () => void;
}

export function ShareSheet({ open, title, hint, url, text, qr, file, extra, onClose }: ShareSheetProps): JSX.Element | null {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setMsg(null);
  }, [open]);

  if (!open) return null;

  const doShare = async (): Promise<void> => {
    trackEvent('share_click');
    const result = await shareLink({ title, text, url, file });
    if (result === 'shared') {
      onClose();
      return;
    }
    setMsg(result === 'copied' ? '系统分享不可用，链接已复制，去微信里粘贴给朋友' : '复制失败，请长按上面的链接手动复制');
  };

  const doCopy = async (): Promise<void> => {
    trackEvent('share_click');
    setMsg((await copyText(url)) ? '链接已复制' : '复制失败，请长按链接手动复制');
  };

  return (
    <div className="sh-mask" onClick={onClose}>
      <div className="sh-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="sh-grab" />
        <h4>{title}</h4>
        {hint ? <p className="sh-hint">{hint}</p> : null}

        <button className="sh-opt main" onClick={() => void doShare()}>
          <span className="sh-ic">
            <Icon name="share" size={15} />
          </span>
          <span className="sh-t">
            <b>发送给朋友</b>
            <span>调用系统分享；浏览器不支持时自动复制链接</span>
          </span>
          <span className="sh-go">›</span>
        </button>

        <button className="sh-opt" onClick={() => void doCopy()}>
          <span className="sh-ic">
            <Icon name="copy" size={15} />
          </span>
          <span className="sh-t">
            <b>复制链接</b>
            <span className="sh-url">{url}</span>
          </span>
          <span className="sh-go">复制</span>
        </button>

        {extra ? (
          <button className="sh-opt" onClick={extra.onClick}>
            <span className="sh-ic">
              <Icon name="note" size={15} />
            </span>
            <span className="sh-t">
              <b>{extra.label}</b>
              <span>存成图片，长按发微信</span>
            </span>
            <span className="sh-go">›</span>
          </button>
        ) : null}

        {qr ? (
          <div className="sh-qr">
            <img src={qr} alt="二维码" />
            <span>当面让对方扫一下</span>
          </div>
        ) : null}

        {msg ? <p className="sh-msg">{msg}</p> : null}

        <button className="sh-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}
