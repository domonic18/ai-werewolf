/**
 * 本地对局记录：id + 玩家凭证。
 * 凭证只存本地（localStorage），用于刷新后继续这一局；
 * 它不随分享链接扩散，换设备也拿不到（那属于 v1.5 的登录态).
 */
export interface SavedGame {
  id: string;
  token: string;
}

const KEY = 'ww_game';

export function readSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { id, token } = parsed as Partial<SavedGame>;
    if (typeof id !== 'string' || typeof token !== 'string' || !id || !token) return null;
    return { id, token };
  } catch {
    /* 旧格式（纯字符串 id）或隐私模式：一律视为不可恢复 */
    return null;
  }
}

export function saveGame(game: SavedGame): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(game));
  } catch {
    /* ignore */
  }
}

export function clearSavedGame(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
