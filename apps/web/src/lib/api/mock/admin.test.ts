import {
  API_KEY_PATTERN,
  ApiPath,
  ChangeMemberRoleResponse,
  CreateEventResponse,
  CreateApiKeyResponse,
  CreateSeasonResponse,
  DevLoginResponse,
  GetAdminOverviewResponse,
  GetCalendarResponse,
  GetDashboardSummaryResponse,
  GetMyNotificationSettingsResponse,
  GetScrimResponse,
  ListAdminApiKeysResponse,
  ListAdminAuditLogsResponse,
  ListAdminMembersResponse,
  ListAdminNoShowScrimsResponse,
  ListAdminResultsResponse,
  ListAdminSeasonsResponse,
  ListEventsResponse,
  ListNoticesResponse,
  ListPatchNotesResponse,
  ListScrimsResponse,
  RevertScrimResultResponse,
  SCRIM_RESULT_REVERT_WINDOW_DAYS,
  UpdateEventResponse,
  UpdateMyNotificationSettingsResponse,
  fillPath,
  type ScrimListStatus,
  type UserRole,
} from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { createApiClient, isApiError } from '../client';
import { createMockBackend, type MockDb } from './backend';
import type { MockAdminScenario } from './admin';

/** S6 목(28개 엔드포인트, D281 이후)이 계약을 지키는지: 실제 클라이언트(zod parse)로 호출 */
function setup(login: { username: string; role?: UserRole } = { username: 'staff_kim', role: 'admin' }, scenario: MockAdminScenario | null = null) {
  let db: MockDb | null = null;
  let now = Date.parse('2026-10-31T03:00:00.000Z');
  const mock = createMockBackend({
    storage: { get: () => db, set: (d) => (db = d) },
    cookies: { hasRefresh: () => true, setRefresh: () => {}, clearRefresh: () => {} },
    now: () => now,
    s1: { origin: () => 'http://localhost:3000' },
    s2: { admin: { scenario: () => scenario } },
  });
  const api = createApiClient({ fetch: mock.fetch });
  const ready = (async () => {
    const res = await api.request(ApiPath.authDevLogin, DevLoginResponse, { method: 'POST', body: login, auth: false });
    api.setSession(res);
    return res.user;
  })();
  const find = async (status: ScrimListStatus, title: string) => {
    const page = await api.request(`${ApiPath.scrims}?status=${status}&limit=100`, ListScrimsResponse);
    const s = page.items.find((x) => x.title === title);
    if (!s) throw new Error(`no scrim ${title}`);
    return s;
  };
  const get = (id: string) => api.request(fillPath(ApiPath.scrim, { id }), GetScrimResponse);
  const results = (view: string) => api.request(`${ApiPath.adminResults}?view=${view}&limit=100`, ListAdminResultsResponse);
  const revert = (id: string, result_id: string) =>
    api.request(fillPath(ApiPath.scrimResultRevert, { id }), RevertScrimResultResponse, { method: 'POST', body: { result_id, reason: '테스트 되돌리기' } });
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return isApiError(e) ? e.code : String(e);
    }
  };
  return { api, ready, find, get, results, revert, code, advance: (ms: number) => (now += ms) };
}

describe('S6 목: 권한', () => {
  it('비운영진은 /admin/*·되돌리기 403(없는 id여도)', async () => {
    const t = setup({ username: 'member_lee' });
    await t.ready;
    expect(await t.code(t.api.request(ApiPath.adminOverview, GetAdminOverviewResponse))).toBe('FORBIDDEN');
    expect(await t.code(t.revert('00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000'))).toBe('FORBIDDEN');
    // 읽기는 멤버 전원
    expect((await t.api.request(ApiPath.notices, ListNoticesResponse)).items.length).toBeGreaterThan(0);
  });
  it('demoted 시나리오: 403 뒤 GET /me가 member', async () => {
    const t = setup(undefined, 'demoted');
    await t.ready;
    expect(await t.code(t.api.request(ApiPath.adminOverview, GetAdminOverviewResponse))).toBe('FORBIDDEN');
    const me = (await (await t.api.request(ApiPath.me, DevLoginResponse.shape.user))) as { role: string };
    expect(me.role).toBe('member');
  });
});

describe('S6 목: 결과 큐·되돌리기(core revertBlockReason·planRatingRevert)', () => {
  it('최근 승인: 이후 경기 있으면 later_games로 비활성, 마지막 경기는 되돌리기 가능', async () => {
    const t = setup();
    await t.ready;
    const q = await t.results('approved');
    const late = q.items.find((r) => r.scrim.title === '불금 협곡 내전')!;
    const last = q.items.find((r) => r.scrim.title === '어제 밤 협곡 내전')!;
    expect(late).toMatchObject({ can_revert: false, revert_blocked_reason: 'later_games' });
    expect(last).toMatchObject({ can_revert: true, revert_blocked_reason: null });
    expect(await t.code(t.revert(late.scrim.id, late.result_id))).toBe('SCRIM_RESULT_REVERT_NOT_ALLOWED');
  });
  it('되돌리기: 레이팅 승인 전 값, 내전 playing, 감사 로그, 재입력 가능', async () => {
    const t = setup();
    await t.ready;
    const last = (await t.results('approved')).items.find((r) => r.scrim.title === '어제 밤 협곡 내전')!;
    const before = await t.get(last.scrim.id);
    expect(before.viewer.can_revert_result).toBe(true);
    const changes = before.result!.rating_changes;
    const d = await t.revert(last.scrim.id, last.result_id);
    expect(d.status).toBe('playing');
    expect(d.result_status).toBe('reverted');
    expect(d.result).toMatchObject({ status: 'reverted', revert_reason: '테스트 되돌리기', rating_status: 'waiting', rating_changes: [] });
    expect(d.viewer.can_submit_result).toBe(true);
    // 「불금」은 이제 그 참가자들의 마지막 경기 → 되돌리기 가능해진다
    const q2 = await t.results('approved');
    expect(q2.items.find((r) => r.scrim.title === '어제 밤 협곡 내전')).toBeUndefined();
    expect(q2.items.find((r) => r.scrim.title === '불금 협곡 내전')!.revert_blocked_reason).not.toBe('later_games');
    const audit = await t.api.request(`${ApiPath.adminAuditLogs}?action=result.revert`, ListAdminAuditLogsResponse);
    expect(audit.items[0]!.details).toMatchObject({ scrim_id: last.scrim.id });
    expect((audit.items[0]!.details.history as unknown[]).length).toBe(changes.length);
    // 다시 되돌리면 승인된 결과가 없다
    expect(await t.code(t.revert(last.scrim.id, last.result_id))).toBe('SCRIM_RESULT_NOT_APPROVED');
  });
  it('기한 지나면 window_passed', async () => {
    const t = setup();
    await t.ready;
    const last = (await t.results('approved')).items.find((r) => r.scrim.title === '어제 밤 협곡 내전')!;
    t.advance(SCRIM_RESULT_REVERT_WINDOW_DAYS * 86_400_000);
    const d = await t.get(last.scrim.id);
    expect(d.viewer).toMatchObject({ can_revert_result: false, revert_blocked_reason: 'window_passed' });
  });
  it('대기 큐: 내가 제출한 결과는 can_review false', async () => {
    const t = setup();
    await t.ready;
    const q = await t.results('pending');
    expect(q.items.find((r) => r.scrim.title === '내가 제출한 롤체 로비')!.can_review).toBe(false);
    expect(q.items.find((r) => r.scrim.title === '승인 대기 협곡 내전')!.can_review).toBe(true);
  });
});

describe('S6 목: 이의 제기 제거(D281)', () => {
  it('이의 제기 경로는 없고 상세·큐에 관련 필드가 없다', async () => {
    const t = setup();
    await t.ready;
    const s = await t.find('playing', '승인 대기 협곡 내전');
    const d = await t.get(s.id);
    expect(d.viewer).not.toHaveProperty('can_dispute_result');
    expect(d.result).not.toHaveProperty('open_dispute_count');
    expect(await t.code(t.api.request(`/scrims/${s.id}/result/disputes`, GetScrimResponse, { method: 'POST', body: {} }))).toBe('NOT_FOUND');
    expect(await t.code(t.api.request('/admin/disputes', GetScrimResponse))).toBe('NOT_FOUND');
    expect(await t.code(t.api.request(`${ApiPath.adminResults}?view=disputed`, ListAdminResultsResponse))).toBe('VALIDATION_FAILED');
  });
});

describe('S6 목: 노쇼·멤버·역할', () => {
  it('후보 내전 + 표시하면 제한·제한 중 태그 + 정책', async () => {
    const t = setup();
    await t.ready;
    const r = await t.api.request(`${ApiPath.adminNoShowScrims}?limit=100`, ListAdminNoShowScrimsResponse);
    const players = r.items.flatMap((s) => s.players);
    expect(players.some((p) => p.restrict_if_marked && p.user.nickname === '원딜장인')).toBe(true);
    expect(players.some((p) => p.user.nickname === '칼바람러' && p.restricted_until !== null)).toBe(true);
    expect(r.policy.threshold).toBeGreaterThan(0);
  });
  it('멤버 검색·정렬·상태, 역할 변경 5분기', async () => {
    const t = setup();
    const me = await t.ready;
    const all = await t.api.request(`${ApiPath.adminMembers}?limit=100`, ListAdminMembersResponse);
    expect(all.items.find((m) => m.user.nickname === '와드지기')!.status).toBe('left');
    expect(all.items.find((m) => m.user.nickname === '칼바람러')!.status).toBe('restricted');
    const search = await t.api.request(`${ApiPath.adminMembers}?q=${encodeURIComponent('AR')}`, ListAdminMembersResponse);
    expect(search.items.map((m) => m.user.nickname)).toContain('칼바람러');
    const locked = all.items.find((m) => m.role_locked)!;
    const role = (id: string, r: UserRole) => t.api.request(fillPath(ApiPath.adminMemberRole, { id }), ChangeMemberRoleResponse, { method: 'PATCH', body: { role: r } });
    expect(await t.code(role(me.id, 'member'))).toBe('ADMIN_SELF_ROLE_CHANGE');
    expect(await t.code(role(locked.user.id, 'member'))).toBe('ADMIN_ROLE_LOCKED');
    const target = all.items.find((m) => m.user.nickname === '한타각')!;
    expect((await role(target.user.id, 'admin')).role).toBe('admin');
    const audit = await t.api.request(`${ApiPath.adminAuditLogs}?action=member.role_change`, ListAdminAuditLogsResponse);
    expect(audit.items[0]!.details).toEqual({ from: 'member', to: 'admin' });
  });
});

describe('S6 목: API 키·시즌', () => {
  it('원문은 발급 응답에만, 목록엔 prefix만', async () => {
    const t = setup();
    await t.ready;
    const res = await t.api.request(ApiPath.adminApiKeys, CreateApiKeyResponse, { method: 'POST', body: { name: '테스트 봇', scopes: ['bot:notices'] } });
    expect(res.key).toMatch(API_KEY_PATTERN);
    const list = await t.api.request(ApiPath.adminApiKeys, ListAdminApiKeysResponse);
    expect(JSON.stringify(list)).not.toContain(res.key);
    expect(list.items[0]!.key_prefix).toBe(res.key.slice(4, 12));
  });
  it('시즌 editable·생성 검사(lead, 겹침)', async () => {
    const t = setup();
    await t.ready;
    const list = await t.api.request(ApiPath.adminSeasons, ListAdminSeasonsResponse);
    const cur = list.items.find((s) => s.phase === 'current')!;
    expect(cur.editable).toEqual({ name: true, starts_at: false, ends_at: true, delete: false });
    expect(list.items.find((s) => s.phase === 'closed')!.editable.ends_at).toBe(false);
    const soon = new Date(Date.parse('2026-10-31T03:00:00.000Z') + 30 * 60_000).toISOString();
    expect(await t.code(t.api.request(ApiPath.adminSeasons, CreateSeasonResponse, { method: 'POST', body: { name: '너무 이른 시즌', starts_at: soon, ends_at: '2026-12-31T00:00:00.000Z' } }))).toBe('VALIDATION_FAILED');
    expect(await t.code(t.api.request(ApiPath.adminSeasons, CreateSeasonResponse, { method: 'POST', body: { name: '겹침', starts_at: '2026-11-05T00:00:00.000Z', ends_at: '2026-12-05T00:00:00.000Z' } }))).toBe('SEASON_OVERLAP');
    const created = await t.api.request(ApiPath.adminSeasons, CreateSeasonResponse, { method: 'POST', body: { name: '시즌 9', starts_at: cur.ends_at, ends_at: '2027-12-01T00:00:00.000Z' } });
    expect(created).toMatchObject({ phase: 'upcoming', editable: { delete: true } });
  });
});

describe('S6 목: 정보·홈·알림 설정', () => {
  it('공지·패치노트·이벤트, 홈 news 블록(패치 2 + 이벤트 2, subtitle)', async () => {
    const t = setup({ username: 'member_choi' });
    await t.ready;
    const patches = await t.api.request(`${ApiPath.patchNotes}?game=tft`, ListPatchNotesResponse);
    expect(patches.items.every((p) => p.game.code === 'tft')).toBe(true);
    const ev = await t.api.request(ApiPath.events, ListEventsResponse);
    expect(ev.from).toBe('2026-10-01');
    expect(ev.to).toBe('2026-10-31');
    const home = await t.api.request(ApiPath.dashboardSummary, GetDashboardSummaryResponse);
    expect(home.news.notice?.title).toBe('11월 내전 일정 안내');
    expect(home.news.items.map((i) => i.kind)).toEqual(['patch_note', 'patch_note', 'event', 'event']);
    expect(home.news.items[0]!.subtitle).not.toContain('\n');
  });
  it('empty 시나리오: 홈 news 비고 목록 빈 값', async () => {
    const t = setup({ username: 'member_choi' }, 'empty');
    await t.ready;
    expect((await t.api.request(ApiPath.dashboardSummary, GetDashboardSummaryResponse)).news).toEqual({ notice: null, items: [] });
    expect((await t.api.request(ApiPath.notices, ListNoticesResponse)).items).toEqual([]);
  });
  it('알림 설정 GET·PATCH(dev-login은 discord_linked false), 빈 본문 400', async () => {
    const t = setup({ username: 'member_choi' });
    await t.ready;
    const g = await t.api.request(ApiPath.myNotificationSettings, GetMyNotificationSettingsResponse);
    expect(g).toEqual({ scrim_start: true, patch: false, discord_linked: false });
    const p = await t.api.request(ApiPath.myNotificationSettings, UpdateMyNotificationSettingsResponse, { method: 'PATCH', body: { patch: true } });
    expect(p.patch).toBe(true);
    expect(await t.code(t.api.request(ApiPath.myNotificationSettings, UpdateMyNotificationSettingsResponse, { method: 'PATCH', body: {} }))).toBe('VALIDATION_FAILED');
  });
});

describe('S6 후속 목: 커뮤니티 캘린더 GET /calendar(계약 S6 23-2, core calendarMonthRange·resolveCalendarMonth)', () => {
  const cal = (t: ReturnType<typeof setup>, q = '') => t.api.request(`${ApiPath.calendar}${q}`, GetCalendarResponse);
  it('month 생략 = 오늘(KST) 달 격자, 일정 → 내전 순, 취소 제외, 값은 같은 요청자의 GET /scrims 카드와 같다', async () => {
    const t = setup({ username: 'member_choi' });
    await t.ready;
    const c = await cal(t);
    expect(c).toMatchObject({ month: '2026-10', from: '2026-09-28', to: '2026-11-01', truncated: { scrims: false, events: false } });
    const kinds = c.items.map((i) => i.kind);
    expect(kinds.indexOf('scrim')).toBeGreaterThan(kinds.lastIndexOf('event'));
    const scrims = c.items.filter((i) => i.kind === 'scrim');
    expect(scrims.length).toBeGreaterThan(0);
    expect(scrims.some((s) => s.title === '주말 스팀 파티')).toBe(false); // cancelled 시드
    const at = scrims.map((s) => Date.parse(s.scheduled_at));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const s of scrims) {
      expect(Date.parse(s.scheduled_at)).toBeGreaterThanOrEqual(Date.parse('2026-09-27T15:00:00.000Z'));
      expect(Date.parse(s.scheduled_at)).toBeLessThan(Date.parse('2026-11-01T15:00:00.000Z'));
      expect(s).not.toHaveProperty('host');
      expect(s).not.toHaveProperty('players');
    }
    const ev = c.items.filter((i) => i.kind === 'event');
    expect(ev.every((e) => e.starts_on <= c.to && e.ends_on >= c.from)).toBe(true);
    // 목록 카드와 같은 값(D287)
    const card = await t.find('open', '화요일 저녁 5:5 내전');
    const item = scrims.find((s) => s.id === card.id)!;
    expect(item).toMatchObject({
      date: '2026-10-31',
      status: card.status,
      capacity: card.capacity,
      joined_count: card.joined_count,
      join_closed: card.join_closed,
      my_status: card.my_status,
      result_status: card.result_status,
    });
  });
  it('다음 달: 앞으로의 모집이 KST 날짜로 나온다', async () => {
    const t = setup({ username: 'member_choi' });
    await t.ready;
    const c = await cal(t, '?month=2026-11');
    expect(c).toMatchObject({ month: '2026-11', from: '2026-10-26', to: '2026-12-06' });
    expect(c.items.some((i) => i.kind === 'scrim' && i.title === '주말 협곡 2판 연속')).toBe(true);
  });
  it('game 필터: 그 게임 내전·일정만, 게임 무관 일정(game null) 제외', async () => {
    const t = setup({ username: 'member_choi' });
    await t.ready;
    const all = await cal(t);
    expect(all.items.some((i) => i.kind === 'event' && i.game === null)).toBe(true);
    const c = await cal(t, '?game=tft');
    expect(c.items.length).toBeGreaterThan(0);
    expect(c.items.every((i) => i.game?.code === 'tft')).toBe(true);
  });
  it('형식 오류 400(month, game)', async () => {
    const t = setup({ username: 'member_choi' });
    await t.ready;
    expect(await t.code(cal(t, '?month=2026-13'))).toBe('VALIDATION_FAILED');
    expect(await t.code(cal(t, '?month=2026-1'))).toBe('VALIDATION_FAILED');
    expect(await t.code(cal(t, '?game=valorant'))).toBe('VALIDATION_FAILED');
  });
  it('empty 시나리오: items []', async () => {
    const t = setup({ username: 'member_choi' }, 'empty');
    await t.ready;
    expect((await cal(t)).items).toEqual([]);
  });
  it('운영진 일정 추가 → 캘린더에 나오고, 수정 → 바뀐 값, 삭제 → 사라진다(기존 /admin/events)', async () => {
    const t = setup();
    await t.ready;
    const created = await t.api.request(ApiPath.adminEvents, CreateEventResponse, {
      method: 'POST',
      body: { game: null, title: '캘린더 테스트 일정', description: null, url: null, starts_on: '2026-10-14', ends_on: '2026-10-14' },
    });
    const has = async (title: string) => (await cal(t)).items.find((i) => i.kind === 'event' && i.id === created.id && i.title === title);
    expect(await has('캘린더 테스트 일정')).toMatchObject({ kind: 'event', starts_on: '2026-10-14', game: null });
    await t.api.request(fillPath(ApiPath.adminEvent, { id: created.id }), UpdateEventResponse, { method: 'PATCH', body: { title: '고친 일정' } });
    expect(await has('고친 일정')).toBeDefined();
    await t.api.request(fillPath(ApiPath.adminEvent, { id: created.id }), null, { method: 'DELETE' });
    expect((await cal(t)).items.some((i) => i.id === created.id)).toBe(false);
  });
});

describe('S6 후속 목: 일정 시각(23-8, D298–D302, shared eventScheduleIssues·core compareEventSchedule)', () => {
  const post = (t: ReturnType<typeof setup>, body: Record<string, unknown>) =>
    t.api.request(ApiPath.adminEvents, CreateEventResponse, { method: 'POST', body: { game: null, description: null, url: null, ...body } });
  const patch = (t: ReturnType<typeof setup>, id: string, body: Record<string, unknown>) =>
    t.api.request(fillPath(ApiPath.adminEvent, { id }), UpdateEventResponse, { method: 'PATCH', body });
  const detailPath = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return isApiError(e) ? `${e.code}:${(e.details ?? []).map((d) => d.path).join(',')}` : String(e);
    }
  };

  it('생성: 시각 저장·응답, 종일 null, end_time만 400, 같은 날 역순 400, 여러 날 역순 통과', async () => {
    const t = setup();
    await t.ready;
    const a = await post(t, { title: '시각 일정', starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: '21:00', end_time: '23:00' });
    expect(a).toMatchObject({ start_time: '21:00', end_time: '23:00' });
    const b = await post(t, { title: '종일 일정', starts_on: '2026-11-08' });
    expect(b).toMatchObject({ start_time: null, end_time: null, ends_on: '2026-11-08' });
    expect(await detailPath(post(t, { title: '시각 검사', starts_on: '2026-11-08', end_time: '23:00' }))).toBe('VALIDATION_FAILED:end_time');
    expect(await detailPath(post(t, { title: '시각 검사', starts_on: '2026-11-08', start_time: '21:00', end_time: '20:59' }))).toBe('VALIDATION_FAILED:end_time');
    expect(await detailPath(post(t, { title: '시각 검사', starts_on: '2026-11-08', start_time: '21:00', end_time: '21:00' }))).toBe('ok');
    expect(await detailPath(post(t, { title: '시각 검사', starts_on: '2026-11-08', ends_on: '2026-11-10', start_time: '21:00', end_time: '18:00' }))).toBe('ok');
    const audit = await t.api.request(`${ApiPath.adminAuditLogs}?action=event.create`, ListAdminAuditLogsResponse);
    expect(audit.items.find((x) => x.target_id === a.id)!.details).toMatchObject({ start_time: '21:00', end_time: '23:00' });
  });

  it('PATCH 병합 검사(D300 예): 역순 400, start_time: null 단독 400, 둘 다 null이면 종일, 여러 날이면 통과', async () => {
    const t = setup();
    await t.ready;
    const e = await post(t, { title: '병합', starts_on: '2026-11-08', start_time: '21:00', end_time: '23:00' });
    expect(await detailPath(patch(t, e.id, { start_time: '23:30' }))).toBe('VALIDATION_FAILED:end_time');
    expect(await detailPath(patch(t, e.id, { start_time: null }))).toBe('VALIDATION_FAILED:end_time');
    expect(await patch(t, e.id, { ends_on: '2026-11-09', start_time: '23:30' })).toMatchObject({ start_time: '23:30', end_time: '23:00', ends_on: '2026-11-09' });
    expect(await patch(t, e.id, { start_time: null, end_time: null })).toMatchObject({ start_time: null, end_time: null });
    expect(await detailPath(patch(t, e.id, { ends_on: '2026-11-07' }))).toBe('VALIDATION_FAILED:ends_on');
  });

  it('정렬: 같은 날 종일 → 08:00 → 21:00, 그다음 ends_on(GET /events·캘린더 공통)', async () => {
    const t = setup();
    await t.ready;
    const late = await post(t, { title: '정렬 21시', starts_on: '2026-11-20', start_time: '21:00' });
    const early = await post(t, { title: '정렬 08시', starts_on: '2026-11-20', start_time: '08:00' });
    const allDayLong = await post(t, { title: '정렬 종일 이틀', starts_on: '2026-11-20', ends_on: '2026-11-21' });
    const allDay = await post(t, { title: '정렬 종일', starts_on: '2026-11-20' });
    const want = [allDay.id, allDayLong.id, early.id, late.id];
    const ev = await t.api.request(`${ApiPath.events}?from=2026-11-20&to=2026-11-20`, ListEventsResponse);
    expect(ev.items.map((x) => x.id).filter((id) => want.includes(id))).toEqual(want);
    const c = await t.api.request(`${ApiPath.calendar}?month=2026-11`, GetCalendarResponse);
    expect(c.items.map((x) => x.id).filter((id) => want.includes(id))).toEqual(want);
  });

  it('시드: 시각 있는 일정(시작·끝)과 시작만 있는 일정, 홈 news 이벤트 행에도 시각', async () => {
    const t = setup({ username: 'member_choi' });
    await t.ready;
    const c = await t.api.request(`${ApiPath.calendar}?month=2026-11`, GetCalendarResponse);
    const ev = c.items.filter((i) => i.kind === 'event');
    expect(ev.some((e) => e.start_time && e.end_time)).toBe(true);
    expect(ev.some((e) => e.start_time && e.end_time === null)).toBe(true);
    // 목은 필수 시각 필드(D305 2단계)를 항상 채운다
    expect(ev.every((e) => e.start_time !== undefined && e.end_time !== undefined)).toBe(true);
    const home = await t.api.request(ApiPath.dashboardSummary, GetDashboardSummaryResponse);
    for (const n of home.news.items) if (n.kind === 'event') expect(n.start_time).not.toBeUndefined();
  });
});

describe('S6 후속 목: 「다가오는 일정」 overview.upcoming(23-8-4, core upcomingWindow·mergeUpcomingItems)', () => {
  const overview = (t: ReturnType<typeof setup>) => t.api.request(ApiPath.adminOverview, GetAdminOverviewResponse);
  it('구간·정렬·취소 제외·지난 내전 제외, shared parse 통과', async () => {
    const t = setup();
    await t.ready;
    const o = await overview(t);
    const u = o.upcoming!;
    expect(u).toMatchObject({ from: '2026-10-31', to: '2026-11-30' });
    expect(u.items.length).toBeGreaterThan(0);
    expect(u.items.length).toBeLessThanOrEqual(5);
    const startOf = (i: (typeof u.items)[number]) =>
      i.kind === 'event' ? Date.parse(`${i.starts_on}T${i.start_time ?? '00:00'}:00+09:00`) : Date.parse(i.scheduled_at);
    const starts = u.items.map(startOf);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const i of u.items) {
      if (i.kind === 'scrim') {
        expect(i.status).not.toBe('cancelled');
        expect(Date.parse(i.scheduled_at)).toBeGreaterThanOrEqual(Date.parse('2026-10-31T03:00:00.000Z'));
        expect(i).not.toHaveProperty('host');
      } else {
        expect(i.ends_on >= u.from && i.starts_on <= u.to).toBe(true);
      }
    }
  });
  it('6개 이상이면 5개 + has_more, 진행 중 여러 날 일정이 맨 앞', async () => {
    const t = setup();
    await t.ready;
    for (let i = 0; i < 6; i += 1) {
      await t.api.request(ApiPath.adminEvents, CreateEventResponse, {
        method: 'POST',
        body: { game: null, title: `내일 일정 ${i}`, description: null, url: null, starts_on: '2026-11-01', start_time: '00:00' },
      });
    }
    const u = (await overview(t)).upcoming!;
    expect(u.items).toHaveLength(5);
    expect(u.has_more).toBe(true);
    // 시드 「서버 2주년 이벤트」(어제 시작, 진행 중)가 가장 먼저
    expect(u.items[0]).toMatchObject({ kind: 'event', title: '서버 2주년 이벤트' });
  });
  it('empty 시나리오: items [], has_more false', async () => {
    const t = setup(undefined, 'empty');
    await t.ready;
    expect((await overview(t)).upcoming).toEqual({ from: '2026-10-31', to: '2026-11-30', items: [], has_more: false });
  });
});
