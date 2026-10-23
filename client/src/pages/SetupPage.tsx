import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { defaultName, normalizeName, rememberName } from '../lib/nickname';
import { Icon, roleIcon } from '../components/Icon';
import { SiteFooter } from '../components/SiteFooter';
import { useHomeData } from '../hooks/useHomeData';
import type { RoleKey, RolesResponse } from '@shared/types';


const CHOICES = [6, 8, 9, 10, 12];
/** 设计稿只列 3 个锁定角色，其余折叠成「还有 N 个进阶角色」 */
const LOCKED_PREVIEW = 3;

interface SetupPageProps {
  onBack: () => void;
  onStarted: (gameId: string, playerToken: string) => void;
}

/**
 * 角色行的一句话说明：用设计稿的短句（10px 单行放得下），
 * 服务端 catalog 里的 ability 更长，留着给别的场景用。
 */
const SHORT_ABILITY: Partial<Record<RoleKey, string>> = {
  wolf: '夜晚睁眼刀人',
  seer: '每夜查验一人',
  witch: '解药 / 毒药各一瓶',
  villager: '靠发言推理',
  hunter: '出局时可开枪带走一人',
  guard: '每夜守护一人',
  idiot: '被投出后可翻牌免死',
  elder: '首次夜间死亡可免死',
  wolfking: '出局时可开枪带走一人',
  dreamweaver: '每夜标记一人，被标者免刀',
};
const shortAbility = (key: RoleKey, fallback: string): string => SHORT_ABILITY[key] ?? fallback;

/** 角色卡 → 推荐 chips 的配色（对齐设计稿的四种底色） */
function chipClass(key: RoleKey, team: 'wolf' | 'good'): string {
  if (team === 'wolf') return 'rec-chip wolf';
  if (key === 'witch') return 'rec-chip witch';
  if (key === 'villager') return 'rec-chip plain';
  return 'rec-chip seer';
}

/**
 * 建局配置（设计规范 v2「夜席」）：人数 / 推荐阵容 / 角色库 / 校验与开局。
 * 结构 = 返回栏 / 总人数 / 系统推荐阵容 / 角色库（加减 + 锁定）/ 更多设置 / 校验 + 开局 / 页脚。
 *
 * 推荐牌组来自服务端 `GET /api/roles`（与引擎校验同一套 catalog 数据），
 * 前端不自己算分档，避免两边各写一份规则后漂移。
 * 客户端只做「能不能点开始」的即时提示，真正的校验在服务端。
 */
export function SetupPage({ onBack, onStarted }: SetupPageProps): JSX.Element {
  const home = useHomeData();
  const [players, setPlayers] = useState(6);
  const [data, setData] = useState<RolesResponse | null>(null);
  const [deck, setDeck] = useState<Partial<Record<RoleKey, number>>>({});
  const [name, setName] = useState(() => defaultName());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllLocked, setShowAllLocked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const load = useCallback(async (count: number) => {
    setError(null);
    try {
      const result = await api.roles(count);
      setData(result);
      /* 换人数时直接套用推荐牌组 */
      const next: Partial<Record<RoleKey, number>> = {};
      for (const slot of result.recommended) next[slot.key] = slot.count;
      setDeck(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '角色库加载失败');
    }
  }, []);

  useEffect(() => {
    void load(players);
  }, [load, players]);

  const total = useMemo(() => Object.values(deck).reduce<number>((a, n) => a + (n ?? 0), 0), [deck]);
  const wolves = useMemo(() => {
    if (!data) return 0;
    const wolfKeys = new Set(data.available.filter((c) => c.team === 'wolf').map((c) => c.key));
    return Object.entries(deck)
      .filter(([key]) => wolfKeys.has(key as RoleKey))
      .reduce<number>((a, [, n]) => a + (n ?? 0), 0);
  }, [data, deck]);

  const problem = useMemo(() => {
    if (!data) return '角色库加载中…';
    if (total !== players) return `角色数量 ${total} 人，与所选人数 ${players} 人不一致`;
    if (wolves < 2) return '狼人至少 2 名';
    if (wolves * 2 >= players) return '狼人不能达到半数';
    return null;
  }, [data, players, total, wolves]);

  const bump = (key: RoleKey, delta: number): void => {
    setDeck((prev) => {
      const next = { ...prev };
      const value = Math.max(0, (next[key] ?? 0) + delta);
      if (value === 0) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const start = async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      const payload = Object.entries(deck).map(([key, count]) => ({ key, count: count ?? 0 }));
      const playerName = normalizeName(name) || defaultName();
      rememberName(playerName);
      const result = await api.createGame({ playerName, deck: payload });
      onStarted(result.gameId, result.playerToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : '开局失败');
    } finally {
      setStarting(false);
    }
  };

  /* 推荐阵容的 chips 按「推荐牌组」而不是当前调整结果，改了数量也不会跟着抖 */
  const recommended = useMemo(() => {
    const list = data?.recommended ?? [];
    /* 设计稿里狼人排在最前，这里按阵营稳定排序，不改数量 */
    return [...list].sort((a, b) => {
      const teamOf = (key: RoleKey): number => (data?.available.find((c) => c.key === key)?.team === 'wolf' ? 0 : 1);
      return teamOf(a.key) - teamOf(b.key);
    });
  }, [data]);
  const locked = data?.locked ?? [];
  const visibleLocked = showAllLocked ? locked : locked.slice(0, LOCKED_PREVIEW);
  const gods = (data?.available ?? [])
    .filter((c) => c.team === 'good' && c.key !== 'villager' && c.key !== 'hunter' && c.key !== 'guard')
    .reduce((acc, card) => acc + (deck[card.key] ?? 0), 0);
  const villagers = deck.villager ?? 0;

  return (
    <section className="screen page-setup">
      <div className="d-nav su-nav">
        <button className="d-back" onClick={onBack} aria-label="返回">
          <Icon name="back" size={16} />
        </button>
        <p className="su-nav-title">新建对局</p>
        <span style={{ width: 36, height: 36 }} />
      </div>

      <div className="su-card">
        <div className="su-head">
          <b>你的代号</b>
          <span>局内显示这个名字</span>
        </div>
        <div className="lg-input">
          <input
            id="setupName"
            maxLength={8}
            placeholder="例如：夜客"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => rememberName(normalizeName(name))}
          />
        </div>
        <div className="su-hint">
          <Icon name="info" size={12} />
          <span>别用「你」——AI 说话时也常说「你」，两个「你」会分不清</span>
        </div>
      </div>

      <div className="su-card">
        <div className="su-head">
          <b>总人数</b>
          <span>
            {players} 人 · 1 真人 + {players - 1} AI
          </span>
        </div>
        <div className="su-seg">
          {CHOICES.map((count) => (
            <button
              key={count}
              className={players === count ? 'su-seat on' : 'su-seat'}
              onClick={() => setPlayers(count)}
            >
              {count}
            </button>
          ))}
        </div>
        <div className="su-hint">
          <Icon name="info" size={12} />
          <span>人数越多，角色越丰富；系统已自动推荐平衡阵容</span>
        </div>
      </div>

      <div className="rec-card">
        <div className="rec-head">
          <div className="rec-title">
            <Icon name="seal" size={13} />
            <span>系统推荐阵容</span>
          </div>
          <span className="rec-badge">标准 {players} 人局</span>
        </div>
        <div className="rec-chips">
          {recommended.map((slot) => {
            const card = data?.available.find((c) => c.key === slot.key);
            return (
              <span key={slot.key} className={chipClass(slot.key, card?.team ?? 'good')}>
                <Icon name={roleIcon(slot.key)} size={12} />
                {card?.name ?? slot.key} ×{slot.count}
              </span>
            );
          })}
        </div>
        <p className="rec-desc">
          狼人 {wolves} · 神职 {gods} · 平民 {villagers}，1 名真人坐庄、其余由 AI 补位
        </p>
      </div>

      <div className="su-card">
        <div className="su-head">
          <b>角色库</b>
          <span>
            已配置 {total} / {players}
          </span>
        </div>

        {!data ? <div className="lb-empty">读取角色库…</div> : null}

        {data
          ? data.available.map((card) => {
              const count = deck[card.key] ?? 0;
              const campClass =
                card.team === 'wolf' ? 'wolf' : card.key === 'witch' ? 'witch' : card.key === 'villager' ? 'plain' : 'god';
              const campLabel = card.team === 'wolf' ? '狼人阵营' : card.key === 'villager' ? '好人阵营' : '神职';
              const campText = `${campLabel} · ${shortAbility(card.key, card.ability)}`;
              return (
                <div key={card.key} className="role-row" title={campText}>
                  <div className="role-left">
                    <span className="role-emoji">
                      <Icon name={roleIcon(card.key)} size={17} />
                    </span>
                    <div className="role-info">
                      <span className="role-name">{card.name}</span>
                      <span className={`role-camp ${campClass}`}>{campText}</span>
                    </div>
                  </div>
                  <div className="role-stepper">
                    <button className="step-btn" onClick={() => bump(card.key, -1)} disabled={count <= 0} aria-label="减少">
                      <Icon name="minus" size={12} />
                    </button>
                    <span className="role-num">{count}</span>
                    <button className="step-btn plus" onClick={() => bump(card.key, 1)} aria-label="增加">
                      <Icon name="plus" size={12} />
                    </button>
                  </div>
                </div>
              );
            })
          : null}

        {visibleLocked.map((card) => (
          <div key={card.key} className="role-row locked" title={card.ability}>
            <div className="role-left">
              <span className="role-emoji">
                <Icon name={roleIcon(card.key)} size={17} />
              </span>
              <div className="role-info">
                <span className="role-name">{card.name}</span>
                <span className="role-camp">
                  {card.team === 'wolf' ? '狼人阵营' : card.key === 'villager' ? '好人阵营' : '神职'} ·{' '}
                  {shortAbility(card.key, card.ability)}
                </span>
              </div>
            </div>
            <div className="role-lock">
              <Icon name="lock" size={12} />
              <span>{card.implemented ? `需 ≥${card.minPlayers} 人` : '开发中'}</span>
            </div>
          </div>
        ))}

        {locked.length > LOCKED_PREVIEW ? (
          <button className="deck-more" onClick={() => setShowAllLocked((v) => !v)}>
            <span>{showAllLocked ? '收起进阶角色' : `还有 ${locked.length - LOCKED_PREVIEW} 个进阶角色`}</span>
            <Icon name="chevronRight" size={12} style={{ transform: showAllLocked ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
          </button>
        ) : null}
      </div>

      {/* 设计稿没有这两项，收进「更多设置」保持默认外观不变 */}
      <div className="su-card">
        <button className="su-head" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => setMoreOpen((v) => !v)}>
          <b>更多设置</b>
          <span style={{ color: 'var(--d-muted)', fontSize: 11 }}>{moreOpen ? '收起' : 'AI 模型'}</span>
        </button>
        {moreOpen ? (
          <div className="lg-field">
            <label htmlFor="modelSelect">
              AI 玩家模型（决定 5 个智能体的言行风格）
            </label>
            <div className="lg-input">
              <select
                id="modelSelect"
                value={home.currentModel ?? ''}
                onChange={(e) => void home.selectModel(e.target.value)}
                style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'var(--d-text)', fontSize: 14, outline: 'none' }}
              >
                {home.models.length === 0 ? <option value="">加载模型列表…</option> : null}
                {home.models.map((model) => (
                  <option key={model.id} value={model.id} style={{ color: '#000' }}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </div>

      <div className="su-bottom">
        <div className="su-validate">
          <span className={problem ? 'bad' : 'ok'}>
            <Icon name={problem ? 'info' : 'check'} size={12} />
            {problem ?? '阵营平衡校验通过'}
          </span>
          <span className="seats">
            {total} / {players} 座
          </span>
        </div>
        {error ? <p className="lg-hint" style={{ color: 'var(--wolf)' }}>开局失败：{error}</p> : null}
        <button className="btn-create" disabled={Boolean(problem) || starting} onClick={() => void start()}>
          {starting ? '开局中…' : '按此阵容开局'}
        </button>
      </div>

      <SiteFooter />
    </section>
  );
}
