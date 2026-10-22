import { Fragment, useEffect, useMemo, useRef } from 'react';
import type { GameEvent } from '@shared/types';
import { highlightNames } from '../lib/highlight';

interface SpeechLogProps {
  events: GameEvent[];
  names: string[];
}

/** 发言记录：按天分组，名字高亮，新消息自动滚到底部 */
export function SpeechLog({ events, names }: SpeechLogProps): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const result: { round: number; items: Extract<GameEvent, { type: 'speech' }>[] }[] = [];
    for (const event of events) {
      if (event.type !== 'speech') continue;
      const last = result[result.length - 1];
      if (last && last.round === event.payload.round) last.items.push(event);
      else result.push({ round: event.payload.round, items: [event] });
    }
    return result;
  }, [events]);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [groups.length, events.length]);

  return (
    <div className="log-list" ref={boxRef}>
      {!groups.length ? <div className="empty">还没有人发言</div> : null}
      {groups.map((group) => (
        <Fragment key={group.round}>
          <div className="daymark">— 第 {group.round} 天 —</div>
          {group.items.map((event) => {
            const p = event.payload;
            const classes = ['speech-item'];
            if (p.isHuman) classes.push('me-msg');
            if (p.isLastWord) classes.push('last-word');
            return (
              <div key={event.seq} className={classes.join(' ')}>
                {p.order ? (
                  <span className="order-tag">
                    #{p.order}/{p.total}
                  </span>
                ) : null}
                <div className="who">
                  <span className="e">{p.emoji}</span>
                  <span className="n">{p.name}</span>
                </div>
                <div className="txt">{highlightNames(p.text, names)}</div>
              </div>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
