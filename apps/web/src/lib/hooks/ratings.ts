'use client';

import type { GameCode } from '@gcd/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';
import { getUserRatingHistory, listSeasons } from '@/lib/api/ratings';
import { gameAccountKeys } from './game-accounts';

/** S3 시즌·레이팅 그래프 훅 2개(계약 S3 9절). 그래프 키는 ['users', …] 아래라 결과 승인 때 프로필과 함께 무효화된다 */

export const ratingKeys = {
  seasons: ['seasons'] as const,
  history: (userId: string, game: GameCode, season: string | null) =>
    [...gameAccountKeys.profiles, userId, 'rating-history', game, season ?? 'default'] as const,
};

const noRetryOn4xx = (count: number, err: unknown) =>
  !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2;

/** GET /seasons — 거의 바뀌지 않는다 */
export function useSeasons() {
  return useQuery({
    queryKey: ratingKeys.seasons,
    queryFn: ({ signal }) => listSeasons(signal),
    staleTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

/** GET /users/:id/rating-history?game&season — season null = 서버 기본 시즌. 선택을 바꾸는 동안 이전 그래프 유지 */
export function useUserRatingHistory(userId: string, game: GameCode | null, season: string | null) {
  return useQuery({
    queryKey: ratingKeys.history(userId, game ?? 'lol', season),
    queryFn: ({ signal }) => getUserRatingHistory(userId, { game: game!, season: season ?? undefined }, signal),
    enabled: game !== null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: noRetryOn4xx,
  });
}
