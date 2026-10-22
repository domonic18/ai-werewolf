import type { TimelineEntry } from '../lib/timeline';

interface RoundTimelineProps {
  entries: TimelineEntry[];
  /** 上帝视角才有死因/用药细节，用来在标题上标注 */
  detailed?: boolean;
}

/** 复盘时间轴：一轮一块，先夜后昼 */
export function RoundTimeline({ entries, detailed = false }: RoundTimelineProps): JSX.Element {
  if (!entries.length) return <div className="empty">还没有可复盘的回合</div>;

  return (
    <div className="timeline">
      <div className="timeline-hint">{detailed ? '上帝视角 · 含死因与用药' : '只展示公开信息'}</div>
      {entries.map((entry) => (
        <div key={entry.round} className="timeline-row">
          <div className="timeline-badge">第 {entry.round} 轮</div>
          <div className="timeline-lines">
            {entry.lines.map((line, index) => (
              <div key={index} className={`timeline-line tone-${line.tone}`}>
                {line.text}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
