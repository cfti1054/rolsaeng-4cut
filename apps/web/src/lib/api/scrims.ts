import {
  ApiPath,
  CancelScrimResponse,
  CreateScrimResponse,
  GetMyScrimRestrictionResponse,
  GetScrimResponse,
  JoinScrimResponse,
  LeaveScrimResponse,
  ListGamesResponse,
  ListScrimsResponse,
  SearchSteamAppsResponse,
  SetScrimNoShowResponse,
  StartScrimResponse,
  UpdateScrimResponse,
  fillPath,
  type CreateScrimRequestInput,
  type GameCode,
  type JoinScrimRequestInput,
  type ScrimListStatus,
  type SetScrimNoShowRequest,
  type UpdateScrimRequestInput,
} from '@gcd/shared';
import { apiClient } from './index';

/**
 * S2 엔드포인트 11개(계약 4절). 엔드포인트 하나당 함수 하나, 응답은 전부 shared zod 스키마로 parse된다.
 * 경로는 ApiPath + fillPath만 쓴다.
 */

/** GET /games */
export function listGames(signal?: AbortSignal) {
  return apiClient.request(ApiPath.games, ListGamesResponse, { signal });
}

export interface ListScrimsParams {
  game?: GameCode;
  status: ScrimListStatus;
  cursor?: string;
  limit?: number;
}

/** GET /scrims?game=&status=&cursor=&limit= */
export function listScrims(p: ListScrimsParams, signal?: AbortSignal) {
  const q = new URLSearchParams();
  if (p.game) q.set('game', p.game);
  q.set('status', p.status);
  if (p.cursor) q.set('cursor', p.cursor);
  if (p.limit !== undefined) q.set('limit', String(p.limit));
  return apiClient.request(`${ApiPath.scrims}?${q.toString()}`, ListScrimsResponse, { signal });
}

/** POST /scrims (201) */
export function createScrim(body: CreateScrimRequestInput) {
  return apiClient.request(ApiPath.scrims, CreateScrimResponse, { method: 'POST', body });
}

/** GET /scrims/:id */
export function getScrim(id: string, signal?: AbortSignal) {
  return apiClient.request(fillPath(ApiPath.scrim, { id }), GetScrimResponse, { signal });
}

/** PATCH /scrims/:id — 바꿀 필드만 */
export function updateScrim(id: string, body: UpdateScrimRequestInput) {
  return apiClient.request(fillPath(ApiPath.scrim, { id }), UpdateScrimResponse, { method: 'PATCH', body });
}

/** POST /scrims/:id/join — 참가·대기 등록·희망 포지션 변경(본문은 항상 객체) */
export function joinScrim(id: string, body: JoinScrimRequestInput) {
  return apiClient.request(fillPath(ApiPath.scrimJoin, { id }), JoinScrimResponse, { method: 'POST', body });
}

/** DELETE /scrims/:id/join — 본문 없음, 200 ScrimDetail */
export function leaveScrim(id: string) {
  return apiClient.request(fillPath(ApiPath.scrimJoin, { id }), LeaveScrimResponse, { method: 'DELETE' });
}

/** POST /scrims/:id/start */
export function startScrim(id: string) {
  return apiClient.request(fillPath(ApiPath.scrimStart, { id }), StartScrimResponse, { method: 'POST' });
}

/** POST /scrims/:id/cancel */
export function cancelScrim(id: string) {
  return apiClient.request(fillPath(ApiPath.scrimCancel, { id }), CancelScrimResponse, { method: 'POST' });
}

/** PUT /scrims/:id/players/:userId/no-show (운영진) */
export function setScrimNoShow(id: string, userId: string, body: SetScrimNoShowRequest) {
  return apiClient.request(fillPath(ApiPath.scrimPlayerNoShow, { id, userId }), SetScrimNoShowResponse, {
    method: 'PUT',
    body,
  });
}

/** GET /steam-apps?q= — 스팀 내전 게임 검색(D98). q 없으면 멤버 보유 게임 */
export function searchSteamApps(q: string, signal?: AbortSignal) {
  const qs = q === '' ? '' : `?${new URLSearchParams({ q }).toString()}`;
  return apiClient.request(`${ApiPath.steamApps}${qs}`, SearchSteamAppsResponse, { signal });
}

/** GET /me/scrim-restriction */
export function getMyScrimRestriction(signal?: AbortSignal) {
  return apiClient.request(ApiPath.myScrimRestriction, GetMyScrimRestrictionResponse, { signal });
}
