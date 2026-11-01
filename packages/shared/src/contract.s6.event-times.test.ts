import { describe, expect, it } from 'vitest';
import {
  ADMIN_UPCOMING_DAYS,
  ADMIN_UPCOMING_MAX,
  AdminOverview,
  AdminUpcoming,
  CalendarItem,
  CreateEventRequest,
  DashboardNewsItem,
  EventTime,
  EventView,
  UpdateEventRequest,
  eventScheduleIssues,
} from './index';

// S6 후속 사용자 결정(2026-11-01): 운영진 일정 시각(Q22 → D298–D305), 관리자 「다가오는 일정」 카드(Q21 → D306–D309).
// 계약 S6 23-8절. 전환(D305) 2단계 완료: 응답의 새 필드(시각 2개·upcoming)는 필수다(시각 값은 null 가능).

const ID = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const T = '2026-11-01T00:00:00.000Z';
const lol = { code: 'lol', name: '리그 오브 레전드', has_positions: true, has_teams: true, has_results: true, positions: ['top'] } as const;

const view = {
  id: ID,
  game: null,
  title: '11월 정기 내전의 날',
  description: null,
  url: null,
  starts_on: '2026-11-08',
  ends_on: '2026-11-08',
  start_time: '21:00',
  end_time: '23:00',
  created_at: T,
  updated_at: T,
} as const;

const scrimItem = {
  kind: 'scrim',
  id: ID2,
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

const issuesOf = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : (r.error?.issues ?? []).map((i) => i.path.join('.'));

describe('일정 시각 형식(D299)', () => {
  it('KST 벽시계 HH:mm, 00:00–23:59', () => {
    for (const ok of ['00:00', '09:05', '21:00', '23:59']) expect(EventTime.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['24:00', '9:00', '21:0', '21:00:00', '21-00', '', '2100', '21:60']) expect(EventTime.safeParse(bad).success, bad).toBe(false);
  });
});

describe('일정 생성 시각(D298·D300)', () => {
  it('시각 생략 = 종일(start_time·end_time null), 기존 요청 그대로 통과', () => {
    expect(CreateEventRequest.parse({ title: '정기 내전의 날', starts_on: '2026-11-08' })).toMatchObject({
      starts_on: '2026-11-08',
      ends_on: '2026-11-08',
      start_time: null,
      end_time: null,
    });
  });
  it('시작 시각만 / 시작·종료 / 같은 시각 허용', () => {
    expect(CreateEventRequest.parse({ title: '행사', starts_on: '2026-11-08', start_time: '21:00' })).toMatchObject({ start_time: '21:00', end_time: null });
    expect(CreateEventRequest.parse({ title: '행사', starts_on: '2026-11-08', start_time: '21:00', end_time: '23:00' }).end_time).toBe('23:00');
    expect(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-08', start_time: '21:00', end_time: '21:00' }).success).toBe(true);
  });
  it('종료 시각만 있으면 실패(path end_time)', () => {
    expect(issuesOf(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-08', end_time: '23:00' }))).toEqual(['end_time']);
  });
  it('하루 일정에서 종료 < 시작이면 실패(path end_time). ends_on 생략도 같은 날로 본다', () => {
    expect(issuesOf(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-08', start_time: '21:00', end_time: '20:59' }))).toEqual(['end_time']);
    expect(
      issuesOf(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: '21:00', end_time: '09:00' })),
    ).toEqual(['end_time']);
  });
  it('여러 날 일정은 시각 순서를 보지 않는다(시작은 첫날, 종료는 끝날)', () => {
    expect(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-08', ends_on: '2026-11-09', start_time: '21:00', end_time: '02:00' }).success).toBe(true);
  });
  it('기간 오류가 먼저(path ends_on), 그때는 시각을 보지 않는다', () => {
    expect(issuesOf(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-08', ends_on: '2026-11-07', end_time: '23:00' }))).toEqual(['ends_on']);
  });
  it('시각 형식 오류는 그 필드 path', () => {
    expect(issuesOf(CreateEventRequest.safeParse({ title: '행사', starts_on: '2026-11-08', start_time: '9:00' }))).toEqual(['start_time']);
  });
});

describe('일정 수정 시각(D300, 부분 수정)', () => {
  it('시각만 보내도 된다(날짜는 저장값, 서버가 합쳐 다시 검사)', () => {
    expect(UpdateEventRequest.parse({ start_time: '21:00' })).toEqual({ start_time: '21:00' });
    expect(UpdateEventRequest.parse({ end_time: '23:00' })).toEqual({ end_time: '23:00' });
    expect(UpdateEventRequest.parse({ start_time: null, end_time: null })).toEqual({ start_time: null, end_time: null });
  });
  it('null = 비우기(종일로), 생략 = 그대로', () => {
    const r = UpdateEventRequest.parse({ start_time: null });
    expect(r).toEqual({ start_time: null });
    expect('end_time' in r).toBe(false);
  });
  it('요청 안에서 판단되는 오류: 시작을 비우며 종료를 넣음 / 같은 날 역순', () => {
    expect(issuesOf(UpdateEventRequest.safeParse({ start_time: null, end_time: '23:00' }))).toEqual(['end_time']);
    expect(
      issuesOf(UpdateEventRequest.safeParse({ starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: '21:00', end_time: '20:00' })),
    ).toEqual(['end_time']);
  });
  it('날짜가 요청에 하나만 있으면 시각 순서는 서버 병합 검사로 넘긴다', () => {
    expect(UpdateEventRequest.safeParse({ ends_on: '2026-11-08', start_time: '21:00', end_time: '20:00' }).success).toBe(true);
  });
  it('모르는 필드 거부(.strict), 빈 본문 거부', () => {
    expect(UpdateEventRequest.safeParse({ starts_at: '2026-11-08T21:00:00+09:00' }).success).toBe(false);
    expect(UpdateEventRequest.safeParse({}).success).toBe(false);
  });
});

describe('합친 값 검사 eventScheduleIssues(서버 PATCH·목·웹 폼 공용)', () => {
  const base = { starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: null, end_time: null };
  it('종일·시작만·정상 범위는 []', () => {
    expect(eventScheduleIssues(base)).toEqual([]);
    expect(eventScheduleIssues({ ...base, start_time: '21:00' })).toEqual([]);
    expect(eventScheduleIssues({ ...base, start_time: '21:00', end_time: '21:00' })).toEqual([]);
  });
  it('저장된 end_time이 있는데 start_time만 비우면 실패(종료 시각도 함께 비워야 함)', () => {
    expect(eventScheduleIssues({ ...base, end_time: '23:00' }).map((i) => i.path)).toEqual(['end_time']);
  });
  it('저장값이 하루 21:00–23:00인데 시작만 23:30으로 → 실패, 끝날을 다음 날로 → 통과', () => {
    expect(eventScheduleIssues({ ...base, start_time: '23:30', end_time: '23:00' }).map((i) => i.path)).toEqual(['end_time']);
    expect(eventScheduleIssues({ ...base, ends_on: '2026-11-09', start_time: '23:30', end_time: '23:00' })).toEqual([]);
  });
  it('기간 오류는 ends_on 하나만', () => {
    expect(eventScheduleIssues({ ...base, ends_on: '2026-11-07', end_time: '23:00' })).toEqual([{ path: 'ends_on', message: 'ends_on은 starts_on 이후' }]);
    expect(eventScheduleIssues({ ...base, ends_on: '2027-11-10' }).map((i) => i.path)).toEqual(['ends_on']);
  });
});

describe('응답의 시각 필드(D298, 전환 D305)', () => {
  it('EventView·캘린더 일정 항목·홈 news 이벤트 행이 start_time·end_time을 싣는다', () => {
    expect(EventView.parse(view)).toMatchObject({ start_time: '21:00', end_time: '23:00' });
    expect(CalendarItem.parse({ ...view, kind: 'event' })).toMatchObject({ kind: 'event', start_time: '21:00', end_time: '23:00' });
    const row = DashboardNewsItem.parse({
      kind: 'event',
      id: ID,
      game: null,
      title: '행사',
      subtitle: null,
      date: '2026-11-08',
      ends_on: '2026-11-08',
      start_time: '21:00',
      end_time: null,
      url: null,
    });
    expect(row).toMatchObject({ start_time: '21:00', end_time: null });
  });
  it('종일 = null', () => {
    expect(EventView.parse({ ...view, start_time: null, end_time: null })).toMatchObject({ start_time: null, end_time: null });
  });
  it('형식이 틀린 시각은 응답 parse 실패(서버 직렬화 오류를 잡는다)', () => {
    expect(EventView.safeParse({ ...view, start_time: '21:00:00' }).success).toBe(false);
  });
  it('2단계(D305): 시각 키가 없으면 실패 — 서버가 빠뜨린 값을 parse가 잡는다', () => {
    const { start_time: _s, end_time: _e, ...old } = view;
    expect(EventView.safeParse(old).success).toBe(false);
    expect(EventView.safeParse({ ...old, start_time: null }).success).toBe(false);
    expect(CalendarItem.safeParse({ ...old, kind: 'event' }).success).toBe(false);
    expect(
      DashboardNewsItem.safeParse({ kind: 'event', id: ID, game: null, title: '행사', subtitle: null, date: '2026-11-08', ends_on: '2026-11-08', url: null })
        .success,
    ).toBe(false);
  });
});

describe('관리자 「다가오는 일정」(D306–D308)', () => {
  const overview = {
    generated_at: T,
    week_start: '2026-10-26T00:00:00.000+09:00',
    month_start: '2026-11-01T00:00:00.000+09:00',
    members: { total: 10, active: 9, admins: 2 },
    scrims_this_week: 4,
    pending_results: { count: 2, oldest_submitted_at: null },
    no_shows: { this_month: 3, last_month: 5 },
    restricted_members: { count: 1, next_release_at: null },
    ranking_cache: { last_computed_at: null, failing_keys: 0 },
  };
  const upcoming = { from: '2026-11-01', to: '2026-12-01', items: [{ ...view, kind: 'event' }, scrimItem], has_more: false };
  it('상수: 최대 5건, 30일', () => {
    expect(ADMIN_UPCOMING_MAX).toBe(5);
    expect(ADMIN_UPCOMING_DAYS).toBe(30);
  });
  it('항목 = 캘린더 항목(CalendarItem)과 같은 모양, 순서는 응답 그대로', () => {
    const u = AdminUpcoming.parse(upcoming);
    expect(u.items.map((i) => i.kind)).toEqual(['event', 'scrim']);
    expect(AdminUpcoming.safeParse({ ...upcoming, items: [{ ...scrimItem, status: 'cancelled' }] }).success).toBe(false);
  });
  it('최대 5건, has_more 필수', () => {
    expect(AdminUpcoming.safeParse({ ...upcoming, items: Array.from({ length: 6 }, () => scrimItem) }).success).toBe(false);
    expect(AdminUpcoming.safeParse({ from: upcoming.from, to: upcoming.to, items: [] }).success).toBe(false);
  });
  it('내전 항목에 명단·방장이 없다(캘린더와 같은 공개 범위)', () => {
    const u = AdminUpcoming.parse({ ...upcoming, items: [{ ...scrimItem, host: { id: ID, nickname: 'x', avatar_url: null }, players: [] }] });
    expect('host' in u.items[0]!).toBe(false);
  });
  it('AdminOverview.upcoming — 2단계(D305) 필수, 값을 검사. restricted_members는 응답에 남는다(D291)', () => {
    expect(AdminOverview.safeParse(overview).success).toBe(false);
    expect(AdminOverview.safeParse({ ...overview, upcoming: null }).success).toBe(false);
    expect(AdminOverview.parse({ ...overview, upcoming }).upcoming.items).toHaveLength(2);
    expect(AdminOverview.safeParse({ ...overview, upcoming: { ...upcoming, has_more: 'no' } }).success).toBe(false);
    expect(AdminOverview.parse({ ...overview, upcoming }).restricted_members.count).toBe(1);
  });
});
