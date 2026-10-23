import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 分享链接的组装规则。
 *
 * 这组用例是为了 2026-10-23 那次线上事故：观战链接形如 `https://host/#watch=<id>`，
 * 分享码被拼在 `#` 后面（`#watch=g1?sharecode=…`），而 `#` 之后的内容浏览器不会发给服务器，
 * 服务端只看到「没有访问参数」，于是朋友的微信里弹出平台那张「链接不完整」页。
 */

const ORIGIN = { origin: 'https://werewolf-ai-01048.app.workbuddy.host', pathname: '/' };

describe('分享链接：sharecode 的位置', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: ORIGIN });
  });

  it('观战深链：参数在 hash 之前，深链原样保留', async () => {
    const { watchUrl } = await import('../client/src/lib/share.js');
    expect(watchUrl('gmvkkn2g36d3b09', '2IBHTRFFFL')).toBe(
      'https://werewolf-ai-01048.app.workbuddy.host/?sharecode=2IBHTRFFFL#watch=gmvkkn2g36d3b09',
    );
  });

  it('邀请链接：ref 与 sharecode 并存', async () => {
    const { inviteUrl } = await import('../client/src/lib/share.js');
    const url = inviteUrl('YEKE-7F2', '2IBHTRFFFL');
    expect(url).toBe('https://werewolf-ai-01048.app.workbuddy.host/?ref=YEKE-7F2&sharecode=2IBHTRFFFL');
  });

  it('邀请码里的特殊字符会被转义，不会把 query 拆坏', async () => {
    const { inviteUrl } = await import('../client/src/lib/share.js');
    expect(inviteUrl('a&b', '2IBHTRFFFL')).toContain('ref=a%26b');
  });

  it('观战链接里的 gameId 只进 hash，不参与 query', async () => {
    const { watchUrl } = await import('../client/src/lib/share.js');
    const url = watchUrl('g1', 'abc');
    const [beforeHash] = url.split('#');
    expect(beforeHash).toBe('https://werewolf-ai-01048.app.workbuddy.host/?sharecode=abc');
  });
});
