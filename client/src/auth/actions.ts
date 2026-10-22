/**
 * 登录动作（SDK 适配层）。
 *
 * 这里只暴露三个窄接口：发验证码、校验验证码、OAuth 跳转。
 * 真正的云服务调用集中在这一个文件，页面不直接依赖 SDK —— 换实现时只改这里。
 * SDK 未就绪（无云配置 / 加载失败）时返回明确原因，页面照常可用（匿名也能玩）。
 */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_READY = '登录通道未就绪：拿不到云服务配置（/api/auth-config 返回空）或 Auth 未开启';

interface CloudAuth {
  sendOtp(payload: Record<string, unknown>): Promise<unknown>;
  verifyOtp(payload: Record<string, unknown>): Promise<{ accessToken?: string; user?: { id?: string } }>;
  signInWithOAuth(options: { provider: string; redirectTo?: string }): Promise<unknown>;
}

let cached: CloudAuth | null | undefined;

async function getAuth(): Promise<CloudAuth | null> {
  if (cached !== undefined) return cached;
  try {
    /* 配置由服务端下发：endpoint 与 publishableKey 都是可公开值 */
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
    if (!factory) {
      cached = null;
      return null;
    }
    const client = factory({ endpoint: cfg.endpoint, publishableKey: cfg.publishableKey });
    cached = client.auth ?? null;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export async function sendOtp(phone: string): Promise<AuthResult<null>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    await auth.sendOtp({ phone });
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '验证码发送失败' };
  }
}

export async function verifyOtp(phone: string, code: string): Promise<AuthResult<{ accessToken: string; userId: string }>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    const raw = (await auth.verifyOtp({ phone, token: code })) as unknown as Record<string, unknown>;
    /* SDK 不同版本的返回结构不一致：session/access_token 等写法都要兼容 */
    const pick = (obj: unknown, keys: string[]): string | undefined => {
      if (!obj || typeof obj !== 'object') return undefined;
      const record = obj as Record<string, unknown>;
      for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value) return value;
      }
      return undefined;
    };
    /* 这个 SDK 返回 { data, error } 结构：先看 error，再看 data.session / data.user */
    const errObj = raw.error as Record<string, unknown> | undefined | null;
    if (errObj) {
      const message =
        (typeof errObj.message === 'string' && errObj.message) ||
        (typeof errObj.msg === 'string' && errObj.msg) ||
        JSON.stringify(errObj);
      return { ok: false, error: `验证码校验失败：${message}` };
    }
    const data = raw.data as Record<string, unknown> | undefined;
    const session = (data?.session ?? raw.session ?? data) as unknown;
    const user = (data?.user ?? raw.user ?? (session as Record<string, unknown> | undefined)?.user) as unknown;
    const accessToken =
      pick(raw, ['accessToken', 'access_token', 'token']) ?? pick(session, ['accessToken', 'access_token']);
    const userId = pick(user, ['id', 'userId', 'user_id']) ?? pick(raw, ['userId', 'user_id']);
    if (!accessToken || !userId) {
      /* 把返回结构的字段名带出来，便于定位是哪一种版本 */
      const keys = Object.keys(raw).join(',');
      return { ok: false, error: `登录返回缺少会话信息（返回字段：${keys || '空'}）` };
    }
    return { ok: true, data: { accessToken, userId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '验证码校验失败' };
  }
}

export async function signInWithOAuth(provider: 'wechat' | 'workbuddy'): Promise<AuthResult<null>> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: NOT_READY };
  try {
    /* 回调地址必须是已发布 HTTPS 域名根路径，否则 Relay 会拒绝（本地无法验证） */
    await auth.signInWithOAuth({ provider, redirectTo: window.location.origin + '/' });
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '第三方登录失败' };
  }
}
