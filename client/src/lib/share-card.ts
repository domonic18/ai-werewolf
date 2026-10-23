/**
 * 战绩卡：把一局的结果画成一张 1080×1656 的竖版图（约 3:4.6，微信转发不变形）。
 *
 * 为什么在客户端画：分享图里带玩家自己的战绩，没必要上传服务器；canvas 直接出 PNG，
 * 长按保存或走系统分享都行。
 *
 * 内容只取「已经结算的数据」（胜负、身份、回合、同行玩家、公开日志），
 * 不会出现任何对局中未公开的信息。
 */

export interface CardData {
  winner: 'good' | 'wolf';
  /** 我的角色中文名，如「预言家」 */
  roleName: string;
  rounds: number;
  survivors: number;
  /** 同局其他玩家（代号） */
  players: string[];
  /** 系统从复盘里抽的一句真实片段 */
  quote: string;
  /** 二维码指向的地址（站点首页 + 邀请码） */
  qrUrl: string;
  /** 展示用的域名，如 werewolf-ai-01048.app.workbuddy.host */
  host: string;
  /** 分享码，用于二维码 */
  qrImage?: string;
}

const W = 1080;
const H = 1656;
const FONT = '"PingFang SC", -apple-system, "Noto Sans SC", "Helvetica Neue", Arial, sans-serif';
const MARK = '"Songti SC", "Noto Serif SC", Georgia, serif';

const INK = '#0A0A0B';
const BONE = '#EDE7DA';
const ASH = '#A6A199';
const FAINT = '#56534C';
const BRASS = '#B99A63';
const SAGE = '#7C9483';
const EMBER = '#C0523F';

/**
 * 从公开日志里挑一句最有「复盘感」的话。
 *
 * 优先级：翻出狼的放逐（终局感最强）→ 任何翻牌放逐 → 我自己的有效发言 → 全场最长的一句发言 → 首条记录。
 * 都是真实发生过的原文，不编。
 *
 * 「我这轮先过，听你们的」是未填发言时的默认值，不算玩家说过的话，选素材时排除——
 * 这张卡就靠这一句撑场面，放一句敷衍话比空着更糟。
 */
const PASS_LINE = '我这轮先过';
/** 卡面最多三行；超了截断加省略号，别让它断在半句话上 */
const MAX_QUOTE = 46;

function clip(text: string): string {
  return text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE)}…` : text;
}

export function pickCardQuote(log: string[], playerName: string): string {
  const sentences = log.filter((line) => /第\d+天 .+：.+/.test(line) && !line.includes(PASS_LINE));

  const wolfOut = log.filter((line) => /被放逐，身份：(狼人|黑狼王)/.test(line));
  if (wolfOut.length) return clip(wolfOut[wolfOut.length - 1] as string);

  const anyOut = log.filter((line) => /被放逐，身份：/.test(line));
  if (anyOut.length) return clip(anyOut[anyOut.length - 1] as string);

  const mine = sentences.filter((line) => line.includes(`${playerName}：`));
  if (mine.length) return clip(mine[mine.length - 1] as string);

  /* 没轮到可说的时候，优先一句「说完的」短发言：长发言截断后像断句出错 */
  const readable = sentences.filter((line) => line.length <= MAX_QUOTE);
  if (readable.length) return readable[readable.length - 1] as string;
  if (sentences.length) return clip(sentences[0] as string);

  return clip(log[0] ?? '这一局没有留下记录。');
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    if (ctx.measureText(current + ch).width > maxWidth && current) {
      lines.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 画卡并导出 PNG；环境不支持 canvas 时返回 null */
export async function renderShareCard(data: CardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  /* 底色：上暗下更暗，模拟夜里的纸面 */
  const bg = ctx.createRadialGradient(W / 2, 160, 40, W / 2, H * 0.55, H * 0.95);
  bg.addColorStop(0, '#24202A');
  bg.addColorStop(0.52, '#121114');
  bg.addColorStop(1, INK);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* 内框发丝线 */
  ctx.strokeStyle = 'rgba(185,154,99,0.22)';
  ctx.lineWidth = 2;
  roundRect(ctx, 48, 48, W - 96, H - 96, 28);
  ctx.stroke();

  const cx = W / 2;
  ctx.textAlign = 'center';

  /* 品牌 */
  ctx.fillStyle = BRASS;
  ctx.font = `500 30px ${MARK}`;
  ctx.letterSpacing = '14px';
  ctx.fillText('AI 狼人杀', cx, 148);
  ctx.letterSpacing = '0px';

  /* 判定 */
  ctx.fillStyle = data.winner === 'good' ? SAGE : EMBER;
  ctx.font = `600 86px ${MARK}`;
  ctx.fillText(data.winner === 'good' ? '好人阵营胜利' : '狼人阵营胜利', cx, 268);

  /* 身份 · 回合：三段分开上色，角色名是这张卡唯一该用黄铜的地方 */
  ctx.font = `400 34px ${FONT}`;
  const lead = '你扮演 ';
  const role = data.roleName;
  const tail = ` · ${data.rounds} 回合`;
  const leadW = ctx.measureText(lead).width;
  const roleW = ctx.measureText(role).width;
  const tailW = ctx.measureText(tail).width;
  const startX = cx - (leadW + roleW + tailW) / 2;
  ctx.textAlign = 'left';
  ctx.fillStyle = ASH;
  ctx.fillText(lead, startX, 330);
  ctx.fillStyle = BRASS;
  ctx.fillText(role, startX + leadW, 330);
  ctx.fillStyle = FAINT;
  ctx.fillText(tail, startX + leadW + roleW, 330);

  /* 复盘片段：左侧黄铜竖线 + 三行以内 */
  const quoteMax = W - 240;
  ctx.font = `400 40px ${FONT}`;
  const quoteLines = wrap(ctx, data.quote, quoteMax).slice(0, 3);
  const quoteTop = 470;
  ctx.fillStyle = 'rgba(185,154,99,0.55)';
  ctx.fillRect(130, quoteTop - 34, 4, quoteLines.length * 58 + 12);
  ctx.fillStyle = BONE;
  ctx.textAlign = 'left';
  quoteLines.forEach((line, i) => {
    ctx.fillText(line, 164, quoteTop + i * 58);
  });

  /* 数据区：紧跟在复盘片段下面，别把中间留成一块空地 */
  const rows: [string, string][] = [
    ['存活', `终局剩 ${data.survivors} 人`],
    ['同行', data.players.slice(0, 4).join(' · ') || '—'],
  ];
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(130, 726);
  ctx.lineTo(W - 130, 726);
  ctx.stroke();

  let rowY = 792;
  ctx.font = `400 32px ${FONT}`;
  for (const [label, value] of rows) {
    ctx.fillStyle = FAINT;
    ctx.fillText(label, 130, rowY);
    ctx.fillStyle = ASH;
    ctx.fillText(value, 230, rowY);
    rowY += 62;
  }

  /* 页脚：品牌语 + 域名 + 二维码 */
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(130, 1230);
  ctx.lineTo(W - 130, 1230);
  ctx.stroke();

  ctx.fillStyle = BONE;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText('一个人也能打的狼人杀', 130, 1300);
  ctx.fillStyle = FAINT;
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText('5 个 AI 补位 · 句句由大模型现场生成', 130, 1352);
  ctx.fillText(data.host, 130, 1396);

  if (data.qrImage) {
    const img = new Image();
    img.src = data.qrImage;
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    });
    ctx.fillStyle = BONE;
    ctx.fillRect(W - 130 - 176 - 12, 1300 - 12, 200, 200);
    ctx.drawImage(img, W - 130 - 176, 1300, 176, 176);
  }

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/** 触发下载（保存战绩卡） */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  /* 立刻回收会让部分浏览器下载中断，延迟一点 */
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
