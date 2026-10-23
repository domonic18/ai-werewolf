import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import type { LLMService } from '../src/server/llm-service.js';
import { createMockLLM } from './helpers/mock-llm.js';
import { permissiveLimiters } from './helpers/limiters.js';

/**
 * 登录入口的能力声明。
 *
 * 线上实际可用的三种方式：手机号验证码、微信授权、WorkBuddy 授权（邮箱通道试过但没验证，
 * 产品上不提供）。前端只渲染服务端声明的入口 —— 这条链一旦接错，用户看到的是
 * 「摆了按钮但点了报错」，所以把默认值和透传都钉在测试里。
 */

const mock = createMockLLM();
const llm: LLMService = {
  state: 'ready',
  models: [{ id: 'mock' }],
  model: { id: 'mock' },
  get callCount(): number {
    return mock.callCount;
  },
  label: () => 'mock',
  listModels: () => [{ id: 'mock', name: 'Mock' }],
  selectModel: (id: string) => ({ id }),
  selfTest: async () => ({ ok: true, sec: '0.0', model: 'mock' }),
  task: mock.task,
};

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({
    llm,
    rooms: new RoomManager({ llm, pace: 0.05 }),
    matchStore: new MatchStore(null),
    /* 不传 publicConfig：验证 routes 层的兜底声明 */
    limiters: permissiveLimiters(),
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  server = app;
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface AuthConfigBody {
  endpoint: string | null;
  publishableKey: string | null;
  providers: string[];
}

describe('登录入口的声明', () => {
  it('默认声明手机号 + 微信 + WorkBuddy，且不声明邮箱', async () => {
    const res = await fetch(`${base}/api/auth-config`);
    const body = (await res.json()) as AuthConfigBody;
    expect(res.status).toBe(200);
    expect(body.providers).toEqual(['phone', 'wechat', 'workbuddy']);
    expect(body.providers).not.toContain('email');
  });

  it('部署方声明什么就返回什么（关掉的 Provider 前端不会渲染）', async () => {
    const app = createApp({
      llm,
      rooms: new RoomManager({ llm, pace: 0.05 }),
      matchStore: new MatchStore(null),
      publicConfig: { endpoint: 'https://example.invalid', publishableKey: 'pk', providers: ['phone'] },
      limiters: permissiveLimiters(),
    });
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
    const port = (app.address() as AddressInfo).port;
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/auth-config`)).json()) as AuthConfigBody;
    await new Promise<void>((resolve) => app.close(() => resolve()));

    expect(body.providers).toEqual(['phone']);
  });
});
