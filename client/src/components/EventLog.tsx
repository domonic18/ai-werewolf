import { useEffect, useRef } from 'react';
import type { GameEvent } from '@shared/types';

interface EventLogProps {
  events: GameEvent[];
}

/** 事件记录：只展示 log 类事件（夜晚/死讯/投票明细） */
export function EventLog({ events }: EventLogProps): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const logs = events.filter((e): e is Extract<GameEvent, { type: 'log' }> => e.type === 'log');

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs.length]);

  return (
    <div className="log-list" ref={boxRef}>
      {!logs.length ? <div className="empty">暂无事件</div> : null}
      {logs.map((event) => (
        <div key={event.seq} className={`log-item ${event.payload.tone ?? ''}`}>
          {event.payload.text}
        </div>
      ))}
    </div>
  );
}
