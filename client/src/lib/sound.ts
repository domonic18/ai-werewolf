/**
 * 环境音（夜晚过场 / 天亮）。
 *
 * 刻意不引入音频文件：
 * - 二进制资源会让仓库变重，也不好在 CSP 下统一管理；
 * - 狼人杀要的是「低频嗡鸣 + 一点风」，用 WebAudio 现场合成比素材更可控，还能随过场长度裁剪。
 *
 * 三条硬约束：
 * 1. 任何浏览器拒绝（自动播放策略、无 WebAudio、用户关掉声音）都只能安静降级，不能抛错；
 * 2. 声音默认开，但必须能被一次性静音并记住（localStorage），刷新不再自动响；
 * 3. 模块导入阶段不碰 window —— 测试跑在 node 里。
 */

const SOUND_KEY = 'ww:sound-off';

type Ctor = typeof AudioContext;

function isOn(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== '1';
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return isOn();
}

export function setSoundEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(SOUND_KEY);
    else window.localStorage.setItem(SOUND_KEY, '1');
  } catch {
    /* 隐私模式下 localStorage 会抛，声音开关退化成「仅本页生效」 */
  }
  if (!on) stopAll();
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let activeStop: (() => void) | null = null;

/** 惰性创建音频上下文；被浏览器拒绝时返回 null，调用方一律静默跳过 */
function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) {
      const Ctx: Ctor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      master = ctx.createGain();
      /* 总音量压得很低：这是「房间里的空气」，不是配乐 */
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

/** 循环噪声缓冲：风吹过树林的底噪 */
function noiseBuffer(ac: AudioContext): AudioBuffer {
  const seconds = 2;
  const buffer = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function stopAll(): void {
  activeStop?.();
  activeStop = null;
}

/**
 * 夜晚底噪：两个低频正弦（相差五度）+ 一段带通噪声，缓慢起伏。
 * 返回 stop()，组件卸载或天亮时调用。
 */
export function startNightAmbience(durationMs: number): () => void {
  if (!isOn()) return () => undefined;
  const ac = ensureContext();
  if (!ac || !master) return () => undefined;

  try {
    stopAll();
    const t0 = ac.currentTime;
    const secs = Math.max(1, durationMs / 1000);
    const bus = ac.createGain();
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(0.055, t0 + Math.min(1.4, secs * 0.25));
    bus.gain.setValueAtTime(0.055, t0 + Math.max(0.2, secs - 1.2));
    bus.gain.linearRampToValueAtTime(0, t0 + secs);
    bus.connect(master);

    const drones: OscillatorNode[] = [];
    for (const [freq, level] of [
      [55, 0.5],
      [82.5, 0.22],
    ] as const) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = level;
      /* 极慢的颤音：让低音不像「一条直线」，但听不出周期 */
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      lfo.frequency.value = 0.07;
      lfoGain.gain.value = 1.4;
      lfo.connect(lfoGain).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + secs);
      osc.connect(gain).connect(bus);
      osc.start(t0);
      osc.stop(t0 + secs);
      drones.push(osc);
    }

    const noise = ac.createBufferSource();
    noise.buffer = noiseBuffer(ac);
    noise.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.7;
    const noiseGain = ac.createGain();
    noiseGain.gain.value = 0.16;
    noise.connect(band).connect(noiseGain).connect(bus);
    noise.start(t0);
    noise.stop(t0 + secs);

    const stop = (): void => {
      try {
        noise.stop();
        drones.forEach((o) => o.stop());
        bus.disconnect();
      } catch {
        /* 已经停过 */
      }
    };
    activeStop = stop;
    /* 自然结束后清掉引用，别让下一夜以为还有声音在放 */
    window.setTimeout(() => {
      if (activeStop === stop) activeStop = null;
    }, durationMs + 200);
    return stop;
  } catch {
    return () => undefined;
  }
}

/** 一句口令的「落子」声：低沉的木鱼感，点到为止 */
export function playCueTick(): void {
  if (!isOn()) return;
  const ac = ensureContext();
  if (!ac || !master) return;
  try {
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(196, t0);
    osc.frequency.exponentialRampToValueAtTime(146, t0 + 0.18);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    osc.connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.36);
  } catch {
    /* 静默降级 */
  }
}

/** 天亮：两个上行的纯音，短促收尾，替过场收口 */
export function playDawnChime(): void {
  if (!isOn()) return;
  const ac = ensureContext();
  const out = master;
  if (!ac || !out) return;
  try {
    const t0 = ac.currentTime;
    [392, 587.33].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const at = t0 + i * 0.16;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.045, at + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
      osc.connect(gain).connect(out);
      osc.start(at);
      osc.stop(at + 1.2);
    });
  } catch {
    /* 静默降级 */
  }
}
