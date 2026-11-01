'use client';

import type { GameCode } from '@gcd/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getCalendar } from '@/lib/api/calendar';
import { isApiError } from '@/lib/api/client';

/**
 * S6 후속 커뮤니티 캘린더 훅(계약 S6 23-6·13절, D295). 쿼리 키 ['calendar', month, game|'all'].
 * 이벤트 쓰기(hooks/admin.ts)와 내전 상태 변경(hooks/scrims.ts) 뒤 ['calendar'] 하나로 모두 무효화한다.
 * 이 파일은 다른 훅 파일을 import하지 않는다(admin·scrims가 이 키를 쓰므로 순환을 막는다).
 */
export const calendarKeys = {
  all: ['calendar'] as const,
  month: (month: string, game: GameCode | null) => ['calendar', month, game ?? 'all'] as const,
};

/**
 * 관리자 운영 요약 키(hooks/admin.ts adminKeys.overview와 같은 값). 「다가오는 일정」(AdminOverview.upcoming, 23-8-4)이
 * 일정·내전을 싣기 때문에 내전 상태 변경(hooks/scrims.ts) 뒤에도 무효화한다 — scrims.ts가 hooks/admin을 import하지 않도록 여기 둔다.
 */
export const ADMIN_OVERVIEW_KEY = ['admin', 'overview'] as const;

const noRetryOn4xx = (count: number, err: unknown) => !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2;

/** GET /calendar?month=&game= — 달·게임을 바꾸는 동안 이전 달을 보여 준다(keepPreviousData) */
export function useCalendar(q: { month: string; game: GameCode | null }) {
  return useQuery({
    queryKey: calendarKeys.month(q.month, q.game),
    queryFn: ({ signal }) => getCalendar({ month: q.month, game: q.game ?? undefined }, signal),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: noRetryOn4xx,
  });
}
