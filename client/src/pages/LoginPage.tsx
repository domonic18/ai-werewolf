import { useEffect, useState } from 'react';
import { sendOtp, signInWithOAuth, verifyOtp } from '../auth/actions';
import { setSession } from '../auth/session';

const APP_VERSION = __APP_VERSION__;

interface LoginPageProps {
  onBack: () => void;
  onSignedIn: () => void;
}

/** 登录页：手机号验证码主推，微信/WorkBuddy 并列；不登录也能玩，这里只是可选增强 */
export function LoginPage({ onBack, onSignedIn }: LoginPageProps): JSX.Element {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [verificationId, setVerificationId] = useState('');
  const [isExistingUser, setIsExistingUser] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  const validPhone = /^1\d{10}$/.test(phone);

  const requestCode = async (): Promise<void> => {
    if (!validPhone || countdown > 0) return;
    setSending(true);
    setHint(null);
    const result = await sendOtp(phone);
    setSending(false);
    if (result.ok) {
      setVerificationId(result.data.verificationId);
      setIsExistingUser(result.data.isExistingUser);
      setCountdown(60);
      setHint('验证码已发送，请查收短信');
    } else {
      setHint(result.error);
    }
  };

  const submit = async (): Promise<void> => {
    if (!validPhone || code.trim().length < 4) return;
    setVerifying(true);
    setHint(null);
    const result = await verifyOtp({ phone, code: code.trim(), verificationId, isExistingUser });
    setVerifying(false);
    if (result.ok) {
      setSession({ accessToken: result.data.accessToken, userId: result.data.userId, expiresAt: 0 });
      onSignedIn();
    } else {
      setHint(result.error);
    }
  };

  const oauth = async (provider: 'wechat' | 'workbuddy'): Promise<void> => {
    setHint(null);
    const result = await signInWithOAuth(provider);
    if (!result.ok) setHint(result.error);
  };

  return (
    <section className="screen">
      <div className="topbar">
        <button className="btn ghost small" onClick={onBack}>
          ‹ 返回
        </button>
        <div className="lobby-title">登录</div>
        <span style={{ width: 44 }} />
      </div>

      <div className="panel">
        <div className="panel-title">手机号登录 / 注册</div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="phone-prefix">+86</span>
          <input
            className="input"
            inputMode="numeric"
            maxLength={11}
            placeholder="11 位手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="input"
            inputMode="numeric"
            maxLength={6}
            placeholder="验证码"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button className="btn ghost" disabled={!validPhone || countdown > 0 || sending} onClick={() => void requestCode()}>
            {sending ? '发送中…' : countdown > 0 ? `${countdown}s` : '获取验证码'}
          </button>
        </div>
        <button
          className="btn primary big"
          style={{ marginTop: 12 }}
          disabled={!verificationId || code.trim().length < 4 || verifying}
          onClick={() => void submit()}
        >
          {verifying ? '登录中…' : '登录 / 注册'}
        </button>
        <p className="hint">同一按钮覆盖新老用户，不会暴露手机号是否已注册。</p>
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

      {hint ? <p className="hint" style={{ textAlign: 'center' }}>{hint}</p> : null}

      <p className="hint" style={{ textAlign: 'center', opacity: 0.7 }}>
        不登录也能玩 —— 登录只是让战绩与对局跟着账号走 · v{APP_VERSION}
      </p>
    </section>
  );
}
