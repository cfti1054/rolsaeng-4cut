import {
  ApiPath,
  GetDashboardSummaryResponse,
  GetEloRankingResponse,
  GetTierRankingResponse,
  type GetEloRankingQuery,
  type GetTierRankingQuery,
} from '@gcd/shared';
import { apiClient } from './index';

/** S4 랭킹·홈 요약(계약 4절). 응답은 shared zod 스키마로 parse된다 */

/** GET /rankings/tier?game= */
export function getTierRanking(q: GetTierRankingQuery, signal?: AbortSignal) {
  const qs = new URLSearchParams({ game: q.game });
  return apiClient.request(`${ApiPath.rankingsTier}?${qs.toString()}`, GetTierRankingResponse, { signal });
}

/** GET /rankings/elo?game=&season= — season 생략 = 서버 기본(현재 시즌 → 가장 최근 시작 시즌) */
export function getEloRanking(q: GetEloRankingQuery, signal?: AbortSignal) {
  const qs = new URLSearchParams({ game: q.game });
  if (q.season) qs.set('season', q.season);
  return apiClient.request(`${ApiPath.rankingsElo}?${qs.toString()}`, GetEloRankingResponse, { signal });
}

/** GET /dashboard/summary */
export function getDashboardSummary(signal?: AbortSignal) {
  return apiClient.request(ApiPath.dashboardSummary, GetDashboardSummaryResponse, { signal });
}
