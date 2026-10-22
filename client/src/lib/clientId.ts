const STORAGE_KEY = 'ww_client_id';

/**
 * 稳定的客户端标识：用于服务端统计观战人数（30 秒心跳）。
 * 只做计数用途，不含任何身份信息。
 */
export function getClientId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    /* 隐私模式下无法持久化，退化为进程内随机值 */
    return `c_${Math.random().toString(36).slice(2, 10)}`;
  }
}
