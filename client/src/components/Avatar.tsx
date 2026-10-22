import { Icon } from './Icon';

/**
 * 头像（v2.1）：不再用写实照片，改为扁平矢量人像 —— 小尺寸下靠「发型轮廓 + 配件 + 底色」
 * 区分，比写实照片更容易辨认，也和整套 1.5px 线描图标同源。
 *
 * 设计规则：
 * - 每位 AI 一个固定底色（低饱和）+ 一个固定发型/配件组合，换到哪一屏都认得出
 * - 只用平面色块，不描细节、不做渐变，20px 下也不能糊
 * - 真人玩家用同一套几何语言的剪影 + 黄铜描边，一眼区分「这是我」
 * - 座位数超过 6 人时多出来的 AI 按座位号轮流取用五种面孔，不会退化成字母块
 */

interface FaceSpec {
  /** 底色（低饱和，和 --ink 系列同一套明度） */
  bg: string;
  /** 衣服色 */
  cloth: string;
  /** 头发色 */
  hair: string;
  /** 肤色 */
  skin: string;
  /** 发型与配件：用路径描述，保证 20px 下仍是可辨认的剪影 */
  hairPath: string;
  /** 配件（眼镜/墨镜/耳饰等），可为空 */
  accent?: JSX.Element;
}

const FACES: Record<string, FaceSpec> = {
  /* 老K：背头 + 墨镜 + 方下巴，冷灰蓝底 —— 小尺寸下一眼是「戴墨镜的那位」 */
  老K: {
    bg: '#33404F',
    cloth: '#1C242E',
    hair: '#1A1D22',
    skin: '#DDB894',
    hairPath: 'M10.6 17.4c0-5.4 4.2-9.4 9.4-9.4s9.4 4 9.4 9.4c0 1.2-.3 2.2-.9 2.9-.9-2.7-1.9-4.4-3.2-5.2-3.6 1.1-8.6 1.1-11.6 0-1.3.8-2.3 2.5-3.2 5.2-.5-.7-.8-1.7-.8-2.9z',
    accent: (
      <g>
        <path d="M12.6 19.4h14.8a1 1 0 011 1v1.2a2.4 2.4 0 01-2.4 2.4h-2.4a2.4 2.4 0 01-2.4-2.4v-.4h-2.4v.4a2.4 2.4 0 01-2.4 2.4h-2.4a2.4 2.4 0 01-2.4-2.4v-1.2a1 1 0 011-1z" fill="#0B0E12" />
        <path d="M17.6 20.2h4.8" stroke="#4A5568" strokeWidth="0.6" />
      </g>
    ),
  },
  /* 小满：头顶丸子头 + 耳环，暖棕底 —— 丸子头是 20px 下也认得出的剪影 */
  小满: {
    bg: '#4A3724',
    cloth: '#2B2016',
    hair: '#17120D',
    skin: '#E8C6A3',
    hairPath: 'M10.8 18.6c0-5.6 4.1-9.6 9.2-9.6s9.2 4 9.2 9.6c0 1.1-.2 2-.6 2.7-.7-2.4-1.7-3.9-3-4.6-3.2 1.2-7.9 1.2-11.1 0-1.3.7-2.3 2.2-3 4.6-.4-.7-.6-1.6-.6-2.7z',
    accent: (
      <g>
        <circle cx="20" cy="6.2" r="3.9" fill="#17120D" />
        <circle cx="20" cy="6.2" r="1.5" fill="#4A3724" />
        <circle cx="10.9" cy="23.4" r="1.6" fill="#B99A63" />
        <circle cx="29.1" cy="23.4" r="1.6" fill="#B99A63" />
      </g>
    ),
  },
  /* 阿岚：长直发垂到肩 + 细框眼镜，青蓝底 —— 发型轮廓最「方」的一位 */
  阿岚: {
    bg: '#223B41',
    cloth: '#16272B',
    hair: '#1B2226',
    skin: '#E0C1A4',
    hairPath: 'M10.4 26.4c0-7.6 4.3-12.8 9.6-12.8s9.6 5.2 9.6 12.8v4.4h-3.2v-6.2c-2.6 1-6.4 1.2-9.8.2-.9-.3-1.8-.7-2.6-1.2v7.2h-3.6z',
    accent: (
      <g fill="none" stroke="#CBD6DF" strokeWidth="1.5">
        <circle cx="15.4" cy="20.6" r="3.2" />
        <circle cx="24.6" cy="20.6" r="3.2" />
        <path d="M18.6 20.6h2.8" strokeLinecap="round" />
      </g>
    ),
  },
  /* 豆豆：卷发云朵 + 圆眼，橄榄底 —— 头顶三个凸起，轮廓最「圆」的一位 */
  豆豆: {
    bg: '#3B3F27',
    cloth: '#242717',
    hair: '#231C15',
    skin: '#EBCAA8',
    hairPath: 'M11.2 20.4c0-6.6 3.9-11 8.8-11s8.8 4.4 8.8 11c0 1.1-.2 2-.5 2.8-.9-2.5-2-4.1-3.4-4.8-2.9 1-7.1 1-9.8 0-1.4.7-2.5 2.3-3.4 4.8-.3-.8-.5-1.7-.5-2.8z',
    accent: (
      <g fill="#231C15">
        <circle cx="12.6" cy="14.4" r="3" />
        <circle cx="16.8" cy="11.2" r="3.1" />
        <circle cx="22.6" cy="10.8" r="3.1" />
        <circle cx="27" cy="13.6" r="3" />
        <circle cx="20" cy="24.6" r="1.7" fill="#8E5F4A" />
      </g>
    ),
  },
  /* 七喜：礼帽 + 单侧耳钉，紫褐底 —— 帽子是最强的辨识特征 */
  七喜: {
    bg: '#3D2A33',
    cloth: '#251A20',
    hair: '#17111A',
    skin: '#E4C09E',
    hairPath: 'M12 17.8c0-4.6 3.6-8 8-8s8 3.4 8 8c0 .8-.1 1.5-.3 2.1-1.1-1.5-1.9-3.3-2.3-5.2-3.1.7-7.7.7-10.8 0-.4 1.9-1.2 3.7-2.3 5.2-.2-.6-.3-1.3-.3-2.1z',
    accent: (
      <g>
        <path d="M11.4 12.6h17.2v3.2H11.4z" fill="#17111A" />
        <path d="M9 16.2h22a1 1 0 011 1v.8H8v-.8a1 1 0 011-1z" fill="#17111A" />
        <path d="M12.6 12.6h14.8" stroke="#B99A63" strokeWidth="1" />
        <circle cx="29.8" cy="23.4" r="1.6" fill="#E8E3D9" />
      </g>
    ),
  },
};

/** 没写进 FACES 的 AI（8 人以上局会启用），按座位号取一张，保证每座都有面孔 */
const FALLBACK_ORDER = ['老K', '小满', '阿岚', '豆豆', '七喜'] as const;

function faceFor(name: string, seat: number): { key: string; spec: FaceSpec } {
  const direct = FACES[name];
  if (direct) return { key: name, spec: direct };
  const key = FALLBACK_ORDER[(seat - 1 + FALLBACK_ORDER.length * 4) % FALLBACK_ORDER.length]!;
  return { key, spec: FACES[key]! };
}

interface AvatarProps {
  name: string;
  seat: number;
  isHuman?: boolean;
  size?: number;
  /** round = 圆形（列表用），plate = 圆角方（座位卡用） */
  shape?: 'round' | 'plate';
  className?: string;
}

export function Avatar({ name, seat, isHuman, size = 32, shape = 'round', className }: AvatarProps): JSX.Element {
  const radius = shape === 'round' ? '50%' : `${Math.round(size * 0.28)}px`;
  const style = { width: size, height: size, borderRadius: radius };

  if (isHuman) {
    return (
      <span className={`avatar avatar-human ${className ?? ''}`.trim()} style={style} title={name}>
        <Icon name="villager" size={Math.round(size * 0.52)} />
      </span>
    );
  }

  const { spec } = faceFor(name, seat);

  return (
    <span className={`avatar ${className ?? ''}`.trim()} style={style} title={name}>
      <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden focusable="false">
        <rect width="40" height="40" fill={spec.bg} />
        {/* 肩膀：给出一个稳定的下半部分轮廓 */}
        <path d="M4 40c0-6.4 7.2-10.6 16-10.6S36 33.6 36 40z" fill={spec.cloth} />
        {/* 脖子 */}
        <rect x="17" y="24" width="6" height="7" rx="3" fill={spec.skin} opacity="0.92" />
        {/* 脸 */}
        <ellipse cx="20" cy="20.6" rx="7.6" ry="8.4" fill={spec.skin} />
        {/* 头发：每个人一种可辨认的剪影 */}
        <path d={spec.hairPath} fill={spec.hair} />
        {/* 眼睛：两个点足够，20px 下不糊 */}
        <g fill="#14161A">
          <ellipse cx="16.9" cy="21.2" rx="0.95" ry="1.15" />
          <ellipse cx="23.1" cy="21.2" rx="0.95" ry="1.15" />
        </g>
        {/* 嘴：一条短弧，避免「面无表情的证件照」 */}
        <path d="M18.2 25c1.1.9 2.5.9 3.6 0" stroke="#8E5F4A" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        {spec.accent}
      </svg>
    </span>
  );
}
