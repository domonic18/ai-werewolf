import { useState } from 'react';
import type { LobbyGame } from '@shared/types';
import { useLobby } from '../hooks/useLobby';
import type { LobbyState } from '../hooks/useLobby';
import { readSavedGame } from '../lib/storage';

const APP_VERSION = __APP_VERSION__;

const FILTERS: { key: NonNullable<LobbyState['filter']>; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'mine', label: '我的' },
  { key: 'human', label: '真人局' },
  { key: 'final', label: '决赛圈' },
];

interface LobbyPageProps {
  onBack: () => void;
  onWatch: (gameId: string) => void;
  /** 点自己那一局时带着凭证回到对局，而不是以观战身份进去 */
  onResume: (gameId: string) => void;
  onStart: () => void;
}

/** 阶段胶囊的配色：决赛圈/投票红、刚开局绿、夜里灰 */
function stageClass(game: LobbyGame): string {
  if (game.round === 0) return 'lb-stage night'; /* 准备中：还没开局，别用「刚开局」的绿 */
  if (game.isFinal || game.phase === 'vote') return 'lb-stage';
  if (game.phase === 'night') return 'lb-stage night';
  return 'lb-stage good';
}

/** 一局一行（设计稿 row：头像组 + 名称/人数 + 阶段/存活 + 观战人数） */
function GameRow({
  game,
  mine,
  onOpen,
}: {
  game: LobbyGame;
  mine: boolean;
  onOpen: (game: LobbyGame) => void;
}): JSX.Element {
  return (
    <button className="lb-row" onClick={() => onOpen(game)}>
      <div className="lb-row-left">
        <div className="lb-avas">
          <div className={mine ? 'lb-ava me' : 'lb-ava'}>{mine ? '🙋' : '🕶️'}</div>
          <div className="lb-ava">🍊</div>
          <div className="lb-ava">🧊</div>
        </div>
        <div className="lb-info">
          <div className="lb-line">
            <span className="lb-name">{game.host} 的局</span>
            <span className="lb-size">{game.players} 人</span>
          </div>
          <div className="lb-line">
            <span className={stageClass(game)}>{game.phaseLabel}</span>
            <span className="lb-alive">
              存活 {game.alive}/{game.players}
            </span>
          </div>
        </div>
      </div>
      <div className="lb-right">
        <span className="lb-view-count">👁 {game.spectators}</span>
        <span className="lb-arrow">›</span>
      </div>
    </button>
  );
}

/** 网格视图：两列卡片，信息量与行视图一致 */
function GameCard({
  game,
  mine,
  onOpen,
}: {
  game: LobbyGame;
  mine: boolean;
  onOpen: (game: LobbyGame) => void;
}): JSX.Element {
  return (
    <button className="lb-row" style={{ height: 'auto', flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: 11 }} onClick={() => onOpen(game)}>
      <div className="lb-line" style={{ justifyContent: 'space-between' }}>
        <span className={stageClass(game)}>{game.phaseLabel}</span>
        <span className="lb-view-count">👁 {game.spectators}</span>
      </div>
      <div className="lb-avas">
        <div className={mine ? 'lb-ava me' : 'lb-ava'}>{mine ? '🙋' : '🕶️'}</div>
        <div className="lb-ava">🍊</div>
        <div className="lb-ava">🧊</div>
      </div>
      <span className="lb-name">{game.host} 的局</span>
      <div className="lb-line" style={{ justifyContent: 'space-between' }}>
        <span className="lb-size">{game.players} 人</span>
        <span className="lb-alive">
          {game.alive}/{game.players}
        </span>
      </div>
    </button>
  );
}

/**
 * 游戏大厅：逐项对齐 docs/designs/06-lobby.html。
 * 结构 = 返回栏 / 概览卡（进行中·观战·决赛圈）/ 筛选 chips（带角标）/
 *        排序 + 视图切换 / 对局列表 / 加载更多 / 页脚。
 */
export function LobbyPage({ onBack, onWatch, onResume, onStart }: LobbyPageProps): JSX.Element {
  const lobby = useLobby();
  const [grid, setGrid] = useState(false);
  const mineId = readSavedGame()?.id ?? null;
  const watching = lobby.games.reduce((sum, game) => sum + game.spectators, 0);
  const finals = lobby.games.filter((g) => g.isFinal).length;
  const remaining = Math.max(0, lobby.total - lobby.games.length);

  const open = (game: LobbyGame): void => {
    if (game.gameId === mineId) onResume(game.gameId);
    else onWatch(game.gameId);
  };

  const emptyText =
    lobby.filter === 'mine'
      ? '还没有属于你的进行中对局'
      : lobby.filter === 'final'
        ? '现在没有决赛圈的对局'
        : lobby.filter === 'human'
          ? '现在没有真人局'
          : '现在没有进行中的对局';

  return (
    <section className="screen page-lobby">
      <div className="d-nav lb-nav">
        <button className="d-back" onClick={onBack} aria-label="返回">
          ←
        </button>
        <p className="lb-nav-title">游戏大厅</p>
        <button className="lb-search" onClick={() => void lobby.reload()} disabled={lobby.loading} aria-label="刷新">
          ↻
        </button>
      </div>

      <div className="ov-card">
        <div className="ov-stats">
          <div className="ov-item">
            <div className="ov-num-row">
              <span className="dot" />
              <b>{lobby.total}</b>
            </div>
            <span>进行中</span>
          </div>
          <div className="ov-div" />
          <div className="ov-item good">
            <b>{watching}</b>
            <span>人正在观战</span>
          </div>
          <div className="ov-div" />
          <div className="ov-item gold">
            <b>{finals}</b>
            <span>决赛圈</span>
          </div>
        </div>
        <div className="ov-foot">
          <span>{lobby.loading ? '刷新中…' : '刚刚更新 · 点右上角刷新'}</span>
          <span>{lobby.games.length >= 6 ? '≥6 局已切紧凑列表' : '列表模式'}</span>
        </div>
      </div>

      <div className="lb-chips">
        {FILTERS.map((item) => {
          const count = lobby.counts[item.key];
          return (
            <button
              key={item.key}
              className={lobby.filter === item.key ? 'lb-chip on' : 'lb-chip'}
              onClick={() => lobby.setFilter(item.key)}
            >
              {item.label}
              <em>{count === null ? '—' : count}</em>
            </button>
          );
        })}
      </div>

      <div className="lb-sort">
        <button
          className="lb-sort-left"
          onClick={() => lobby.setSort(lobby.sort === 'spectators' ? 'created' : 'spectators')}
        >
          <span>{lobby.sort === 'spectators' ? '按观战人数' : '按开局时间'}</span>
          <span className="arrow">▾</span>
        </button>
        <div className="lb-views">
          <button className={grid ? 'lb-view' : 'lb-view on'} onClick={() => setGrid(false)} aria-label="列表视图">
            ☰
          </button>
          <button className={grid ? 'lb-view on' : 'lb-view'} onClick={() => setGrid(true)} aria-label="网格视图">
            ▦
          </button>
        </div>
      </div>

      {lobby.error ? (
        <div className="lb-empty">
          大厅加载失败：{lobby.error}
          <br />
          <button className="lb-more" style={{ width: '100%', marginTop: 10 }} onClick={() => void lobby.reload()}>
            重试
          </button>
        </div>
      ) : null}

      {!lobby.error && lobby.games.length === 0 ? (
        lobby.loading ? (
          <div className="lb-empty">读取进行中对局…</div>
        ) : (
          <div className="lb-empty">
            {emptyText}
            <br />
            <button className="lb-more" style={{ width: '100%', marginTop: 10 }} onClick={onStart}>
              开一局
            </button>
          </div>
        )
      ) : null}

      {lobby.games.length > 0 ? (
        <div className="lb-list" style={grid ? { display: 'grid', gridTemplateColumns: '1fr 1fr' } : undefined}>
          {lobby.games.map((game) =>
            grid ? (
              <GameCard key={game.gameId} game={game} mine={game.gameId === mineId} onOpen={open} />
            ) : (
              <GameRow key={game.gameId} game={game} mine={game.gameId === mineId} onOpen={open} />
            ),
          )}
        </div>
      ) : null}

      {lobby.games.length > 0 ? (
        lobby.hasMore ? (
          <button className="lb-more" disabled={lobby.loading} onClick={() => void lobby.loadMore()}>
            {lobby.loading ? '加载中…' : `上滑加载更多 · 还有 ${remaining} 局`}
          </button>
        ) : (
          <div className="lb-more" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            没有更多了 · 共 {lobby.total} 局
          </div>
        )
      ) : null}

      <footer className="d-footer">
        <p>by domonic · 17aitech.com</p>
        <p>WorkBuddy 1024 造物挑战 · v{APP_VERSION}</p>
      </footer>
    </section>
  );
}
