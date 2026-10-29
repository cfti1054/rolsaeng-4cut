'use client';

import type {
  CreateScrimRequestInput,
  GameCode,
  ScrimDetail,
  ScrimListStatus,
  UpdateScrimRequestInput,
} from '@gcd/shared';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';
import {
  cancelScrim,
  createScrim,
  getMyScrimRestriction,
  getScrim,
  joinScrim,
  leaveScrim,
  listGames,
  listScrims,
  setScrimNoShow,
  startScrim,
  updateScrim,
} from '@/lib/api/scrims';
import { isOpenStatus } from '@/lib/scrims';

/**
 * S2 데이터 훅 11개(계약 8절). 엔드포인트 하나당 훅 하나.
 * 상태를 바꾸는 응답은 모두 갱신 후 ScrimDetail(D87) → 상세 캐시를 바로 교체하고 목록 캐시만 무효화한다.
 */

export const scrimKeys = {
  games: ['games'] as const,
  all: ['scrims'] as const,
  lists: ['scrims', 'list'] as const,
  list: (q: { game?: GameCode; status: ScrimListStatus }) => ['scrims', 'list', q.game ?? 'all', q.status] as const,
  detail: (id: string) => ['scrims', 'detail', id] as const,
  restriction: ['me', 'scrim-restriction'] as const,
};

/** 목록 페이지 크기(3열 × 4줄) */
export const SCRIMS_PAGE_SIZE = 12;
/** 모집 중 상세 재조회 간격(계약 8절) */
export const SCRIM_DETAIL_POLL_MS = 20_000;

const noRetryOn4xx = (count: number, err: unknown) =>
  !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2;

/** GET /games — 거의 바뀌지 않는 데이터 */
export function useGames() {
  return useQuery({
    queryKey: scrimKeys.games,
    queryFn: ({ signal }) => listGames(signal),
    staleTime: 10 * 60_000,
    retry: noRetryOn4xx,
  });
}

/** GET /scrims — 커서 페이징(「더 보기」) */
export function useScrims(q: { game?: GameCode; status: ScrimListStatus }) {
  return useInfiniteQuery({
    queryKey: scrimKeys.list(q),
    queryFn: ({ pageParam, signal }) =>
      listScrims({ game: q.game, status: q.status, cursor: pageParam, limit: SCRIMS_PAGE_SIZE }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    retry: noRetryOn4xx,
    staleTime: 15_000,
  });
}

/** GET /scrims/:id — 모집 중이면 20초 간격 + 창 포커스 시 재조회 */
export function useScrim(id: string, enabled = true) {
  return useQuery({
    queryKey: scrimKeys.detail(id),
    queryFn: ({ signal }) => getScrim(id, signal),
    enabled,
    retry: noRetryOn4xx,
    refetchInterval: (query) => (query.state.data && isOpenStatus(query.state.data.status) ? SCRIM_DETAIL_POLL_MS : false),
    refetchOnWindowFocus: (query) => !!query.state.data && isOpenStatus(query.state.data.status),
  });
}

/** GET /me/scrim-restriction */
export function useMyScrimRestriction() {
  return useQuery({
    queryKey: scrimKeys.restriction,
    queryFn: ({ signal }) => getMyScrimRestriction(signal),
    staleTime: 60_000,
    retry: noRetryOn4xx,
  });
}

/** 상태 변경 응답(ScrimDetail)을 상세 캐시에 넣고 목록을 무효화한다 */
export function applyScrimDetail(qc: QueryClient, detail: ScrimDetail): void {
  qc.setQueryData(scrimKeys.detail(detail.id), detail);
  void qc.invalidateQueries({ queryKey: scrimKeys.lists });
}

/**
 * 상태 변경 실패 공통 처리.
 * - SCRIM_BANNED: 해제 시각을 다시 받아 온다(계약 2절)
 * - 409·404·403: 화면이 서버와 달라졌을 수 있으니 상세를 다시 조회
 */
export function handleScrimMutationError(qc: QueryClient, id: string | null, err: unknown): void {
  if (!isApiError(err)) return;
  if (err.code === 'SCRIM_BANNED') void qc.invalidateQueries({ queryKey: scrimKeys.restriction });
  if (id && [403, 404, 409].includes(err.status)) {
    void qc.invalidateQueries({ queryKey: scrimKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: scrimKeys.lists });
  }
}

/** POST /scrims */
export function useCreateScrim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateScrimRequestInput) => createScrim(body),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, null, err),
  });
}

/** PATCH /scrims/:id */
export function useUpdateScrim(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateScrimRequestInput) => updateScrim(id, body),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** POST /scrims/:id/join — 참가·대기 등록·희망 포지션 변경 */
export function useJoinScrim(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferred_positions: string[]) => joinScrim(id, { preferred_positions }),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** DELETE /scrims/:id/join */
export function useLeaveScrim(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => leaveScrim(id),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** POST /scrims/:id/start */
export function useStartScrim(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => startScrim(id),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** POST /scrims/:id/cancel */
export function useCancelScrim(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelScrim(id),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** PUT /scrims/:id/players/:userId/no-show (운영진) */
export function useSetScrimNoShow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; noShow: boolean }) => setScrimNoShow(id, v.userId, { no_show: v.noShow }),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}
