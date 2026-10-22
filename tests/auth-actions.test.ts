import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 这组用例锁的是 SDK **运行时**契约，不是 .d.ts 的措辞。
 *
 * 背景（2026-10 连续三次线上登录故障）：
 * - 第一版凭感觉传 `{ phone }`，能收到短信；
 * - 后来照 .d.ts 注释改成 `{ phone_number, target: 'ANY' }`，结果 SDK 的
 *   `resolveAuthIdentifier` 只认 `credentials.phone` / `credentials.email`，
 *   两个都不存在 → 直接失败，页面点「获取验证码」毫无反应、短信也不发。
 *
 * 所以这里用一个假 SDK 把调用形状钉住：字段名一改错，测试立刻红。
 */
const auth = {
  sendOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
};

const factory = vi.fn(() => ({ auth }));

vi.mock('@tencent-ai/workbuddy-cloud-sdk', () => ({ createWorkBuddyCloud: factory }));

const CONFIG = { endpoint: 'https://demo.app.workbuddy.host', publishableKey: 'wbpk_demo' };

function stubConfig(overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ ...CONFIG, ...overrides }),
    })),
  );
}

/** actions.ts 里有模块级缓存，每个用例都重新加载一次，避免相互污染 */
async function freshActions(): Promise<typeof import('../client/src/auth/actions')> {
  vi.resetModules();
  return await import('../client/src/auth/actions');
}

describe('登录适配层 · SDK 调用契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    factory.mockImplementation(() => ({ auth }) as never);
    stubConfig();
  });

  it('发码用 phone 字段（不是 phone_number，也不必传 target）', async () => {
    auth.sendOtp.mockResolvedValue({ data: { verificationId: 'v-1', isExistingUser: false }, error: null });
    const { sendOtp } = await freshActions();

    const result = await sendOtp('13800000000');

    /* 关键断言：运行时只认 phone */
    expect(auth.sendOtp).toHaveBeenCalledWith({ phone: '13800000000' });
    expect(result).toEqual({ ok: true, data: { verificationId: 'v-1', isExistingUser: false } });
  });

  it('验码带齐 phone + token + verificationId + isExistingUser', async () => {
    auth.sendOtp.mockResolvedValue({ data: { verificationId: 'v-2', isExistingUser: true }, error: null });
    auth.verifyOtp.mockResolvedValue({
      data: { accessToken: 'at', refreshToken: 'rt', expiresAt: 123, user: { id: 'u-1' } },
      error: null,
    });
    const { sendOtp, verifyOtp } = await freshActions();

    const sent = await sendOtp('13800000000');
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;

    const result = await verifyOtp({
      phone: '13800000000',
      code: '123456',
      verificationId: sent.data.verificationId,
      isExistingUser: sent.data.isExistingUser,
    });

    expect(auth.verifyOtp).toHaveBeenCalledWith({
      phone: '13800000000',
      token: '123456',
      verificationId: 'v-2',
      isExistingUser: true,
    });
    expect(result).toEqual({ ok: true, data: { accessToken: 'at', userId: 'u-1', expiresAt: 123 } });
  });

  it('SDK 返回 error 时原样透出，不静默吞掉', async () => {
    auth.sendOtp.mockResolvedValue({
      data: null,
      error: { kind: 'invalid-request', status: 0, message: 'sendOtp requires exactly one of email or phone' },
    });
    const { sendOtp } = await freshActions();

    const result = await sendOtp('13800000000');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('exactly one of email or phone');
  });

  it('配置缺失时报「通道未就绪」，恢复后重试即可，不永久缓存失败', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ endpoint: null, publishableKey: null }) })),
    );
    const { sendOtp } = await freshActions();

    expect((await sendOtp('13800000000')).ok).toBe(false);

    stubConfig();
    auth.sendOtp.mockResolvedValue({ data: { verificationId: 'v-3', isExistingUser: true }, error: null });
    expect((await sendOtp('13800000000')).ok).toBe(true);
  });

  it('会话缺 sub 时从 accessToken 的 JWT 里兜底取 userId', async () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'jwt-user' })).toString('base64url');
    auth.sendOtp.mockResolvedValue({ data: { verificationId: 'v-4', isExistingUser: true }, error: null });
    auth.verifyOtp.mockResolvedValue({
      data: { accessToken: `header.${payload}.sig`, refreshToken: '', expiresAt: 0, user: { id: '' } },
      error: null,
    });
    const { verifyOtp } = await freshActions();

    const result = await verifyOtp({
      phone: '13800000000',
      code: '654321',
      verificationId: 'v-4',
      isExistingUser: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userId).toBe('jwt-user');
  });

  it('初始化 SDK 时带上 oauthRelayBaseUrl（第三方登录需要）', async () => {
    stubConfig({ oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth' });
    auth.sendOtp.mockResolvedValue({ data: { verificationId: 'v-5', isExistingUser: true }, error: null });
    const { sendOtp } = await freshActions();

    await sendOtp('13800000000');

    expect(factory).toHaveBeenCalledWith({
      endpoint: CONFIG.endpoint,
      publishableKey: CONFIG.publishableKey,
      oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    });
  });
});
