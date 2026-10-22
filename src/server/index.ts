/**
 * 进程入口：加载云服务配置 → 初始化 LLM 网关 → 起单端口服务。
 * 绑定 0.0.0.0 + PORT（sites 沙箱要求）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createApp, PROJECT_ROOT } from './app.js';
import { createLLMGateway } from '../ai/llm-gateway.js';
import type { CloudConfig } from '../ai/llm-gateway.js';
import { MatchStore } from '../cloud/match-store.js';
import { RoomManager } from './rooms.js';

interface FileConfig {
  endpoint?: string;
  publishableKey?: string;
  oauthRelayBaseUrl?: string;
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
  const llm = await createLLMGateway(config);
  const matchStore = new MatchStore(llm.cloud);
  const rooms = new RoomManager({ llm, matchStore });

  const server = createApp({ llm, rooms, matchStore });
  const port = Number(process.env.PORT ?? 3000);

  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));
  console.log(`[werewolf-ai] listening on :${port}, llm=${llm.label()}, models=${llm.models.length}`);
  return server;
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname) : false;
if (isDirectRun) {
  main().catch((e: Error) => {
    console.error('[werewolf-ai] fatal:', e);
    process.exit(1);
  });
}
