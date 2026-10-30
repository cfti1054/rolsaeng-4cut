'use client';

import type {
  CreateScrimRequestInput,
  GameCode,
  RejectScrimResultRequestInput,
  SaveScrimTeamsRequestInput,
  ScrimDetail,
  ScrimListStatus,
  SubmitScrimResultRequest,
  UpdateScrimRequestInput,
} from '@gcd/shared';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';
import {
  approveScrimResult,
  balanceScrim,
  rejectScrimResult,
  saveScrimTeams,
  submitScrimResult,
  withdrawScrimResult,
  cancelScrim,
  createScrim,
  getMyScrimRestriction,
  getScrim,
  joinScrim,
  leaveScrim,
  listGames,
  listScrims,
  searchSteamApps,
  setScrimNoShow,
  startScrim,
  updateScrim,
} from '@/lib/api/scrims';
import { isOpenStatus } from '@/lib/scrims';
import { gameAccountKeys } from './game-accounts';
import { ratingKeys } from './ratings';

/**
 * S2 데이터 훅 11개(계약 8절) + 스팀 게임 검색(D98). 엔드포인트 하나당 훅 하나.
 * 상태를 바꾸는 응답은 모두 갱신 후 ScrimDetail(D87) → 상세 캐시를 바로 교체하고 목록 캐시만 무효화한다.
 */

export const scrimKeys = {
  games: ['games'] as const,
  all: ['scrims'] as const,
  lists: ['scrims', 'list'] as const,
  list: (q: { game?: GameCode; status: ScrimListStatus }) => ['scrims', 'list', q.game ?? 'all', q.status] as const,
  detail: (id: string) => ['scrims', 'detail', id] as const,
  restriction: ['me', 'scrim-restriction'] as const,
  steamApps: (q: string) => ['steam-apps', q.toLowerCase()] as const,
};

/** 목록 페이지 크기(3열 × 4줄) */
export const SCRIMS_PAGE_SIZE = 12;
/** 모집 중·진행 중 상세 재조회 간격(S2 계약 8절, S3 9절: playing에도 적용해 승인 대기 반영) */
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

/** 재조회 대상: 모집 중(참가 현황) + 진행 중(결과 제출·승인 대기) */
const isLiveStatus = (d: ScrimDetail | undefined) => !!d && (isOpenStatus(d.status) || d.status === 'playing');

/** GET /scrims/:id — 모집 중·진행 중이면 20초 간격 + 창 포커스 시 재조회 */
export function useScrim(id: string, enabled = true) {
  return useQuery({
    queryKey: scrimKeys.detail(id),
    queryFn: ({ signal }) => getScrim(id, signal),
    enabled,
    retry: noRetryOn4xx,
    refetchInterval: (query) => (isLiveStatus(query.state.data) ? SCRIM_DETAIL_POLL_MS : false),
    refetchOnWindowFocus: (query) => isLiveStatus(query.state.data),
  });
}

/** GET /steam-apps?q= — 같은 검색어는 5분 재사용, 입력이 바뀌는 동안 이전 결과를 보여 준다 */
export function useSteamApps(q: string, enabled = true) {
  return useQuery({
    queryKey: scrimKeys.steamApps(q),
    queryFn: ({ signal }) => searchSteamApps(q, signal),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: noRetryOn4xx,
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

/** S3 결과 승인 등으로 레이팅·최근 내전이 바뀔 때: 상세 교체 + 목록·프로필·레이팅 그래프(['users', …]) 무효화 */
export function applyScrimResultDetail(qc: QueryClient, detail: ScrimDetail): void {
  applyScrimDetail(qc, detail);
  void qc.invalidateQueries({ queryKey: gameAccountKeys.profiles });
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
    // 노쇼는 프로필 최근 내전(no_show 칩)에도 보이므로 프로필 캐시도 무효화한다
    onSuccess: (d) => applyScrimResultDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

// -----------------------------------------------------------------------------
// S3 팀 밸런스·팀 구성·결과(계약 S3 9절 훅 6개, 나머지 2개는 hooks/ratings.ts)
// -----------------------------------------------------------------------------

/**
 * POST /scrims/:id/balance — 계산만 한다. 응답은 캐시에 저장하지 않고 화면 상태로만 둔다(저장 전까지).
 * 409(팀 수정 불가·밸런스 불가)면 상세를 다시 받아 버튼 노출을 맞춘다.
 */
export function useBalanceScrim(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => balanceScrim(id),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** PUT /scrims/:id/teams — 안 선택·직접 수정 저장 */
export function useSaveScrimTeams(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveScrimTeamsRequestInput) => saveScrimTeams(id, body),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** POST /scrims/:id/result — 결과 제출 */
export function useSubmitScrimResult(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitScrimResultRequest) => submitScrimResult(id, body),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** DELETE /scrims/:id/result — 제출 취소 */
export function useWithdrawScrimResult(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => withdrawScrimResult(id),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** POST /scrims/:id/result/approve — 승인 + 레이팅 반영(운영진). 프로필·그래프 캐시도 무효화 */
export function useApproveScrimResult(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (resultId: string) => approveScrimResult(id, { result_id: resultId }),
    onSuccess: (d) => {
      applyScrimResultDetail(qc, d);
      // 승인이 시즌을 자동으로 만들 수 있다(D116) → 그래프 시즌 선택 목록도 새로 받는다
      void qc.invalidateQueries({ queryKey: ratingKeys.seasons });
    },
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}

/** POST /scrims/:id/result/reject — 반려(운영진, 사유 필수) */
export function useRejectScrimResult(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RejectScrimResultRequestInput) => rejectScrimResult(id, body),
    onSuccess: (d) => applyScrimDetail(qc, d),
    onError: (err) => handleScrimMutationError(qc, id, err),
  });
}
