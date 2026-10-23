import { useEffect, useState } from 'react';
import type { InvitePreviewResponse } from '@shared/types';
import { api } from '../api/client';
import { Icon } from './Icon';
import { currentRef } from '../lib/invite';

/**
 * 邀请落地横幅：被邀请人第一次打开链接时，顶上告诉他「是谁在请」。
 *
 * 三个刻意的选择：
 * - 只在这里展示**邀请人**的聚合战绩（局数 + 胜率），不展示任何明细；
 * - 邀请码无效/接口挂了就整条不渲染 —— 与其显示一条「XX 邀请你」的假消息，不如安静；
 * - 已在登录态的人不显示：关系已在登录时补记过了，再请一次只是噪音。
 */
export function InviteBanner({
  signedIn,
  onStart,
}: {
  signedIn: boolean;
  onStart: () => void;
}): JSX.Element | null {
  const [ref] = useState<string | null>(() => currentRef());
  const [preview, setPreview] = useState<InvitePreviewResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!ref) return;
    let cancelled = false;
    void api
      .invitePreview(ref)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        /* 拿不到就不显示横幅，不打扰开局 */
      });
    return () => {
      cancelled = true;
    };
  }, [ref]);

  if (signedIn || dismissed || !ref || !preview?.ok) return null;

  const games = preview.games ?? 0;
  const wins = preview.wins ?? 0;
  const rate = games > 0 ? Math.round((wins / games) * 100) : null;

  return (
    <div className="iv-banner">
      <div className="iv-banner-main">
        <span className="iv-banner-mark" aria-hidden>
          <Icon name="users" size={15} />
        </span>
        <div className="iv-banner-text">
          <b>{preview.name ?? '一位玩家'} 邀请你来打一局</b>
          <span>
            {games > 0 ? `TA 打过 ${games} 局${rate === null ? '' : ` · 胜率 ${rate}%`}` : 'TA 刚入席，还没打完第一局'}
          </span>
        </div>
      </div>
      <div className="iv-banner-actions">
        <button className="iv-banner-go" onClick={onStart}>
          入席开局
        </button>
        <button className="iv-banner-later" onClick={() => setDismissed(true)}>
          先看看
        </button>
      </div>
    </div>
  );
}
