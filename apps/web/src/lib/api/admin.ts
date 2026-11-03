import {
  ApiPath,
  ChangeMemberRoleResponse,
  CreateApiKeyResponse,
  CreateEventResponse,
  CreateNoticeResponse,
  CreatePatchNoteResponse,
  CreateSeasonResponse,
  GetAdminOverviewResponse,
  ListAdminApiKeysResponse,
  ListAdminAuditLogsResponse,
  ListAdminMembersResponse,
  ListAdminNoShowScrimsResponse,
  ListAdminResultsResponse,
  ListAdminSeasonsResponse,
  RevokeApiKeyResponse,
  UpdateEventResponse,
  UpdateNoticeResponse,
  UpdatePatchNoteResponse,
  UpdateSeasonResponse,
  fillPath,
  type AdminAuditAction,
  type AdminMemberSort,
  type AdminResultView,
  type ChangeMemberRoleRequest,
  type CreateApiKeyRequestInput,
  type CreateEventRequestInput,
  type CreateNoticeRequestInput,
  type CreatePatchNoteRequestInput,
  type CreateSeasonRequestInput,
  type UpdateEventRequestInput,
  type UpdateNoticeRequestInput,
  type UpdatePatchNoteRequestInput,
  type UpdateSeasonRequestInput,
  type UserRole,
} from '@gcd/shared';
import { apiClient } from './index';

/**
 * S6 운영진 엔드포인트 21개(계약 S6 4-2. 25번째 되돌리기는 lib/api/scrims.ts). 모두 JWT + admin, 비운영진 403.
 * 응답은 shared zod 스키마로 parse된다. 경로는 ApiPath + fillPath만 쓴다.
 */

function query(q: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export interface PageParams {
  cursor?: string;
  limit?: number;
}

// ---- 통계·큐·노쇼 ----

/** GET /admin/overview */
export function getAdminOverview(signal?: AbortSignal) {
  return apiClient.request(ApiPath.adminOverview, GetAdminOverviewResponse, { signal });
}

/** GET /admin/results?view= */
export function listAdminResults(p: PageParams & { view: AdminResultView }, signal?: AbortSignal) {
  return apiClient.request(`${ApiPath.adminResults}${query({ ...p })}`, ListAdminResultsResponse, { signal });
}

/** GET /admin/no-show/scrims — 노쇼 표시 후보(표시 기한 안). 저장은 기존 PUT /scrims/:id/players/:userId/no-show */
export function listAdminNoShowScrims(p: PageParams = {}, signal?: AbortSignal) {
  return apiClient.request(`${ApiPath.adminNoShowScrims}${query({ ...p })}`, ListAdminNoShowScrimsResponse, { signal });
}

// ---- 멤버·역할 ----

export interface AdminMembersParams extends PageParams {
  q?: string;
  role?: UserRole;
  sort: AdminMemberSort;
}

/** GET /admin/members?q=&role=&sort= */
export function listAdminMembers(p: AdminMembersParams, signal?: AbortSignal) {
  return apiClient.request(`${ApiPath.adminMembers}${query({ ...p })}`, ListAdminMembersResponse, { signal });
}

/** PATCH /admin/members/:id/role */
export function changeMemberRole(id: string, body: ChangeMemberRoleRequest) {
  return apiClient.request(fillPath(ApiPath.adminMemberRole, { id }), ChangeMemberRoleResponse, { method: 'PATCH', body });
}

/** DELETE /admin/members/:id (204). 운영진·기록 있는 회원은 409 */
export function deleteMember(id: string) {
  return apiClient.request(fillPath(ApiPath.adminMember, { id }), null, { method: 'DELETE' });
}

// ---- 공지·패치노트·이벤트 쓰기(목록은 lib/api/news.ts 공개 GET) ----

/** POST /admin/notices (201) */
export function createNotice(body: CreateNoticeRequestInput) {
  return apiClient.request(ApiPath.adminNotices, CreateNoticeResponse, { method: 'POST', body });
}
/** PATCH /admin/notices/:id */
export function updateNotice(id: string, body: UpdateNoticeRequestInput) {
  return apiClient.request(fillPath(ApiPath.adminNotice, { id }), UpdateNoticeResponse, { method: 'PATCH', body });
}
/** DELETE /admin/notices/:id (204) */
export function deleteNotice(id: string) {
  return apiClient.request(fillPath(ApiPath.adminNotice, { id }), null, { method: 'DELETE' });
}

/** POST /admin/patch-notes (201) */
export function createPatchNote(body: CreatePatchNoteRequestInput) {
  return apiClient.request(ApiPath.adminPatchNotes, CreatePatchNoteResponse, { method: 'POST', body });
}
/** PATCH /admin/patch-notes/:id */
export function updatePatchNote(id: string, body: UpdatePatchNoteRequestInput) {
  return apiClient.request(fillPath(ApiPath.adminPatchNote, { id }), UpdatePatchNoteResponse, { method: 'PATCH', body });
}
/** DELETE /admin/patch-notes/:id (204) */
export function deletePatchNote(id: string) {
  return apiClient.request(fillPath(ApiPath.adminPatchNote, { id }), null, { method: 'DELETE' });
}

/** POST /admin/events (201) */
export function createEvent(body: CreateEventRequestInput) {
  return apiClient.request(ApiPath.adminEvents, CreateEventResponse, { method: 'POST', body });
}
/** PATCH /admin/events/:id */
export function updateEvent(id: string, body: UpdateEventRequestInput) {
  return apiClient.request(fillPath(ApiPath.adminEvent, { id }), UpdateEventResponse, { method: 'PATCH', body });
}
/** DELETE /admin/events/:id (204) */
export function deleteEvent(id: string) {
  return apiClient.request(fillPath(ApiPath.adminEvent, { id }), null, { method: 'DELETE' });
}

// ---- API 키 ----

/** GET /admin/api-keys — 페이징 없음 */
export function listAdminApiKeys(signal?: AbortSignal) {
  return apiClient.request(ApiPath.adminApiKeys, ListAdminApiKeysResponse, { signal });
}
/** POST /admin/api-keys (201) — 원문 key는 이 응답에만 있다 */
export function createApiKey(body: CreateApiKeyRequestInput) {
  return apiClient.request(ApiPath.adminApiKeys, CreateApiKeyResponse, { method: 'POST', body });
}
/** POST /admin/api-keys/:id/revoke — 본문 없음, 멱등 */
export function revokeApiKey(id: string) {
  return apiClient.request(fillPath(ApiPath.adminApiKeyRevoke, { id }), RevokeApiKeyResponse, { method: 'POST' });
}

// ---- 시즌 ----

/** GET /admin/seasons — 페이징 없음 */
export function listAdminSeasons(signal?: AbortSignal) {
  return apiClient.request(ApiPath.adminSeasons, ListAdminSeasonsResponse, { signal });
}
/** POST /admin/seasons (201) */
export function createSeason(body: CreateSeasonRequestInput) {
  return apiClient.request(ApiPath.adminSeasons, CreateSeasonResponse, { method: 'POST', body });
}
/** PATCH /admin/seasons/:id — 보낸 필드만 */
export function updateSeason(id: string, body: UpdateSeasonRequestInput) {
  return apiClient.request(fillPath(ApiPath.adminSeason, { id }), UpdateSeasonResponse, { method: 'PATCH', body });
}
/** DELETE /admin/seasons/:id (204) — upcoming만 */
export function deleteSeason(id: string) {
  return apiClient.request(fillPath(ApiPath.adminSeason, { id }), null, { method: 'DELETE' });
}

// ---- 감사 로그 ----

/** GET /admin/audit-logs?action= */
export function listAdminAuditLogs(p: PageParams & { action?: AdminAuditAction }, signal?: AbortSignal) {
  return apiClient.request(`${ApiPath.adminAuditLogs}${query({ ...p })}`, ListAdminAuditLogsResponse, { signal });
}
