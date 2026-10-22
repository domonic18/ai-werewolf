import type { SVGProps } from 'react';

/**
 * 图标系统（v2）：一套自绘的 24×24、1.5px 描边、圆头圆角的线性图标。
 * 取代 emoji —— 全站不再出现彩色字符，颜色一律继承 currentColor。
 *
 * 规范（见 docs/DESIGN-V2.md）：
 * - viewBox 固定 24，stroke-width 1.5，strokeLinecap/Join = round
 * - 只用几何构造，不描细节：16px 下仍要清楚
 * - 只做装饰时 aria-hidden；作为唯一可访达名称时使用 <Icon title="…" /> 或按钮自带 aria-label
 */
export type IconName =
  /* 角色 */
  | 'wolf'
  | 'seer'
  | 'witch'
  | 'villager'
  | 'hunter'
  | 'guard'
  | 'idol'
  | 'elder'
  | 'crown'
  | 'moon'
  /* 界面 */
  | 'back'
  | 'chevronRight'
  | 'close'
  | 'check'
  | 'lock'
  | 'refresh'
  | 'users'
  | 'eye'
  | 'play'
  | 'pause'
  | 'clock'
  | 'mail'
  | 'phone'
  | 'shieldCheck'
  | 'seal'
  | 'ballot'
  | 'mic'
  | 'note'
  | 'grid'
  | 'list'
  | 'sort'
  | 'search'
  | 'send'
  | 'plus'
  | 'minus'
  | 'skull'
  | 'sun'
  | 'info';

const PATHS: Record<IconName, JSX.Element> = {
  /* 狼头：两只尖耳 + 吻部，比写实狼更好认 */
  wolf: (
    <>
      <path d="M5 4.5l3.2 1.8L12 4l3.8 2.3L19 4.5v5.2c0 4.4-3.1 7.9-7 9.8-3.9-1.9-7-5.4-7-9.8z" />
      <path d="M9.2 10.4h.01M14.8 10.4h.01" />
      <path d="M10.4 14.2c1 .8 2.2.8 3.2 0" />
    </>
  ),
  /* 预言家：眼 + 瞳孔 */
  seer: (
    <>
      <path d="M2.8 12S6 6.8 12 6.8 21.2 12 21.2 12 18 17.2 12 17.2 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  /* 女巫：圆底药瓶 */
  witch: (
    <>
      <path d="M9.6 3.2h4.8M10.6 3.2v4.1L7.4 14a4.2 4.2 0 003.6 6.3h2a4.2 4.2 0 003.6-6.3l-3.2-6.7V3.2" />
      <path d="M8.6 13.6h6.8" />
    </>
  ),
  /* 平民：人形 */
  villager: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.6 20.2c0-3.4 2.9-6 6.4-6s6.4 2.6 6.4 6" />
    </>
  ),
  /* 猎人：准星 */
  hunter: (
    <>
      <circle cx="12" cy="12" r="6.4" />
      <path d="M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  /* 守卫：盾 */
  guard: (
    <>
      <path d="M12 3.2l7 2.4v5.6c0 4.4-2.9 7.9-7 9.6-4.1-1.7-7-5.2-7-9.6V5.6z" />
      <path d="M8.8 11.8l2.2 2.2 4.2-4.4" />
    </>
  ),
  /* 白痴：面具 */
  idol: (
    <>
      <path d="M4.4 7.2h15.2v5.4c0 4.2-3.4 7.6-7.6 7.6s-7.6-3.4-7.6-7.6z" />
      <path d="M9 11.4h.01M15 11.4h.01" />
      <path d="M9.6 15.2c1.5 1 3.3 1 4.8 0" />
    </>
  ),
  /* 长老：手杖 */
  elder: (
    <>
      <path d="M15.6 3.6a3.2 3.2 0 00-3.2 3.2v13.6" />
      <path d="M15.6 3.6a3.2 3.2 0 013.2 3.2" />
      <path d="M9.2 20.4h6.4" />
    </>
  ),
  /* 黑狼王：冠 */
  crown: (
    <>
      <path d="M3.6 8.4l3.6 3 4.8-5.6 4.8 5.6 3.6-3-1.6 10.2H5.2z" />
    </>
  ),
  /* 摄梦人：月 */
  moon: <path d="M20.2 14.6A8.4 8.4 0 019.4 3.8 8.6 8.6 0 1020.2 14.6z" />,

  back: (
    <>
      <path d="M14.8 5.6L8.4 12l6.4 6.4" />
    </>
  ),
  chevronRight: <path d="M9.6 5.6L16 12l-6.4 6.4" />,
  close: <path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" />,
  check: <path d="M4.8 12.6l4.6 4.6 9.8-10.4" />,
  lock: (
    <>
      <rect x="4.8" y="10.4" width="14.4" height="9.6" rx="2.4" />
      <path d="M8.4 10.4V7.6a3.6 3.6 0 017.2 0v2.8" />
    </>
  ),
  refresh: (
    <>
      <path d="M4.4 12a7.6 7.6 0 0113-5.4l2.2 2.2" />
      <path d="M19.6 4.4v4.4h-4.4" />
      <path d="M19.6 12a7.6 7.6 0 01-13 5.4l-2.2-2.2" />
      <path d="M4.4 19.6v-4.4h4.4" />
    </>
  ),
  users: (
    <>
      <circle cx="9.2" cy="8.4" r="3" />
      <path d="M3.6 19.6c0-3.1 2.5-5.6 5.6-5.6s5.6 2.5 5.6 5.6" />
      <path d="M16 5.8a3 3 0 010 5.6M17.2 14.4c1.9.7 3.2 2.5 3.2 4.6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6 6.8 12 6.8 21.2 12 21.2 12 18 17.2 12 17.2 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.2" />
    </>
  ),
  play: <path d="M8.4 5.6l9.6 6.4-9.6 6.4z" />,
  pause: (
    <>
      <path d="M9 5.6v12.8M15 5.6v12.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.6V12l3 1.8" />
    </>
  ),
  mail: (
    <>
      <rect x="3.2" y="5.6" width="17.6" height="12.8" rx="2.4" />
      <path d="M3.6 7.2l8.4 6 8.4-6" />
    </>
  ),
  phone: (
    <path d="M7.2 3.6h2.4l1.6 4-2 1.6a11 11 0 005.6 5.6l1.6-2 4 1.6v2.4a2.4 2.4 0 01-2.6 2.4C10.4 18.4 5.6 13.6 4.8 6.2a2.4 2.4 0 012.4-2.6z" />
  ),
  shieldCheck: (
    <>
      <path d="M12 3.2l7 2.4v5.6c0 4.4-2.9 7.9-7 9.6-4.1-1.7-7-5.2-7-9.6V5.6z" />
      <path d="M8.8 11.8l2.2 2.2 4.2-4.4" />
    </>
  ),
  /* 「推荐阵容」的印章：圆 + 十字刻痕，替代星形装饰 */
  seal: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  ballot: (
    <>
      <rect x="3.6" y="9.6" width="16.8" height="10.4" rx="2" />
      <path d="M8.4 9.6V6.4A2 2 0 0110.4 4.4h7.2" />
      <path d="M8.8 14.8h6.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9.2" y="3.2" width="5.6" height="10" rx="2.8" />
      <path d="M5.6 11.2a6.4 6.4 0 0012.8 0" />
      <path d="M12 17.6v3.2" />
    </>
  ),
  note: (
    <>
      <path d="M6 3.6h8.4L19 8.4v12H6z" />
      <path d="M14 3.8v4.8h4.6" />
      <path d="M9 13h6M9 16.4h4" />
    </>
  ),
  grid: (
    <>
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.4" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="1.4" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="1.4" />
    </>
  ),
  list: (
    <>
      <path d="M8.4 6.4h12M8.4 12h12M8.4 17.6h12" />
      <path d="M3.6 6.4h.01M3.6 12h.01M3.6 17.6h.01" />
    </>
  ),
  sort: (
    <>
      <path d="M4.4 6.8h15.2M6.4 12h11.2M9.2 17.2h5.6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6" />
      <path d="M15.2 15.2l4.4 4.4" />
    </>
  ),
  send: <path d="M4.4 12l15.2-7.2-4.8 15.2-3.2-6z" />,
  plus: <path d="M12 5.6v12.8M5.6 12h12.8" />,
  minus: <path d="M5.6 12h12.8" />,
  skull: (
    <>
      <path d="M12 3.4c-4 0-7 2.8-7 6.6 0 2.4 1.2 4 2.6 5v2.6h8.8V15c1.4-1 2.6-2.6 2.6-5 0-3.8-3-6.6-7-6.6z" />
      <path d="M9.6 10.4h.01M14.4 10.4h.01" />
      <path d="M10.4 17.6v2M13.6 17.6v2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 11v5.2M12 8.2h.01" />
    </>
  ),
};

/** 角色 key → 图标名（服务端 role key 与图标解耦，图标是前端的事） */
const ROLE_ICON: Record<string, IconName> = {
  wolf: 'wolf',
  seer: 'seer',
  witch: 'witch',
  villager: 'villager',
  hunter: 'hunter',
  guard: 'guard',
  idiot: 'idol',
  elder: 'elder',
  wolfking: 'crown',
  dreamweaver: 'moon',
};

export function roleIcon(role?: string | null): IconName {
  return (role && ROLE_ICON[role]) || 'villager';
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** 传了 title 就作为图片对外朗读，否则视为装饰 */
  title?: string;
}

export function Icon({ name, size = 18, title, ...rest }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
