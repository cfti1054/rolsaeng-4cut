import { calendarMonthRange, kstDateKey } from '@gcd/core';
import { type CalendarEventItem, type CalendarItem, type CalendarScrimItem } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import {
  CALENDAR_CELL_SCRIMS,
  calendarAddLabel,
  calendarCellLabel,
  calendarDay,
  calendarDayLabel,
  calendarMobileDayLabel,
  dayCellScrims,
  mobileCalendarDays,
  scrimsOn,
  splitCalendarItems,
} from './calendar';
import { monthGrid, weekBars } from './news';
import { routes } from './routes';

const ev = (id: string, starts_on: string, ends_on: string, game: CalendarEventItem['game'] = null): CalendarEventItem => ({
  kind: 'event',
  id,
  game,
  title: id,
  description: null,
  url: null,
  starts_on,
  ends_on,
  start_time: null,
  end_time: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
});

let seq = 0;
const sc = (scheduled_at: string, over: Partial<CalendarScrimItem> = {}): CalendarScrimItem => {
  seq += 1;
  return {
    kind: 'scrim',
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    title: `내전 ${seq}`,
    game: { code: 'lol', name: '리그 오브 레전드', has_positions: true, has_teams: true, has_results: true, positions: ['top', 'jungle', 'mid', 'adc', 'support'] },
    steam_app: null,
    date: kstDateKey(new Date(scheduled_at)),
    scheduled_at,
    status: 'recruiting',
    capacity: 10,
    joined_count: 3,
    join_closed: false,
    my_status: null,
    result_status: null,
    ...over,
    custom_game_name: over.custom_game_name ?? null,
  };
};

describe('격자 구간 = core calendarMonthRange(서버·목과 같은 구간, 계약 14-7·23-7)', () => {
  it.each(['2026-11', '2027-02', '2026-12', '2028-02', '2026-10'])('%s: monthGrid from·to = calendarMonthRange from·to', (m) => {
    const g = monthGrid(m);
    const r = calendarMonthRange(m);
    expect({ from: g.from, to: g.to }).toEqual({ from: r.from, to: r.to });
  });
});

describe('종류 나누기·그 날 내전', () => {
  it('splitCalendarItems: 서버 순서(일정 → 내전)를 종류별로 유지', () => {
    const items: CalendarItem[] = [ev('a', '2026-11-01', '2026-11-03'), ev('b', '2026-11-02', '2026-11-02'), sc('2026-11-02T12:00:00.000Z'), sc('2026-11-03T12:00:00.000Z')];
    const r = splitCalendarItems(items);
    expect(r.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.scrims).toHaveLength(2);
  });
  it('내전 KST 날짜: 15:00Z는 다음 날, 14:59:59.999Z는 그 날', () => {
    const late = sc('2026-11-05T14:59:59.999Z');
    const next = sc('2026-11-05T15:00:00.000Z');
    expect(late.date).toBe('2026-11-05');
    expect(next.date).toBe('2026-11-06');
    expect(scrimsOn('2026-11-05', [late, next])).toEqual([late]);
    expect(scrimsOn('2026-11-06', [late, next])).toEqual([next]);
  });
  it('dayCellScrims: 최대 3줄 + 「+N개」', () => {
    const list = [1, 2, 3, 4, 5].map((h) => sc(`2026-11-06T0${h}:00:00.000Z`));
    expect(CALENDAR_CELL_SCRIMS).toBe(3);
    const r = dayCellScrims(list);
    expect(r.shown).toEqual(list.slice(0, 3));
    expect(r.more).toBe(2);
    expect(dayCellScrims(list.slice(0, 3))).toEqual({ shown: list.slice(0, 3), more: 0 });
    expect(dayCellScrims([])).toEqual({ shown: [], more: 0 });
  });
  it('calendarDay: 여러 날 일정은 걸친 날마다, 내전은 그 날만', () => {
    const e = ev('long', '2026-11-05', '2026-11-08');
    const s = sc('2026-11-06T12:00:00.000Z');
    expect(calendarDay('2026-11-06', [e], [s])).toEqual({ date: '2026-11-06', events: [e], scrims: [s] });
    expect(calendarDay('2026-11-09', [e], [s])).toEqual({ date: '2026-11-09', events: [], scrims: [] });
  });
});

describe('여러 날 일정 막대(weekBars를 CalendarEventItem에 그대로)', () => {
  it('주 경계에서 잘린다: 11-05(목) ~ 11-10(화) → 첫 주 목–일 4칸 + 다음 주 월–화 2칸', () => {
    const e = ev('w', '2026-11-05', '2026-11-10');
    const [w1, w2] = monthGrid('2026-11').weeks.filter((w) => w.includes('2026-11-05') || w.includes('2026-11-10'));
    expect(weekBars(w1!, [e])).toEqual([{ event: e, col: 3, span: 4, lane: 0, fromPrev: false, toNext: true }]);
    expect(weekBars(w2!, [e])).toEqual([{ event: e, col: 0, span: 2, lane: 0, fromPrev: true, toNext: false }]);
  });
});

describe('문구', () => {
  it('날짜 머리·칸 이름·추가 버튼 이름', () => {
    expect(calendarDayLabel('2026-11-06')).toBe('11월 6일 (금)');
    expect(calendarMobileDayLabel('2026-11-06')).toBe('11.06 금');
    expect(calendarCellLabel('2026-11-06', 1, 2)).toBe('11월 6일 일정 1개, 내전 2개');
    expect(calendarCellLabel('2026-11-06', 0, 2)).toBe('11월 6일 내전 2개');
    expect(calendarCellLabel('2026-11-06', 0, 0)).toBe('11월 6일 일정 없음');
    expect(calendarAddLabel('2026-11-06')).toBe('11월 6일에 일정 추가');
  });
  it('내전 줄 링크 = /scrims/{id}', () => {
    expect(routes.scrim('abc')).toBe('/scrims/abc');
  });
});

describe('모바일 목록형(mobileCalendarDays)', () => {
  const today = '2026-11-10';
  it('그 달 날짜 중 항목이 있는 날만, 지난 날짜는 접는다(이번 달)', () => {
    const items: CalendarItem[] = [
      ev('past', '2026-11-02', '2026-11-02'),
      ev('ongoing', '2026-11-08', '2026-11-12'),
      ev('prevMonth', '2026-10-27', '2026-10-28'), // 격자 앞쪽(다른 달) → 목록에 없다
      sc('2026-11-03T12:00:00.000Z'),
      sc('2026-11-10T12:00:00.000Z'),
      sc('2026-11-20T12:00:00.000Z'),
      sc('2026-12-02T12:00:00.000Z'), // 격자 뒤쪽(다른 달)
    ];
    const r = mobileCalendarDays(items, '2026-11', today);
    expect(r.past.map((d) => d.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(r.pastCount).toBe(2);
    expect(r.upcoming.map((d) => d.date)).toEqual(['2026-11-10', '2026-11-20']);
    // 오늘 진행 중인 여러 날 일정은 오늘에 한 번만(지난 일정으로 접히지 않는다)
    const t = r.upcoming[0]!;
    expect(t.events.map((e) => e.id)).toEqual(['ongoing']);
    expect(t.scrims).toHaveLength(1);
    expect([...r.past, ...r.upcoming].flatMap((d) => d.events.map((e) => e.id))).toEqual(['past', 'ongoing']);
  });
  it('다른 달이면 접지 않는다, 지난달에서 이어진 일정은 1일에', () => {
    const r = mobileCalendarDays([ev('span', '2026-11-29', '2026-12-03'), sc('2026-12-05T03:00:00.000Z')], '2026-12', today);
    expect(r.past).toEqual([]);
    expect(r.pastCount).toBe(0);
    expect(r.upcoming.map((d) => d.date)).toEqual(['2026-12-01', '2026-12-05']);
  });
  it('항목이 없으면 둘 다 빈 배열', () => {
    expect(mobileCalendarDays([], '2026-11', today)).toEqual({ past: [], upcoming: [], pastCount: 0 });
  });
});
