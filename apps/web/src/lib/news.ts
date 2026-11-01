import { kstDateKey } from '@gcd/core';
import { isoDateDiffDays, type EventView, type GameCode } from '@gcd/shared';

/**
 * S6 /news·홈 「패치 · 이벤트」 화면 로직(순수 함수, 단위 테스트 대상). 계약 S6 13절.
 * 날짜는 모두 KST 달력 날짜 `YYYY-MM-DD`(서버 date 컬럼 그대로). 시간대 변환을 하지 않는다.
 */

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' + n일 */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** 요일(월 0 … 일 6) */
function weekdayMon0(date: string): number {
  return (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** 오늘(KST) 'YYYY-MM-DD' */
export function kstToday(now: number): string {
  return kstDateKey(new Date(now));
}

/** 'YYYY-MM' 형식이면 그대로, 아니면 null */
export function parseMonth(raw: string | null | undefined): string | null {
  return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : null;
}

/** 'YYYY-MM' ± n달 */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** 「2026년 11월」 */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${y}년 ${m}월`;
}

export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'] as const;

/**
 * 달 격자(월요일 시작, 7열). 첫 주는 그 달 1일이 든 주의 월요일부터, 마지막 주는 말일이 든 주의 일요일까지.
 * 반환 from·to = 격자 처음·끝 날짜(GET /events 조회 구간, 최대 42일 < EVENTS_RANGE_MAX_DAYS).
 */
export function monthGrid(month: string): { weeks: string[][]; from: string; to: string } {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const from = addDays(first, -weekdayMon0(first));
  const to = addDays(last, 6 - weekdayMon0(last));
  const weeks: string[][] = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  return { weeks, from, to };
}

export interface WeekBar {
  event: EventView;
  /** 0–6 */
  col: number;
  span: number;
  lane: number;
  /** 이번 주 앞에서 이어짐(시작일이 이 주보다 앞) */
  fromPrev: boolean;
  /** 다음 주로 이어짐 */
  toNext: boolean;
}

/**
 * 한 주(7일)에 걸치는 이벤트 막대. 여러 날 이벤트는 주마다 잘라 그린다.
 * lane = 겹치지 않게 아래로 쌓는 줄 번호(입력 순서 = 서버 정렬 starts_on ASC, ends_on ASC, id ASC 그대로 탐욕 배치).
 */
export function weekBars(week: readonly string[], events: readonly EventView[]): WeekBar[] {
  const start = week[0]!;
  const end = week[week.length - 1]!;
  const lanes: number[][] = [];
  const out: WeekBar[] = [];
  for (const e of events) {
    if (e.ends_on < start || e.starts_on > end) continue;
    const s = e.starts_on < start ? start : e.starts_on;
    const t = e.ends_on > end ? end : e.ends_on;
    const col = isoDateDiffDays(start, s);
    const span = isoDateDiffDays(s, t) + 1;
    let lane = lanes.findIndex((cols) => cols.every((c) => c < col || c >= col + span));
    if (lane < 0) {
      lane = lanes.length;
      lanes.push([]);
    }
    for (let c = col; c < col + span; c += 1) lanes[lane]!.push(c);
    out.push({ event: e, col, span, lane, fromPrev: e.starts_on < start, toNext: e.ends_on > end });
  }
  return out;
}

/** 그 날짜에 걸친 이벤트(모바일 목록형·날짜 칸 접근성 이름) */
export function eventsOn(date: string, events: readonly EventView[]): EventView[] {
  return events.filter((e) => e.starts_on <= date && e.ends_on >= date);
}

/** 「11.02」 또는 「11.02 – 11.06」 */
export function eventDateText(startsOn: string, endsOn: string): string {
  const f = (d: string) => `${d.slice(5, 7)}.${d.slice(8, 10)}`;
  return startsOn === endsOn ? f(startsOn) : `${f(startsOn)} – ${f(endsOn)}`;
}

/** 일정 날짜·시각(KST 벽시계 `HH:mm`, D298). start_time·end_time 생략(1단계 옛 응답) = 종일 */
export type EventSchedule = { starts_on: string; ends_on: string; start_time?: string | null; end_time?: string | null };

/**
 * 일정 날짜·시각 표기(계약 S6 23-8-5).
 * 종일 하루 「11.08」 · 종일 여러 날 「11.08 – 11.10」 · 하루 시작만 「11.08 21:00」 · 하루 시작·끝 「11.08 21:00–23:00」
 * · 여러 날 「11.08 21:00 – 11.10 18:00」(끝 시각 없으면 「11.08 21:00 – 11.10」).
 * end_time은 start_time이 있을 때만 의미가 있다(서버 규칙) — start_time이 없으면 시각을 쓰지 않는다.
 */
export function eventScheduleText(e: EventSchedule): string {
  const st = e.start_time ?? null;
  if (st === null) return eventDateText(e.starts_on, e.ends_on);
  const et = e.end_time ?? null;
  const f = (d: string) => `${d.slice(5, 7)}.${d.slice(8, 10)}`;
  if (e.starts_on === e.ends_on) return `${f(e.starts_on)} ${st}${et ? `–${et}` : ''}`;
  return `${f(e.starts_on)} ${st} – ${f(e.ends_on)}${et ? ` ${et}` : ''}`;
}

/** 하루 목록용 시각 「종일」 | 「21:00」 | 「21:00–23:00」(끝 시각은 하루 일정일 때만 — 여러 날이면 끝 시각은 다른 날이다) */
export function eventTimeText(e: EventSchedule): string {
  const st = e.start_time ?? null;
  if (st === null) return '종일';
  const et = e.end_time ?? null;
  return et && e.starts_on === e.ends_on ? `${st}–${et}` : st;
}

/** 패치노트 게시일 「2026.10.29」 */
export function isoDateDotted(date: string): string {
  return date.split('-').join('.');
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** 홈 행 날짜 블록(목업 Main 「OCT / 29」) */
export function newsDateBlock(date: string): { mon: string; day: string } {
  return { mon: MONTH_ABBR[Number(date.slice(5, 7)) - 1] ?? '', day: String(Number(date.slice(8, 10))) };
}

/** 게임 필터 칩: 전체 + 게임 코드(게임 목록 순서) */
export function gameFilterOptions(games: readonly { code: GameCode }[]): (GameCode | null)[] {
  return [null, ...games.map((g) => g.code)];
}
