import { clearSession } from '../auth/session';
import { useSession } from '../auth/useSession';

/**
 * 登录态卡片：登录后首页/登录页都要能看到「我现在是哪个账号」。
 *
 * 之前登录后界面和登录前一模一样（登录态只存在 sessionStorage，没有任何页面读它），
 * 用户没法确认到底登没登上 —— 这个组件就是那条可见的反馈。
 * 退出只清本地会话，不影响进行中对局（匿名也能玩，登录不是前置条件）。
 */
function maskId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

interface AccountCardProps {
  /** 额外说明；默认用原型 05 的文案 */
  hint?: string;
}

export function AccountCard({ hint }: AccountCardProps): JSX.Element | null {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="panel account-card">
      <div className="account-row">
        <span className="account-avatar">👤</span>
        <div className="account-meta">
          <b>已登录</b>
          <span className="account-id">{maskId(session.userId)}</span>
        </div>
        <button className="btn ghost small" onClick={() => clearSession()}>
          退出登录
        </button>
      </div>
      <p className="hint">{hint ?? '战绩、未完成的对局、观战记录都记在这个账号下'}</p>
    </div>
  );
}
