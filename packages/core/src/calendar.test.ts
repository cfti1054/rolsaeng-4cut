import { describe, expect, it } from 'vitest';
import type { CalendarEventItem, CalendarScrimItem } from '@gcd/shared';
import {
  DAY_MS,
  calendarMonthRange,
  compareEventSchedule,
  eventStartsAt,
  mergeUpcomingItems,
  resolveCalendarMonth,
  upcomingWindow,
  type EventScheduleKey,
} from './index';

/** 'YYYY-MM-DD' 두 날짜 사이 일수(양끝 포함) */
const spanDays = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS + 1;
/** 요일(월 0 … 일 6) */
const weekday = (d: string): number => (new Date(`${d}T00:00:00.000Z`).getUTCDay() + 6) % 7;

describe('calendarMonthRange (14-7, 월요일 시작 격자)', () => {
  it('2026-11: 10-26(월) ~ 12-06(일), 42일', () => {
    const r = calendarMonthRange('2026-11');
    expect(r).toMatchObject({ first: '2026-11-01', last: '2026-11-30', from: '2026-10-26', to: '2026-12-06' });
    expect(spanDays(r.from, r.to)).toBe(42);
  });

  it('fromAt·toBefore = KST 자정(UTC 전날 15:00)', () => {
    const r = calendarMonthRange('2026-11');
    expect(r.fromAt.toISOString()).toBe('2026-10-25T15:00:00.000Z');
    expect(r.fromAt.getTime()).toBe(Date.parse('2026-10-26T00:00:00+09:00'));
    expect(r.toBefore.toISOString()).toBe('2026-12-06T15:00:00.000Z');
    expect(r.toBefore.getTime()).toBe(Date.parse('2026-12-07T00:00:00+09:00'));
    // 반열림 [fromAt, toBefore) 길이 = 격자 일수
    expect((r.toBefore.getTime() - r.fromAt.getTime()) / DAY_MS).toBe(42);
  });

  it('1일이 월요일이고 말일이 일요일인 평년 2월(2027-02): 정확히 28일', () => {
    const r = calendarMonthRange('2027-02');
    expect(r).toMatchObject({ first: '2027-02-01', last: '2027-02-28', from: '2027-02-01', to: '2027-02-28' });
    expect(spanDays(r.from, r.to)).toBe(28);
    expect(r.fromAt.toISOString()).toBe('2027-01-31T15:00:00.000Z');
    expect(r.toBefore.toISOString()).toBe('2027-02-28T15:00:00.000Z');
  });

  it('1일이 월요일인 달(2026-06): from = 1일', () => {
    const r = calendarMonthRange('2026-06');
    expect(r.from).toBe('2026-06-01');
    expect(r.to).toBe('2026-07-05');
    expect(spanDays(r.from, r.to)).toBe(35);
  });

  it('말일이 일요일인 달(2026-05, 31일 일): to = 말일', () => {
    const r = calendarMonthRange('2026-05');
    expect(r).toMatchObject({ first: '2026-05-01', last: '2026-05-31', from: '2026-04-27', to: '2026-05-31' });
    expect(spanDays(r.from, r.to)).toBe(35);
  });

  it('연 넘김: 2026-12 → to 2027-01-03, 2027-01 → from 2026-12-28', () => {
    const dec = calendarMonthRange('2026-12');
    expect(dec).toMatchObject({ first: '2026-12-01', last: '2026-12-31', from: '2026-11-30', to: '2027-01-03' });
    expect(dec.toBefore.toISOString()).toBe('2027-01-03T15:00:00.000Z');
    const jan = calendarMonthRange('2027-01');
    expect(jan).toMatchObject({ first: '2027-01-01', from: '2026-12-28', to: '2027-01-31' });
    expect(jan.fromAt.toISOString()).toBe('2026-12-27T15:00:00.000Z');
  });

  it('윤년 2028-02: 말일 29일(화), 2월 29일이 든 주 일요일까지', () => {
    const r = calendarMonthRange('2028-02');
    expect(r).toMatchObject({ first: '2028-02-01', last: '2028-02-29', from: '2028-01-31', to: '2028-03-05' });
    expect(spanDays(r.from, r.to)).toBe(35);
    // 평년 2월은 28일
    expect(calendarMonthRange('2026-02').last).toBe('2026-02-28');
    // 2000년은 400의 배수라 윤년, 2100은 범위 밖
    expect(calendarMonthRange('2000-02').last).toBe('2000-02-29');
  });

  it('42일 격자(1일 일요일 + 31일): 2026-03', () => {
    const r = calendarMonthRange('2026-03');
    expect(r).toMatchObject({ from: '2026-02-23', to: '2026-04-05' });
    expect(spanDays(r.from, r.to)).toBe(42);
  });

  it('2000-01 ~ 2099-12 전부: 월요일 시작·일요일 끝, 28·35·42일, 1일·말일 포함, 6일 이내 여백', () => {
    const lengths = new Set<number>();
    for (let y = 2000; y <= 2099; y += 1) {
      for (let m = 1; m <= 12; m += 1) {
        const month = `${y}-${String(m).padStart(2, '0')}`;
        const r = calendarMonthRange(month);
        expect(weekday(r.from)).toBe(0);
        expect(weekday(r.to)).toBe(6);
        expect(r.first).toBe(`${month}-01`);
        expect(r.last.slice(0, 7)).toBe(month);
        expect(r.from <= r.first && r.last <= r.to).toBe(true);
        expect(spanDays(r.from, r.first)).toBeLessThanOrEqual(7);
        expect(spanDays(r.last, r.to)).toBeLessThanOrEqual(7);
        const n = spanDays(r.from, r.to);
        expect([28, 35, 42]).toContain(n);
        lengths.add(n);
        expect(r.fromAt.getTime()).toBe(Date.parse(`${r.from}T00:00:00+09:00`));
        expect(r.toBefore.getTime()).toBe(Date.parse(`${r.to}T00:00:00+09:00`) + DAY_MS);
      }
    }
    expect([...lengths].sort()).toEqual([28, 35, 42]);
  });

  it('형식 오류 → RangeError', () => {
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '2026-11-01', '2026/11', '', ' 2026-11', '1999-12', '2100-01']) {
      expect(() => calendarMonthRange(bad), bad).toThrow(RangeError);
    }
    expect(() => calendarMonthRange(undefined as unknown as string)).toThrow(RangeError);
    expect(() => calendarMonthRange(202611 as unknown as string)).toThrow(RangeError);
  });
});

describe('resolveCalendarMonth (14-7)', () => {
  const now = new Date('2026-10-31T15:00:00.000Z'); // = 2026-11-01 00:00 KST

  it('month 생략: KST 자정 경계', () => {
    expect(resolveCalendarMonth(undefined, now)).toBe('2026-11');
    expect(resolveCalendarMonth(undefined, new Date('2026-10-31T14:59:59.999Z'))).toBe('2026-10');
    // 연 넘김(KST 1월 1일 0시 = UTC 12-31 15:00)
    expect(resolveCalendarMonth(undefined, new Date('2026-12-31T15:00:00.000Z'))).toBe('2027-01');
    expect(resolveCalendarMonth(undefined, new Date('2026-12-31T14:59:59.999Z'))).toBe('2026-12');
  });

  it('month가 있으면 now와 무관하게 그대로', () => {
    expect(resolveCalendarMonth('2027-02', now)).toBe('2027-02');
    expect(resolveCalendarMonth('2000-01', now)).toBe('2000-01');
  });

  it('형식 오류 month → RangeError(빈 문자열도 생략으로 보지 않음)', () => {
    for (const bad of ['2026-13', '2026-1', '', '2026-11-01']) {
      expect(() => resolveCalendarMonth(bad, now), bad).toThrow(RangeError);
    }
  });

  it('month 생략 + 잘못된 now → RangeError', () => {
    expect(() => resolveCalendarMonth(undefined, new Date(Number.NaN))).toThrow(RangeError);
  });

  it('calendarMonthRange와 이어 쓰기(23-3 1단계)', () => {
    const r = calendarMonthRange(resolveCalendarMonth(undefined, now));
    expect([r.from, r.to]).toEqual(['2026-10-26', '2026-12-06']);
  });
});

// =============================================================================
// 14-7 추가(23-8, D302·D306–D308): 일정 시각 정렬·시작 순간·「다가오는 일정」 구간·병합
// =============================================================================

const key = (id: string, starts_on: string, start_time?: string | null, ends_on = starts_on): EventScheduleKey =>
  start_time === undefined ? { id, starts_on, ends_on } : { id, starts_on, ends_on, start_time };
const ids = (xs: readonly { id: string }[]): string[] => xs.map((x) => x.id);

describe('compareEventSchedule (D302: starts_on, start_time NULLS FIRST, ends_on, id)', () => {
  it('같은 날 종일 < 08:00 < 21:00', () => {
    const xs = [key('c', '2026-11-08', '21:00'), key('b', '2026-11-08', '08:00'), key('a', '2026-11-08', null)];
    expect(ids([...xs].sort(compareEventSchedule))).toEqual(['a', 'b', 'c']);
    expect(compareEventSchedule(key('x', '2026-11-08', null), key('y', '2026-11-08', '00:00'))).toBeLessThan(0);
    expect(compareEventSchedule(key('y', '2026-11-08', '00:00'), key('x', '2026-11-08', null))).toBeGreaterThan(0);
  });

  it('start_time 생략(undefined)은 null(종일)과 같다', () => {
    const a = key('1', '2026-11-08', undefined);
    const b = key('1', '2026-11-08', null);
    expect('start_time' in a).toBe(false);
    expect(compareEventSchedule(a, b)).toBe(0);
    expect(compareEventSchedule(b, a)).toBe(0);
    // 같은 종일이면 id로 가른다
    expect(compareEventSchedule(key('a', '2026-11-08'), key('b', '2026-11-08', null))).toBeLessThan(0);
  });

  it('앞 날짜가 시각과 무관하게 먼저(월·연 넘김 포함)', () => {
    expect(compareEventSchedule(key('z', '2026-11-07', '23:59'), key('a', '2026-11-08', null))).toBeLessThan(0);
    expect(compareEventSchedule(key('z', '2026-11-30', '23:59'), key('a', '2026-12-01', '00:00'))).toBeLessThan(0);
    expect(compareEventSchedule(key('a', '2027-01-01', null), key('z', '2026-12-31', '23:59'))).toBeGreaterThan(0);
  });

  it('같은 시작(날짜·시각)이면 ends_on, 그다음 id', () => {
    const xs = [
      key('d', '2026-11-08', '21:00', '2026-11-10'),
      key('c', '2026-11-08', '21:00', '2026-11-08'),
      key('b', '2026-11-08', '21:00', '2026-11-09'),
      key('a', '2026-11-08', '21:00', '2026-11-10'),
    ];
    expect(ids([...xs].sort(compareEventSchedule))).toEqual(['c', 'b', 'a', 'd']);
    // 종일끼리도 ends_on → id
    expect(compareEventSchedule(key('z', '2026-11-08', null, '2026-11-08'), key('a', '2026-11-08', null, '2026-11-09'))).toBeLessThan(0);
    expect(compareEventSchedule(key('a', '2026-11-08', '10:00', '2026-11-09'), key('a', '2026-11-08', '10:00', '2026-11-09'))).toBe(0);
  });

  it('ends_on보다 start_time이 먼저 본다(종일 여러 날 < 시각 있는 하루)', () => {
    expect(compareEventSchedule(key('z', '2026-11-08', null, '2026-11-12'), key('a', '2026-11-08', '00:00', '2026-11-08'))).toBeLessThan(0);
  });

  it('id는 문자열 비교(uuid 소문자)', () => {
    const u1 = '0a0e0000-0000-4000-8000-000000000000';
    const u2 = 'a00e0000-0000-4000-8000-000000000000';
    expect(compareEventSchedule(key(u1, '2026-11-08'), key(u2, '2026-11-08'))).toBeLessThan(0);
  });
});

describe('eventStartsAt (KST 벽시계 → 순간)', () => {
  it("('2026-11-08', '21:00') = 2026-11-08T12:00:00.000Z", () => {
    expect(eventStartsAt('2026-11-08', '21:00').toISOString()).toBe('2026-11-08T12:00:00.000Z');
  });

  it('null·undefined(종일) = 그 날 KST 00:00 = 전날 15:00Z', () => {
    expect(eventStartsAt('2026-11-08', null).toISOString()).toBe('2026-11-07T15:00:00.000Z');
    expect(eventStartsAt('2026-11-08', undefined).toISOString()).toBe('2026-11-07T15:00:00.000Z');
    // 연 넘김
    expect(eventStartsAt('2027-01-01', null).toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('KST 경계: 08:59 → 전날 23:59Z, 09:00 → 그날 00:00Z, 23:59 → 그날 14:59Z', () => {
    expect(eventStartsAt('2026-11-08', '08:59').toISOString()).toBe('2026-11-07T23:59:00.000Z');
    expect(eventStartsAt('2026-11-08', '09:00').toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(eventStartsAt('2026-11-08', '23:59').toISOString()).toBe('2026-11-08T14:59:00.000Z');
    expect(eventStartsAt('2026-11-08', '00:00').getTime()).toBe(eventStartsAt('2026-11-08', null).getTime());
  });

  it('형식 오류 → RangeError', () => {
    for (const bad of ['2026-11-8', '2026-02-30', '2026/11/08', '', '2026-11-08T00:00']) {
      expect(() => eventStartsAt(bad, '21:00'), bad).toThrow(RangeError);
    }
    for (const bad of ['24:00', '9:00', '21:00:00', '21:60', '', ' 21:00']) {
      expect(() => eventStartsAt('2026-11-08', bad), bad).toThrow(RangeError);
    }
    expect(() => eventStartsAt(undefined as unknown as string, null)).toThrow(RangeError);
  });
});

describe('upcomingWindow (D307: 오늘 KST ~ +days일)', () => {
  it('now 2026-10-31T15:00Z(KST 11-01 00:00), 30일 → 11-01 ~ 12-01, scrimBefore 12-01T15:00Z', () => {
    const w = upcomingWindow(new Date('2026-10-31T15:00:00.000Z'), 30);
    expect(w.from).toBe('2026-11-01');
    expect(w.to).toBe('2026-12-01');
    expect(w.scrimBefore.toISOString()).toBe('2026-12-01T15:00:00.000Z');
  });

  it('KST 자정 직전은 아직 전날', () => {
    const w = upcomingWindow(new Date('2026-10-31T14:59:59.999Z'), 30);
    expect([w.from, w.to]).toEqual(['2026-10-31', '2026-11-30']);
    expect(w.scrimBefore.toISOString()).toBe('2026-11-30T15:00:00.000Z');
  });

  it('하루 중 어느 시각이든 from은 같은 KST 날짜', () => {
    const w = upcomingWindow(new Date('2026-11-01T14:59:59.999Z'), 30); // KST 11-01 23:59:59.999
    expect([w.from, w.to]).toEqual(['2026-11-01', '2026-12-01']);
  });

  it('월·연 넘김', () => {
    expect(upcomingWindow(new Date('2026-12-15T03:00:00.000Z'), 30)).toEqual({
      from: '2026-12-15',
      to: '2027-01-14',
      scrimBefore: new Date('2027-01-14T15:00:00.000Z'),
    });
    // 평년 2월 넘김
    const feb = upcomingWindow(new Date('2027-02-10T00:00:00.000Z'), 30);
    expect([feb.from, feb.to]).toEqual(['2027-02-10', '2027-03-12']);
    // 윤년 2월
    const leap = upcomingWindow(new Date('2028-02-10T00:00:00.000Z'), 30);
    expect([leap.from, leap.to]).toEqual(['2028-02-10', '2028-03-11']);
  });

  it('days 0 = 오늘만, scrimBefore = 내일 KST 00:00', () => {
    const w = upcomingWindow(new Date('2026-10-31T15:00:00.000Z'), 0);
    expect([w.from, w.to]).toEqual(['2026-11-01', '2026-11-01']);
    expect(w.scrimBefore.toISOString()).toBe('2026-11-01T15:00:00.000Z');
  });

  it('잘못된 now·days → RangeError', () => {
    expect(() => upcomingWindow(new Date(Number.NaN), 30)).toThrow(RangeError);
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => upcomingWindow(new Date('2026-10-31T15:00:00.000Z'), bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe('mergeUpcomingItems (D308: 시작 순 병합, 같은 순간 일정 먼저)', () => {
  const ev = (id: string, starts_on: string, start_time: string | null, ends_on = starts_on): CalendarEventItem => ({
    kind: 'event',
    id,
    game: null,
    title: `일정 ${id}`,
    description: null,
    starts_on,
    ends_on,
    start_time,
    end_time: null,
    url: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  }) as unknown as CalendarEventItem;
  const sc = (id: string, scheduled_at: string): CalendarScrimItem => ({
    kind: 'scrim',
    id,
    title: `내전 ${id}`,
    game: { code: 'lol', name: '리그 오브 레전드' },
    steam_app: null,
    date: scheduled_at.slice(0, 10),
    scheduled_at,
    status: 'recruiting',
    capacity: 10,
    joined_count: 0,
    join_closed: false,
    my_status: null,
    result_status: null,
  }) as unknown as CalendarScrimItem;

  it('진행 중 여러 날 일정(어제 시작)이 가장 먼저', () => {
    // now = KST 11-01 12:00. 어제(10-31) 시작해 11-02에 끝나는 일정, 오늘 13:00 내전, 오늘 종일 일정
    const events = [ev('e-ongoing', '2026-10-31', '20:00', '2026-11-02'), ev('e-today', '2026-11-01', null)];
    const scrims = [sc('s-today', '2026-11-01T04:00:00.000Z')];
    const r = mergeUpcomingItems(events, scrims, 5);
    expect(ids(r.items)).toEqual(['e-ongoing', 'e-today', 's-today']);
    expect(r.hasMore).toBe(false);
  });

  it('같은 순간이면 일정 먼저(21:00 일정 vs 21:00 내전, 종일 vs 00:00 내전)', () => {
    const r = mergeUpcomingItems([ev('e', '2026-11-08', '21:00')], [sc('s', '2026-11-08T12:00:00.000Z')], 5);
    expect(ids(r.items)).toEqual(['e', 's']);
    const r2 = mergeUpcomingItems([ev('e', '2026-11-08', null)], [sc('s', '2026-11-07T15:00:00.000Z')], 5);
    expect(ids(r2.items)).toEqual(['e', 's']);
  });

  it('21:00 일정 vs 20:00 내전 → 내전 먼저', () => {
    const r = mergeUpcomingItems([ev('e', '2026-11-08', '21:00')], [sc('s', '2026-11-08T11:00:00.000Z')], 5);
    expect(ids(r.items)).toEqual(['s', 'e']);
  });

  it('max 5에서 6개 → 앞 5개 + hasMore true', () => {
    const events = [ev('e1', '2026-11-02', null), ev('e2', '2026-11-04', '10:00'), ev('e3', '2026-11-06', null)];
    const scrims = [
      sc('s1', '2026-11-03T12:00:00.000Z'),
      sc('s2', '2026-11-05T12:00:00.000Z'),
      sc('s3', '2026-11-07T12:00:00.000Z'),
    ];
    const r = mergeUpcomingItems(events, scrims, 5);
    expect(ids(r.items)).toEqual(['e1', 's1', 'e2', 's2', 'e3']);
    expect(r.hasMore).toBe(true);
    // 한 종류만 max + 1개
    const only = mergeUpcomingItems([], ['a', 'b', 'c', 'd', 'e', 'f'].map((id, k) => sc(id, `2026-11-0${k + 2}T12:00:00.000Z`)), 5);
    expect(ids(only.items)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(only.hasMore).toBe(true);
  });

  it('정확히 5개 → 전부 + hasMore false', () => {
    const events = [ev('e1', '2026-11-02', null), ev('e2', '2026-11-04', null)];
    const scrims = [sc('s1', '2026-11-03T12:00:00.000Z'), sc('s2', '2026-11-05T12:00:00.000Z'), sc('s3', '2026-11-06T12:00:00.000Z')];
    const r = mergeUpcomingItems(events, scrims, 5);
    expect(ids(r.items)).toEqual(['e1', 's1', 'e2', 's2', 's3']);
    expect(r.hasMore).toBe(false);
  });

  it('입력 순서 안정: 같은 순간끼리 같은 종류는 받은 순서 그대로(다시 정렬하지 않음)', () => {
    // 일정: 같은 시작 순간(종일과 00:00), compareEventSchedule 순 = 종일 먼저, 그 안은 ends_on·id
    const events = [ev('e-b', '2026-11-08', null), ev('e-a', '2026-11-08', null, '2026-11-09'), ev('e-c', '2026-11-08', '00:00')];
    // 내전: 같은 scheduled_at, id 순으로 받음
    const scrims = [sc('s-2', '2026-11-07T15:00:00.000Z'), sc('s-1', '2026-11-07T15:00:00.000Z')];
    const r = mergeUpcomingItems(events, scrims, 5);
    expect(ids(r.items)).toEqual(['e-b', 'e-a', 'e-c', 's-2', 's-1']);
    // 항목 객체를 그대로 담는다(복사·변형 없음)
    expect(r.items[0]).toBe(events[0]);
    expect(r.items[3]).toBe(scrims[0]);
  });

  it('server 흐름(23-8-4): compareEventSchedule로 정렬한 일정 + upcomingWindow 구간', () => {
    const now = new Date('2026-11-01T03:00:00.000Z'); // KST 11-01 12:00
    const w = upcomingWindow(now, 30);
    const raw = [ev('late', '2026-11-08', '21:00'), ev('allday', '2026-11-08', null), ev('ongoing', '2026-10-30', null, '2026-11-01')];
    const events = raw.filter((e) => e.ends_on >= w.from && e.starts_on <= w.to).sort(compareEventSchedule);
    const scrims = [sc('fri', '2026-11-08T11:00:00.000Z')].filter((s) => {
      const t = Date.parse(s.scheduled_at);
      return t >= now.getTime() && t < w.scrimBefore.getTime();
    });
    expect(ids(mergeUpcomingItems(events, scrims, 5).items)).toEqual(['ongoing', 'allday', 'fri', 'late']);
  });

  it('빈 입력 → 빈 목록, hasMore false', () => {
    expect(mergeUpcomingItems([], [], 5)).toEqual({ items: [], hasMore: false });
  });

  it('max가 1 이상 정수가 아니면 RangeError', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => mergeUpcomingItems([], [], bad), String(bad)).toThrow(RangeError);
    }
  });

  it('형식이 틀린 일정 시각·내전 시각 → RangeError', () => {
    expect(() => mergeUpcomingItems([ev('e', '2026-11-08', '25:00')], [sc('s', '2026-11-08T12:00:00.000Z')], 5)).toThrow(RangeError);
    expect(() => mergeUpcomingItems([ev('e', '2026-11-08', null)], [sc('s', 'not-a-date')], 5)).toThrow(RangeError);
  });
});
