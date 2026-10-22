import { Icon } from './Icon';

/**
 * 头像：AI 玩家用生成的人物插画（client/public/art/agent-*.jpg），
 * 真人用剪影徽记。所有头像都是圆形/圆角方，统一加 1px 内描边压住照片边缘。
 *
 * 座位数超过 6 人时会启用更多 AI 角色（大熊/阿桃/…），
 * 没有专属插画的角色按座位号轮流取用五张插画，保证每个座位都有面孔，
 * 不会退化成 emoji 或彩色字母块。
 */
const PORTRAITS = [
  { names: ['老K'], src: '/art/agent-laoke.jpg' },
  { names: ['小满'], src: '/art/agent-xiaoman.jpg' },
  { names: ['阿岚'], src: '/art/agent-alan.jpg' },
  { names: ['豆豆'], src: '/art/agent-doudou.jpg' },
  { names: ['七喜'], src: '/art/agent-qixi.jpg' },
] as const;

const BY_NAME = new Map<string, string>();
for (const portraits of PORTRAITS) {
  for (const name of portraits.names) BY_NAME.set(name, portraits.src);
}

function artFor(name: string, seat: number): string {
  const known = BY_NAME.get(name);
  if (known) return known;
  return PORTRAITS[(seat - 1 + PORTRAITS.length * 4) % PORTRAITS.length]!.src;
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

  return (
    <span className={`avatar ${className ?? ''}`.trim()} style={style}>
      <img src={artFor(name, seat)} alt="" width={size} height={size} loading="lazy" decoding="async" />
    </span>
  );
}
