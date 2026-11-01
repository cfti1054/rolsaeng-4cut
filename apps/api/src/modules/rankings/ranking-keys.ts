import type { ActivityPeriod, GameCode, TierRankingGame } from '@gcd/shared';

/** ranking_caches.cache_key(계약 S4 7-1, S5 7절). 이 접두사가 정리 작업(deleteExcept) 범위다 */
export const RANKING_KEY_PREFIX = 'rankings:';

export const tierRankingKey = (game: TierRankingGame): string => `${RANKING_KEY_PREFIX}tier:${game}`;
export const eloRankingKey = (game: GameCode, seasonId: string): string => `${RANKING_KEY_PREFIX}elo:${game}:${seasonId}`;
/** 기간 종류별 고정 키. payload에 기간이 들어 있다(D216) */
export const activityRankingKey = (period: ActivityPeriod): string => `${RANKING_KEY_PREFIX}activity:${period}`;
export const playtimeRankingKey = (appId: number): string => `${RANKING_KEY_PREFIX}playtime:${appId}`;
