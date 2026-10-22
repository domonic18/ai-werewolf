import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { createOwnerResolver, readBearer } from '../src/server/auth.js';

const req = (authorization?: string): IncomingMessage =>
  ({ headers: authorization ? { authorization } : {} }) as IncomingMessage;

describe('readBearer', () => {
  it('取出 Bearer token，大小写不敏感', () => {
    expect(readBearer(req('Bearer abc123'))).toBe('abc123');
    expect(readBearer(req('bearer abc123'))).toBe('abc123');
  });

  it('没有或格式不对返回 null', () => {
    expect(readBearer(req())).toBeNull();
    expect(readBearer(req('Basic abc123'))).toBeNull();
    expect(readBearer(req('Bearer   '))).toBeNull();
  });
});

describe('createOwnerResolver', () => {
  it('未配置校验器时一律匿名（不阻塞开局）', async () => {
    const resolve = createOwnerResolver(null);
    expect(await resolve(req('Bearer abc'))).toBeNull();
  });

  it('校验通过返回账号 id', async () => {
    const resolve = createOwnerResolver({ verify: async (t) => (t === 'good' ? 'user-1' : null) });
    expect(await resolve(req('Bearer good'))).toBe('user-1');
    expect(await resolve(req('Bearer bad'))).toBeNull();
  });

  it('校验器抛错时降级为匿名，而不是把错误抛给调用方', async () => {
    const resolve = createOwnerResolver({
      verify: async () => {
        throw new Error('network');
      },
    });
    expect(await resolve(req('Bearer any'))).toBeNull();
  });

  it('没有 Authorization 头时直接返回 null，不调用校验器', async () => {
    let called = false;
    const resolve = createOwnerResolver({
      verify: async () => {
        called = true;
        return 'x';
      },
    });
    expect(await resolve(req())).toBeNull();
    expect(called).toBe(false);
  });
});
