/**
 * 进程入口：先监听端口，再后台初始化 AI 通道。
 *
 * 顺序很重要（2026-10-22 线上 504 的教训）：LLM 的 endpoint 是本应用的公网域名，
 * 沙箱冷启动时该域名尚未就绪。若先 await 初始化再 listen，初始化失败 → 进程退出 →
 * 端口从未监听 → 平台 30s 后返回 504，连静态首页都打不开。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createApp, PROJECT_ROOT } from './app.js';
import { createOwnerResolver } from './auth.js';
import { createCloudTokenVerifier } from './identity.js';
import type { CloudConfig } from '../ai/llm-gateway.js';
import { MatchStore } from '../cloud/match-store.js';
import { RoomManager } from './rooms.js';
import { LLMRuntime } from './llm-runtime.js';
import type { AppEnv } from '../shared/types.js';

interface FileConfig {
  endpoint?: string;
  publishableKey?: string;
  oauthRelayBaseUrl?: string;
  env?: string;
}

/**
 * 配置查找顺序（开源仓库零密钥）：
 *   1) 环境变量 WB_ENDPOINT / WB_PUBLISHABLE_KEY / WB_OAUTH_RELAY
 *   2) config/cloud.json —— 本地开发用，已被 .gitignore 忽略（模板见 config/cloud.example.json）
 *   3) /workspace/.workbuddy/deploy-config.json —— sites 沙箱内由发布配置写入
 */
async function loadConfig(): Promise<CloudConfig> {
  const candidates = [
    path.join(PROJECT_ROOT, 'config', 'cloud.json'),
    '/workspace/.workbuddy/deploy-config.json',
  ];

  let fileConfig: FileConfig = {};
  for (const file of candidates) {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
      if (parsed && typeof parsed === 'object') fileConfig = { ...fileConfig, ...(parsed as FileConfig) };
    } catch {
      /* 缺失即跳过 */
    }
  }

  const endpoint = process.env.WB_ENDPOINT ?? fileConfig.endpoint;
  const publishableKey = process.env.WB_PUBLISHABLE_KEY ?? fileConfig.publishableKey;
  const oauthRelayBaseUrl = process.env.WB_OAUTH_RELAY ?? fileConfig.oauthRelayBaseUrl;

  if (!endpoint || !publishableKey) {
    throw new Error(
      '缺少云服务配置：请设置 WB_ENDPOINT / WB_PUBLISHABLE_KEY 环境变量，或复制 config/cloud.example.json 为 config/cloud.json 并填入配置',
    );
  }
  return { endpoint, publishableKey, ...(oauthRelayBaseUrl ? { oauthRelayBaseUrl } : {}) };
}

export async function main(): Promise<import('node:http').Server> {
  const config = await loadConfig();

  /* 环境：WB_ENV=staging 时页面打标，且默认不写生产战绩表（WB_WRITE_MATCHES=1 可显式打开） */
  const env: AppEnv = (process.env.WB_ENV ?? process.env.APP_ENV ?? '').toLowerCase() === 'staging' ? 'staging' : 'production';
  const readOnlyMatches = env === 'staging' && process.env.WB_WRITE_MATCHES !== '1';

  const llm = new LLMRuntime(config);
  const matchStore = new MatchStore(() => llm.cloud, { readOnly: readOnlyMatches });
  const rooms = new RoomManager({ llm, matchStore });

  /*
   * 身份核实：把前端带来的 access token 交给云服务认人。
   * 云端不可达/超时一律降级为匿名（登录是可选项，绝不阻断开局）。
   */
  const verifier = createCloudTokenVerifier({
    endpoint: config.endpoint,
    publishableKey: config.publishableKey,
  });

  const server = createApp({
    llm,
    rooms,
    matchStore,
    env,
    resolveOwner: createOwnerResolver(verifier),
    probeOwner: (token) => verifier.probe(token),
    publicConfig: {
      endpoint: config.endpoint,
      publishableKey: config.publishableKey,
      ...(config.oauthRelayBaseUrl ? { oauthRelayBaseUrl: config.oauthRelayBaseUrl } : {}),
      /*
       * 哪些登录方式真的可用，由部署方声明（WB_AUTH_PROVIDERS=phone,wechat,workbuddy）。
       * 默认与线上实际一致：手机号验证码 + 微信 + WorkBuddy 三种（邮箱试过但没验证，产品上不提供）。
       * 某个 Provider 若在云服务管理页被关掉，部署时改成只声明可用的那几个即可，
       * 前端不会摆出「点了必失败」的按钮。
       */
      providers: (process.env.WB_AUTH_PROVIDERS ?? 'phone,wechat,workbuddy')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    },
  });
  const port = Number(process.env.PORT ?? 3000);

  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));
  console.log(
    `[werewolf-ai] listening on :${port}（env=${env}${readOnlyMatches ? '，战绩只读' : ''}，AI 通道后台初始化中）`,
  );

  /* 后台初始化：失败不退出进程，站点保持可用，/api/games 返回 503 直到就绪 */
  void llm.bootstrap();

  return server;
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
  : false;

if (isDirectRun) {
  main().catch((e: Error) => {
    console.error('[werewolf-ai] fatal:', e);
    process.exit(1);
  });
}
