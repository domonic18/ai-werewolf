import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { HealthResponse, LiveResponse, MatchesResponse, ModelInfo } from '@shared/types';

export interface HomeData {
  health: HealthResponse | null;
  healthError: string | null;
  models: ModelInfo[];
  currentModel: string | null;
  matches: MatchesResponse | null;
  live: LiveResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  selectModel: (id: string) => Promise<void>;
}

/** 首页数据：健康检查 / 模型列表 / 战绩墙 / 进行中对局，一次 refresh 全量拉取 */
export function useHomeData(): HomeData {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchesResponse | null>(null);
  const [live, setLive] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    const [healthResult, modelsResult, matchesResult, liveResult] = await Promise.allSettled([
      api.health(),
      api.models(),
      api.matches(),
      api.live(),
    ]);

    if (healthResult.status === 'fulfilled') {
      setHealth(healthResult.value);
      setHealthError(healthResult.value.llm.ok ? null : healthResult.value.llm.error ?? '未知错误');
    } else {
      setHealth(null);
      setHealthError(healthResult.reason instanceof Error ? healthResult.reason.message : '服务不可达');
    }

    if (modelsResult.status === 'fulfilled') {
      setModels(modelsResult.value.models);
      setCurrentModel(modelsResult.value.current ?? null);
    }
    if (matchesResult.status === 'fulfilled') setMatches(matchesResult.value);
    if (liveResult.status === 'fulfilled') setLive(liveResult.value);

    setLoading(false);
  }, []);

  const selectModel = useCallback(
    async (id: string): Promise<void> => {
      await api.selectModel(id);
      setCurrentModel(id);
      const result = await api.models();
      setModels(result.models);
      setCurrentModel(result.current ?? id);
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { health, healthError, models, currentModel, matches, live, loading, refresh, selectModel };
}
