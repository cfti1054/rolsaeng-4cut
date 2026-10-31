import type { GameCode, TierRankingGame } from '@gcd/shared';

/** ranking_caches.cache_key(계약 S4 7-1). 이 접두사가 정리 작업(deleteExcept) 범위다 */
export const RANKING_KEY_PREFIX = 'rankings:';

export const tierRankingKey = (game: TierRankingGame): string => `${RANKING_KEY_PREFIX}tier:${game}`;
export const eloRankingKey = (game: GameCode, seasonId: string): string => `${RANKING_KEY_PREFIX}elo:${game}:${seasonId}`;
