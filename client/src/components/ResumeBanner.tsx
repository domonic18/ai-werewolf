interface ResumeBannerProps {
  onResume: () => void;
  onDrop: () => void;
}

/** 断线恢复：刷新/误关后回到服务端仍在进行的对局 */
export function ResumeBanner({ onResume, onDrop }: ResumeBannerProps): JSX.Element {
  return (
    <div
      className="panel"
      style={{ borderColor: 'rgba(246,199,106,.5)', background: 'rgba(246,199,106,.08)' }}
    >
      <div className="panel-head">
        <span className="panel-title">⏸ 你有一局进行中</span>
      </div>
      <div className="row">
        <button className="btn primary" style={{ flex: 1 }} onClick={onResume}>
          回到对局
        </button>
        <button className="btn ghost" onClick={onDrop}>
          放弃这局
        </button>
      </div>
      <p className="hint">刷新不会丢进度——你的对局保存在服务端。</p>
    </div>
  );
}
