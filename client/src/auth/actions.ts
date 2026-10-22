/**
 * 登录动作（SDK 适配层）。
 *
 * 这里只暴露三个窄接口：发验证码、校验验证码、OAuth 跳转。
 * 真正的云服务调用集中在这一个文件，页面不直接依赖 SDK —— 换实现时只改这里。
 * SDK 未就绪（无云配置 / 加载失败）时返回明确原因，页面照常可用（匿名也能玩）。
 */
export type AuthResult<T> = { ok: true; data: T } | { ok: false; error: string };

const NOT_READY = '登录通道尚未就绪：请确认已在 WorkBuddy 云服务中开启 Auth';

interface CloudAuth {
  sendOtp(payload: Record<string, unknown>): Promise<unknown>;
  verifyOtp(payload: Record<string, unknown>): Promise<{ accessToken?: string; user?: { id?: string } }>;
  signInWithOAuth(options: { provider: string; redirectTo?: string }): Promise<unknown>;
}

let cached: CloudAuth | null | undefined;

async function getAuth(): Promise<CloudAuth | null> {
  if (cached !== undefined) return cached;
  try {
    const mod = (await import('@tencent-ai/workbuddy-cloud-sdk')) as unknown as {
      createWorkBuddyCloud?: (options: Record<string, unknown>) => { auth?: CloudAuth };
    };
    const factory = mod.createWorkBuddyCloud;
    if (!factory) {
      cached = null;
      return null;
    }
    /* 前端只用可公开的 publishableKey；endpoint 由同源推断 */
    const client = factory({ endpoint: window.location.origin });
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
    const result = await auth.verifyOtp({ phone, token: code });
    const accessToken = result?.accessToken;
    const userId = result?.user?.id;
    if (!accessToken || !userId) return { ok: false, error: '登录返回缺少会话信息' };
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
