import { useEffect, useState } from 'react';
import { sendOtp, signInWithOAuth, verifyOtp } from '../auth/actions';
import { setSession } from '../auth/session';
import { useSession } from '../auth/useSession';
import { AccountCard } from '../components/AccountCard';

const APP_VERSION = __APP_VERSION__;

interface LoginPageProps {
  onBack: () => void;
  onSignedIn: () => void;
}

type Channel = 'phone' | 'email';

/**
 * 登录页（对齐原型 docs/designs/05-login.html）：
 * 标题「登录后开局」+ 手机号/邮箱 Tab + 验证码 + 其他方式（微信 / WorkBuddy）。
 * 已登录时直接显示账号卡 —— 否则用户进来看不出自己是不是已经登录了。
 */
export function LoginPage({ onBack, onSignedIn }: LoginPageProps): JSX.Element {
  const { signedIn } = useSession();
  const [channel, setChannel] = useState<Channel>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [verificationId, setVerificationId] = useState('');
  const [isExistingUser, setIsExistingUser] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  /* 提示紧跟按钮显示：失败信息藏在页面底部会被当成「点了没反应」 */
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const value = channel === 'phone' ? phone : email;
  const valid = channel === 'phone' ? /^1\d{10}$/.test(phone) : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSend = valid && countdown === 0 && !sending;
  const canSubmit = valid && Boolean(verificationId) && code.trim().length >= 4 && !verifying;

  const requestCode = async (): Promise<void> => {
    if (!canSend) return;
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
    if (!canSubmit) return;
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
    <section className="screen">
      <div className="topbar">
        <button className="btn ghost small" onClick={onBack}>
          ‹ 返回
        </button>
        <div className="lobby-title">账号登录</div>
        <span style={{ width: 44 }} />
      </div>

      <div className="login-hero">
        <div className="login-logo">🐺</div>
        <h2 className="login-title">登录后开局</h2>
        <p className="login-sub">战绩、未完成的对局、观战记录都记在账号下</p>
      </div>

      {signedIn ? (
        <>
          <AccountCard />
          <button className="btn primary big" style={{ marginTop: 12 }} onClick={onBack}>
            回到首页继续
          </button>
        </>
      ) : (
        <>
          <div className="panel">
            <div className="login-tabs">
              <button
                className={channel === 'phone' ? 'login-tab on' : 'login-tab'}
                onClick={() => setChannel('phone')}
              >
                手机号
              </button>
              <button
                className={channel === 'email' ? 'login-tab on' : 'login-tab'}
                onClick={() => setChannel('email')}
              >
                邮箱
              </button>
            </div>

            {channel === 'phone' ? (
              <div className="login-field">
                <label className="field-label" htmlFor="loginPhone">
                  手机号
                </label>
                <div className="row">
                  <span className="phone-prefix">+86</span>
                  <input
                    id="loginPhone"
                    className="input"
                    inputMode="numeric"
                    maxLength={11}
                    placeholder="11 位手机号"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <p className="field-hint">中国大陆 11 位手机号</p>
              </div>
            ) : (
              <div className="login-field">
                <label className="field-label" htmlFor="loginEmail">
                  邮箱
                </label>
                <input
                  id="loginEmail"
                  className="input"
                  inputMode="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                />
                <p className="field-hint">邮箱验证码登录，同样不设密码</p>
              </div>
            )}

            <div className="login-field">
              <label className="field-label" htmlFor="loginCode">
                {channel === 'phone' ? '短信验证码' : '邮箱验证码'}
              </label>
              <div className="row">
                <input
                  id="loginCode"
                  className="input"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位数字"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <button className="btn ghost" disabled={!canSend} onClick={() => void requestCode()}>
                  {sending ? '发送中…' : countdown > 0 ? `${countdown}s` : '获取验证码'}
                </button>
              </div>
              <p className="field-hint">收不到？60 秒后可重新获取</p>
            </div>

            <button className="btn primary big" style={{ marginTop: 12 }} disabled={!canSubmit} onClick={() => void submit()}>
              {verifying ? '登录中…' : '登录 / 注册'}
            </button>
            {msg ? <p className={msg.kind === 'err' ? 'login-msg err' : 'login-msg'}>{msg.text}</p> : null}
            <p className="hint" style={{ textAlign: 'center' }}>
              ⓘ 未注册的手机号会自动创建账号，全程验证码，不设密码
            </p>
          </div>

          <div className="panel">
            <div className="panel-title">其他方式</div>
            <button className="btn ghost big" style={{ marginTop: 10 }} onClick={() => void oauth('wechat')}>
              💬 微信登录（一键授权 / 扫码）
            </button>
            <button className="btn ghost big" style={{ marginTop: 8 }} onClick={() => void oauth('workbuddy')}>
              🅦 使用 WorkBuddy 登录
            </button>
            <p className="hint">这两种需要已发布的 HTTPS 域名回调，本地预览不可用。</p>
          </div>
        </>
      )}

      <p className="hint" style={{ textAlign: 'center', opacity: 0.7 }}>
        不登录也能玩 —— 登录只是让战绩与对局跟着账号走 · v{APP_VERSION}
      </p>
    </section>
  );
}
