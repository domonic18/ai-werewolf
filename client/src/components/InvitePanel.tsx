import { useEffect, useMemo, useState } from 'react';
import type { FriendSummaryView } from '@shared/types';
import { api } from '../api/client';
import { Icon } from './Icon';
import { ShareSheet } from './ShareSheet';
import { useMyInvite } from '../hooks/useInvite';
import { formatWhen } from '../lib/format';
import { copyText, inviteUrl, qrDataUrl } from '../lib/share';
import { currentShareCode } from '../lib/url';

/** 胜率：0 局时不给百分比，避免出现「0%」这种像是在骂人的数字 */
function winRate(friend: FriendSummaryView): string {
  if (!friend.games) return '—';
  return `${Math.round((friend.wins / friend.games) * 100)}%`;
}

/**
 * 邀请面板（我的战绩页）。
 *
 * 三件事按重要性排：先给邀请码（可复制、可分享），再给列表（谁来了、玩得怎么样），
 * 最后才是「要不要公开我的胜率」——那是被邀请人才需要操心的开关。
 *
 * 口径上刻意只做聚合：朋友列表里没有「他哪局输给了谁」的入口，页面上也没有这个接口。
 */
export function InvitePanel(): JSX.Element {
  const { data, loading, reload } = useMyInvite(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const shareCode = currentShareCode();
  const url = useMemo(() => (data?.code ? inviteUrl(data.code, shareCode) : ''), [data?.code, shareCode]);
  const qr = useMemo(() => (url ? qrDataUrl(url) : ''), [url]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!data) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">邀请朋友</span>
        </div>
        <div className="lb-empty">
          {loading ? '读取中…' : '邀请服务暂时不可用，可以先去打一局，稍后再来。'}
        </div>
      </div>
    );
  }

  if (!data.available) {
    return (
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">邀请朋友</span>
        </div>
        <div className="lb-empty">邀请服务还没就绪（云库未连接），战绩部分不受影响。</div>
      </div>
    );
  }

  const save = async (patch: { nickname?: string; hideStats?: boolean }): Promise<void> => {
    setSaving(true);
    try {
      await api.updateProfile(patch);
      await reload();
      setEditing(false);
    } catch {
      /* 失败保留原值，下一次再改 */
    } finally {
      setSaving(false);
    }
  };

  const copyInvite = async (): Promise<void> => {
    const ok = await copyText(`来打一局狼人杀：${url}`);
    setCopied(ok ? '链接已复制' : '复制失败，请长按上面的链接手动复制');
  };

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">邀请朋友</span>
          <span className="panel-sub">{data.friends.length ? `${data.friends.length} 人已入席` : '还没人从你这里入席'}</span>
        </div>

        {/* 邀请码：这是全页唯一「给别人看」的东西，字号给足 */}
        <div className="iv-code-row">
          <div className="iv-code-box">
            <span className="iv-code-label">你的邀请码</span>
            <b className="iv-code">{data.code}</b>
          </div>
          <div className="iv-code-actions">
            <button className="btn ghost iv-btn" onClick={() => void copyInvite()}>
              <Icon name="copy" size={13} />
              {copied ?? '复制链接'}
            </button>
            <button className="btn primary iv-btn" onClick={() => setShareOpen(true)}>
              <Icon name="share" size={13} />
              分享
            </button>
          </div>
        </div>

        {/* 昵称：手机号登录拿不到，缺了就在这里补一次 */}
        <div className="me-row iv-name-row">
          <span className="me-role">
            <Icon name="users" size={14} />
          </span>
          {editing ? (
            <>
              <input
                className="iv-name-input"
                maxLength={12}
                autoFocus
                placeholder="朋友列表里显示的名字"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save({ nickname: draft.trim() });
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
              <button className="iv-mini" disabled={saving} onClick={() => void save({ nickname: draft.trim() })}>
                保存
              </button>
            </>
          ) : (
            <>
              <span className="me-row-main">
                <b>{data.nickname ?? '还没有昵称'}</b>
                <span>朋友列表里显示这个名字</span>
              </span>
              <button
                className="iv-mini"
                onClick={() => {
                  setDraft(data.nickname ?? '');
                  setEditing(true);
                }}
              >
                {data.nickname ? '修改' : '设置'}
              </button>
            </>
          )}
        </div>

        {/* 公开开关：默认开，关了之后邀请人只看得到「在玩」 */}
        <div className="me-row iv-switch-row">
          <span className="me-role">
            <Icon name="shieldCheck" size={14} />
          </span>
          <span className="me-row-main">
            <b>对邀请我的人公开胜率</b>
            <span>{data.hideStats ? '已关闭：对方只看到「在玩」' : '对方能看到局数与胜率，看不到每一局的细节'}</span>
          </span>
          <button
            className={data.hideStats ? 'sw' : 'sw on'}
            role="switch"
            aria-checked={!data.hideStats}
            aria-label="对邀请我的人公开胜率"
            disabled={saving}
            onClick={() => void save({ hideStats: !data.hideStats })}
          >
            <i />
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">我邀请的朋友</span>
          <span className="panel-sub">按最近活跃排序</span>
        </div>

        {data.friends.length ? (
          data.friends.map((friend, index) => (
            <div key={`${friend.name}-${index}`} className={friend.stale ? 'fr-row stale' : 'fr-row'}>
              <span className="fr-av" aria-hidden>
                {friend.name.slice(0, 1)}
              </span>
              <span className="me-row-main">
                <b>
                  {friend.name}
                  {friend.stale ? <em className="fr-tag">很久没来</em> : null}
                </b>
                <span>
                  {friend.hidden
                    ? '在玩 · 未公开战绩'
                    : friend.games
                      ? `${friend.games} 局 · 胜率 ${winRate(friend)}`
                      : '还没打完第一局'}
                </span>
              </span>
              <span className="fr-when">{friend.lastPlayedAt ? formatWhen(friend.lastPlayedAt) : '—'}</span>
            </div>
          ))
        ) : (
          <div className="iv-empty">
            <p>发给一个朋友，他打完第一局，这里就会有胜率。</p>
            <button className="btn ghost" onClick={() => void copyInvite()}>
              <Icon name="copy" size={13} />
              {copied ?? '复制邀请链接'}
            </button>
          </div>
        )}

        <p className="me-note">只统计他们自己坐庄打完的局；对方的每一局明细不会出现在这里。</p>
      </div>

      <ShareSheet
        open={shareOpen}
        title="邀请一位朋友"
        hint="对方点开就是你这一局的入口，登录后自动记在你名下。"
        url={url}
        text="来打一局狼人杀，五个会说谎的 AI 补位。"
        qr={qr || undefined}
        onClose={() => setShareOpen(false)}
      />
    </>
  );
}
