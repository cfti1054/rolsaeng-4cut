'use client';

import type { GameCode } from '@gcd/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';
import { listEvents, listNotices, listPatchNotes } from '@/lib/api/news';

/**
 * S6 정보 훅 3개(계약 S6 13절). 쿼리 키는 ['news', …] — 운영진 쓰기 성공 후 ['news'] 하나로 모두 무효화한다.
 */
export const newsKeys = {
  all: ['news'] as const,
  notices: (limit: number) => ['news', 'notices', limit] as const,
  patchNotes: (game: GameCode | null, limit: number) => ['news', 'patch-notes', game ?? 'all', limit] as const,
  events: (q: { from: string; to: string; game: GameCode | null }) => ['news', 'events', q.from, q.to, q.game ?? 'all'] as const,
};

const noRetryOn4xx = (count: number, err: unknown) => !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2;

/** GET /notices — 커서 페이징(「더 보기」) */
export function useNotices(limit: number) {
  return useInfiniteQuery({
    queryKey: newsKeys.notices(limit),
    queryFn: ({ pageParam, signal }) => listNotices({ cursor: pageParam, limit }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 60_000,
    retry: noRetryOn4xx,
  });
}

/** GET /patch-notes?game= — 게임 칩을 바꾸는 동안 이전 목록을 보여 준다 */
export function usePatchNotes(game: GameCode | null, limit: number) {
  return useInfiniteQuery({
    queryKey: newsKeys.patchNotes(game, limit),
    queryFn: ({ pageParam, signal }) => listPatchNotes({ game: game ?? undefined, cursor: pageParam, limit }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: noRetryOn4xx,
  });
}

/**
 * GET /events?from=&to=&game= — 캘린더 한 화면·관리 목록 구간(EVENTS_RANGE_MAX_DAYS 안).
 * 한 구간의 이벤트를 모두 그려야 하므로 next_cursor가 없을 때까지 이어 받아 한 응답으로 합친다(limit = 페이지 크기).
 */
export function useEvents(q: { from: string; to: string; game: GameCode | null; limit: number }) {
  return useQuery({
    queryKey: newsKeys.events(q),
    queryFn: async ({ signal }) => {
      const first = await listEvents({ from: q.from, to: q.to, game: q.game ?? undefined, limit: q.limit }, signal);
      const items = [...first.items];
      let cursor = first.next_cursor;
      while (cursor) {
        const page = await listEvents({ from: q.from, to: q.to, game: q.game ?? undefined, limit: q.limit, cursor }, signal);
        items.push(...page.items);
        cursor = page.next_cursor;
      }
      return { ...first, items, next_cursor: null };
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: noRetryOn4xx,
  });
}
