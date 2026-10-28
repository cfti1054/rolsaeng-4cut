import { z } from 'zod';

export const PAGE_LIMIT_DEFAULT = 20;
export const PAGE_LIMIT_MAX = 100;

/**
 * 목록 요청 공통 쿼리. 문서 6장: cursor, limit.
 * - cursor: 직전 응답의 next_cursor를 그대로 넘긴다. 클라이언트는 내용을 해석하지 않는다(서버가 만든 불투명 문자열).
 * - limit: 1~100, 기본 20. 100 초과는 VALIDATION_FAILED(잘라내지 않는다).
 * 목록 엔드포인트의 Query 스키마는 `PaginationQuery.extend({...})`로 만든다.
 */
export const PaginationQuery = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

/** 목록 응답 형태: `{ items: [...], next_cursor: string | null }`. 마지막 페이지면 next_cursor는 null. */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    next_cursor: z.string().nullable(),
  });
}

export type Paginated<T> = {
  items: T[];
  next_cursor: string | null;
};
