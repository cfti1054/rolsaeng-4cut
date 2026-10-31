import type { ActivityPeriod, SyncQuota } from '@gcd/shared';
import { DAY_MS, KST_OFFSET_LABEL, KST_OFFSET_MS } from './config';

export function assertValidDate(d: Date, name: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RangeError(`${name}: 올바른 Date가 아님`);
  }
}

/**
 * now가 속한 KST 하루 구간 [start, end).
 * start = now의 KST 날짜 00:00:00.000(+09:00)을 가리키는 시각, end = start + 24h.
 * KST에는 일광 절약 시간이 없어 하루는 항상 24시간이다.
 */
export function kstDayWindow(now: Date): { start: Date; end: Date } {
  assertValidDate(now, 'now');
  const kstMs = now.getTime() + KST_OFFSET_MS;
  const kstDayStartMs = Math.floor(kstMs / DAY_MS) * DAY_MS;
  const startMs = kstDayStartMs - KST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/**
 * now가 속한 KST 주 구간 [start, end). start = 월요일 00:00 KST, end = start + 7일.
 * 1970-01-01(KST 일 번호 0)이 목요일이라 일 번호 + 3을 7로 나눈 나머지가 월요일부터 지난 날 수다.
 */
export function kstWeekWindow(now: Date): { start: Date; end: Date } {
  const { start: dayStart } = kstDayWindow(now);
  const kstDayNumber = (dayStart.getTime() + KST_OFFSET_MS) / DAY_MS;
  const daysSinceMonday = (((kstDayNumber + 3) % 7) + 7) % 7;
  const startMs = dayStart.getTime() - daysSinceMonday * DAY_MS;
  return { start: new Date(startMs), end: new Date(startMs + 7 * DAY_MS) };
}

/**
 * now가 속한 KST 달 구간 [start, end). start = 그 달 1일 00:00 KST, end = 다음 달 1일 00:00 KST(계약 S5 9-1).
 */
export function kstMonthWindow(now: Date): { start: Date; end: Date } {
  assertValidDate(now, 'now');
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  // Date.UTC는 월 12를 다음 해 1월로 넘긴다
  return {
    start: new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - KST_OFFSET_MS),
  };
}

/**
 * 활동 랭킹 집계 기간(계약 S5 9-1, 문서 7-3 「주간·월간」).
 * week = kstWeekWindow(월요일 시작), days 7. month = kstMonthWindow, days = 그 달 날짜 수(28–31).
 */
export function activityPeriodWindow(
  period: ActivityPeriod,
  now: Date,
): { start: Date; end: Date; days: number } {
  if (period === 'week') return { ...kstWeekWindow(now), days: 7 };
  if (period === 'month') {
    const w = kstMonthWindow(now);
    return { ...w, days: Math.round((w.end.getTime() - w.start.getTime()) / DAY_MS) };
  }
  throw new RangeError(`period: 알 수 없는 값 (${String(period)})`);
}

/** instant의 KST 날짜 `YYYY-MM-DD`(계약 S5 9-1) */
export function kstDateKey(instant: Date): string {
  assertValidDate(instant, 'instant');
  const kst = new Date(instant.getTime() + KST_OFFSET_MS);
  const y = String(kst.getUTCFullYear()).padStart(4, '0');
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * KST 자정 시각(kstDayWindow의 start/end)을 `YYYY-MM-DDT00:00:00.000+09:00`으로 표기.
 * 입력이 KST 자정이 아니면 RangeError(호출 실수 방지).
 */
export function formatKstMidnight(instant: Date): string {
  assertValidDate(instant, 'instant');
  const kstMs = instant.getTime() + KST_OFFSET_MS;
  if (kstMs % DAY_MS !== 0) {
    throw new RangeError('instant: KST 자정이 아님');
  }
  const kst = new Date(kstMs);
  const y = String(kst.getUTCFullYear()).padStart(4, '0');
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00.000${KST_OFFSET_LABEL}`;
}

function assertCount(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${name}: 0 이상의 정수여야 함 (${v})`);
  }
}

/**
 * 수동 새로고침 남은 횟수(계약 7절, D41).
 * remaining = max(0, limit − used), resets_at = 다음 KST 자정(+09:00 표기).
 * used·limit이 음수거나 정수가 아니면 RangeError.
 */
export function buildSyncQuota(used: number, limit: number, now: Date): SyncQuota {
  assertCount(used, 'used');
  assertCount(limit, 'limit');
  const { end } = kstDayWindow(now);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resets_at: formatKstMidnight(end),
  };
}
