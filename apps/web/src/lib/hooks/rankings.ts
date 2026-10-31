'use client';

import { RANKING_CACHE_INTERVAL_MIN, type GameCode, type TierRankingGame } from '@gcd/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';
import { getDashboardSummary, getEloRanking, getTierRanking } from '@/lib/api/rankings';
import { useMe } from './auth';

/**
 * S4 랭킹·홈 요약 훅 3개(계약 10절). 값은 서버 5분 캐시라 승인 뒤 무효화해도 늦게 바뀔 수 있다(정상).
 */
export const rankingKeys = {
  all: ['rankings'] as const,
  tier: (game: TierRankingGame) => ['rankings', 'tier', game] as const,
  elo: (game: GameCode, season: string | null) => ['rankings', 'elo', game, season ?? 'default'] as const,
};

/** 사이드바와 홈이 같은 키를 써서 요청이 한 번만 나간다(D157) */
export const dashboardKeys = {
  summary: ['dashboard', 'summary'] as const,
};

const noRetryOn4xx = (count: number, err: unknown) => !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2;

/** 화면을 열어 둔 채로도 캐시 주기마다 새 값을 받는다 */
const RANKING_REFETCH_MS = RANKING_CACHE_INTERVAL_MIN * 60_000;

/** GET /rankings/tier — game null이면 요청하지 않는다(게임 목록을 받기 전, 다른 탭) */
export function useTierRanking(game: TierRankingGame | null) {
  return useQuery({
    queryKey: rankingKeys.tier(game ?? 'lol'),
    queryFn: ({ signal }) => getTierRanking({ game: game! }, signal),
    enabled: game !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: RANKING_REFETCH_MS,
    retry: noRetryOn4xx,
  });
}

/** GET /rankings/elo — season null = 서버 기본 시즌 */
export function useEloRanking(game: GameCode | null, season: string | null) {
  return useQuery({
    queryKey: rankingKeys.elo(game ?? 'lol', season),
    queryFn: ({ signal }) => getEloRanking({ game: game!, season: season ?? undefined }, signal),
    enabled: game !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchInterval: RANKING_REFETCH_MS,
    retry: noRetryOn4xx,
  });
}

/** 요약 쿼리 옵션. 재조회 주기를 테스트로 고정하려고 훅과 나눴다 */
export function dashboardSummaryOptions(enabled: boolean) {
  return {
    queryKey: dashboardKeys.summary,
    queryFn: ({ signal }: { signal?: AbortSignal }) => getDashboardSummary(signal),
    enabled,
    staleTime: 60_000,
    // 홈이 「5분마다 갱신」을 보여 주고 모집 인원도 같이 묶여 있어 열린 화면도 같은 주기로 받는다
    refetchInterval: RANKING_REFETCH_MS,
    retry: noRetryOn4xx,
  };
}

/** GET /dashboard/summary — 사이드바·모바일 머리·홈 공유(staleTime 60초, D157). 세션을 확인한 뒤에 부른다 */
export function useDashboardSummary() {
  const me = useMe();
  return useQuery(dashboardSummaryOptions(me.data !== undefined && !me.data.needs_nickname_confirmation));
}
