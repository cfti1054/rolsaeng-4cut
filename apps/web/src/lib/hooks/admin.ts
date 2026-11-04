'use client';

import type {
  AdminAuditAction,
  AdminMemberSort,
  AdminResultView,
  CreateApiKeyRequestInput,
  CreateEventRequestInput,
  CreateNoticeRequestInput,
  CreatePatchNoteRequestInput,
  CreateSeasonRequestInput,
  UpdateEventRequestInput,
  UpdateNoticeRequestInput,
  UpdatePatchNoteRequestInput,
  UpdateSeasonRequestInput,
  UserRole,
} from '@gcd/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  changeMemberRole,
  createApiKey,
  createEvent,
  createNotice,
  createPatchNote,
  createSeason,
  deleteEvent,
  deleteMember,
  deleteNotice,
  deletePatchNote,
  deleteSeason,
  getAdminOverview,
  listAdminApiKeys,
  listAdminAuditLogs,
  listAdminMembers,
  listAdminNoShowScrims,
  listAdminResults,
  listAdminSeasons,
  revokeApiKey,
  updateEvent,
  updateNotice,
  updatePatchNote,
  updateSeason,
} from '@/lib/api/admin';
import { isApiError } from '@/lib/api/client';
import { approveScrimResult, rejectScrimResult, revertScrimResult, setScrimNoShow } from '@/lib/api/scrims';
import { runNoShowChanges, type NoShowChange } from '@/lib/admin';
import { queryKeys } from './auth';
import { ADMIN_OVERVIEW_KEY, calendarKeys } from './calendar';
import { gameAccountKeys } from './game-accounts';
import { newsKeys } from './news';
import { dashboardKeys, rankingKeys } from './rankings';
import { ratingKeys } from './ratings';
import { scrimKeys } from './scrims';

/**
 * S6 운영진 훅(계약 S6 13절). 쿼리 키 ['admin', …].
 * 운영진 API가 403이면 강등됐을 수 있다(D263) → ['me']를 다시 읽고, 화면은 FORBIDDEN 상태를 그린다.
 */
export const adminKeys = {
  all: ['admin'] as const,
  overview: ADMIN_OVERVIEW_KEY,
  results: (view: AdminResultView) => ['admin', 'results', view] as const,
  noShow: ['admin', 'no-show'] as const,
  membersAll: ['admin', 'members'] as const,
  members: (q: { q: string; role: UserRole | null; sort: AdminMemberSort }) => ['admin', 'members', q.q, q.role ?? 'all', q.sort] as const,
  apiKeys: ['admin', 'api-keys'] as const,
  seasons: ['admin', 'seasons'] as const,
  auditAll: ['admin', 'audit'] as const,
  audit: (action: AdminAuditAction | null) => ['admin', 'audit', action ?? 'all'] as const,
};

export const ADMIN_PAGE_SIZE = 20;

const noRetryOn4xx = (count: number, err: unknown) => !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2;

/** 403이면 /me를 다시 읽게 하고 오류는 그대로 던진다 */
function guarded<T>(qc: QueryClient, fn: () => Promise<T>): Promise<T> {
  return fn().catch((e: unknown) => {
    if (isApiError(e) && e.code === 'FORBIDDEN') void qc.invalidateQueries({ queryKey: queryKeys.me, exact: true });
    throw e;
  });
}

/** 쿼리 오류가 FORBIDDEN인가(화면 분기용) */
export function isForbidden(err: unknown): boolean {
  return isApiError(err) && err.code === 'FORBIDDEN';
}

/** 결과가 바뀌는 처리(승인·반려·되돌리기) 뒤 무효화 대상(계약 S6 13절) */
export function invalidateAfterResultChange(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: scrimKeys.all });
  void qc.invalidateQueries({ queryKey: adminKeys.all });
  void qc.invalidateQueries({ queryKey: dashboardKeys.all });
  void qc.invalidateQueries({ queryKey: rankingKeys.all });
  void qc.invalidateQueries({ queryKey: gameAccountKeys.profiles });
  void qc.invalidateQueries({ queryKey: ratingKeys.seasons });
  // S6 후속(D295): 캘린더 내전 항목의 result_status·status
  void qc.invalidateQueries({ queryKey: calendarKeys.all });
}

function invalidateAfterNewsWrite(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: newsKeys.all });
  void qc.invalidateQueries({ queryKey: dashboardKeys.all });
  void qc.invalidateQueries({ queryKey: adminKeys.auditAll });
  // S6 후속(D295): 운영진 일정 = 이벤트(공지·패치노트 쓰기에도 불러도 캘린더 1회 재조회뿐이다)
  void qc.invalidateQueries({ queryKey: calendarKeys.all });
  // S6 후속(23-8-4): 「다가오는 일정」(overview.upcoming)이 일정을 싣는다
  void qc.invalidateQueries({ queryKey: adminKeys.overview });
}

// -----------------------------------------------------------------------------
// 읽기
// -----------------------------------------------------------------------------

/** GET /admin/overview */
export function useAdminOverview(enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: adminKeys.overview,
    queryFn: ({ signal }) => guarded(qc, () => getAdminOverview(signal)),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: noRetryOn4xx,
  });
}

/** GET /admin/results?view= — 커서 페이징 */
export function useAdminResults(view: AdminResultView, enabled = true) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: adminKeys.results(view),
    queryFn: ({ pageParam, signal }) => guarded(qc, () => listAdminResults({ view, cursor: pageParam, limit: ADMIN_PAGE_SIZE }, signal)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
    staleTime: 15_000,
    retry: noRetryOn4xx,
  });
}

/** GET /admin/no-show/scrims — 표시 기한 안 내전 */
export function useAdminNoShowScrims(enabled = true) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: adminKeys.noShow,
    queryFn: ({ pageParam, signal }) => guarded(qc, () => listAdminNoShowScrims({ cursor: pageParam, limit: ADMIN_PAGE_SIZE }, signal)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
    staleTime: 15_000,
    retry: noRetryOn4xx,
  });
}

/** GET /admin/members — 검색어·역할·정렬별 커서 페이징 */
export function useAdminMembers(q: { q: string; role: UserRole | null; sort: AdminMemberSort }, enabled = true) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: adminKeys.members(q),
    queryFn: ({ pageParam, signal }) =>
      guarded(qc, () =>
        listAdminMembers({ q: q.q || undefined, role: q.role ?? undefined, sort: q.sort, cursor: pageParam, limit: ADMIN_PAGE_SIZE }, signal),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
    staleTime: 15_000,
    retry: noRetryOn4xx,
  });
}

/** GET /admin/api-keys */
export function useAdminApiKeys(enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: adminKeys.apiKeys,
    queryFn: ({ signal }) => guarded(qc, () => listAdminApiKeys(signal)),
    enabled,
    retry: noRetryOn4xx,
  });
}

/** GET /admin/seasons */
export function useAdminSeasons(enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: adminKeys.seasons,
    queryFn: ({ signal }) => guarded(qc, () => listAdminSeasons(signal)),
    enabled,
    retry: noRetryOn4xx,
  });
}

/** GET /admin/audit-logs?action= */
export function useAdminAuditLogs(action: AdminAuditAction | null, enabled = true) {
  const qc = useQueryClient();
  return useInfiniteQuery({
    queryKey: adminKeys.audit(action),
    queryFn: ({ pageParam, signal }) =>
      guarded(qc, () => listAdminAuditLogs({ action: action ?? undefined, cursor: pageParam, limit: ADMIN_PAGE_SIZE }, signal)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
    retry: noRetryOn4xx,
  });
}

// -----------------------------------------------------------------------------
// 결과 처리(큐). 승인·반려는 S3 엔드포인트, 되돌리기는 S6. 성공 후 큐·overview를 다시 조회(D251)
// -----------------------------------------------------------------------------

export type ResultAction =
  | { kind: 'approve'; scrimId: string; resultId: string }
  | { kind: 'reject'; scrimId: string; resultId: string; reason: string }
  | { kind: 'revert'; scrimId: string; resultId: string; reason: string };

export function useAdminResultAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ResultAction) =>
      guarded(qc, () => {
        switch (a.kind) {
          case 'approve':
            return approveScrimResult(a.scrimId, { result_id: a.resultId });
          case 'reject':
            return rejectScrimResult(a.scrimId, { result_id: a.resultId, reason: a.reason });
          case 'revert':
            return revertScrimResult(a.scrimId, { result_id: a.resultId, reason: a.reason });
        }
      }),
    onSuccess: (d) => {
      qc.setQueryData(scrimKeys.detail(d.id), d);
      invalidateAfterResultChange(qc);
    },
    // 409(이미 처리됨 등)면 큐가 낡았다 → 다시 받는다
    onError: () => void qc.invalidateQueries({ queryKey: adminKeys.all }),
  });
}

/**
 * 노쇼 저장: 바뀐 참가자만 기존 PUT을 차례로 호출, 첫 실패에서 멈춘다(D252). 끝나면(성공·실패 모두) 후보·통계를 다시 조회.
 * 일부만 저장된 채 실패하면 failed에 남는다 — 화면은 오류와 함께 다시 받은 상태를 보여 준다.
 */
export function useSaveNoShows() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { scrimId: string; changes: NoShowChange[] }) => {
      const r = await runNoShowChanges(v.changes, (c) => guarded(qc, () => setScrimNoShow(v.scrimId, c.userId, { no_show: c.noShow })));
      if (r.failed) throw Object.assign(r.failed.error instanceof Error ? r.failed.error : new Error('no-show'), { saved: r.saved });
      return r;
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: adminKeys.noShow });
      void qc.invalidateQueries({ queryKey: adminKeys.overview });
      void qc.invalidateQueries({ queryKey: adminKeys.membersAll });
      // 내전 상세의 노쇼 처리와 같게 캘린더(내전 항목 my_status 등)도 다시 받는다
      void qc.invalidateQueries({ queryKey: calendarKeys.all });
      void qc.invalidateQueries({ queryKey: scrimKeys.detail(v.scrimId) });
      void qc.invalidateQueries({ queryKey: gameAccountKeys.profiles });
    },
  });
}

// -----------------------------------------------------------------------------
// 멤버·역할
// -----------------------------------------------------------------------------

/** PATCH /admin/members/:id/role */
export function useChangeMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; role: UserRole }) => guarded(qc, () => changeMemberRole(v.id, { role: v.role })),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.membersAll });
      void qc.invalidateQueries({ queryKey: adminKeys.overview });
      void qc.invalidateQueries({ queryKey: adminKeys.auditAll });
    },
  });
}

/** 운영진 전용 회원 삭제. 성공하면 목록·통계·감사를 다시 읽는다 */
export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => guarded(qc, () => deleteMember(id)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.membersAll });
      void qc.invalidateQueries({ queryKey: adminKeys.overview });
      void qc.invalidateQueries({ queryKey: adminKeys.auditAll });
    },
  });
}

// -----------------------------------------------------------------------------
// 공지·패치노트·이벤트
// -----------------------------------------------------------------------------

export function useCreateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateNoticeRequestInput) => guarded(qc, () => createNotice(b)),
    onSuccess: () => invalidateAfterNewsWrite(qc),
  });
}
export function useUpdateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdateNoticeRequestInput }) => guarded(qc, () => updateNotice(v.id, v.body)),
    onSettled: () => invalidateAfterNewsWrite(qc),
  });
}
export function useDeleteNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => guarded(qc, () => deleteNotice(id)),
    onSettled: () => invalidateAfterNewsWrite(qc),
  });
}

export function useCreatePatchNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreatePatchNoteRequestInput) => guarded(qc, () => createPatchNote(b)),
    onSuccess: () => invalidateAfterNewsWrite(qc),
  });
}
export function useUpdatePatchNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdatePatchNoteRequestInput }) => guarded(qc, () => updatePatchNote(v.id, v.body)),
    onSettled: () => invalidateAfterNewsWrite(qc),
  });
}
export function useDeletePatchNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => guarded(qc, () => deletePatchNote(id)),
    onSettled: () => invalidateAfterNewsWrite(qc),
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateEventRequestInput) => guarded(qc, () => createEvent(b)),
    onSuccess: () => invalidateAfterNewsWrite(qc),
  });
}
export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdateEventRequestInput }) => guarded(qc, () => updateEvent(v.id, v.body)),
    onSettled: () => invalidateAfterNewsWrite(qc),
  });
}
export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => guarded(qc, () => deleteEvent(id)),
    onSettled: () => invalidateAfterNewsWrite(qc),
  });
}

// -----------------------------------------------------------------------------
// API 키
// -----------------------------------------------------------------------------

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateApiKeyRequestInput) => guarded(qc, () => createApiKey(b)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.apiKeys });
      void qc.invalidateQueries({ queryKey: adminKeys.auditAll });
    },
  });
}
export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => guarded(qc, () => revokeApiKey(id)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.apiKeys });
      void qc.invalidateQueries({ queryKey: adminKeys.auditAll });
    },
  });
}

// -----------------------------------------------------------------------------
// 시즌(사이드바 시즌 카드·랭킹·그래프 시즌 목록도 바뀐다)
// -----------------------------------------------------------------------------

function invalidateAfterSeasonWrite(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: adminKeys.seasons });
  void qc.invalidateQueries({ queryKey: adminKeys.auditAll });
  void qc.invalidateQueries({ queryKey: ratingKeys.seasons });
  void qc.invalidateQueries({ queryKey: dashboardKeys.all });
  void qc.invalidateQueries({ queryKey: rankingKeys.all });
}

export function useCreateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CreateSeasonRequestInput) => guarded(qc, () => createSeason(b)),
    onSuccess: () => invalidateAfterSeasonWrite(qc),
  });
}
export function useUpdateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: UpdateSeasonRequestInput }) => guarded(qc, () => updateSeason(v.id, v.body)),
    onSettled: () => invalidateAfterSeasonWrite(qc),
  });
}
export function useDeleteSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => guarded(qc, () => deleteSeason(id)),
    onSettled: () => invalidateAfterSeasonWrite(qc),
  });
}
