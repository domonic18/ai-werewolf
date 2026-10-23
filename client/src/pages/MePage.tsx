import { useCallback, useEffect, useState } from 'react';
import type { LobbyGame, MatchesResponse } from '@shared/types';
import { ROLES } from '@shared/roles';
import { api } from '../api/client';
import { refreshAccessToken } from '../auth/actions';
import { logout } from '../auth/session';
import { useSession } from '../auth/useSession';
import { Icon, roleIcon } from '../components/Icon';
import { InvitePanel } from '../components/InvitePanel';
import { SiteFooter } from '../components/SiteFooter';
import { formatWhen, matchOutcome, roleFromLabel } from '../lib/format';
import { readSavedGame } from '../lib/storage';

/**
 * 我的战绩（#me）。
 *
 * 之前「登录后战绩记在账号下」只有一句承诺：数据接口有（/api/matches?mine=1），
 * 但页面上找不到入口，只有结算页底部露一小块。这里给它一个正式的落点：
 * 累计战绩（总局 / 胜场 / 胜率）+ 进行中的对局 + 最近每一局的角色与胜负。
 *
 * 数据全部来自服务端按账号过滤，前端不做二次统计——口径只有一处。
 */
interface MePageProps {
  onBack: () => void;
  onLogin: () => void;
  onStart: () => void;
  onResume: (gameId: string) => void;
}

function maskId(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

const OUTCOME_TAG: Record<'win' | 'lose' | 'aborted', { text: string; cls: string }> = {
  win: { text: '胜', cls: 'tag win' },
  lose: { text: '负', cls: 'tag lose' },
  aborted: { text: '中止', cls: 'tag phase' },
};

export function MePage({ onBack, onLogin, onStart, onResume }: MePageProps): JSX.Element {
  const { session, signedIn } = useSession();
  const [matches, setMatches] = useState<MatchesResponse | null>(null);
  const [ongoing, setOngoing] = useState<LobbyGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  /* 自检结果：只用来把「为什么认不出我」说清楚，不参与业务判断 */
  const [authIssue, setAuthIssue] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!signedIn) {
      setMatches(null);
      setOngoing([]);
      return;
    }
    setLoading(true);
    setError(null);
    const [history, live] = await Promise.all([
      api.matches(true).catch((e: Error) => {
        setError(e.message);
        return null;
      }),
      api.live({ filter: 'mine', mine: readSavedGame()?.id ?? null, limit: 20 }).catch(() => null),
    ]);
    setMatches(history);
    setOngoing(live?.games ?? []);
    setLoading(false);

    /* 服务端把人认成匿名时，问一次 /whoami 把原因落到字符串上 */
    if (signedIn && history && history.scope === 'all') {
      const info = await api.whoami().catch(() => null);
      if (info?.signedIn) setAuthIssue(null);
      else if (info?.status === 'network') setAuthIssue('云端不可达');
      else if (typeof info?.status === 'number') setAuthIssue(`云端返回 ${info.status}`);
      else setAuthIssue('没有可用的凭证');
    } else {
      setAuthIssue(null);
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 服务端认不出人时给一次「重新同步」：先让 SDK 续期，续不上才是真的要重新登录 */
  const resync = async (): Promise<void> => {
    setResyncing(true);
    const token = await refreshAccessToken();
    if (token) {
      await load();
      setResyncing(false);
      return;
    }
    setResyncing(false);
    await logout();
    onLogin();
  };

  const mine = matches?.mine ?? null;
  /* 本地有会话但服务端认不出人（token 过期/换环境）：别让 0 局看起来像「你没打过」 */
  const staleAuth = Boolean(signedIn && matches && matches.scope === 'all');
  const rows = matches?.recent ?? [];
  const rate = mine && mine.total > 0 ? Math.round((mine.wins / mine.total) * 100) : 0;

  return (
    <section className="screen page-me">
      <div className="d-nav lb-nav">
        <button className="d-back" onClick={onBack} aria-label="返回">
          <Icon name="back" size={16} />
        </button>
        <p className="lb-nav-title">我的战绩</p>
        <button className="lb-search" onClick={() => void load()} disabled={loading} aria-label="刷新">
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {!signedIn ? (
        <div className="su-card me-guest">
          <span className="me-guest-icon">
            <Icon name="lock" size={24} />
          </span>
          <b>登录后才会有你的战绩</b>
          <p>
            战绩按账号存在云端：换设备、清缓存都不会丢。不登录也能玩，只是这一局不记在你名下。
          </p>
          <button className="btn-create" onClick={onLogin}>
            去登录
          </button>
          <button className="me-ghost" onClick={onStart}>
            先开一局
          </button>
        </div>
      ) : (
        <>
          <div className="account-card">
            <div className="account-left">
              <span className="avatar avatar-human">
                <Icon name="villager" size={15} />
              </span>
              <div className="account-text">
                <b>已登录</b>
                <span>{session ? maskId(session.userId) : ''}</span>
              </div>
            </div>
            <button className="account-out" onClick={() => void logout()}>
              退出
            </button>
          </div>

          {staleAuth ? (
            <div className="me-stale">
              <Icon name="info" size={12} />
              <span>
                服务端没有认出当前账号{authIssue ? `（${authIssue}）` : ''}，这份统计暂时是全网数据。
              </span>
              <button className="me-stale-btn" onClick={() => void resync()} disabled={resyncing}>
                {resyncing ? '同步中…' : '重新同步'}
              </button>
            </div>
          ) : null}

          <div className="ov-card">
            <div className="ov-stats">
              <div className="ov-item">
                <b>{mine?.total ?? 0}</b>
                <span>总对局</span>
              </div>
              <div className="ov-div" />
              <div className="ov-item good">
                <b>{mine?.wins ?? 0}</b>
                <span>胜场</span>
              </div>
              <div className="ov-div" />
              <div className="ov-item gold">
                <b>{rate}%</b>
                <span>胜率</span>
              </div>
            </div>
            <div className="ov-foot">
              <span>
                {mine && mine.total > 0 ? `已分胜负 ${mine.total} 局` : '还没有打完的对局，开一局就会有了'}
              </span>
              {mine?.aborted ? <span>{mine.aborted} 局中止未计入</span> : null}
            </div>
          </div>

          <InvitePanel />

          {ongoing.length ? (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title">进行中</span>
                <span className="panel-sub">{ongoing.length} 局</span>
              </div>
              {ongoing.map((game) => (
                <button key={game.gameId} className="me-row" onClick={() => onResume(game.gameId)}>
                  <span className="me-role">
                    <Icon name="clock" size={14} />
                  </span>
                  <span className="me-row-main">
                    <b>
                      {game.players} 人局 · {game.phaseLabel}
                    </b>
                    <span>
                      存活 {game.alive}/{game.players} · {game.host} 的局
                    </span>
                  </span>
                  <span className="me-go">
                    继续
                    <Icon name="chevronRight" size={12} />
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">最近战绩</span>
              <span className="panel-sub">{rows.length ? `最近 ${rows.length} 局` : '按时间倒序'}</span>
            </div>
            {error ? <div className="lb-empty">读取失败：{error}</div> : null}
            {!error && !rows.length ? (
              <div className="lb-empty">
                {loading ? '读取中…' : '还没有打完的对局。开一局，这里就有第一条记录。'}
              </div>
            ) : null}
            {rows.map((row) => {
              const role = roleFromLabel(row.player_role);
              const outcome = OUTCOME_TAG[matchOutcome(row.player_role, row.result)];
              return (
                <div key={row.id} className="me-row">
                  <span className="me-role">
                    <Icon name={roleIcon(role)} size={14} />
                  </span>
                  <span className="me-row-main">
                    <b>{role ? ROLES[role].name : row.player_role || '未知角色'}</b>
                    <span>
                      {row.rounds} 回合 · {formatWhen(row.created_at)}
                    </span>
                  </span>
                  <span className={outcome.cls}>{outcome.text}</span>
                </div>
              );
            })}
          </div>

          <p className="me-note">
            只有你自己坐庄打完的对局才计入；观战、以及未登录时玩的局不进这份战绩。
          </p>
        </>
      )}

      <SiteFooter />
    </section>
  );
}
