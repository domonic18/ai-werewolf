/**
 * LLM 客户端的抽象：引擎与 AI 玩家只依赖这个接口，
 * 便于测试注入 Mock，也避免把云 SDK 的类型泄漏到游戏层。
 */
export interface LLMTaskOptions {
  temperature?: number;
  retries?: number;
}

export interface LLMClient {
  /** 要求模型输出 JSON 并解析；失败抛错（llmFailure 标记） */
  task(system: string, user: string, options?: LLMTaskOptions): Promise<Record<string, unknown>>;
  /** 当前模型的可读名（日志/健康检查用） */
  label(): string;
  /** 累计调用次数（用于"观战不增加成本"这类断言） */
  callCount?: number;
}
