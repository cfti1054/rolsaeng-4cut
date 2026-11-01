/**
 * S6 통계·결과 승인 큐·노쇼 후보·감사 로그 목록 HTTP 테스트(DB 없이, 계약 S6 12-5·12-6·12-7, 10절).
 * 고정 시계 2026-10-31T03:00Z(KST 토 12:00, 이번 주 = 10-26 월, 이번 달 = 10월).
 */
import {
  GetAdminOverviewResponse,
  ListAdminAuditLogsResponse,
  ListAdminNoShowScrimsResponse,
  ListAdminResultsResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { approve, login, member, seedPendingTeamResult, seedSeason } from './support/s4-helpers';
import { DAY, HOUR, MIN, json } from './support/s6-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-31T03:00:00.000Z';
const nowMs = Date.parse(NOW);

function noShowRow(app: TestApp, userId: string, markedAt: number, hostId: string) {
  const s = app.prisma.scrim.insert({
    gameId: app.prisma.gameId('lol'),
    hostId,
    title: '노쇼 기록용',
    scheduledAt: new Date(markedAt - HOUR),
    capacity: 10,
    status: 'finished',
  });
  return app.prisma.scrimPlayer.insert({ scrimId: s.id, userId, status: 'no_show', noShowMarkedAt: new Date(markedAt), joinedAt: new Date(0) });
}

describe('GET /admin/overview', () => {
  it('회원 수·이번 주 내전·승인 대기·노쇼(이번 달/지난달)·제한 회원·랭킹 캐시', async () => {
    t = await createTestApp({ fixedClock: NOW });
    seedSeason(t, '시즌', '2026-10-01T00:00:00.000+09:00', '2026-12-01T00:00:00.000+09:00');
    const admin = await login(t, 'admin_a', 'admin');
    const [a, b, c, d] = [await member(t, '가'), await member(t, '나'), await member(t, '다'), await member(t, '라')];
    const left = t.prisma.users.find((u) => u.id === d);
    if (left) left.leftAt = new Date(nowMs - DAY);
    t.clock.set(new Date(nowMs - 5 * HOUR).toISOString());
    const older = seedPendingTeamResult(t, [a, b], [c, d], { title: '오래된 제출' });
    t.clock.set(NOW);
    const newer = seedPendingTeamResult(t, [a, b], [c, d], { title: '최근 내전' });
    // 노쇼: 이번 달 4회(b 3회 → 제한, c 10-01 00:00 KST 경계), 지난달 1회(c 9-30 23:59:59 KST)
    for (const ms of [nowMs - HOUR, nowMs - DAY, nowMs - 2 * DAY]) noShowRow(t, b, ms, a);
    noShowRow(t, c, Date.parse('2026-09-30T14:59:59.000Z'), a);
    noShowRow(t, c, Date.parse('2026-09-30T15:00:00.000Z'), a);
    t.prisma.scrim.insert({ gameId: t.prisma.gameId('lol'), hostId: a, title: '취소', scheduledAt: new Date(nowMs - HOUR), capacity: 10, status: 'cancelled' });
    t.rankingCache.rows.set('rankings:x', {
      payload: {},
      computedAt: new Date(nowMs - 3 * MIN),
      lastFailedAt: new Date(nowMs - MIN),
      lastError: 'boom',
      baselinePeriodStart: new Date(0),
      baselineRanks: {},
    });

    const o = GetAdminOverviewResponse.parse(await json(await call(t, 'GET', '/admin/overview', admin.token)));
    expect(o).toMatchObject({
      generated_at: NOW,
      week_start: '2026-10-26T00:00:00.000+09:00',
      month_start: '2026-10-01T00:00:00.000+09:00',
      members: { total: 5, active: 4, admins: 1 },
      pending_results: { count: 2, oldest_submitted_at: new Date(nowMs - 5 * HOUR).toISOString() },
      no_shows: { this_month: 4, last_month: 1 },
      restricted_members: { count: 1, next_release_at: new Date(nowMs - HOUR + t.config.scrim.noShow.restrictionDays * DAY).toISOString() },
      ranking_cache: { last_computed_at: new Date(nowMs - 3 * MIN).toISOString(), failing_keys: 1 },
    });
    // 통계 4번째 칸 = 이번 주 내전(D281·Q20): 결과 내전 2 + 이번 주 노쇼 기록용 내전 3(b), 취소 1·지난 주(c) 제외
    expect(o.scrims_this_week).toBe(5);
    expect(o).not.toHaveProperty('open_disputes');
  });

  it('빈 DB: null·0', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const o = GetAdminOverviewResponse.parse(await json(await call(t, 'GET', '/admin/overview', admin.token)));
    expect(o).toMatchObject({
      pending_results: { count: 0, oldest_submitted_at: null },
      scrims_this_week: 0,
      restricted_members: { count: 0, next_release_at: null },
      ranking_cache: { last_computed_at: null, failing_keys: 0 },
    });
  });
});

describe('GET /admin/overview upcoming(S6 23-8-4, D306–D308)', () => {
  // NOW = 2026-10-31T03:00Z(KST 10-31 12:00) → from 10-31, to 11-30, 내전 상한 scrimBefore = 2026-11-30T15:00Z(12-01 00:00 KST)
  const SCRIM_BEFORE = Date.parse('2026-11-30T15:00:00.000Z');
  const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  type Status = 'recruiting' | 'full' | 'playing' | 'finished' | 'cancelled';
  const scrim = (app: TestApp, hostId: string, at: number, o: { status?: Status; title?: string; id?: string } = {}) =>
    app.prisma.scrim.insert({
      ...(o.id ? { id: o.id } : {}),
      gameId: app.prisma.gameId('lol'),
      hostId,
      title: o.title ?? '다가오는 내전',
      scheduledAt: new Date(at),
      capacity: 10,
      status: o.status ?? 'recruiting',
    }) as { id: string };
  const event = (app: TestApp, from: string, to: string, o: { start?: string; game?: 'lol' | 'tft'; title?: string; id?: string } = {}) =>
    app.prisma.calendarEvent.insert({
      ...(o.id ? { id: o.id } : {}),
      gameId: o.game ? app.prisma.gameId(o.game) : null,
      title: o.title ?? '운영진 일정',
      startsOn: new Date(`${from}T00:00:00.000Z`),
      endsOn: new Date(`${to}T00:00:00.000Z`),
      ...(o.start ? { startTime: new Date(`1970-01-01T${o.start}:00.000Z`) } : {}),
    }) as { id: string };
  async function overview(app: TestApp, token: string) {
    const res = await call(app, 'GET', '/admin/overview', token);
    const text = await res.text();
    expect({ status: res.status, text }).toMatchObject({ status: 200 });
    const o = GetAdminOverviewResponse.parse(JSON.parse(text));
    // 필수 필드(D305 2단계): api는 항상 싣는다
    expect(o.upcoming).toBeDefined();
    return { o, upcoming: o.upcoming as NonNullable<typeof o.upcoming>, text };
  }

  it('비면 items []·has_more false, from·to = 오늘(KST)·+30일. 멤버 403', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const user = await login(t, 'member_u');
    const { upcoming } = await overview(t, admin.token);
    expect(upcoming).toEqual({ from: '2026-10-31', to: '2026-11-30', items: [], has_more: false });
    await expectError(await call(t, 'GET', '/admin/overview', user.token), 403, 'FORBIDDEN');
  });

  it('경계: 진행 중 여러 날 일정(게임 무관) 맨 앞, 끝난 일정·12-01 시작 제외, 내전 now − 1ms(이미 시작) 제외·now 포함, 취소 제외, scrimBefore − 1ms 포함·정각 제외. my_status = 요청 운영진, host·players 없음', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const host = await member(t, '숨은방장');
    const other = await member(t, '다른회원');
    const ongoing = event(t, '2026-10-29', '2026-11-01', { title: '진행 중 행사' });
    event(t, '2026-10-29', '2026-10-30', { title: '어제 끝남' });
    const lastDay = event(t, '2026-11-30', '2026-11-30', { game: 'tft', title: '마지막 날' });
    event(t, '2026-12-01', '2026-12-01', { title: '구간 밖' });
    scrim(t, host, nowMs - 1, { status: 'playing', title: '이미 시작' });
    const atNow = scrim(t, host, nowMs, { title: '지금 시작' });
    scrim(t, host, nowMs + HOUR, { status: 'cancelled', title: '취소' });
    const last = scrim(t, host, SCRIM_BEFORE - 1, { status: 'full', title: '마지막 순간' });
    scrim(t, host, SCRIM_BEFORE, { title: '상한 정각' });
    t.prisma.scrimPlayer.insert({ scrimId: atNow.id, userId: admin.userId, status: 'joined', joinedAt: new Date(nowMs - DAY) });
    t.prisma.scrimPlayer.insert({ scrimId: last.id, userId: other, status: 'waitlist', joinedAt: new Date(nowMs - DAY) });
    t.prisma.scrimPlayer.insert({ scrimId: atNow.id, userId: host, status: 'joined', joinedAt: new Date(nowMs - DAY) });

    const { upcoming, text } = await overview(t, admin.token);
    expect(upcoming.items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      `event:${ongoing.id}`,
      `scrim:${atNow.id}`,
      `event:${lastDay.id}`,
      `scrim:${last.id}`,
    ]);
    expect(upcoming.has_more).toBe(false);
    expect(upcoming.items[0]).toMatchObject({ kind: 'event', game: null, starts_on: '2026-10-29', ends_on: '2026-11-01', start_time: null, end_time: null });
    expect(upcoming.items[1]).toMatchObject({ kind: 'scrim', my_status: 'joined', joined_count: 2, date: '2026-10-31', scheduled_at: NOW });
    expect(upcoming.items[3]).toMatchObject({ kind: 'scrim', status: 'full', my_status: null, date: '2026-11-30' });
    const upcomingText = JSON.stringify(JSON.parse(text).upcoming);
    for (const k of ['host', 'players', 'waitlist', 'nickname', 'created_by']) expect(upcomingText).not.toContain(`"${k}`);
    expect(upcomingText).not.toContain(host);
    expect(upcomingText).not.toContain(other);
    expect(upcomingText).not.toContain('숨은방장');
  });

  it('시작 순 병합: 종일(00:00) < 20:00 내전 < 21:00 일정 < 같은 순간 21:00 내전(일정 먼저), 정확히 5개 has_more false → 6개면 5개 + has_more', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const host = await member(t, '방장');
    const allDay = event(t, '2026-11-08', '2026-11-08', { id: uid(1) });
    const at21 = Date.parse('2026-11-08T12:00:00.000Z'); // KST 21:00
    const s21 = scrim(t, host, at21, { id: uid(11) });
    const e21 = event(t, '2026-11-08', '2026-11-08', { start: '21:00', id: uid(2) });
    const s20 = scrim(t, host, at21 - HOUR, { id: uid(12) });
    const s9 = scrim(t, host, Date.parse('2026-11-09T03:00:00.000Z'), { id: uid(13) });

    const five = (await overview(t, admin.token)).upcoming;
    expect(five.items.map((i) => i.id)).toEqual([allDay.id, s20.id, e21.id, s21.id, s9.id]);
    expect(five.items[2]).toMatchObject({ kind: 'event', start_time: '21:00' });
    expect(five.has_more).toBe(false);

    const later = event(t, '2026-11-10', '2026-11-10', { id: uid(3) });
    const six = (await overview(t, admin.token)).upcoming;
    expect(six.items.map((i) => i.id)).toEqual([allDay.id, s20.id, e21.id, s21.id, s9.id]);
    expect(six.items.map((i) => i.id)).not.toContain(later.id);
    expect(six.has_more).toBe(true);
  });

  it('일정만 6개 → 앞 5개(D302 순서) + has_more, 내전만 6개 → 이른 5개 + has_more', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const ids = [6, 5, 4, 3, 2, 1].map((n) => event(t as TestApp, '2026-11-02', '2026-11-02', { id: uid(n) }).id);
    const e = (await overview(t, admin.token)).upcoming;
    expect(e.items.map((i) => i.id)).toEqual([...ids].reverse().slice(0, 5));
    expect(e.has_more).toBe(true);

    t.prisma.calendarEvent.rows = [];
    const host = await member(t, '방장');
    const sids = [0, 1, 2, 3, 4, 5].map((i) => scrim(t as TestApp, host, nowMs + (i + 1) * HOUR).id);
    const s = (await overview(t, admin.token)).upcoming;
    expect(s.items.map((i) => i.id)).toEqual(sids.slice(0, 5));
    expect(s.has_more).toBe(true);
  });
});

describe('GET /admin/results', () => {
  it('pending(오래된 것부터·can_review 자기 제출 false)·approved(7일 안·되돌리기 판정)·커서, disputed 보기 없음(D281)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    seedSeason(t, '시즌', '2026-10-01T00:00:00.000+09:00', '2026-12-01T00:00:00.000+09:00');
    const admin = await login(t, 'admin_a', 'admin');
    const admin2 = await login(t, 'admin_b', 'admin');
    const [a, b, c, d] = [await member(t, '가'), await member(t, '나'), await member(t, '다'), await member(t, '라')];
    const p1 = seedPendingTeamResult(t, [a, b], [c, d], { title: '첫 제출' });
    t.clock.advance(MIN);
    const p2 = seedPendingTeamResult(t, [admin.userId, b], [c, d], { title: '내 제출' });
    t.clock.advance(MIN);
    const appr = seedPendingTeamResult(t, [a, await member(t, '마')], [await member(t, '바'), await member(t, '사')], { winner: 'orange' });
    await approve(t, admin2, appr);
    // 8일 전 승인(목록 밖)
    const old = seedPendingTeamResult(t, [await member(t, '아')], [await member(t, '자')], { rated: false });
    const oldRow = t.prisma.scrimResult.rows.find((r) => r.id === old.resultId);
    if (oldRow) Object.assign(oldRow, { status: 'approved', approvedAt: new Date(t.clock.now().getTime() - 8 * DAY), approvedById: admin2.userId });

    const pending = ListAdminResultsResponse.parse(await json(await call(t, 'GET', '/admin/results', admin.token)));
    expect(pending.items.map((i) => i.result_id)).toEqual([p1.resultId, p2.resultId]);
    expect(pending.items[0]).toMatchObject({
      status: 'pending',
      can_review: true,
      can_revert: false,
      revert_blocked_reason: null,
      rating_status: 'waiting',
      outcome: { winner_team: 'blue', winner: null },
      scrim: { id: p1.scrimId, title: '첫 제출', rated: true, game: { code: 'lol' }, host: { id: a } },
      submitted_by: { id: a },
    });
    expect(pending.items[1]?.can_review).toBe(false);
    const pg1 = ListAdminResultsResponse.parse(await json(await call(t, 'GET', '/admin/results?view=pending&limit=1', admin.token)));
    const pg2 = ListAdminResultsResponse.parse(await json(await call(t, 'GET', `/admin/results?view=pending&limit=1&cursor=${pg1.next_cursor}`, admin.token)));
    expect(pg2.items.map((i) => i.result_id)).toEqual([p2.resultId]);
    await expectError(await call(t, 'GET', `/admin/results?view=approved&cursor=${pg1.next_cursor}`, admin.token), 400, 'VALIDATION_FAILED');

    const approved = ListAdminResultsResponse.parse(await json(await call(t, 'GET', '/admin/results?view=approved', admin.token)));
    expect(approved.items.map((i) => i.result_id)).toEqual([appr.resultId]);
    expect(approved.items[0]).toMatchObject({ rating_status: 'applied', can_revert: true, approved_by: { id: admin2.userId }, outcome: { winner_team: 'orange' } });

    await expectError(await call(t, 'GET', '/admin/results?view=all', admin.token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/admin/results?view=disputed', admin.token), 400, 'VALIDATION_FAILED');
  });
});

describe('GET /admin/no-show/scrims', () => {
  it('표시 기한 안 playing·finished 내전, 슬롯 순서, 최근 노쇼 수·제한·restrict_if_marked, 정책 값', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const [host, risky, ok, waiter] = [await member(t, '방장'), await member(t, '위험'), await member(t, '안전'), await member(t, '대기')];
    const days = t.config.scrim.noShowMarkWindowDays;
    const mk = (title: string, scheduledAt: number, status: 'playing' | 'finished' | 'recruiting' | 'cancelled') =>
      t?.prisma.scrim.insert({ gameId: t.prisma.gameId('lol'), hostId: host, title, scheduledAt: new Date(scheduledAt), capacity: 10, status }) as { id: string };
    const s1 = mk('진행 중', nowMs - HOUR, 'playing');
    const s2 = mk('기한 끝 직전', nowMs - days * DAY, 'finished');
    mk('기한 지남', nowMs - days * DAY - 1, 'finished');
    mk('모집 중', nowMs - HOUR, 'recruiting');
    mk('취소', nowMs - HOUR, 'cancelled');
    const join = (scrimId: string, userId: string, i: number, status: 'joined' | 'no_show' | 'waitlist' = 'joined') =>
      t?.prisma.scrimPlayer.insert({ scrimId, userId, status, joinedAt: new Date(nowMs - 10 * HOUR + i), noShowMarkedAt: status === 'no_show' ? new Date(nowMs - MIN) : null });
    join(s1.id, risky, 1);
    join(s1.id, host, 2);
    join(s1.id, ok, 3, 'no_show');
    join(s1.id, waiter, 4, 'waitlist');
    // risky는 최근 노쇼 2회 → 하나 더 표시하면 제한(threshold 3)
    noShowRow(t, risky, nowMs - DAY, host);
    noShowRow(t, risky, nowMs - 2 * DAY, host);

    const r = ListAdminNoShowScrimsResponse.parse(await json(await call(t, 'GET', '/admin/no-show/scrims', admin.token)));
    const titles = r.items.map((i) => i.title);
    expect(titles.slice(0, 1)).toEqual(['진행 중']);
    expect(titles).toContain('기한 끝 직전');
    expect(titles).not.toContain('기한 지남');
    expect(titles).not.toContain('모집 중');
    expect(titles).not.toContain('취소');
    const first = r.items[0];
    expect(first?.mark_deadline).toBe(new Date(nowMs - HOUR + days * DAY).toISOString());
    expect(first?.players.map((p) => p.user.id)).toEqual([host, risky, ok]);
    expect(first?.players.find((p) => p.user.id === risky)).toMatchObject({ status: 'joined', no_show_count_30d: 2, restricted_until: null, restrict_if_marked: true });
    expect(first?.players.find((p) => p.user.id === ok)).toMatchObject({ status: 'no_show', no_show_count_30d: 1, restrict_if_marked: false });
    expect(first?.players.find((p) => p.user.id === host)).toMatchObject({ no_show_count_30d: 0, restrict_if_marked: false });
    expect(r.policy).toEqual({
      threshold: t.config.scrim.noShow.threshold,
      window_days: t.config.scrim.noShow.windowDays,
      restriction_days: t.config.scrim.noShow.restrictionDays,
      mark_window_days: days,
    });
    void s2;
  });
});

describe('GET /admin/audit-logs', () => {
  it('created_at DESC, action 필터, 커서, 모르는 action 400', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    await call(t, 'POST', '/admin/notices', admin.token, { title: '첫 공지', body: '본문' });
    t.clock.advance(MIN);
    await call(t, 'POST', '/admin/api-keys', admin.token, { name: '봇', scopes: ['bot:notices'] });
    t.clock.advance(MIN);
    await call(t, 'POST', '/admin/notices', admin.token, { title: '둘째 공지', body: '본문' });
    const all = ListAdminAuditLogsResponse.parse(await json(await call(t, 'GET', '/admin/audit-logs', admin.token)));
    expect(all.items.map((i) => i.action)).toEqual(['notice.create', 'api_key.create', 'notice.create']);
    expect(all.items[0]).toMatchObject({ actor: { id: admin.userId }, target_type: 'notice', summary: "공지 '둘째 공지' 작성" });
    const notices = ListAdminAuditLogsResponse.parse(await json(await call(t, 'GET', '/admin/audit-logs?action=notice.create&limit=1', admin.token)));
    expect(notices.items.map((i) => i.summary)).toEqual(["공지 '둘째 공지' 작성"]);
    const next = ListAdminAuditLogsResponse.parse(
      await json(await call(t, 'GET', `/admin/audit-logs?action=notice.create&limit=1&cursor=${notices.next_cursor}`, admin.token)),
    );
    expect(next.items.map((i) => i.summary)).toEqual(["공지 '첫 공지' 작성"]);
    expect(next.next_cursor).toBeNull();
    await expectError(await call(t, 'GET', '/admin/audit-logs?action=scrim.approve', admin.token), 400, 'VALIDATION_FAILED');
  });
});
