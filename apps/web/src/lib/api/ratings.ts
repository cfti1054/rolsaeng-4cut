import { ApiPath, GetUserRatingHistoryResponse, ListSeasonsResponse, fillPath, type GameCode } from '@gcd/shared';
import { apiClient } from './index';

/** S3 시즌·레이팅 그래프(계약 S3 4절). 응답은 shared zod 스키마로 parse된다 */

/** GET /seasons — 전체 시즌(starts_at 내림차순) */
export function listSeasons(signal?: AbortSignal) {
  return apiClient.request(ApiPath.seasons, ListSeasonsResponse, { signal });
}

/** GET /users/:id/rating-history?game=&season= — season 생략 = 서버 기본(현재 → 가장 최근 시작 시즌) */
export function getUserRatingHistory(id: string, q: { game: GameCode; season?: string }, signal?: AbortSignal) {
  const qs = new URLSearchParams({ game: q.game });
  if (q.season) qs.set('season', q.season);
  return apiClient.request(`${fillPath(ApiPath.userRatingHistory, { id })}?${qs.toString()}`, GetUserRatingHistoryResponse, { signal });
}
