import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { permissiveLimiters } from './helpers/limiters.js';
import { RoomManager } from '../src/server/rooms.js';
import { MatchStore } from '../src/cloud/match-store.js';
import { LLMRuntime } from '../src/server/llm-runtime.js';

/**
 * 回归用例：AI 通道起不来时，站点必须仍然可用。
 * 对应 2026-10-22 线上 504 —— 当时 listen 在 LLM 初始化之后，初始化失败 → 端口不监听。
 */
describe('AI 通道不可用时的降级', () => {
  let server: Server;
  let base: string;
  let runtime: LLMRuntime;
  let staticDir: string;

  beforeAll(async () => {
    staticDir = mkdtempSync(path.join(tmpdir(), 'ww-static-'));
    writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>fallback-ok</title><div id="root"></div>');

    /* 指向必然连不上的地址，并把重试压到毫秒级 */
    runtime = new LLMRuntime(
      { endpoint: 'http://127.0.0.1:9', publishableKey: 'wbpk_test' },
      { retryDelaysMs: [0, 10], longRetryMs: 600_000 },
    );

    const rooms = new RoomManager({ llm: runtime });
    const app = createApp({ llm: runtime, rooms, matchStore: new MatchStore(null), staticDir, limiters: permissiveLimiters() });
    await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
    server = app;
    base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

    await runtime.bootstrap();
  });

  afterAll(async () => {
    runtime.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('AI 初始化失败后，进程仍在、静态页照常返回', async () => {
    expect(runtime.state).toBe('failed');

    const page = await fetch(base + '/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('fallback-ok');
  });

  it('健康检查如实上报 failed 与原因，而不是让接口挂掉', async () => {
    const res = await fetch(base + '/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; llm: { state: string; ok: boolean; error: string | null } };
    expect(body.ok).toBe(true);
    expect(body.llm.state).toBe('failed');
    expect(body.llm.ok).toBe(false);
    expect(body.llm.error).toBeTruthy();
  });

  it('开局被明确拒绝（503）而不是 500 或挂起', async () => {
    const res = await fetch(base + '/api/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: '降级测试' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; state: string };
    expect(body.state).toBe('failed');
    expect(body.error).toContain('AI 通道');
  });

  it('模型列表在未就绪时返回空数组，不抛错', async () => {
    const res = await fetch(base + '/api/models');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: unknown[] };
    expect(body.models).toEqual([]);
  });
});
