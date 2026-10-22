import { useState } from 'react';
import type { PendingAction } from '@shared/types';

interface PromptPanelProps {
  pending: PendingAction;
  onSubmit: (value: string | number | null) => void;
}

const QUICK_LINES = [
  '我是好人，先听后面的发言',
  '昨晚的信息太少了，谁都别急着带票',
  '我怀疑发言最顺的那个人，太刻意了',
  '我是预言家，昨晚验了人，票跟我走',
  '这轮先过，把发言权留给后面的人',
];

/**
 * 真人输入面板。分支优先级固定为 input > options > confirm，
 * 输入类永远是输入框，不会退化成按钮（v1.2.1 的教训）。
 */
export function PromptPanel({ pending, onSubmit }: PromptPanelProps): JSX.Element {
  const [text, setText] = useState('');

  if (pending.kind === 'input') {
    const submit = (): void => onSubmit(text.trim() || '我这轮先过，听你们的。');
    return (
      <>
        <div className="say-hint" dangerouslySetInnerHTML={{ __html: pending.prompt.html }} />
        <textarea
          className="say-box"
          rows={3}
          maxLength={200}
          autoFocus
          placeholder="输入你的发言（回车发送，Shift+回车换行）…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="say-chips">
          {QUICK_LINES.map((line) => (
            <span key={line} className="chip" onClick={() => setText(line)}>
              {line}
            </span>
          ))}
        </div>
        <div className="stage-actions">
          <button className="btn primary" style={{ width: '100%', padding: 14, fontSize: 15 }} onClick={submit}>
            🗣 发言
          </button>
        </div>
      </>
    );
  }

  if (pending.options.length) {
    return (
      <div className="stage-actions">
        {pending.options.map((option) => (
          <button key={String(option.value)} className="btn choice" onClick={() => onSubmit(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="stage-actions">
      <button className="btn primary" onClick={() => onSubmit(1)}>
        {pending.prompt.confirm ?? '继续'}
      </button>
    </div>
  );
}
