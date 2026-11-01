/**
 * `@db.Date` 컬럼 변환(계약 S6 8-1, D254). KST 달력 날짜를 날짜 그대로 저장한다 — 시간대 변환을 하지 않는다.
 * 쓰기: 'YYYY-MM-DD' → UTC 자정 Date. 읽기: Date → toISOString 앞 10자.
 */
export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * `@db.Time(0)` 컬럼 변환(계약 S6 23-8-2, D299). KST 벽시계 `HH:mm`을 그대로 저장한다 — 시간대 변환을 하지 않는다.
 * 쓰기: 'HH:mm' → 1970-01-01 UTC의 그 시각 Date. 읽기: Date → toISOString 11–16자(null은 null).
 */
export function toDbTime(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00.000Z`);
}

export function fromDbTime(d: Date | null): string | null {
  return d === null ? null : d.toISOString().slice(11, 16);
}
