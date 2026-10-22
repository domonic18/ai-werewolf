/**
 * 登录动作（SDK 适配层）。
 *
 * 契约来自 SDK **运行时实现**（node_modules/@tencent-ai/workbuddy-cloud-sdk/lib/chunk-*.js
 * 的 `resolveAuthIdentifier` / `sendOtp` / `verifyOtp`），不是只看 .d.ts：
 *
 * - `sendOtp(credentials)`：运行时只认 `credentials.phone` / `credentials.email`
 *   （`phone_number`、`target` 是 SDK 内部转发给上游的**请求体**字段，由它自己拼，
 *   调用方传了也不会被读）。两个都不传 → 直接返回
 *   "sendOtp requires exactly one of email or phone"。
 *   返回 `{ data: { verificationId, isExistingUser }, error }`。
 * - `verifyOtp(params)`：同样靠 `params.phone` 认人，另需 `verificationId` + `token`；
 *   `isExistingUser` 决定走登录还是注册（由发码结果给出，SDK 不猜）。
 *   返回 `{ data: { accessToken, refreshToken, expiresAt, user }, error }`。
 * - `signInWithOAuth({ provider, redirectTo })`：返回 `{ data: { url } }`，
 *   SDK 不代跳，必须由调用方 `location.assign`（workbuddy 走 PKCE，必须同标签页）。
 *
 * 教训（2026-10 三次线上故障）：字段名只能从运行时实现确认，不能凭 .d.ts 注释或猜测。
 * tests/auth-actions.test.ts 用假 SDK 把这三条契约钉住了，改错会直接测试失败。
 */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** 发码渠道：手机号或邮箱，二选一（SDK 运行时同样按这个字段区分，见文件头注释） */
export interface OtpTarget {
  kind: 'phone' | 'email';
  value: string;
}

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

interface CloudError {
  kind?: string;
  status?: number;
  message?: string;
  msg?: string;
}

type CloudResult<T> = { data: T | null; error: CloudError | null };

interface CloudAuth {
  sendOtp(credentials: { phone: string } | { email: string }): Promise<CloudResult<OtpChallenge>>;
  verifyOtp(params: {
    phone?: string;
    email?: string;
    token: string;
    verificationId: string;
    isExistingUser: boolean;
  }): Promise<CloudResult<CloudSession>>;
  signInWithOAuth(options: {
    provider: 'wechat' | 'workbuddy';
    redirectTo?: string;
  }): Promise<CloudResult<{ url: string }>>;
}

type CloudModule = {
  createWorkBuddyCloud?: (options: Record<string, unknown>) => { auth?: CloudAuth };
};

interface AuthConfig {
  endpoint: string;
  publishableKey: string;
  oauthRelayBaseUrl?: string;
}

let cached: CloudAuth | null | undefined;

/** 失败时把缓存清回 undefined，下次点击重新初始化 —— 一次网络抖动不该让整页永久不可用 */
function resetCache(): null {
  cached = undefined;
  return null;
}

async function getAuth(): Promise<CloudAuth | null> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch('/api/auth-config');
    const cfg = (await res.json()) as Partial<AuthConfig>;
    if (!cfg.endpoint || !cfg.publishableKey) return resetCache();
    const mod = (await import('@tencent-ai/workbuddy-cloud-sdk')) as unknown as CloudModule;
    const factory = mod.createWorkBuddyCloud;
    if (!factory) return resetCache();
    const options: Record<string, unknown> = {
      endpoint: cfg.endpoint,
      publishableKey: cfg.publishableKey,
    };
    if (cfg.oauthRelayBaseUrl) options.oauthRelayBaseUrl = cfg.oauthRelayBaseUrl;
    const client = factory(options);
    cached = client.auth ?? null;
    return cached;
  } catch {
    return resetCache();
  }
}

function errText(error: CloudError | null): string {
  if (!error) return '未知错误';
  const message = error.message ?? error.msg;
  if (message) return message;
  return `登录服务返回错误（kind=${error.kind ?? 'unknown'}，status=${error.status ?? 0}）`;
}

/** 兜底：个别上游响应不带 `sub`，从 JWT 里取 `sub` 当 userId，避免拿到空 id 直接判失败 */
function fallbackUserId(accessToken: string): string {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
    return typeof payload.sub === 'string' ? payload.sub : '';
  } catch {
    return '';
  }
}

/** 发码：返回 verificationId 与「是否老用户」（后者决定验码走登录还是注册） */
export async function sendOtp(
  target: OtpTarget,
): Promise<AuthResult<{ verificationId: string; isExistingUser: boolean }>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    /* 运行时只认 `phone` / `email`；手机号由 SDK 归一化成 `+86 xxx` 并补 `target: 'ANY'` */
    const result = await auth.sendOtp(
      target.kind === 'phone' ? { phone: target.value } : { email: target.value },
    );
    if (result.error) return { ok: false, error: errText(result.error) };
    const data = result.data;
    if (!data?.verificationId) return { ok: false, error: '验证码已发出，但没有拿到 verificationId' };
    return { ok: true, data: { verificationId: data.verificationId, isExistingUser: data.isExistingUser === true } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '验证码发送失败' };
  }
}

/** 验码：渠道与标识必须与发码时一致，isExistingUser 来自发码结果 */
export async function verifyOtp(params: {
  target: OtpTarget;
  code: string;
  verificationId: string;
  isExistingUser: boolean;
}): Promise<AuthResult<{ accessToken: string; userId: string; expiresAt: number }>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    const result = await auth.verifyOtp({
      ...(params.target.kind === 'phone' ? { phone: params.target.value } : { email: params.target.value }),
      token: params.code,
      verificationId: params.verificationId,
      isExistingUser: params.isExistingUser,
    });
    if (result.error) return { ok: false, error: errText(result.error) };
    const session = result.data;
    if (!session?.accessToken) return { ok: false, error: '验码成功但会话信息不完整' };
    const userId = session.user?.id || fallbackUserId(session.accessToken);
    if (!userId) return { ok: false, error: '验码成功但拿不到用户标识' };
    return {
      ok: true,
      data: { accessToken: session.accessToken, userId, expiresAt: session.expiresAt ?? 0 },
    };
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
