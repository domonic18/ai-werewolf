/**
 * 登录动作（SDK 适配层）。
 *
 * 严格按 SDK 类型定义实现（node_modules/@tencent-ai/workbuddy-cloud-sdk/lib/client-*.d.ts）：
 * - sendOtp(credentials: OtpCredentials) → CloudResult<OtpChallenge>
 *   手机号字段是 `phone_number`，并带 `target: 'ANY'`（新老用户都允许发码）；
 *   返回 `{ data: { verificationId, isExistingUser }, error }`。
 * - verifyOtp(params: VerifyOtpParams & { isExistingUser }) → CloudResult<CloudSession>
 *   必须同时带 verificationId + token + phone（与发码时一致）+ isExistingUser。
 * - signInWithOAuth({ provider }) → CloudResult<{ url }>
 *   SDK 不自己跳转，由调用方 location.assign；workbuddy 的 PKCE 存在当前标签页，
 *   所以必须同标签页跳转，不能 window.open。
 *
 * 以上三条都来自类型定义，不再靠猜测字段名。
 */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_READY = '登录通道未就绪：拿不到云服务配置（/api/auth-config 返回空）或 Auth 未开启';

interface CloudSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: { id: string };
}

interface OtpChallenge {
  verificationId: string;
  isExistingUser: boolean;
}

type CloudResult<T> = { data: T | null; error: { message?: string; msg?: string } | null };

interface CloudAuth {
  sendOtp(credentials: { phone_number: string; target: 'ANY' }): Promise<CloudResult<OtpChallenge>>;
  verifyOtp(params: {
    verificationId: string;
    token: string;
    phone: string;
    isExistingUser: boolean;
  }): Promise<CloudResult<CloudSession>>;
  signInWithOAuth(options: { provider: 'wechat' | 'workbuddy' }): Promise<CloudResult<{ url: string }>>;
}

let cached: CloudAuth | null | undefined;

async function getAuth(): Promise<CloudAuth | null> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('/api/auth-config');
    const cfg = (await res.json()) as { endpoint?: string | null; publishableKey?: string | null };
    if (!cfg.endpoint || !cfg.publishableKey) {
      cached = null;
      return null;
    }
    const mod = (await import('@tencent-ai/workbuddy-cloud-sdk')) as unknown as {
      createWorkBuddyCloud?: (options: Record<string, unknown>) => { auth?: CloudAuth };
    };
    const factory = mod.createWorkBuddyCloud;
    cached = factory ? (factory({ endpoint: cfg.endpoint, publishableKey: cfg.publishableKey }).auth ?? null) : null;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

const errText = (error: { message?: string; msg?: string } | null): string =>
  error?.message ?? error?.msg ?? '未知错误';

/** 发码：返回 verificationId 与「是否老用户」（后者决定验码走登录还是注册） */
export async function sendOtp(
  phone: string,
): Promise<AuthResult<{ verificationId: string; isExistingUser: boolean }>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    const result = await auth.sendOtp({ phone_number: phone, target: 'ANY' });
    if (result.error) return { ok: false, error: errText(result.error) };
    const data = result.data;
    if (!data?.verificationId) return { ok: false, error: '验证码已发出，但没有拿到 verificationId' };
    return { ok: true, data: { verificationId: data.verificationId, isExistingUser: data.isExistingUser } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '验证码发送失败' };
  }
}

/** 验码：四个参数缺一不可，phone 必须与发码时一致 */
export async function verifyOtp(params: {
  phone: string;
  code: string;
  verificationId: string;
  isExistingUser: boolean;
}): Promise<AuthResult<{ accessToken: string; userId: string; expiresAt: number }>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    const result = await auth.verifyOtp({
      verificationId: params.verificationId,
      token: params.code,
      phone: params.phone,
      isExistingUser: params.isExistingUser,
    });
    if (result.error) return { ok: false, error: errText(result.error) };
    const session = result.data;
    if (!session?.accessToken || !session.user?.id) {
      return { ok: false, error: '验码成功但会话信息不完整' };
    }
    return { ok: true, data: { accessToken: session.accessToken, userId: session.user.id, expiresAt: session.expiresAt } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '验证码校验失败' };
  }
}

/** 第三方登录：拿 url 后在当前标签页跳转（SDK 不代跳） */
export async function signInWithOAuth(provider: 'wechat' | 'workbuddy'): Promise<AuthResult<null>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    const result = await auth.signInWithOAuth({ provider });
    if (result.error) return { ok: false, error: errText(result.error) };
    const url = result.data?.url;
    if (!url) return { ok: false, error: '没有拿到授权地址' };
    window.location.assign(url);
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '第三方登录失败' };
  }
}
