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
 * - **一整夜共用一次过场**：中途因 AI 思考太久让出屏幕后，下一句口令到达会从断点续演，
 *   所以排在最后的角色（女巫）也能在氛围里出场 —— 早期版本是「一夜只演一次」，它永远赶不上；
 * - 玩家要决策 / 静场过久 / 超过硬上限，一律收（判定在 `shouldCloseCurtain`）；
 * - 可以跳过（跳过即整夜静音，不再拉起）、可以静音，静音选择记在本机；
 * - 全程只是「看」，不承载任何输入 —— 哪怕它失效，对局也照常推进。
 */
export function NightCurtain({
  round,
  cues,
  startAt,
  phase,
  hasPending,
  dawnText,
  onDone,
  onSkip,
}: {
  round: number;
  /** 这一夜的全部口令（会随着对局推进继续增长） */
  cues: string[];
  /** 从第几句开始演：中途让出屏幕后回来了，就接着演 */
  startAt: number;
  phase: Phase;
  hasPending: boolean;
  /** 天亮后要说的那句话；夜里为 null */
  dawnText?: string | null;
  /** 落幕时回传「已经演到第几句」，调用方据此决定下次从哪续 */
  onDone: (shownTotal: number) => void;
  /** 玩家点了跳过：这一夜剩下的口令不再拉起 */
  onSkip: () => void;
}): JSX.Element {
  const list = cues.slice(startAt);
  const resumed = startAt > 0;
  const [shown, setShown] = useState(0);
  const [closing, setClosing] = useState(false);
  const [soundOn, setSoundOn] = useState(() => soundEnabled());
  const finished = useRef(false);
  const lastCueAt = useRef(Date.now());
  const shownTotal = useRef(0);

  const finish = (skipped: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    stopAll();
    setClosing(true);
    /* 落幕时把「这一夜已知的口令」全部算作已演：否则在静场/下限处收场会被立刻重开，闪一下 */
    const seen = Math.max(shownTotal.current, cues.length);
    window.setTimeout(() => (skipped ? onSkip() : onDone(seen)), 240);
  };

  /* 逐句落下：显示到第 n 句后，等一个间隔再放下句 */
  useEffect(() => {
    if (shown >= list.length) return;

    /*
     * 轮到自己：直接把**最新那句**顶上来，不再按句间节奏排队。
     * 实测过的糟糕时序：预言家面板已经弹出，过场上还挂着「狼人请闭眼」——
     * 玩家会对着上一句口令做这一轮的决定。口令比节奏重要，节奏让路。
     */
    if (hasPending) {
      lastCueAt.current = Date.now();
      shownTotal.current = startAt + list.length;
      setShown(list.length);
      return;
    }

    const timer = window.setTimeout(
      () => {
        lastCueAt.current = Date.now();
        shownTotal.current = startAt + shown + 1;
        setShown((prev) => prev + 1);
        /* 待决策时的第一句不响提示音：紧跟着就是行动面板，两声叠在一起吵 */
        if (shown > 0 || !hasPending) playCueTick();
      },
      nextCueDelay(shown, NIGHT_TIMING, resumed),
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, list.length, resumed, hasPending, startAt]);

  /* 落幕判定：每 100ms 看一次，条件满足就走淡出 */
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const total = now - startedAt;
      if (
        shouldCloseCurtain({
          phase,
          elapsedMs: total,
          sinceCueMs: now - lastCueAt.current,
          hasPending,
        })
      ) {
        window.clearInterval(timer);
        finish(false);
      }
    }, 100);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasPending]);

  /* 环境音跟着过场走，卸载即停。天亮的那记钟声由 useDawnChime 统一放（跳过过场时也要响） */
  useEffect(() => {
    if (phase !== 'night') {
      stopAll();
      return;
    }
    if (!soundOn) return;
    const stop = startNightAmbience(Math.min(NIGHT_TIMING.maxMs, 8000));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundOn, phase]);

  const toggleSound = (): void => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
  };

  const isDawn = phase !== 'night';
  const latest = shown > 0 ? list[shown - 1] : undefined;

  return (
    <div className={closing ? 'nc nc-out' : 'nc'} role="status" aria-live="polite">
      <div className={isDawn ? 'nc-sky dawn' : 'nc-sky'} aria-hidden />
      {isDawn ? <div className="nc-sun" aria-hidden /> : <div className="nc-moon" aria-hidden />}

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
          {isDawn
            ? 'DAWN'
            : resumed
              ? `${nightLabel(round)} · 续`
              : `${nightLabel(round)} · ${round > 0 ? `NIGHT ${round}` : 'NIGHTFALL'}`}
        </p>

        {/* 天亮后只留一句结论：谁出局 / 平安夜。夜里的口令已经演完了 */}
        {isDawn ? (
          <div className="nc-cues" key="dawn">
            <p className="nc-cue">天亮了</p>
            {dawnText ? <p className="nc-dawn-note">{dawnText}</p> : null}
          </div>
        ) : (
          /* 只显示当前这一句：夜里一次给一句才有仪式感，堆成列表就成了日志 */
          <div className="nc-cues" key={latest ?? 'pending'}>
            {latest ? <p className="nc-cue">{latest}</p> : null}
            {shown < list.length || !latest ? (
              <p className="nc-cue pending" aria-hidden>
                ···
              </p>
            ) : null}
          </div>
        )}

        {/* 进度用刻度而不是「1 / 2 句」：夜里不该出现统计数字 */}
        {isDawn ? null : (
          <div className="nc-ticks" aria-hidden>
            {list.map((text, i) => (
              <i key={`${startAt + i}-${text}`} className={i < shown ? 'on' : ''} />
            ))}
          </div>
        )}
      </div>

      <div className="nc-foot">
        <span className="nc-hint">{isDawn ? '天亮了' : hasPending ? '该你了' : '天还没亮'}</span>
        <button className="nc-skip" onClick={() => finish(true)}>
          跳过
          <Icon name="chevronRight" size={12} />
        </button>
      </div>
      <div className="nc-progress" aria-hidden>
        <i
          style={{
            width: isDawn
              ? '100%'
              : `${Math.round(((startAt + shown) / Math.max(cues.length, 1)) * 100)}%`,
          }}
        />
      </div>
    </div>
  );
}
