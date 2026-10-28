'use client';

import type { DevLoginRequest, Me, UpdateMeRequest } from '@gcd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { devLogin, getMe, logout, refreshToken, updateMe } from '@/lib/api/auth';
import { isApiError } from '@/lib/api/client';

export const queryKeys = {
  me: ['me'] as const,
};

/** GET /me. 토큰이 없으면 클라이언트가 먼저 refresh로 부팅한다. 인증 오류는 재시도하지 않는다. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    staleTime: 60_000,
    retry: (count, err) => !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2,
  });
}

/** PATCH /me */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMeRequest) => updateMe(body),
    onSuccess: (me) => qc.setQueryData<Me>(queryKeys.me, me),
  });
}

/** POST /auth/refresh (보통은 클라이언트가 알아서 부른다. 명시적으로 세션을 다시 받을 때) */
export function useRefreshToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: refreshToken,
    onSuccess: (res) => qc.setQueryData<Me>(queryKeys.me, res.user),
  });
}

/** POST /auth/logout → 캐시 비움. 이동은 호출한 쪽이 한다(/login). */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => qc.clear(),
  });
}

/** POST /auth/dev-login (NEXT_PUBLIC_AUTH_DEV_LOGIN=true일 때만 화면에 노출) */
export function useDevLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DevLoginRequest) => devLogin(body),
    onSuccess: (res) => qc.setQueryData<Me>(queryKeys.me, res.user),
  });
}
