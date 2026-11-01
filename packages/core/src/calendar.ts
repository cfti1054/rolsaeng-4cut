import {
  CalendarMonth,
  EventTime,
  IsoDate,
  type CalendarEventItem,
  type CalendarItem,
  type CalendarScrimItem,
} from '@gcd/shared';
import { DAY_MS, KST_OFFSET_MS } from './config';
import { assertValidDate, kstDateKey } from './time';

// =============================================================================
// S6 후속 커뮤니티 캘린더 구간(계약 S6 14-7·23절, D285). 날짜는 KST 달력 날짜 문자열 'YYYY-MM-DD'.
// 격자는 월요일 시작 7열: 그 달 1일이 든 주의 월요일 ~ 말일이 든 주의 일요일(28·35·42일).
// 웹 /news monthGrid(apps/web/src/lib/news.ts)와 같은 from·to를 낸다.
// =============================================================================

const formatIsoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** 형식 검사(shared CalendarMonth: 'YYYY-MM', 2000-01 ~ 2099-12). 틀리면 RangeError */
function assertCalendarMonth(month: unknown): asserts month is string {
  if (typeof month !== 'string' || !CalendarMonth.safeParse(month).success) {
    throw new RangeError(`month: 올바른 YYYY-MM 달이 아님 (${String(month)})`);
  }
}

/** UTC 자정 ms(달력 날짜)의 요일, 월 0 … 일 6 */
const weekdayMon0 = (ms: number): number => (new Date(ms).getUTCDay() + 6) % 7;

/**
 * month 'YYYY-MM'의 격자 구간.
 * first = 1일, last = 말일, from = first가 든 주의 월요일, to = last가 든 주의 일요일.
 * fromAt = from의 KST 00:00, toBefore = (to + 1일)의 KST 00:00. 내전 조회는 scheduled_at ∈ [fromAt, toBefore).
 * 형식이 틀리면 RangeError.
 */
export function calendarMonthRange(month: string): {
  first: string;
  last: string;
  from: string;
  to: string;
  fromAt: Date;
  toBefore: Date;
} {
  assertCalendarMonth(month);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1;
  const firstMs = Date.UTC(y, m, 1);
  const lastMs = Date.UTC(y, m + 1, 0);
  const fromMs = firstMs - weekdayMon0(firstMs) * DAY_MS;
  const toMs = lastMs + (6 - weekdayMon0(lastMs)) * DAY_MS;
  return {
    first: formatIsoDate(firstMs),
    last: formatIsoDate(lastMs),
    from: formatIsoDate(fromMs),
    to: formatIsoDate(toMs),
    // 달력 날짜의 UTC 자정 − 9시간 = 그 날짜의 KST 자정
    fromAt: new Date(fromMs - KST_OFFSET_MS),
    toBefore: new Date(toMs + DAY_MS - KST_OFFSET_MS),
  };
}

/** month가 있으면 형식 검사 후 그대로(틀리면 RangeError), 없으면 kstDateKey(now)의 'YYYY-MM' */
export function resolveCalendarMonth(month: string | undefined, now: Date): string {
  if (month !== undefined) {
    assertCalendarMonth(month);
    return month;
  }
  assertValidDate(now, 'now');
  return kstDateKey(now).slice(0, 7);
}

// =============================================================================
// S6 후속 일정 시각·「다가오는 일정」(계약 S6 14-7 추가·23-8, D302·D306–D308).
// 시각은 KST 벽시계 'HH:mm'(shared EventTime), null·undefined = 종일.
// =============================================================================

/** 일정 정렬 키(EventView·CalendarEventItem의 부분집합) */
export type EventScheduleKey = { id: string; starts_on: string; ends_on: string; start_time?: string | null };

/** 문자열 사전순 비교(-1·0·1). PostgreSQL uuid·date·time 정렬과 같은 순서(고정 길이 형식) */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * D302 일정 정렬(Array.sort 비교 함수): starts_on ASC → start_time ASC(null·undefined = 종일 먼저) → ends_on ASC → id ASC.
 * 서버 orderBy `[startsOn asc, startTime asc nulls first, endsOn asc, id asc]`와 같은 순서.
 * 형식 검사는 하지 않는다(값은 이미 shared 스키마를 통과한 응답·행).
 */
export function compareEventSchedule(a: EventScheduleKey, b: EventScheduleKey): number {
  const byStart = cmpStr(a.starts_on, b.starts_on);
  if (byStart !== 0) return byStart;
  const ta = a.start_time ?? null;
  const tb = b.start_time ?? null;
  if (ta !== tb) {
    if (ta === null) return -1;
    if (tb === null) return 1;
    return cmpStr(ta, tb);
  }
  const byEnd = cmpStr(a.ends_on, b.ends_on);
  if (byEnd !== 0) return byEnd;
  return cmpStr(a.id, b.id);
}

/** 일정 시작 순간 = `${startsOn}T${startTime ?? '00:00'}:00+09:00`(KST). 형식이 틀리면 RangeError */
export function eventStartsAt(startsOn: string, startTime: string | null | undefined): Date {
  if (typeof startsOn !== 'string' || !IsoDate.safeParse(startsOn).success) {
    throw new RangeError(`startsOn: 올바른 YYYY-MM-DD 날짜가 아님 (${String(startsOn)})`);
  }
  const time = startTime ?? '00:00';
  if (typeof time !== 'string' || !EventTime.safeParse(time).success) {
    throw new RangeError(`startTime: 올바른 HH:mm 시각이 아님 (${String(startTime)})`);
  }
  // 달력 날짜·벽시계를 UTC로 읽은 값 − 9시간 = 그 KST 순간
  return new Date(Date.parse(`${startsOn}T${time}:00.000Z`) - KST_OFFSET_MS);
}

/**
 * 「다가오는 일정」 구간(D307). from = kstDateKey(now), to = from + days일, scrimBefore = (to + 1일)의 KST 00:00.
 * 내전은 scheduled_at ∈ [now, scrimBefore), 일정은 ends_on ≥ from && starts_on ≤ to.
 * now가 잘못된 Date이거나 days가 0 이상 정수가 아니면 RangeError.
 */
export function upcomingWindow(now: Date, days: number): { from: string; to: string; scrimBefore: Date } {
  assertValidDate(now, 'now');
  if (!Number.isInteger(days) || days < 0) {
    throw new RangeError(`days: 0 이상 정수가 아님 (${String(days)})`);
  }
  const from = kstDateKey(now);
  const toMs = Date.parse(`${from}T00:00:00.000Z`) + days * DAY_MS;
  return {
    from,
    to: formatIsoDate(toMs),
    scrimBefore: new Date(toMs + DAY_MS - KST_OFFSET_MS),
  };
}

/** 내전 시작 순간(ms). scheduled_at이 날짜로 읽히지 않으면 RangeError */
function scrimStartMs(s: CalendarScrimItem): number {
  const ms = Date.parse(s.scheduled_at);
  if (Number.isNaN(ms)) throw new RangeError(`scheduled_at: 올바른 시각이 아님 (${String(s.scheduled_at)})`);
  return ms;
}

/**
 * 시작 순 병합(D308). 입력은 이미 정렬됨: events = compareEventSchedule 순, scrims = scheduled_at ASC·id ASC.
 * 각 최대 max + 1개를 받는다. 키: 일정 eventStartsAt(starts_on, start_time), 내전 scheduled_at.
 * 같은 순간이면 일정 먼저, 같은 종류끼리는 입력 순서(안정). 입력을 다시 정렬하지 않는다.
 * 반환 items = 앞 max개, hasMore = events.length + scrims.length > max. max가 1 이상 정수가 아니면 RangeError.
 */
export function mergeUpcomingItems(
  events: readonly CalendarEventItem[],
  scrims: readonly CalendarScrimItem[],
  max: number,
): { items: CalendarItem[]; hasMore: boolean } {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`max: 1 이상 정수가 아님 (${String(max)})`);
  }
  const items: CalendarItem[] = [];
  let i = 0;
  let j = 0;
  while (items.length < max && (i < events.length || j < scrims.length)) {
    if (j >= scrims.length) {
      items.push(events[i++]!);
    } else if (i >= events.length) {
      items.push(scrims[j++]!);
    } else {
      const e = events[i]!;
      const s = scrims[j]!;
      // 같은 순간이면 일정 먼저(≤)
      if (eventStartsAt(e.starts_on, e.start_time).getTime() <= scrimStartMs(s)) {
        items.push(e);
        i++;
      } else {
        items.push(s);
        j++;
      }
    }
  }
  return { items, hasMore: events.length + scrims.length > max };
}
