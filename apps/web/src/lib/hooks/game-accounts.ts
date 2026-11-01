'use client';

import type {
  GetMyGameAccountsResponse,
  GetUserProfileResponse,
  LinkGameAccountRequestInput,
  SetPrimaryGameAccountResponse,
} from '@gcd/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  cancelRiotVerification,
  confirmRiotVerification,
  getMyGameAccounts,
  getUserProfile,
  linkGameAccount,
  setPrimaryGameAccount,
  syncGameAccount,
  unlinkGameAccount,
} from '@/lib/api/game-accounts';
import { isApiError } from '@/lib/api/client';
import { applyPrimary, nextPollInterval } from '@/lib/game-accounts';

/**
 * S1 데이터 훅 8개(계약 12절). 엔드포인트 하나당 훅 하나.
 * 폴링 규칙(계약 6-1): sync.state ≠ idle인 계정이 있으면 2초 간격, 최대 60초.
 */

export const gameAccountKeys = {
  mine: ['me', 'game-accounts'] as const,
  profiles: ['users'] as const,
  profile: (id: string) => ['users', id, 'profile'] as const,
};

const noRetryOn4xx = (count: number, err: unknown) =>
  !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2;

/** GET /me/game-accounts */
export function useMyGameAccounts() {
  const pendingSince = useRef<number | null>(null);
  return useQuery({
    queryKey: gameAccountKeys.mine,
    queryFn: ({ signal }) => getMyGameAccounts(signal),
    retry: noRetryOn4xx,
    refetchInterval: (query) => {
      const [interval, since] = nextPollInterval(query.state.data?.accounts, pendingSince.current, Date.now());
      pendingSince.current = since;
      return interval;
    },
  });
}

/** GET /users/:id/profile. refresh_queued면 10초 뒤 1회 다시 조회(계약 12절) */
export function useUserProfile(id: string, enabled = true) {
  const pendingSince = useRef<number | null>(null);
  const query = useQuery({
    queryKey: gameAccountKeys.profile(id),
    queryFn: ({ signal }) => getUserProfile(id, signal),
    enabled,
    retry: noRetryOn4xx,
    refetchInterval: (q) => {
      const [interval, since] = nextPollInterval(q.state.data?.game_accounts, pendingSince.current, Date.now());
      pendingSince.current = since;
      return interval;
    },
  });

  const refreshQueued = query.data?.recent_matches?.refresh_queued === true;
  const refetchedFor = useRef<string | null>(null);
  const { refetch } = query;
  useEffect(() => {
    if (!refreshQueued || refetchedFor.current === id) return;
    refetchedFor.current = id;
    const t = setTimeout(() => void refetch(), 10_000);
    return () => clearTimeout(t);
  }, [refreshQueued, id, refetch]);

  return query;
}

/** POST /me/game-accounts. riot이면 진행 중 확인을 캐시에 바로 넣는다. steam이면 호출한 쪽이 authorize_url로 이동 */
export function useLinkGameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LinkGameAccountRequestInput) => linkGameAccount(body),
    onSuccess: (res) => {
      if (res.provider === 'riot') {
        qc.setQueryData<GetMyGameAccountsResponse>(gameAccountKeys.mine, (old) =>
          old ? { ...old, riot_verification: res.verification } : old,
        );
      }
    },
    onError: (err) => {
      // 한도·이미 연동은 목록이 화면과 달라졌을 수 있다
      if (isApiError(err) && err.status === 409) void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
    },
  });
}

/** POST …/riot-verifications/:id/confirm */
export function useConfirmRiotVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => confirmRiotVerification(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
      void qc.invalidateQueries({ queryKey: gameAccountKeys.profiles });
    },
    onError: (err) => {
      if (!isApiError(err)) return;
      // 시간 초과·이미 처리됨(다른 탭) → 서버 상태로 다시 그린다
      if (['OWNERSHIP_CHECK_EXPIRED', 'NOT_FOUND', 'GAME_ACCOUNT_LIMIT_REACHED', 'GAME_ACCOUNT_ALREADY_LINKED'].includes(err.code)) {
        void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
      }
    },
  });
}

/** DELETE …/riot-verifications/:id */
export function useCancelRiotVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelRiotVerification(id),
    onSuccess: () => {
      qc.setQueryData<GetMyGameAccountsResponse>(gameAccountKeys.mine, (old) =>
        old ? { ...old, riot_verification: null } : old,
      );
      void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
    },
  });
}

/** DELETE /me/game-accounts/:id */
export function useUnlinkGameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlinkGameAccount(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
      void qc.invalidateQueries({ queryKey: gameAccountKeys.profiles });
    },
  });
}

type PrimaryContext = { previous: GetMyGameAccountsResponse | undefined };

/**
 * 대표 지정 뮤테이션 옵션(낙관적 갱신 + 실패 시 롤백). 훅과 단위 테스트가 같은 옵션을 쓴다.
 */
export function setPrimaryMutationOptions(
  qc: QueryClient,
  mutate: (id: string) => Promise<SetPrimaryGameAccountResponse> = setPrimaryGameAccount,
): MutationOptions<SetPrimaryGameAccountResponse, unknown, string, PrimaryContext> {
  return {
    mutationFn: mutate,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: gameAccountKeys.mine });
      const previous = qc.getQueryData<GetMyGameAccountsResponse>(gameAccountKeys.mine);
      if (previous) qc.setQueryData<GetMyGameAccountsResponse>(gameAccountKeys.mine, applyPrimary(previous, id));
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(gameAccountKeys.mine, ctx.previous);
    },
    onSuccess: (res) => {
      qc.setQueryData<GetMyGameAccountsResponse>(gameAccountKeys.mine, (old) =>
        old ? { ...old, accounts: res.accounts } : old,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: gameAccountKeys.profiles });
    },
  };
}

/** POST /me/game-accounts/:id/primary — 낙관적 갱신, 실패하면 이전 목록으로 되돌린다 */
export function useSetPrimaryGameAccount() {
  const qc = useQueryClient();
  return useMutation(setPrimaryMutationOptions(qc));
}

/** POST /me/game-accounts/:id/sync — 202 응답의 계정·남은 횟수를 캐시에 반영(이후 폴링) */
export function useSyncGameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => syncGameAccount(id),
    onSuccess: (res) => {
      qc.setQueryData<GetMyGameAccountsResponse>(gameAccountKeys.mine, (old) =>
        old ? { ...old, accounts: res.accounts, sync_quota: res.sync_quota } : old,
      );
      // 범위를 프로필 키(['users', id, 'profile'])로만 좁힌다 — 같은 ['users'] 아래 레이팅 그래프 캐시를 건드리지 않게
      qc.setQueriesData<GetUserProfileResponse>({ queryKey: gameAccountKeys.profiles, predicate: (q) => q.queryKey[2] === 'profile' }, (old) =>
        old?.is_self ? { ...old, game_accounts: res.accounts, sync_quota: res.sync_quota } : old,
      );
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'SYNC_LIMIT_EXCEEDED') {
        void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
        void qc.invalidateQueries({ queryKey: gameAccountKeys.profiles });
      }
    },
  });
}
