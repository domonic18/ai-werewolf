import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { NIGHT_TIMING, nextCueDelay, nightLabel, shouldCloseCurtain } from '../lib/night';
import type { Phase } from '@shared/types';
import { playCueTick, setSoundEnabled, soundEnabled, startNightAmbience, stopAll } from '../lib/sound';

/**
 * 夜幕过场：天黑这一段原本只有一行口令和等待，狼人杀一半的氛围就没了。
 *
 * 规则：
 * - 口令按到达顺序逐句落下（第一句前留静场），不预排完整剧本；
 * - 天亮 / 玩家要决策 / 超过安全上限，一律立刻落幕（判定在 `shouldCloseCurtain`）；
 * - 可以跳过、可以静音，静音选择记在本机；
 * - 全程只是「看」，不承载任何输入 —— 哪怕它失效，对局也照常推进。
 */
export function NightCurtain({
  round,
  cues,
  phase,
  hasPending,
  onDone,
}: {
  round: number;
  cues: string[];
  phase: Phase;
  hasPending: boolean;
  onDone: () => void;
}): JSX.Element {
  const [shown, setShown] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [closing, setClosing] = useState(false);
  const [soundOn, setSoundOn] = useState(() => soundEnabled());
  const finished = useRef(false);

  const finish = (): void => {
    if (finished.current) return;
    finished.current = true;
    stopAll();
    setClosing(true);
    window.setTimeout(onDone, 260);
  };

  /* 逐句落下：显示到第 n 句后，等一个间隔再放下句 */
  useEffect(() => {
    if (shown.length >= cues.length) return;
    const timer = window.setTimeout(() => {
      setShown((prev) => [...prev, cues[prev.length] as string]);
      if (shown.length > 0) playCueTick();
    }, nextCueDelay(shown.length));
    return () => window.clearTimeout(timer);
  }, [shown.length, cues]);

  /* 落幕判定：每 100ms 看一次，条件满足就走淡出 */
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAt;
      setElapsed(next);
      if (shouldCloseCurtain({ phase, elapsedMs: next, hasPending })) {
        window.clearInterval(timer);
        finish();
      }
    }, 100);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasPending]);

  /* 环境音跟着过场走，卸载即停 */
  useEffect(() => {
    if (!soundOn) return;
    const stop = startNightAmbience(Math.min(NIGHT_TIMING.maxMs, 8000));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn]);

  const toggleSound = (): void => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
  };

  const latest = shown[shown.length - 1];

  return (
    <div className={closing ? 'nc nc-out' : 'nc'} role="status" aria-live="polite">
      <div className="nc-sky" aria-hidden />
      <div className="nc-moon" aria-hidden />

      <button
        className="nc-sound"
        onClick={toggleSound}
        aria-label={soundOn ? '静音' : '开启声音'}
        title={soundOn ? '静音' : '开启声音'}
      >
        <Icon name={soundOn ? 'sound' : 'mute'} size={14} />
      </button>

      <div className="nc-body">
        <p className="nc-label">
          {nightLabel(round)} · {round > 0 ? `NIGHT ${round}` : 'NIGHTFALL'}
        </p>
        {/* 只显示当前这一句：夜里一次给一句才有仪式感，堆成列表就成了日志 */}
        <div className="nc-cues" key={latest ?? 'pending'}>
          {latest ? <p className="nc-cue">{latest}</p> : null}
          {shown.length < cues.length || !latest ? (
            <p className="nc-cue pending" aria-hidden>
              ···
            </p>
          ) : null}
        </div>
        {/* 进度用刻度而不是「1 / 2 句」：夜里不该出现统计数字 */}
        <div className="nc-ticks" aria-hidden>
          {cues.map((text, i) => (
            <i key={`${i}-${text}`} className={i < shown.length ? 'on' : ''} />
          ))}
        </div>
      </div>

      <div className="nc-foot">
        <span className="nc-hint" data-elapsed={Math.floor(elapsed / 1000)}>
          天还没亮
        </span>
        <button className="nc-skip" onClick={finish}>
          跳过
          <Icon name="chevronRight" size={12} />
        </button>
      </div>
      <div className="nc-progress" aria-hidden>
        <i style={{ width: `${Math.round((shown.length / Math.max(cues.length, 1)) * 100)}%` }} />
      </div>
    </div>
  );
}
