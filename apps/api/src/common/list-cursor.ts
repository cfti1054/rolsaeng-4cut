import { z } from 'zod';
import { AppError } from './app-error';

/**
 * S6 목록 커서(계약 S6 4·8-2절): base64url(JSON { k: 목록 종류, v: [정렬 키…, id] }). 클라이언트에는 불투명 문자열.
 * 기존 scrim-cursor.ts와 같은 방식이다. 해석 실패·다른 목록(k)의 커서 → VALIDATION_FAILED(path `cursor`).
 * 정렬 키 값은 문자열(ISO 시각·날짜·id)·정수(오프셋), 또는 nullable 정렬 키의 null(S6 후속 events2의 start_time, D302).
 */
const Payload = z
  .object({ k: z.string().min(1).max(64), v: z.array(z.union([z.string().max(200), z.number().int(), z.null()])).max(8) })
  .strict();

export type CursorValue = string | number | null;

export function encodeListCursor(kind: string, values: readonly CursorValue[]): string {
  return Buffer.from(JSON.stringify({ k: kind, v: values })).toString('base64url');
}

export function invalidCursor(message = 'cursor: 해석할 수 없는 값'): AppError {
  return new AppError('VALIDATION_FAILED', undefined, { details: [{ path: 'cursor', message }] });
}

/** kind가 다르거나 값 개수가 arity와 다르면 VALIDATION_FAILED */
export function decodeListCursor(raw: string, kind: string, arity: number): CursorValue[] {
  let json: unknown;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('base64url 아님');
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const p = Payload.safeParse(json);
  if (!p.success) throw invalidCursor();
  if (p.data.k !== kind) throw invalidCursor('cursor: 다른 목록의 커서');
  if (p.data.v.length !== arity) throw invalidCursor();
  return p.data.v;
}

/** 커서 값 → Date(ISO 시각). 형식이 틀리면 VALIDATION_FAILED */
export function cursorDate(v: CursorValue | undefined): Date {
  if (typeof v !== 'string') throw invalidCursor();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw invalidCursor();
  return d;
}

/** 커서 값 → uuid 문자열 */
export function cursorId(v: CursorValue | undefined): string {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw invalidCursor();
  return v;
}

/** limit + 1행을 읽은 결과에서 페이지와 다음 커서 */
export function pageOf<T>(rows: T[], limit: number, cursorOf: (last: T) => string): { items: T[]; next_cursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, next_cursor: rows.length > limit && last !== undefined ? cursorOf(last) : null };
}
