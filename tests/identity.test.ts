import { describe, expect, it, vi } from 'vitest';
import { createCloudTokenVerifier } from '../src/server/identity.js';

/**
 * 服务端身份核实的底线：
 * - 必须真的问云端（不能自己解 JWT 就当真，那样谁都能冒充）；
 * - 请求要带 `x-wb-webapp-access-key`，否则网关只回 invalid_client（2026-10 实测）；
 * - 云端不可用只能降级为匿名，不能把开局卡住。
 */
const ENDPOINT = 'https://demo.app.workbuddy.host';
const KEY = 'wbpk_demo';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('createCloudTokenVerifier', () => {
  it('200 时返回账号 id，并带上凭据头与 Bearer', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sub: 'user-1', phone_number: '13800000000' }));
    const verifier = createCloudTokenVerifier({ endpoint: ENDPOINT, publishableKey: KEY, fetchImpl });

    await expect(verifier.verify('tok-abc')).resolves.toBe('user-1');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ENDPOINT}/.cloud/auth/v1/user/me`);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-wb-webapp-access-key']).toBe(KEY);
    expect(headers.Authorization).toBe('Bearer tok-abc');
    /*
     * 会话按 appId + Origin 绑定：服务端调用若不带 Origin，网关会当成另一个客户端，
     * 回 invalid_grant —— 线上表现就是「刚登录，却提示登录态失效」。
     */
    expect(headers.Origin).toBe(ENDPOINT);
    expect(headers.Referer).toBe(`${ENDPOINT}/`);
  });

  it('同一个 token 会被缓存，不重复打云端', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sub: 'user-1' }));
    const verifier = createCloudTokenVerifier({ endpoint: ENDPOINT, publishableKey: KEY, fetchImpl });

    await verifier.verify('tok-abc');
    await verifier.verify('tok-abc');
    await verifier.verify('tok-abc');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('401 返回匿名，并短期缓存这个结论', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'invalid_grant' }));
    const verifier = createCloudTokenVerifier({ endpoint: ENDPOINT, publishableKey: KEY, fetchImpl });

    await expect(verifier.verify('bad')).resolves.toBeNull();
    await expect(verifier.verify('bad')).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('云端 5xx 不缓存：故障不能被当成「这人没登录」永久记住', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, { error: 'bad gateway' }))
      .mockResolvedValueOnce(jsonResponse(200, { sub: 'user-2' }));
    const verifier = createCloudTokenVerifier({ endpoint: ENDPOINT, publishableKey: KEY, fetchImpl });

    await expect(verifier.verify('tok')).resolves.toBeNull();
    await expect(verifier.verify('tok')).resolves.toBe('user-2');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('网络异常/超时降级为 null，不抛错（不能让开局失败）', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const verifier = createCloudTokenVerifier({ endpoint: ENDPOINT, publishableKey: KEY, fetchImpl });

    await expect(verifier.verify('tok')).resolves.toBeNull();
  });

  it('空 token 直接返回 null，不发请求', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { sub: 'user-1' }));
    const verifier = createCloudTokenVerifier({ endpoint: ENDPOINT, publishableKey: KEY, fetchImpl });

    await expect(verifier.verify('')).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('用户 id 兼容 sub / uid / user.id 三种写法', async () => {
    const cases = [{ sub: 'a' }, { uid: 'b' }, { user: { id: 'c' } }];
    for (const body of cases) {
      const verifier = createCloudTokenVerifier({
        endpoint: ENDPOINT,
        publishableKey: KEY,
        fetchImpl: async () => jsonResponse(200, body),
      });
      await expect(verifier.verify(`tok-${JSON.stringify(body)}`)).resolves.not.toBeNull();
    }
  });
});
