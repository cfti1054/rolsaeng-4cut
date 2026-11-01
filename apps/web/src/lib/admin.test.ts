import {
  AdminUpcoming,
  BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS,
  SCRIM_RESULT_REVERT_WINDOW_DAYS,
  ScrimResultRevertBlock,
  EVENT_SPAN_MAX_DAYS,
  EventTime,
  eventScheduleIssues,
  type AdminOverview,
  type CalendarEventItem,
  type CalendarScrimItem,
} from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import {
  REVERT_BLOCK_TEXT,
  discordDelivery,
  isoToKstLocalInput,
  kstLocalInputToIso,
  memberStatusText,
  noShowChanges,
  noShowPolicyText,
  overviewCards,
  rankingCacheText,
  resultOutcomeText,
  revertErrorText,
  runNoShowChanges,
  seasonPatch,
  upcomingRows,
  eventScheduleIssueText,
  UPCOMING_EMPTY_TEXT,
} from './admin';

const NOW = Date.parse('2026-10-31T12:00:00.000Z');

describe('되돌리기 막는 이유 문구(계약 S6 13절)', () => {
  it('5종 모두 문구가 있고 기한은 shared 상수', () => {
    for (const b of ScrimResultRevertBlock.options) expect(REVERT_BLOCK_TEXT[b].length).toBeGreaterThan(0);
    expect(REVERT_BLOCK_TEXT.window_passed).toBe(`승인 후 ${SCRIM_RESULT_REVERT_WINDOW_DAYS}일이 지나 되돌릴 수 없어요`);
    expect(REVERT_BLOCK_TEXT.self_submitted).toBe('내가 제출한 결과는 다른 운영진이 되돌려야 해요');
    expect(REVERT_BLOCK_TEXT.season_closed).toBe('시즌 종료 처리가 끝나 되돌릴 수 없어요');
    expect(REVERT_BLOCK_TEXT.later_games).toBe('참가자의 다음 경기가 이미 반영돼 되돌릴 수 없어요');
    expect(REVERT_BLOCK_TEXT.rating_mismatch).toBe('레이팅 기록이 맞지 않아요. 개발자에게 알려 주세요');
  });
  it('시도 응답 SCRIM_RESULT_REVERT_NOT_ALLOWED → rating_mismatch 문구', () => {
    expect(revertErrorText('SCRIM_RESULT_REVERT_NOT_ALLOWED', null)).toBe(REVERT_BLOCK_TEXT.rating_mismatch);
    // B안: 다시 읽은 revert_blocked_reason이 있으면 그 이유
    expect(revertErrorText('SCRIM_RESULT_REVERT_NOT_ALLOWED', 'later_games')).toBe(REVERT_BLOCK_TEXT.later_games);
    expect(revertErrorText('FORBIDDEN', 'later_games')).toBeNull();
  });
});

describe('통계 3칸(D291)', () => {
  const o: AdminOverview = {
    generated_at: new Date(NOW).toISOString(),
    week_start: '2026-10-25T15:00:00.000Z',
    month_start: '2026-09-30T15:00:00.000Z',
    members: { total: 13, active: 12, admins: 3 },
    scrims_this_week: 4,
    pending_results: { count: 2, oldest_submitted_at: new Date(NOW - 14 * 3_600_000).toISOString() },
    no_shows: { this_month: 3, last_month: 5 },
    restricted_members: { count: 1, next_release_at: '2026-11-01T15:00:00.000Z' },
    ranking_cache: { last_computed_at: '2026-10-31T14:05:00.000Z', failing_keys: 0 },
    upcoming: { from: '2026-11-01', to: '2026-12-01', items: [], has_more: false },
  };
  it('목업 문구와 같은 모양', () => {
    const c = overviewCards(o, NOW);
    expect(c.map((x) => x.value)).toEqual([2, 4, 3]);
    expect(c[0]!.sub).toBe('가장 오래된 제출 · 14시간 전');
    expect(c[1]).toMatchObject({ label: '이번 주 내전', unit: '경기', sub: '월요일부터 · 취소 제외' });
    expect(c[2]!.sub).toBe('지난달보다 2회 적어요');
  });
  it('「참가 제한 중」 칸이 없다(응답 restricted_members는 있어도)', () => {
    const c = overviewCards(o, NOW);
    expect(c).toHaveLength(3);
    expect(c.map((x) => x.key)).toEqual(['pending', 'scrims_week', 'no_shows']);
    expect(c.some((x) => x.label === '참가 제한 중')).toBe(false);
  });
  it('빈 값·같음·많음', () => {
    const c = overviewCards({ ...o, pending_results: { count: 0, oldest_submitted_at: null }, no_shows: { this_month: 4, last_month: 1 } }, NOW);
    expect(c[0]!.sub).toBe('대기 중인 결과가 없어요');
    expect(c[2]!.sub).toBe('지난달보다 3회 많아요');
    expect(overviewCards({ ...o, no_shows: { this_month: 2, last_month: 2 } }, NOW)[2]!.sub).toBe('지난달과 같아요');
  });
  it('랭킹 캐시 머리: KST 시각, 실패 키면 경고', () => {
    expect(rankingCacheText(o.ranking_cache)).toEqual({ text: '랭킹 캐시 23:05 갱신', warn: false });
    expect(rankingCacheText({ last_computed_at: null, failing_keys: 2 }).warn).toBe(true);
  });
});

describe('노쇼 저장(D252)', () => {
  const ref = (id: string) => ({ id, nickname: id, avatar_url: null });
  const players = [
    { user: ref('a'), status: 'joined' as const },
    { user: ref('b'), status: 'no_show' as const },
    { user: ref('c'), status: 'joined' as const },
  ];
  it('바뀐 참가자만', () => {
    expect(noShowChanges(players, new Set(['b']))).toEqual([]);
    expect(noShowChanges(players, new Set(['a', 'c']))).toEqual([
      { userId: 'a', noShow: true },
      { userId: 'b', noShow: false },
      { userId: 'c', noShow: true },
    ]);
  });
  it('차례로 호출하고 첫 실패에서 멈춘다', async () => {
    const calls: string[] = [];
    const r = await runNoShowChanges(
      [
        { userId: 'a', noShow: true },
        { userId: 'b', noShow: false },
        { userId: 'c', noShow: true },
      ],
      async (c) => {
        calls.push(c.userId);
        if (c.userId === 'b') throw new Error('boom');
      },
    );
    expect(calls).toEqual(['a', 'b']);
    expect(r.saved).toBe(1);
    expect(r.failed?.change.userId).toBe('b');
  });
  it('정책 문구는 서버 값', () => {
    expect(noShowPolicyText({ threshold: 3, window_days: 30, restriction_days: 1, mark_window_days: 7 })).toBe('30일 안에 3회면 1일간 참가 제한');
  });
});

describe('공지 디스코드 상태(8-4)', () => {
  const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
  it('꺼짐 / 대기 / 전송됨 / 72시간 경과', () => {
    expect(discordDelivery({ notify_discord: false, discord_notified_at: null, created_at: at(1) }, NOW)).toBe('off');
    expect(discordDelivery({ notify_discord: true, discord_notified_at: null, created_at: at(1) }, NOW)).toBe('pending');
    expect(discordDelivery({ notify_discord: true, discord_notified_at: at(0), created_at: at(1) }, NOW)).toBe('sent');
    expect(discordDelivery({ notify_discord: true, discord_notified_at: null, created_at: at(BOT_ANNOUNCEMENT_PENDING_MAX_AGE_HOURS) }, NOW)).toBe('expired');
  });
});

describe('멤버·결과 문구', () => {
  it('STATUS', () => {
    expect(memberStatusText({ status: 'active', restricted_until: null }).text).toBe('활동 중');
    expect(memberStatusText({ status: 'restricted', restricted_until: '2026-11-01T15:00:00.000Z' }).text).toBe('참가 제한 ~11.02');
    expect(memberStatusText({ status: 'left', restricted_until: null }).text).toBe('서버 나감');
  });
  it('결과 문구', () => {
    expect(resultOutcomeText({ winner_team: 'blue', winner: null })).toBe('블루팀 승리');
    expect(resultOutcomeText({ winner_team: null, winner: { id: 'x', nickname: '체스왕', avatar_url: null } })).toBe('1위 체스왕');
  });
});

describe('시즌 폼', () => {
  it('datetime-local ↔ ISO(KST)', () => {
    expect(isoToKstLocalInput('2026-10-31T15:00:00.000Z')).toBe('2026-11-01T00:00');
    expect(kstLocalInputToIso('2026-11-01T00:00')).toBe('2026-11-01T00:00:00+09:00');
    expect(kstLocalInputToIso('')).toBeNull();
  });
  it('editable 잠금 칸(null)은 보내지 않고, 같은 값도 보내지 않는다', () => {
    const cur = { name: '시즌 3', starts_at: '2026-10-31T15:00:00.000Z', ends_at: '2027-01-31T15:00:00.000Z' };
    expect(seasonPatch(cur, { name: '시즌 3', starts_at: null, ends_at: '2027-02-01T00:00:00+09:00' })).toEqual({});
    expect(seasonPatch(cur, { name: '시즌 3 ', starts_at: null, ends_at: '2027-02-02T00:00:00+09:00' })).toEqual({ ends_at: '2027-02-02T00:00:00+09:00' });
    expect(seasonPatch(cur, { name: '새 이름', starts_at: '2026-11-01T00:00:00+09:00', ends_at: null })).toEqual({ name: '새 이름' });
  });
});

describe('「다가오는 일정」 행(23-8-5, D306)', () => {
  const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ev = (n: number, p: Partial<CalendarEventItem>): CalendarEventItem => ({
    kind: 'event',
    id: uid(n),
    game: null,
    title: `일정 ${n}`,
    description: null,
    url: null,
    starts_on: '2026-11-08',
    ends_on: '2026-11-08',
    start_time: null,
    end_time: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...p,
  });
  const game = (code: 'lol' | 'steam') => ({
    code,
    name: code === 'lol' ? '리그 오브 레전드' : '스팀 게임',
    has_positions: code === 'lol',
    has_teams: code === 'lol',
    has_results: code === 'lol',
    positions: [],
  });
  const sc = (n: number, p: Partial<CalendarScrimItem>): CalendarScrimItem => ({
    kind: 'scrim',
    id: uid(100 + n),
    title: '금요 5:5',
    game: game('lol'),
    steam_app: null,
    date: '2026-11-13',
    scheduled_at: '2026-11-13T12:00:00.000Z',
    status: 'recruiting',
    capacity: 10,
    joined_count: 7,
    join_closed: false,
    my_status: null,
    result_status: null,
    ...p,
  });
  const up = (items: AdminUpcoming['items']): AdminUpcoming => AdminUpcoming.parse({ from: '2026-11-01', to: '2026-12-01', items, has_more: false });

  it('항목 없음 → 빈 목록, 빈 문구', () => {
    expect(upcomingRows(up([]))).toEqual([]);
    expect(UPCOMING_EMPTY_TEXT).toBe('다가오는 일정이 없어요');
  });
  it('진행 중 여러 날 일정 「진행 중 · ~MM.DD」, 시작일이 from이면 날짜(요일)', () => {
    const r = upcomingRows(up([ev(1, { starts_on: '2026-10-30', ends_on: '2026-11-03' }), ev(2, { starts_on: '2026-11-01', ends_on: '2026-11-03' })]));
    expect(r[0]!.date).toBe('진행 중 · ~11.03');
    expect(r[1]!.date).toBe('11.01 (일)');
  });
  it('일정 시각: 종일 · 시작만 · 시작–끝, 게임 무관·약칭, 칩 「일정」, 링크 없음', () => {
    const r = upcomingRows(
      up([
        ev(1, {}),
        ev(2, { start_time: '21:00' }),
        ev(3, { start_time: '21:00', end_time: '23:00', game: game('lol') }),
      ]),
    );
    expect(r.map((x) => x.time)).toEqual(['종일', '21:00', '21:00–23:00']);
    expect(r.map((x) => x.game)).toEqual(['게임 무관', '게임 무관', '롤']);
    expect(r.every((x) => x.chip === '일정' && x.href === null && x.linkLabel === null && !x.bold)).toBe(true);
    expect(r[0]!.date).toBe('11.08 (일)');
  });
  it('내전 KST 시각(15:00Z 경계 = 다음날 00:00), 링크·접근성 이름', () => {
    const r = upcomingRows(
      up([
        sc(1, {}),
        sc(2, { date: '2026-11-14', scheduled_at: '2026-11-13T15:00:00.000Z' }),
        sc(3, { date: '2026-11-13', scheduled_at: '2026-11-13T14:59:00.000Z' }),
      ]),
    );
    expect(r[0]).toMatchObject({ date: '11.13 (금)', time: '21:00', game: '롤', chip: '내전', href: `/scrims/${uid(101)}`, linkLabel: '11월 13일 21:00 금요 5:5 내전 상세' });
    expect(r[1]).toMatchObject({ date: '11.14 (토)', time: '00:00' });
    expect(r[2]).toMatchObject({ date: '11.13 (금)', time: '23:59' });
  });
  it('스팀(승패 없음) 「모집」, 내 참가 bold, 응답 순서 그대로', () => {
    const r = upcomingRows(up([sc(1, { game: game('steam'), my_status: 'joined' }), ev(9, {}), sc(2, {})]));
    expect(r.map((x) => x.kind)).toEqual(['scrim', 'event', 'scrim']);
    expect(r[0]).toMatchObject({ chip: '모집', game: '스팀', bold: true });
    expect(r[2]).toMatchObject({ chip: '내전', bold: false });
  });
});

describe('QA 수정: 내전 행 링크 이름에서 칩 반복 생략', () => {
  const g = (has_results: boolean) => ({ code: (has_results ? 'lol' : 'steam') as 'lol' | 'steam', name: 'x', has_positions: false, has_teams: false, has_results, positions: [] });
  const item = (title: string, has_results = true) => ({
    kind: 'scrim' as const,
    id: '00000000-0000-4000-8000-000000000201',
    title,
    game: g(has_results),
    steam_app: null,
    date: '2026-11-13',
    scheduled_at: '2026-11-13T12:00:00.000Z',
    status: 'recruiting' as const,
    capacity: 10,
    joined_count: 1,
    join_closed: false,
    my_status: null,
    result_status: null,
  });
  const label = (title: string, has_results = true) =>
    upcomingRows(AdminUpcoming.parse({ from: '2026-11-01', to: '2026-12-01', items: [item(title, has_results)], has_more: false }))[0]!.linkLabel;
  it('제목이 칩 문구로 끝나면 칩 생략, 아니면 붙인다', () => {
    expect(label('화요일 저녁 5:5 내전')).toBe('11월 13일 21:00 화요일 저녁 5:5 내전 상세');
    expect(label('금요 5:5')).toBe('11월 13일 21:00 금요 5:5 내전 상세');
    expect(label('주말 파티 모집', false)).toBe('11월 13일 21:00 주말 파티 모집 상세');
    expect(label('주말 스팀 파티', false)).toBe('11월 13일 21:00 주말 스팀 파티 모집 상세');
    // 칩과 다른 단어로 끝나면 그대로 붙인다(「모집」 칩인데 제목이 「내전」으로 끝남)
    expect(label('스팀 내전', false)).toBe('11월 13일 21:00 스팀 내전 모집 상세');
  });
});

describe('QA 수정: 일정 기간·시각 오류 문구(해요체 매핑, shared eventScheduleIssues 전부)', () => {
  const text = (v: Parameters<typeof eventScheduleIssues>[0]) => eventScheduleIssues(v).map(eventScheduleIssueText);
  it('shared가 내는 4가지 이슈 모두 웹 문구로 바뀐다', () => {
    expect(text({ starts_on: '2026-11-08', ends_on: '2026-11-07', start_time: null, end_time: null })).toEqual(['종료일은 시작일과 같거나 그 뒤여야 해요']);
    const far = new Date(Date.parse('2026-01-01T00:00:00.000Z') + (EVENT_SPAN_MAX_DAYS + 1) * 86_400_000).toISOString().slice(0, 10);
    expect(text({ starts_on: '2026-01-01', ends_on: far, start_time: null, end_time: null })).toEqual([`일정 기간은 최대 ${EVENT_SPAN_MAX_DAYS}일까지예요`]);
    expect(text({ starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: null, end_time: '23:00' })).toEqual(['종료 시각만 입력할 수 없어요. 시작 시각을 먼저 정해 주세요']);
    expect(text({ starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: '21:00', end_time: '20:00' })).toEqual(['종료 시각은 시작 시각 이후여야 해요']);
  });
  it('시각 형식 오류(zod EventTime)도 매핑, 모르는 이슈는 shared 메시지 폴백', () => {
    const bad = EventTime.safeParse('24:00');
    expect(bad.success).toBe(false);
    expect(eventScheduleIssueText({ path: 'start_time', message: bad.error!.issues[0]!.message })).toBe('시각은 HH:mm 형식이어야 해요');
    expect(eventScheduleIssueText({ path: 'url', message: '올바른 URL이 아님' })).toBe('올바른 URL이 아님');
    expect(eventScheduleIssueText({ path: 'end_time', message: '새 규칙' })).toBe('새 규칙');
  });
});
