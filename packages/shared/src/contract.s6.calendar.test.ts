import { describe, expect, it } from 'vitest';
import {
  ApiPath,
  CALENDAR_EVENTS_MAX,
  CALENDAR_SCRIMS_MAX,
  CalendarItem,
  CalendarMonth,
  CalendarScrimStatus,
  CreateEventRequest,
  EventView,
  GetCalendarQuery,
  GetCalendarResponse,
} from './index';

// S6 후속 커뮤니티 캘린더(계약 S6 23절, D282–D296)

const ID = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const lol = { code: 'lol', name: '리그 오브 레전드', has_positions: true, has_teams: true, has_results: true, positions: ['top'] } as const;

const scrim = {
  kind: 'scrim',
  id: ID,
  title: '금요 5:5',
  game: lol,
  steam_app: null,
  date: '2026-11-06',
  scheduled_at: '2026-11-06T12:00:00.000Z',
  status: 'recruiting',
  capacity: 10,
  joined_count: 7,
  join_closed: false,
  my_status: null,
  result_status: null,
} as const;

const event = {
  kind: 'event',
  id: ID2,
  game: null,
  title: '11월 정기 내전의 날',
  description: '저녁 9시 디스코드 음성 채널',
  url: null,
  starts_on: '2026-11-08',
  ends_on: '2026-11-08',
  start_time: null,
  end_time: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
} as const;

describe('S6 캘린더 경로', () => {
  it('GET /calendar 1개, 쓰기는 기존 /admin/events 재사용', () => {
    expect(ApiPath.calendar).toBe('/calendar');
    expect(ApiPath.adminEvents).toBe('/admin/events');
    expect(ApiPath.adminEvent).toBe('/admin/events/:id');
    expect(Object.values(ApiPath).filter((v) => v.startsWith('/calendar'))).toEqual(['/calendar']);
    const values = Object.values(ApiPath);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('S6 캘린더 쿼리', () => {
  it('month·game 모두 선택', () => {
    expect(GetCalendarQuery.parse({})).toEqual({});
    expect(GetCalendarQuery.parse({ month: '2026-11', game: 'tft' })).toEqual({ month: '2026-11', game: 'tft' });
  });
  it('month 형식: YYYY-MM, 01–12, 2000–2099', () => {
    for (const ok of ['2026-01', '2026-12', '2000-01', '2099-12']) expect(CalendarMonth.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-11', '1999-12', '2100-01', '2026-11-01', '']) {
      expect(CalendarMonth.safeParse(bad).success, bad).toBe(false);
    }
  });
  it('모르는 게임 코드는 VALIDATION_FAILED(zod 실패)', () => {
    expect(GetCalendarQuery.safeParse({ game: 'valorant' }).success).toBe(false);
  });
});

describe('S6 캘린더 응답', () => {
  it('내전·일정 두 종류(kind 구분)', () => {
    const r = GetCalendarResponse.parse({
      month: '2026-11',
      from: '2026-10-26',
      to: '2026-12-06',
      items: [event, scrim],
      truncated: { scrims: false, events: false },
    });
    expect(r.items.map((i) => i.kind)).toEqual(['event', 'scrim']);
  });
  it('취소된 내전은 캘린더 항목이 될 수 없다', () => {
    expect(CalendarScrimStatus.options).toEqual(['recruiting', 'full', 'playing', 'finished']);
    expect(CalendarItem.safeParse({ ...scrim, status: 'cancelled' }).success).toBe(false);
  });
  it('내전 항목에는 참가자 명단·방장이 없다(공개 필드만, D287)', () => {
    const parsed = CalendarItem.parse({ ...scrim, host: { id: ID, nickname: 'x', avatar_url: null }, players: [] });
    expect('host' in parsed).toBe(false);
    expect('players' in parsed).toBe(false);
  });
  it('일정 항목 = EventView + kind(수정 폼이 그대로 쓴다, D289)', () => {
    const parsed = CalendarItem.parse(event);
    expect(parsed.kind).toBe('event');
    const { kind: _kind, ...view } = parsed as Extract<CalendarItem, { kind: 'event' }>;
    expect(EventView.parse(view)).toEqual(view);
  });
  it('일정 쓰기는 기존 CreateEventRequest 그대로(시각 생략 = 종일, D298이 D283을 대체 — contract.s6.event-times.test.ts)', () => {
    expect(CreateEventRequest.parse({ title: '정기 내전의 날', starts_on: '2026-11-08' })).toMatchObject({
      starts_on: '2026-11-08',
      ends_on: '2026-11-08',
      start_time: null,
      end_time: null,
    });
  });
  it('truncated는 필수, 최대 수 상수', () => {
    expect(
      GetCalendarResponse.safeParse({ month: '2026-11', from: '2026-10-26', to: '2026-12-06', items: [] }).success,
    ).toBe(false);
    expect(CALENDAR_SCRIMS_MAX).toBe(300);
    expect(CALENDAR_EVENTS_MAX).toBe(100);
  });
});
