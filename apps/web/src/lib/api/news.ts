import {
  ApiPath,
  ListEventsResponse,
  ListNoticesResponse,
  ListPatchNotesResponse,
  type GameCode,
} from '@gcd/shared';
import { apiClient } from './index';

/**
 * S6 정보 읽기 3개(계약 S6 4-1, 멤버 전원). 응답은 shared zod 스키마로 parse된다.
 * 운영진 화면의 공지·패치노트·이벤트 목록도 이 GET을 쓴다(운영진 전용 목록 없음).
 */

function query(q: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** GET /notices?cursor=&limit= — created_at DESC */
export function listNotices(p: { cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
  return apiClient.request(`${ApiPath.notices}${query(p)}`, ListNoticesResponse, { signal });
}

/** GET /patch-notes?game=&cursor=&limit= — published_on DESC */
export function listPatchNotes(p: { game?: GameCode; cursor?: string; limit?: number } = {}, signal?: AbortSignal) {
  return apiClient.request(`${ApiPath.patchNotes}${query(p)}`, ListPatchNotesResponse, { signal });
}

/** GET /events?from=&to=&game= — 기간이 [from, to]와 겹치는 이벤트. 응답 from·to = 실제 적용 구간 */
export function listEvents(
  p: { from?: string; to?: string; game?: GameCode; cursor?: string; limit?: number } = {},
  signal?: AbortSignal,
) {
  return apiClient.request(`${ApiPath.events}${query(p)}`, ListEventsResponse, { signal });
}
