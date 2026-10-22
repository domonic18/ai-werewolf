interface SpeechOrderBarProps {
  order: { id: number; name: string; emoji: string }[];
  speakingId: number | null;
  spokenIds: Set<number>;
}

/** 发言顺序条：当前发言者金色高亮，已发过言的划线降权 */
export function SpeechOrderBar({ order, speakingId, spokenIds }: SpeechOrderBarProps): JSX.Element | null {
  if (!order.length) return null;

  return (
    <div className="speech-order">
      <span className="so-label">🗣 发言顺序</span>
      {order.map((item) => {
        const classes = ['so-item'];
        if (item.id === speakingId) classes.push('speaking');
        else if (spokenIds.has(item.id)) classes.push('done');
        return (
          <span key={item.id} className={classes.join(' ')}>
            {item.emoji} {item.name}
          </span>
        );
      })}
    </div>
  );
}
