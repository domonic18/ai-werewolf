import { useEffect, useState } from 'react';
import { getSession, onSessionChange } from './session';
import type { Session } from './session';

/**
 * 登录态 hook：只读当前会话并跟随变化重渲染。
 * 登录/登出的实际动作放在 LoginPage，避免这个 hook 承担业务。
 */
export function useSession(): { session: Session | null; signedIn: boolean } {
  const [session, setSession] = useState<Session | null>(() => getSession());

  useEffect(() => onSessionChange(setSession), []);

  return { session, signedIn: session !== null };
}
