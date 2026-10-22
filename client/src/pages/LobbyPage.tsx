import type { LobbyGame } from '@shared/types';
import { useLobby } from '../hooks/useLobby';
import type { LobbyState } from '../hooks/useLobby';
import { Footer } from '../components/Footer';

const APP_VERSION = __APP_VERSION__;

const FILTERS: { key: LobbyState['filter']; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'human', label: '真人局' },
  { key: 'final', label: '决赛圈' },
];

const SORTS: { key: LobbyState['sort']; label: string }[] = [
  { key: 'spectators', label: '按热度' },
  { key: 'created', label: '按开局时间' },
];

interface LobbyPageProps {
  onBack: () => void;
  onWatch: (gameId: string) => void;
  onStart: () => void;
}

/** 一局一行：密度高时用这个；少于 6 局时用卡片，避免列表行在大片空白里显得空 */
function GameRow({ game, onWatch }: { game: LobbyGame; onWatch: (id: string) => void }): JSX.Element {
  const aliveRatio = game.players > 0 ? game.alive / game.players : 0;
  const classes = ['lobby-row'];
  if (game.isFinal) classes.push('hot');
  if (game.spectators >= 3) classes.push('hot');

  return (
    <button className={classes.join(' ')} onClick={() => onWatch(game.gameId)}>
      <span className="lobby-row-main">
        <span className="lobby-host">
          👤 {game.host} 的对局
          {game.isFinal ? <em className="lobby-flag">决赛圈</em> : null}
          {!game.hasHuman ? <em className="lobby-flag ghost">全 AI</em> : null}
        </span>
        <span className="lobby-meta">
          <span className="tag stage">{game.phaseLabel}</span>
          <span className="lobby-alive">
            存活 {game.alive}/{game.players}
            <span className="lobby-alive-track">
              <span className="lobby-alive-fill" style={{ width: `${Math.round(aliveRatio * 100)}%` }} />
            </span>
          </span>
        </span>
      </span>
      <span className="lobby-side">
        <span className="lobby-eye">👁 {game.spectators}</span>
        <span className="lobby-watch">观战 ›</span>
      </span>
    </button>
  );
}

function GameCard({ game, onWatch }: { game: LobbyGame; onWatch: (id: string) => void }): JSX.Element {
  const aliveRatio = game.players > 0 ? game.alive / game.players : 0;
  return (
    <button className={`lobby-card ${game.isFinal ? 'hot' : ''}`} onClick={() => onWatch(game.gameId)}>
      <span className="lobby-card-top">
        <span className="lobby-host">👤 {game.host}</span>
        <span className="tag stage">{game.phaseLabel}</span>
      </span>
      <span className="lobby-alive">
        存活 {game.alive}/{game.players}
        <span className="lobby-alive-track">
          <span className="lobby-alive-fill" style={{ width: `${Math.round(aliveRatio * 100)}%` }} />
        </span>
      </span>
      <span className="lobby-card-bottom">
        <span className="lobby-eye">👁 {game.spectators} 人在看</span>
        <span className="lobby-watch">观战 ›</span>
      </span>
    </button>
  );
}

export function LobbyPage({ onBack, onWatch, onStart }: LobbyPageProps): JSX.Element {
  const lobby = useLobby();
  const watching = lobby.games.reduce((sum, game) => sum + game.spectators, 0);
  /* 密度自适应：局多的时候卡片太占屏幕，换成紧凑行 */
  const dense = lobby.games.length >= 6;

  return (
    <section className="screen">
      <div className="topbar">
        <button className="btn ghost small" onClick={onBack}>
          ‹ 返回
        </button>
        <div className="lobby-title">游戏大厅</div>
        <button className="btn ghost small" onClick={() => void lobby.reload()} disabled={lobby.loading}>
          {lobby.loading ? '刷新中' : '刷新'}
        </button>
      </div>

      <div className="lobby-stats">
        <div className="lobby-stat">
          <b>{lobby.total}</b>
          <span>进行中</span>
        </div>
        <div className="lobby-stat">
          <b>{watching}</b>
          <span>观战中</span>
        </div>
        <div className="lobby-stat">
          <b>{lobby.games.filter((g) => g.isFinal).length}</b>
          <span>决赛圈</span>
        </div>
      </div>

      <div className="lobby-toolbar">
        <div className="chips">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              className={`chip ${lobby.filter === item.key ? 'active' : ''}`}
              onClick={() => lobby.setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="chips">
          {SORTS.map((item) => (
            <button
              key={item.key}
              className={`chip ghost ${lobby.sort === item.key ? 'active' : ''}`}
              onClick={() => lobby.setSort(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {lobby.error ? (
        <div className="panel abort-box">
          <div className="panel-title">大厅加载失败</div>
          <p className="hint">{lobby.error}</p>
          <button className="btn primary" onClick={() => void lobby.reload()}>
            重试
          </button>
        </div>
      ) : null}

      {!lobby.error && !lobby.loading && lobby.games.length === 0 ? (
        <div className="panel empty-lobby">
          <div className="empty-emoji">🌙</div>
          <div className="panel-title">现在没有进行中的对局</div>
          <p className="hint">开一局，让 5 个 AI 先吵起来——别人就能从这里围观你。</p>
          <button className="btn primary" onClick={onStart}>
            开一局
          </button>
        </div>
      ) : null}

      {lobby.games.length > 0 ? (
        <div className={dense ? 'lobby-rows' : 'lobby-cards'}>
          {lobby.games.map((game) =>
            dense ? (
              <GameRow key={game.gameId} game={game} onWatch={onWatch} />
            ) : (
              <GameCard key={game.gameId} game={game} onWatch={onWatch} />
            ),
          )}
        </div>
      ) : null}

      {lobby.loading && lobby.games.length === 0 ? <div className="empty">读取进行中对局…</div> : null}

      {lobby.games.length > 0 ? (
        <div className="lobby-more">
          {lobby.hasMore ? (
            <button className="btn ghost" disabled={lobby.loading} onClick={() => void lobby.loadMore()}>
              {lobby.loading ? '加载中…' : '加载更多'}
            </button>
          ) : (
            <span className="lobby-end">没有更多了 · 共 {lobby.total} 局</span>
          )}
        </div>
      ) : null}

      <Footer version={APP_VERSION} />
    </section>
  );
}
