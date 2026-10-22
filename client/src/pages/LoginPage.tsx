import { useEffect, useState } from 'react';
import { sendOtp, signInWithOAuth, verifyOtp } from '../auth/actions';
import { clearSession, setSession } from '../auth/session';
import { useSession } from '../auth/useSession';

const APP_VERSION = __APP_VERSION__;

interface LoginPageProps {
  onBack: () => void;
  onSignedIn: () => void;
}

type Channel = 'phone' | 'email';

/**
 * 登录页：逐项对齐 docs/designs/05-login.html。
 * 结构 = 返回栏 / Logo+标题 / 登录卡（Tab·手机号·验证码·登录）/ 其他方式 /
 *        协议行 / 托管说明 / 页脚。已登录时整卡换成账号状态，避免重复登录。
 */
export function LoginPage({ onBack, onSignedIn }: LoginPageProps): JSX.Element {
  const { session } = useSession();
  const [channel, setChannel] = useState<Channel>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [verificationId, setVerificationId] = useState('');
  const [isExistingUser, setIsExistingUser] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [agreed, setAgreed] = useState(true);
  /* 提示紧跟按钮显示：失败信息藏在页面底部会被当成「点了没反应」 */
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const value = channel === 'phone' ? phone : email;
  const valid = channel === 'phone' ? /^1\d{10}$/.test(phone) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const requestCode = async (): Promise<void> => {
    /* 按钮不做「灰掉」：设计稿里它是常亮的，格式问题点一下再说清楚更友好 */
    if (countdown > 0 || sending) return;
    if (!valid) {
      setMsg({ kind: 'err', text: channel === 'phone' ? '请输入 11 位手机号' : '请输入有效邮箱' });
      return;
    }
    setSending(true);
    setMsg(null);
    const result = await sendOtp({ kind: channel, value });
    setSending(false);
    if (result.ok) {
      setVerificationId(result.data.verificationId);
      setIsExistingUser(result.data.isExistingUser);
      setCountdown(60);
      setMsg({ kind: 'ok', text: channel === 'phone' ? '验证码已发送，请查收短信' : '验证码已发送，请查收邮件' });
    } else {
      setMsg({ kind: 'err', text: `发送失败：${result.error}` });
    }
  };

  const submit = async (): Promise<void> => {
    if (verifying) return;
    if (!valid) {
      setMsg({ kind: 'err', text: channel === 'phone' ? '请输入 11 位手机号' : '请输入有效邮箱' });
      return;
    }
    if (!verificationId) {
      setMsg({ kind: 'err', text: '请先获取验证码' });
      return;
    }
    if (code.trim().length < 4) {
      setMsg({ kind: 'err', text: '请输入收到的验证码' });
      return;
    }
    if (!agreed) {
      setMsg({ kind: 'err', text: '请先勾选用户协议与隐私政策' });
      return;
    }
    setVerifying(true);
    setMsg(null);
    const result = await verifyOtp({
      target: { kind: channel, value },
      code: code.trim(),
      verificationId,
      isExistingUser,
    });
    setVerifying(false);
    if (result.ok) {
      setSession({ accessToken: result.data.accessToken, userId: result.data.userId, expiresAt: 0 });
      onSignedIn();
    } else {
      setMsg({ kind: 'err', text: `登录失败：${result.error}` });
    }
  };

  const oauth = async (provider: 'wechat' | 'workbuddy'): Promise<void> => {
    setMsg(null);
    const result = await signInWithOAuth(provider);
    if (!result.ok) setMsg({ kind: 'err', text: `拉起失败：${result.error}` });
  };

  return (
    <section className="screen page-login">
      <div className="d-nav lg-nav">
        <button className="d-back" onClick={onBack} aria-label="返回">
          ←
        </button>
        <p className="d-nav-title">账号登录</p>
        <span style={{ width: 30, height: 30 }} />
      </div>

      <div className="lg-hero">
        <div className="lg-logo">🐺</div>
        <h1>{session ? '已登录' : '登录后开局'}</h1>
        <p>{session ? '战绩、对局与观战记录都记在这个账号下' : '战绩、未完成的对局、观战记录都记在账号下'}</p>
      </div>

      {session ? (
        <>
          <div className="lg-card">
            <div className="account-card" style={{ border: 0, background: 'transparent', padding: 0 }}>
              <div className="account-left">
                <span className="avatar">🙋</span>
                <div className="account-text">
                  <b>已登录</b>
                  <span>{session.userId}</span>
                </div>
              </div>
            </div>
            <button className="lg-submit" onClick={onBack}>
              回到首页继续
            </button>
            <button className="lg-oauth wb" style={{ justifyContent: 'center' }} onClick={() => clearSession()}>
              <span className="lg-oauth-left">退出登录</span>
            </button>
          </div>
        </>
      ) : (
        <div className="lg-card">
          <div className="lg-tabs">
            <button className={channel === 'phone' ? 'lg-tab on' : 'lg-tab'} onClick={() => setChannel('phone')}>
              手机号
            </button>
            <button className={channel === 'email' ? 'lg-tab on' : 'lg-tab'} onClick={() => setChannel('email')}>
              邮箱
            </button>
          </div>

          {channel === 'phone' ? (
            <div className="lg-field">
              <label htmlFor="loginPhone">手机号</label>
              <div className="lg-input">
                <span className="lg-prefix">+86</span>
                <input
                  id="loginPhone"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="138 0013 8000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <p className="lg-hint">中国大陆 11 位手机号</p>
            </div>
          ) : (
            <div className="lg-field">
              <label htmlFor="loginEmail">邮箱</label>
              <div className="lg-input">
                <input
                  id="loginEmail"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                />
              </div>
              <p className="lg-hint">邮箱验证码登录，同样不设密码</p>
            </div>
          )}

          <div className="lg-field">
            <label htmlFor="loginCode">{channel === 'phone' ? '短信验证码' : '邮箱验证码'}</label>
            <div className="lg-code-row">
              <div className="lg-input">
                <input
                  id="loginCode"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位数字"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </div>
              <button className="lg-send" disabled={sending || countdown > 0} onClick={() => void requestCode()}>
                {sending ? '发送中…' : countdown > 0 ? `${countdown}s` : '获取验证码'}
              </button>
            </div>
            <p className="lg-hint">收不到？60 秒后可重新获取</p>
          </div>

          <button className="lg-submit" onClick={() => void submit()}>
            {verifying ? '登录中…' : '登录 / 注册'}
          </button>
          {msg ? <p className={msg.kind === 'err' ? 'login-msg err' : 'login-msg'}>{msg.text}</p> : null}
          <p className="lg-note">ⓘ 未注册的手机号会自动创建账号，全程验证码，不设密码</p>
        </div>
      )}

      {session ? null : (
        <>
          <div className="lg-divider">
            <i />
            <span>其他方式</span>
            <i />
          </div>

          <button className="lg-oauth wechat" onClick={() => void oauth('wechat')}>
            <span className="lg-oauth-left">
              <span>💬</span>
              <span>微信登录</span>
            </span>
            <em>一键授权 / 扫码</em>
          </button>
          <button className="lg-oauth wb" onClick={() => void oauth('workbuddy')}>
            <span className="lg-oauth-left">
              <span>⚡</span>
              <span>使用 WorkBuddy 登录</span>
            </span>
            <em>统一账号</em>
          </button>

          <div className="lg-agree">
            <button
              className={agreed ? 'lg-check on' : 'lg-check'}
              onClick={() => setAgreed((v) => !v)}
              aria-label="同意用户协议与隐私政策"
            >
              {agreed ? <span>✓</span> : null}
            </button>
            <p>
              我已阅读并同意 <b>用户协议</b> 与 <b>隐私政策</b>，手机号仅用于登录验证
            </p>
          </div>

          <div className="lg-trust">🔒 登录由 WorkBuddy 云服务托管，不接触你的密码</div>
        </>
      )}

      <footer className="d-footer">
        <p>by domonic · 17aitech.com</p>
        <p>WorkBuddy 1024 造物挑战 · v{APP_VERSION}</p>
      </footer>
    </section>
  );
}
