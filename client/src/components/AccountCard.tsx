import { clearSession } from '../auth/session';
import { Icon } from './Icon';
import { useSession } from '../auth/useSession';

/**
 * 登录态条：首页在 Hero 之下展示。
 *
 * 设计稿没有单独的登录态区块，但「登录后界面一模一样」是实际反馈过的问题——
 * 所以登录后补一条账号条，比例沿用设计稿的 resume-card，不抢视觉。
 * 退出只清本地会话，不影响进行中对局（匿名也能玩）。
 */
function maskId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function AccountCard(): JSX.Element | null {
  const { session } = useSession();
  if (!session) return null;

  return (
    <div className="account-card">
      <div className="account-left">
        <span className="avatar avatar-human">
          <Icon name="villager" size={15} />
        </span>
        <div className="account-text">
          <b>已登录 · 战绩记在账号下</b>
          <span>{maskId(session.userId)}</span>
        </div>
      </div>
      <button className="account-out" onClick={() => clearSession()}>
        退出
      </button>
    </div>
  );
}
