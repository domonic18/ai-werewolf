/**
 * 玩家代号。
 *
 * 以前默认叫「你」，游戏里的日志、座位、发言记录全是「你：……」，而 AI 说话时也满口
 * 「你昨天怎么不说话」——两种「你」混在一起，读起来分不清谁在说谁。
 * 所以默认给一个真正的代号：从一组中性名字里挑一个，记在本机，下次沿用。
 *
 * 选词原则：2~4 字、没有性别与年龄指向、不和 AI 角色池重名（老K/小满/阿岚/豆豆/七喜/
 * 大熊/阿桃/老白/小北/星野/米粒/阿七）。
 */
const KEY = 'ww_name';

const POOL = ['夜客', '旅人', '过客', '灯下客', '守夜人', '迟到者'];

function readSaved(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(KEY);
    return value && value.trim() ? value.trim().slice(0, 8) : null;
  } catch {
    return null;
  }
}

/** 取一个默认代号：优先用上次的，否则随机挑一个并记住 */
export function defaultName(): string {
  const saved = readSaved();
  if (saved) return saved;
  const name = POOL[Math.floor(Math.random() * POOL.length)] as string;
  rememberName(name);
  return name;
}

/** 记住玩家自己改过的代号（空值不覆盖，避免手滑清空后丢掉选择） */
export function rememberName(name: string): void {
  const value = name.trim().slice(0, 8);
  if (!value) return;
  try {
    globalThis.localStorage?.setItem(KEY, value);
  } catch {
    /* 隐私模式：只是下次不再记得，不影响本局 */
  }
}

/** 允许的字符：与 SERVER 的清洗保持一致（去控制字符靠服务端，这里只挡空白） */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 8);
}
