import type { CalendarEventItem, CalendarItem, CalendarScrimItem } from '@gcd/shared';
import { WEEKDAY_LABELS, addDays, eventsOn, monthOf, shiftMonth } from './news';

/**
 * S6 후속 커뮤니티 캘린더 화면 로직(순수 함수, 단위 테스트 대상). 계약 S6 23-6.
 * 날짜는 모두 KST 달력 날짜 'YYYY-MM-DD'. 내전 date는 서버가 kstDateKey(scheduled_at)로 준 값을 그대로 쓴다.
 * 격자(monthGrid)·막대(weekBars)·그 날 일정(eventsOn)은 /news와 같은 lib/news.ts 함수를 쓴다(CalendarEventItem ⊇ EventView).
 */

/** 칸 안 내전 줄 기본 최대 수(넘치면 「+N개」) */
export const CALENDAR_CELL_SCRIMS = 3;

/** 응답 items(일정 → 내전 순, D290)를 종류별로 나눈다. 각 종류 안의 순서는 서버 순서 그대로 */
export function splitCalendarItems(items: readonly CalendarItem[]): { events: CalendarEventItem[]; scrims: CalendarScrimItem[] } {
  const events: CalendarEventItem[] = [];
  const scrims: CalendarScrimItem[] = [];
  for (const it of items) {
    if (it.kind === 'event') events.push(it);
    else scrims.push(it);
  }
  return { events, scrims };
}

/** 그 날(KST) 내전. 순서 = 입력 순서(scheduled_at ASC, id ASC) */
export function scrimsOn(date: string, scrims: readonly CalendarScrimItem[]): CalendarScrimItem[] {
  return scrims.filter((s) => s.date === date);
}

/** 칸 안에 보일 내전 줄(최대 max개)과 넘친 수 */
export function dayCellScrims<T>(scrims: readonly T[], max: number = CALENDAR_CELL_SCRIMS): { shown: T[]; more: number } {
  return { shown: scrims.slice(0, max), more: Math.max(0, scrims.length - max) };
}

/** 'YYYY-MM-DD' 요일(월 0 … 일 6) */
function weekdayMon0(date: string): number {
  return (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** 「11월 6일」 */
function monthDay(date: string): string {
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`;
}

/** 상세 목록 머리 「11월 6일 (금)」 */
export function calendarDayLabel(date: string): string {
  return `${monthDay(date)} (${WEEKDAY_LABELS[weekdayMon0(date)]})`;
}

/** 모바일 날짜 머리 「11.06 금」 */
export function calendarMobileDayLabel(date: string): string {
  return `${date.slice(5, 7)}.${date.slice(8, 10)} ${WEEKDAY_LABELS[weekdayMon0(date)]}`;
}

/** 격자 칸 접근성 이름 「11월 6일 일정 1개, 내전 2개」(없으면 「11월 6일 일정 없음」) */
export function calendarCellLabel(date: string, eventCount: number, scrimCount: number): string {
  if (eventCount === 0 && scrimCount === 0) return `${monthDay(date)} 일정 없음`;
  const parts: string[] = [];
  if (eventCount > 0) parts.push(`일정 ${eventCount}개`);
  if (scrimCount > 0) parts.push(`내전 ${scrimCount}개`);
  return `${monthDay(date)} ${parts.join(', ')}`;
}

/** admin 모드 칸 추가 버튼 접근성 이름 「11월 6일에 일정 추가」 */
export function calendarAddLabel(date: string): string {
  return `${monthDay(date)}에 일정 추가`;
}

export interface CalendarDay {
  date: string;
  events: CalendarEventItem[];
  scrims: CalendarScrimItem[];
}

/** 그 날의 일정·내전(격자 칸 선택 상세 목록) */
export function calendarDay(date: string, events: readonly CalendarEventItem[], scrims: readonly CalendarScrimItem[]): CalendarDay {
  return { date, events: eventsOn(date, events) as CalendarEventItem[], scrims: scrimsOn(date, scrims) };
}

/**
 * 모바일 목록형(md 미만): 그 달 날짜 중 항목이 있는 날만, 날짜 오름차순.
 * - 일정은 한 번만 나온다(여러 날 일정을 날마다 되풀이하지 않는다). 기준 날짜 = 시작일과 그 달 1일 중 늦은 날.
 *   그 달이 이번 달이고 이미 시작해 오늘 진행 중인 일정은 오늘에 둔다(지난 일정으로 접히지 않게).
 * - 내전은 date(KST) 날짜.
 * - past = 그 달이 이번 달일 때 오늘보다 앞선 날짜 묶음(「지난 일정 N개 보기」로 접는다), pastCount = 그 안의 항목 수.
 *   다른 달이면 past는 비어 있다(지난 달 전체·다음 달 전체를 그대로 보인다).
 */
export function mobileCalendarDays(
  items: readonly CalendarItem[],
  month: string,
  today: string,
): { past: CalendarDay[]; upcoming: CalendarDay[]; pastCount: number } {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const isThisMonth = monthOf(today) === month;
  const byDate = new Map<string, CalendarDay>();
  const at = (date: string) => {
    let d = byDate.get(date);
    if (!d) {
      d = { date, events: [], scrims: [] };
      byDate.set(date, d);
    }
    return d;
  };
  const { events, scrims } = splitCalendarItems(items);
  for (const e of events) {
    if (e.ends_on < first || e.starts_on > last) continue;
    let anchor = e.starts_on < first ? first : e.starts_on;
    if (isThisMonth && anchor < today && e.ends_on >= today) anchor = today;
    at(anchor).events.push(e);
  }
  for (const s of scrims) if (monthOf(s.date) === month) at(s.date).scrims.push(s);
  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const past = isThisMonth ? days.filter((d) => d.date < today) : [];
  const upcoming = isThisMonth ? days.filter((d) => d.date >= today) : days;
  return { past, upcoming, pastCount: past.reduce((n, d) => n + d.events.length + d.scrims.length, 0) };
}

