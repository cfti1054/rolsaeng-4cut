/**
 * S6 공지·패치노트·이벤트(공개 GET + 운영진 CRUD + 감사), 홈 news 블록, 알림 설정 HTTP 테스트(DB 없이, 계약 S6 8·9절).
 * 고정 시계 2026-10-31T15:30Z = KST 11-01 00:30(자정 직후, 날짜가 하루 밀리지 않는지 확인).
 * `@db.Date` 실제 왕복은 test/db/admin.db.e2e.spec.ts.
 */
import {
  EventView,
  GetDashboardSummaryResponse,
  GetMeResponse,
  GetMyNotificationSettingsResponse,
  ListEventsResponse,
  ListNoticesResponse,
  ListPatchNotesResponse,
  NoticeView,
  PatchNoteView,
} from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { type Who, login } from './support/s4-helpers';
import { MIN, auditRows, json } from './support/s6-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-31T15:30:00.000Z';

async function setup(clock = NOW) {
  t = await createTestApp({ fixedClock: clock });
  const admin = await login(t, 'admin_a', 'admin');
  const admin2 = await login(t, 'admin_b', 'admin');
  const user = await login(t, 'member_u');
  return { app: t, admin, admin2, user };
}

const post = (app: TestApp, who: Who, path: string, body: unknown) => call(app, 'POST', path, who.token, body);
const patch = (app: TestApp, who: Who, path: string, body: unknown) => call(app, 'PATCH', path, who.token, body);
const del = (app: TestApp, who: Who, path: string) => call(app, 'DELETE', path, who.token);

describe('공지 CRUD + 감사', () => {
  it('작성 201 → 수정(다른 운영진, author 불변, before/after) → 같은 값 PATCH는 감사 없음 → 삭제 204(삭제 전 전체 값) → 다시 삭제 404', async () => {
    const { app, admin, admin2, user } = await setup();
    const created = NoticeView.parse(
      await json(await post(app, admin, '/admin/notices', { title: '  11월   내전 일정 ', body: '첫 줄\r\n둘째 줄  ', notify_discord: true }), 201),
    );
    expect(created).toMatchObject({ title: '11월 내전 일정', body: '첫 줄\n둘째 줄', author: { id: admin.userId }, notify_discord: true, discord_notified_at: null });
    expect(auditRows(app, 'notice.create')[0]).toMatchObject({
      actorId: admin.userId,
      targetType: 'notice',
      targetId: created.id,
      summary: "공지 '11월 내전 일정' 작성",
      details: { title: '11월 내전 일정', body: '첫 줄\n둘째 줄', notify_discord: true },
    });

    const updated = NoticeView.parse(await json(await patch(app, admin2, `/admin/notices/${created.id}`, { title: '11월 내전 일정(수정)', body: '첫 줄\n둘째 줄' })));
    expect(updated.author.id).toBe(admin.userId);
    expect(updated.title).toBe('11월 내전 일정(수정)');
    const upd = auditRows(app, 'notice.update');
    expect(upd).toHaveLength(1);
    expect(upd[0]).toMatchObject({
      actorId: admin2.userId,
      details: { before: { title: '11월 내전 일정' }, after: { title: '11월 내전 일정(수정)' } },
    });
    expect(Object.keys((upd[0]?.details as { after: object }).after)).toEqual(['title']);

    expect((await patch(app, admin, `/admin/notices/${created.id}`, { title: '11월 내전 일정(수정)' })).status).toBe(200);
    expect(auditRows(app, 'notice.update')).toHaveLength(1);

    const list = ListNoticesResponse.parse(await json(await call(app, 'GET', '/notices', user.token)));
    expect(list.items.map((n) => n.id)).toEqual([created.id]);
    expect(JSON.stringify(list)).not.toMatch(/discord_id|email/);

    expect((await del(app, admin2, `/admin/notices/${created.id}`)).status).toBe(204);
    expect(app.prisma.notice.rows).toHaveLength(0);
    const delAudit = auditRows(app, 'notice.delete')[0];
    expect(delAudit).toMatchObject({
      targetId: created.id,
      summary: "공지 '11월 내전 일정(수정)' 삭제",
      details: { id: created.id, title: '11월 내전 일정(수정)', author_id: admin.userId, notify_discord: true, discord_notified_at: null },
    });
    await expectError(await del(app, admin, `/admin/notices/${created.id}`), 404, 'NOT_FOUND');
    await expectError(await patch(app, admin, `/admin/notices/${created.id}`, { title: '없는 공지' }), 404, 'NOT_FOUND');
  });

  it('전송 뒤 notify_discord 변경 409 DISCORD_ALREADY_NOTIFIED, 같은 값·제목 수정은 통과', async () => {
    const { app, admin } = await setup();
    const n = NoticeView.parse(await json(await post(app, admin, '/admin/notices', { title: '봇 공지', body: '내용', notify_discord: true }), 201));
    const row = app.prisma.notice.rows[0];
    if (row) row.discordNotifiedAt = new Date(NOW);
    await expectError(await patch(app, admin, `/admin/notices/${n.id}`, { notify_discord: false }), 409, 'DISCORD_ALREADY_NOTIFIED');
    expect((await patch(app, admin, `/admin/notices/${n.id}`, { notify_discord: true, title: '봇 공지 수정' })).status).toBe(200);
    expect(app.prisma.notice.rows[0]?.discordNotifiedAt?.toISOString()).toBe(NOW);
  });

  it('검증: 빈 PATCH·모르는 필드·짧은 제목 400, uuid 아닌 id 400(운영진), 비운영진은 없는 id여도 403, 비로그인 401', async () => {
    const { app, admin, user } = await setup();
    await expectError(await patch(app, admin, '/admin/notices/00000000-0000-4000-8000-000000000001', {}), 400, 'VALIDATION_FAILED');
    await expectError(await post(app, admin, '/admin/notices', { title: '공지', body: 'x', extra: 1 }), 400, 'VALIDATION_FAILED');
    await expectError(await post(app, admin, '/admin/notices', { title: '공', body: 'x' }), 400, 'VALIDATION_FAILED');
    await expectError(await patch(app, admin, '/admin/notices/not-a-uuid', { title: '제목제목' }), 400, 'VALIDATION_FAILED');
    for (const [m, p] of [
      ['POST', '/admin/notices'],
      ['PATCH', '/admin/notices/00000000-0000-4000-8000-000000000001'],
      ['DELETE', '/admin/notices/00000000-0000-4000-8000-000000000001'],
      ['POST', '/admin/patch-notes'],
      ['PATCH', '/admin/patch-notes/00000000-0000-4000-8000-000000000001'],
      ['DELETE', '/admin/patch-notes/00000000-0000-4000-8000-000000000001'],
      ['POST', '/admin/events'],
      ['PATCH', '/admin/events/00000000-0000-4000-8000-000000000001'],
      ['DELETE', '/admin/events/00000000-0000-4000-8000-000000000001'],
    ] as const) {
      await expectError(await call(app, m, p, user.token, m === 'DELETE' ? undefined : { title: '제목제목' }), 403, 'FORBIDDEN');
      await expectError(await call(app, m, p, undefined, m === 'DELETE' ? undefined : {}), 401, 'UNAUTHENTICATED');
    }
    for (const p of ['/notices', '/patch-notes', '/events']) {
      await expectError(await call(app, 'GET', p), 401, 'UNAUTHENTICATED');
      expect((await call(app, 'GET', p, user.token)).status).toBe(200);
    }
  });

  it('목록: created_at DESC, id DESC + 커서', async () => {
    const { app, admin, user } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(NoticeView.parse(await json(await post(app, admin, '/admin/notices', { title: `공지 ${i}번`, body: '내용' }), 201)).id);
      app.clock.advance(MIN);
    }
    const p1 = ListNoticesResponse.parse(await json(await call(app, 'GET', '/notices?limit=2', user.token)));
    expect(p1.items.map((n) => n.id)).toEqual([ids[2], ids[1]]);
    const p2 = ListNoticesResponse.parse(await json(await call(app, 'GET', `/notices?limit=2&cursor=${p1.next_cursor}`, user.token)));
    expect(p2.items.map((n) => n.id)).toEqual([ids[0]]);
    expect(p2.next_cursor).toBeNull();
    await expectError(await call(app, 'GET', '/notices?cursor=abc', user.token), 400, 'VALIDATION_FAILED');
  });
});

describe('패치노트', () => {
  it('작성(KST 자정 직후 날짜 그대로)·게임 필터·정렬·커서·수정·삭제·감사', async () => {
    const { app, admin, user } = await setup();
    const a = PatchNoteView.parse(
      await json(
        await post(app, admin, '/admin/patch-notes', {
          game: 'lol',
          version: '26.22',
          title: '26.22 패치',
          summary: '챔피언 조정\n아이템',
          url: 'https://example.com/patch',
          published_on: '2026-11-01',
          notify_discord: true,
        }),
        201,
      ),
    );
    expect(a).toMatchObject({ published_on: '2026-11-01', game: { code: 'lol' }, version: '26.22', url: 'https://example.com/patch' });
    expect(app.prisma.patchNote.rows[0]?.publishedOn.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(auditRows(app, 'patch_note.create')[0]?.details).toMatchObject({ game: 'lol', published_on: '2026-11-01', notify_discord: true });

    const b = PatchNoteView.parse(
      await json(await post(app, admin, '/admin/patch-notes', { game: 'tft', title: '롤체 패치', summary: '요약', published_on: '2026-10-30' }), 201),
    );
    expect(b).toMatchObject({ version: null, url: null, notify_discord: false });
    app.clock.advance(MIN);
    const c = PatchNoteView.parse(
      await json(await post(app, admin, '/admin/patch-notes', { game: 'lol', title: '핫픽스', summary: '요약', published_on: '2026-11-01' }), 201),
    );

    const all = ListPatchNotesResponse.parse(await json(await call(app, 'GET', '/patch-notes', user.token)));
    expect(all.items.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    const lol = ListPatchNotesResponse.parse(await json(await call(app, 'GET', '/patch-notes?game=lol&limit=1', user.token)));
    expect(lol.items.map((p) => p.id)).toEqual([c.id]);
    const lol2 = ListPatchNotesResponse.parse(await json(await call(app, 'GET', `/patch-notes?game=lol&limit=1&cursor=${lol.next_cursor}`, user.token)));
    expect(lol2.items.map((p) => p.id)).toEqual([a.id]);
    expect(lol2.next_cursor).toBeNull();
    await expectError(await call(app, 'GET', '/patch-notes?game=wow', user.token), 400, 'VALIDATION_FAILED');
    // 커서 날짜 자리가 달력에 없는 날 → 400 path cursor(QA minor 2)
    for (const d of ['2026-13-45', '2026-02-30']) {
      const c = Buffer.from(JSON.stringify({ k: 'patch-notes', v: [d, NOW, a.id] })).toString('base64url');
      const bad = await expectError(await call(app, 'GET', `/patch-notes?cursor=${c}`, user.token), 400, 'VALIDATION_FAILED');
      expect(bad.details?.[0]?.path).toBe('cursor');
    }

    const upd = PatchNoteView.parse(await json(await patch(app, admin, `/admin/patch-notes/${b.id}`, { game: 'lol', url: 'http://example.com/x', published_on: '2026-10-29' })));
    expect(upd).toMatchObject({ game: { code: 'lol' }, url: 'http://example.com/x', published_on: '2026-10-29' });
    expect(auditRows(app, 'patch_note.update')[0]?.details).toEqual({
      before: { game: 'tft', url: null, published_on: '2026-10-30' },
      after: { game: 'lol', url: 'http://example.com/x', published_on: '2026-10-29' },
    });
    expect((await patch(app, admin, `/admin/patch-notes/${b.id}`, { url: null })).status).toBe(200);
    expect(app.prisma.patchNote.rows.find((r) => r.id === b.id)?.url).toBeNull();

    await expectError(await post(app, admin, '/admin/patch-notes', { game: 'lol', title: '나쁜 링크', summary: 's', published_on: '2026-11-01', url: 'javascript:alert(1)' }), 400, 'VALIDATION_FAILED');
    await expectError(await post(app, admin, '/admin/patch-notes', { game: 'lol', title: '없는 날짜', summary: 's', published_on: '2026-02-30' }), 400, 'VALIDATION_FAILED');

    // 전송 뒤 notify 변경 409
    const row = app.prisma.patchNote.rows.find((r) => r.id === a.id);
    if (row) row.discordNotifiedAt = new Date(NOW);
    await expectError(await patch(app, admin, `/admin/patch-notes/${a.id}`, { notify_discord: false }), 409, 'DISCORD_ALREADY_NOTIFIED');

    expect((await del(app, admin, `/admin/patch-notes/${a.id}`)).status).toBe(204);
    expect(auditRows(app, 'patch_note.delete')[0]?.details).toMatchObject({ id: a.id, game: 'lol', title: '26.22 패치', published_on: '2026-11-01' });
    await expectError(await del(app, admin, `/admin/patch-notes/${a.id}`), 404, 'NOT_FOUND');
  });

  it('games 행이 없는 코드 → 400 path game', async () => {
    const { app, admin } = await setup();
    app.prisma.game.rows = app.prisma.game.rows.filter((g) => g.code !== 'steam');
    const body = await expectError(
      await post(app, admin, '/admin/patch-notes', { game: 'steam', title: '스팀 소식', summary: 's', published_on: '2026-11-01' }),
      400,
      'VALIDATION_FAILED',
    );
    expect(body.details?.[0]?.path).toBe('game');
    await expectError(await post(app, admin, '/admin/events', { game: 'steam', title: '스팀 행사', starts_on: '2026-11-01' }), 400, 'VALIDATION_FAILED');
  });
});

describe('이벤트', () => {
  it('기본 구간 = 오늘(KST 11-01)이 속한 달, 겹침 조건·정렬·게임 필터(게임 무관 행 제외)·커서', async () => {
    const { app, admin, user } = await setup();
    const mk = async (body: Record<string, unknown>) => EventView.parse(await json(await post(app, admin, '/admin/events', body), 201));
    const octEnd = await mk({ title: '10월 말 행사', starts_on: '2026-10-25', ends_on: '2026-11-01' });
    const oct = await mk({ title: '10월 행사', starts_on: '2026-10-01', ends_on: '2026-10-31' });
    const single = await mk({ game: 'lol', title: '하루 행사', starts_on: '2026-11-15' });
    expect(single.ends_on).toBe('2026-11-15');
    const dec = await mk({ title: '12월 행사', starts_on: '2026-12-01', ends_on: '2026-12-02' });
    const novEnd = await mk({ game: 'lol', title: '월말 행사', starts_on: '2026-11-30', ends_on: '2026-12-05' });
    await expectError(await post(app, admin, '/admin/events', { title: '거꾸로', starts_on: '2026-11-02', ends_on: '2026-11-01' }), 400, 'VALIDATION_FAILED');

    const def = ListEventsResponse.parse(await json(await call(app, 'GET', '/events', user.token)));
    expect(def).toMatchObject({ from: '2026-11-01', to: '2026-11-30' });
    expect(def.items.map((e) => e.id)).toEqual([octEnd.id, single.id, novEnd.id]);
    const lol = ListEventsResponse.parse(await json(await call(app, 'GET', '/events?game=lol&limit=1', user.token)));
    expect(lol.items.map((e) => e.id)).toEqual([single.id]);
    const lol2 = ListEventsResponse.parse(await json(await call(app, 'GET', `/events?game=lol&limit=1&cursor=${lol.next_cursor}`, user.token)));
    expect(lol2.items.map((e) => e.id)).toEqual([novEnd.id]);
    const fromOnly = ListEventsResponse.parse(await json(await call(app, 'GET', '/events?from=2026-10-15', user.token)));
    expect(fromOnly).toMatchObject({ from: '2026-10-15', to: '2026-10-31' });
    expect(fromOnly.items.map((e) => e.id)).toEqual([oct.id, octEnd.id]);
    const toOnly = ListEventsResponse.parse(await json(await call(app, 'GET', '/events?to=2026-12-01', user.token)));
    expect(toOnly.from).toBe('2026-12-01');
    expect(toOnly.items.map((e) => e.id)).toEqual([novEnd.id, dec.id]);
    await expectError(await call(app, 'GET', '/events?from=2026-11-01&to=2027-03-01', user.token), 400, 'VALIDATION_FAILED');
  });

  it('PATCH 한쪽 날짜는 저장값과 합쳐 검사(path ends_on), game null로 비우기, 감사', async () => {
    const { app, admin } = await setup();
    const e = EventView.parse(await json(await post(app, admin, '/admin/events', { game: 'tft', title: '롤체 대회', starts_on: '2026-11-10', ends_on: '2026-11-12' }), 201));
    const bad = await expectError(await patch(app, admin, `/admin/events/${e.id}`, { ends_on: '2026-11-09' }), 400, 'VALIDATION_FAILED');
    expect(bad.details?.[0]?.path).toBe('ends_on');
    const bad2 = await expectError(await patch(app, admin, `/admin/events/${e.id}`, { starts_on: '2025-11-01' }), 400, 'VALIDATION_FAILED');
    expect(bad2.details?.[0]?.path).toBe('ends_on');
    const ok = EventView.parse(await json(await patch(app, admin, `/admin/events/${e.id}`, { starts_on: '2026-11-11', game: null })));
    expect(ok).toMatchObject({ starts_on: '2026-11-11', ends_on: '2026-11-12', game: null });
    expect(auditRows(app, 'event.update')[0]?.details).toEqual({
      before: { game: 'tft', starts_on: '2026-11-10' },
      after: { game: null, starts_on: '2026-11-11' },
    });
    expect((await del(app, admin, `/admin/events/${e.id}`)).status).toBe(204);
    expect(auditRows(app, 'event.delete')[0]?.details).toMatchObject({ title: '롤체 대회', starts_on: '2026-11-11', ends_on: '2026-11-12', game: null });
  });
});

describe('이벤트 시각(23-8, D298–D302)', () => {
  const mkE = async (app: TestApp, who: Who, body: Record<string, unknown>) =>
    EventView.parse(await json(await post(app, who, '/admin/events', body), 201));
  const pathOf = async (res: Response) => (await expectError(res, 400, 'VALIDATION_FAILED')).details?.map((d) => d.path);

  it('POST: 시각 저장(DB time 1970-01-01 UTC)·응답 HH:mm, 생략 = 종일 null, end_time만 400, 같은 날 역순 400·같은 시각 허용, 여러 날 역순 통과, 기간 오류가 시각보다 먼저', async () => {
    const { app, admin } = await setup();
    const timed = await mkE(app, admin, { title: '정기 내전의 날', starts_on: '2026-11-08', start_time: '21:00', end_time: '23:00' });
    expect(timed).toMatchObject({ starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: '21:00', end_time: '23:00' });
    const row = app.prisma.calendarEvent.rows.find((r) => r.id === timed.id);
    expect(row?.startTime?.toISOString()).toBe('1970-01-01T21:00:00.000Z');
    expect(row?.endTime?.toISOString()).toBe('1970-01-01T23:00:00.000Z');
    // 자정 직전·직후 값도 시간대 변환 없이 그대로
    const edge = await mkE(app, admin, { title: '자정 일정', starts_on: '2026-11-08', start_time: '00:00', end_time: '23:59' });
    expect([edge.start_time, edge.end_time]).toEqual(['00:00', '23:59']);

    const allDay = await mkE(app, admin, { title: '종일 일정', starts_on: '2026-11-09' });
    expect([allDay.start_time, allDay.end_time]).toEqual([null, null]);
    const startOnly = await mkE(app, admin, { title: '시작만 알림', starts_on: '2026-11-09', start_time: '20:00', end_time: null });
    expect([startOnly.start_time, startOnly.end_time]).toEqual(['20:00', null]);

    expect(await pathOf(await post(app, admin, '/admin/events', { title: '끝만 있음', starts_on: '2026-11-08', end_time: '23:00' }))).toEqual(['end_time']);
    expect(
      await pathOf(await post(app, admin, '/admin/events', { title: '같은 날 역순', starts_on: '2026-11-08', start_time: '21:00', end_time: '20:59' })),
    ).toEqual(['end_time']);
    const same = await mkE(app, admin, { title: '같은 시각', starts_on: '2026-11-08', start_time: '21:00', end_time: '21:00' });
    expect([same.start_time, same.end_time]).toEqual(['21:00', '21:00']);
    const multi = await mkE(app, admin, { title: '여러 날 역순', starts_on: '2026-11-08', ends_on: '2026-11-09', start_time: '23:00', end_time: '01:00' });
    expect([multi.start_time, multi.end_time]).toEqual(['23:00', '01:00']);
    // 기간 오류가 있으면 시각은 보지 않는다(①에서 끝)
    expect(
      await pathOf(await post(app, admin, '/admin/events', { title: '둘 다 틀림', starts_on: '2026-11-08', ends_on: '2026-11-07', end_time: '23:00' })),
    ).toEqual(['ends_on']);
    // 형식: 24:00·초·한 자리 시 400
    for (const bad of ['24:00', '21:00:00', '9:00']) {
      await expectError(await post(app, admin, '/admin/events', { title: '형식 오류', starts_on: '2026-11-08', start_time: bad }), 400, 'VALIDATION_FAILED');
    }

    expect(auditRows(app, 'event.create').find((a) => a.targetId === timed.id)?.details).toMatchObject({ start_time: '21:00', end_time: '23:00' });
    expect(auditRows(app, 'event.create').find((a) => a.targetId === allDay.id)?.details).toMatchObject({ start_time: null, end_time: null });
  });

  it('PATCH: 저장값과 합쳐 검사(D300) — start_time 23:30 역순 400, start_time null 단독 400, 둘 다 null = 종일, 여러 날이면 통과, 같은 값은 감사 없음, 감사 diff·삭제 스냅샷에 시각', async () => {
    const { app, admin } = await setup();
    const e = await mkE(app, admin, { title: '11월 정기 내전의 날', starts_on: '2026-11-08', start_time: '21:00', end_time: '23:00' });
    const url = `/admin/events/${e.id}`;

    expect(await pathOf(await patch(app, admin, url, { start_time: '23:30' }))).toEqual(['end_time']);
    expect(await pathOf(await patch(app, admin, url, { start_time: null }))).toEqual(['end_time']);
    expect(await pathOf(await patch(app, admin, url, { end_time: '20:00' }))).toEqual(['end_time']);
    expect(auditRows(app, 'event.update')).toHaveLength(0);
    expect(app.prisma.calendarEvent.rows[0]?.startTime?.toISOString()).toBe('1970-01-01T21:00:00.000Z');

    // 같은 값 PATCH는 감사 없음
    expect((await patch(app, admin, url, { start_time: '21:00', end_time: '23:00' })).status).toBe(200);
    expect(auditRows(app, 'event.update')).toHaveLength(0);

    // 여러 날로 늘리면서 시작 23:30 → 통과(여러 날은 순서 검사 없음)
    const multi = EventView.parse(await json(await patch(app, admin, url, { ends_on: '2026-11-09', start_time: '23:30' })));
    expect(multi).toMatchObject({ starts_on: '2026-11-08', ends_on: '2026-11-09', start_time: '23:30', end_time: '23:00' });
    expect(auditRows(app, 'event.update')[0]?.details).toEqual({
      before: { ends_on: '2026-11-08', start_time: '21:00' },
      after: { ends_on: '2026-11-09', start_time: '23:30' },
    });
    // 다시 하루로 줄이면 합친 값이 역순 → 400 path end_time
    expect(await pathOf(await patch(app, admin, url, { ends_on: '2026-11-08' }))).toEqual(['end_time']);

    // 시각만 생략한 PATCH는 시각을 건드리지 않는다
    const titled = EventView.parse(await json(await patch(app, admin, url, { title: '정기 내전의 날(연장)' })));
    expect([titled.start_time, titled.end_time]).toEqual(['23:30', '23:00']);

    // 둘 다 null = 종일로
    const cleared = EventView.parse(await json(await patch(app, admin, url, { start_time: null, end_time: null })));
    expect([cleared.start_time, cleared.end_time]).toEqual([null, null]);
    expect(app.prisma.calendarEvent.rows[0]).toMatchObject({ startTime: null, endTime: null });
    expect(auditRows(app, 'event.update').at(-1)?.details).toEqual({
      before: { start_time: '23:30', end_time: '23:00' },
      after: { start_time: null, end_time: null },
    });

    // 종일 일정에 시작만 넣기
    const started = EventView.parse(await json(await patch(app, admin, url, { start_time: '19:00' })));
    expect([started.start_time, started.end_time]).toEqual(['19:00', null]);

    expect((await del(app, admin, url)).status).toBe(204);
    expect(auditRows(app, 'event.delete')[0]?.details).toMatchObject({ start_time: '19:00', end_time: null, starts_on: '2026-11-08', ends_on: '2026-11-09' });
  });

  it('GET /events 정렬(D302): 같은 날 종일 → 08:00 → 21:00, 같은 시작이면 ends_on·id, 앞 날짜가 시각과 무관하게 먼저 + limit 1·2·3 커서로 넘겨도 누락·중복 없음', async () => {
    const { app, user } = await setup();
    const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const seed = (id: number, from: string, to: string, start: string | null, end: string | null = null) =>
      app.prisma.calendarEvent.insert({
        id: uid(id),
        title: `일정 ${id}`,
        startsOn: new Date(`${from}T00:00:00.000Z`),
        endsOn: new Date(`${to}T00:00:00.000Z`),
        startTime: start === null ? null : new Date(`1970-01-01T${start}:00.000Z`),
        endTime: end === null ? null : new Date(`1970-01-01T${end}:00.000Z`),
      });
    // 넣는 순서를 섞는다
    seed(9, '2026-11-09', '2026-11-09', null);
    seed(5, '2026-11-08', '2026-11-08', '21:00', '23:00');
    seed(2, '2026-11-08', '2026-11-08', null);
    seed(4, '2026-11-08', '2026-11-08', '08:00');
    seed(6, '2026-11-08', '2026-11-10', '21:00');
    seed(1, '2026-11-08', '2026-11-08', null);
    seed(3, '2026-11-08', '2026-11-09', null);
    seed(7, '2026-11-08', '2026-11-08', '21:00');
    seed(0, '2026-11-07', '2026-11-07', '23:59');
    const expected = [0, 1, 2, 3, 4, 5, 7, 6, 9].map(uid);

    const all = ListEventsResponse.parse(await json(await call(app, 'GET', '/events?from=2026-11-01&to=2026-11-30', user.token)));
    expect(all.items.map((e) => e.id)).toEqual(expected);
    expect(all.items.find((e) => e.id === uid(5))).toMatchObject({ start_time: '21:00', end_time: '23:00' });
    expect(all.items.find((e) => e.id === uid(1))).toMatchObject({ start_time: null, end_time: null });

    for (const limit of [1, 2, 3]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const q: string = `/events?from=2026-11-01&to=2026-11-30&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`;
        const page = ListEventsResponse.parse(await json(await call(app, 'GET', q, user.token)));
        seen.push(...page.items.map((e) => e.id));
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      expect(seen).toEqual(expected);
    }
  });

  it('GET /events 커서 형식: 옛 events 접두사·값 4개 아님·시각 형식 오류·날짜 형식 오류 → 400 path cursor', async () => {
    const { app, user } = await setup();
    const enc = (k: string, v: unknown[]) => Buffer.from(JSON.stringify({ k, v })).toString('base64url');
    const id = '00000000-0000-4000-8000-000000000001';
    const bad = [
      enc('events', ['2026-11-08', '2026-11-08', id]),
      enc('events2', ['2026-11-08', '2026-11-08', id]),
      enc('events2', ['2026-11-08', null, '2026-11-08', id, 'x']),
      enc('events2', ['2026-11-08', '24:00', '2026-11-08', id]),
      enc('events2', ['2026-11-08', '21:00:00', '2026-11-08', id]),
      enc('events2', ['2026-11-08', 2100, '2026-11-08', id]),
      enc('events2', ['2026/11/08', null, '2026-11-08', id]),
      // 형식은 맞지만 달력에 없는 날(QA minor 2)
      enc('events2', ['2026-13-45', null, '2026-11-08', id]),
      enc('events2', ['2026-11-08', null, '2026-02-30', id]),
      enc('events2', ['2026-11-08', null, '2026-11-08', 'not-uuid']),
    ];
    for (const c of bad) {
      const body = await expectError(await call(app, 'GET', `/events?cursor=${c}`, user.token), 400, 'VALIDATION_FAILED');
      expect(body.details?.[0]?.path).toBe('cursor');
    }
    // 올바른 events2 커서(시각 null·값) 200
    expect((await call(app, 'GET', `/events?cursor=${enc('events2', ['2026-11-08', null, '2026-11-08', id])}`, user.token)).status).toBe(200);
    expect((await call(app, 'GET', `/events?cursor=${enc('events2', ['2026-11-08', '21:00', '2026-11-08', id])}`, user.token)).status).toBe(200);
  });
});

describe('이벤트 PATCH 동시 수정(QA s6 일정 시각 minor 1)', () => {
  /**
   * FakePrisma는 트랜잭션을 직렬화하므로, 서비스가 행을 읽은 직후 다른 운영진의 커밋을 흉내 내 행을 바꾼다.
   * 저장값 11-08~11-10, 09:00/10:00. A가 {ends_on: 11-08}(읽은 값으로는 같은 날 09:00–10:00이라 통과)를 보내는 사이
   * B의 {start_time: 21:00}이 커밋되면, 다시 읽어 합친 값(같은 날 21:00–10:00)으로 400이어야 한다.
   */
  async function seeded() {
    const { app, admin } = await setup();
    const e = EventView.parse(
      await json(
        await post(app, admin, '/admin/events', { title: '사흘 행사', starts_on: '2026-11-08', ends_on: '2026-11-10', start_time: '09:00', end_time: '10:00' }),
        201,
      ),
    );
    const row = () => {
      const r = app.prisma.calendarEvent.rows.find((x) => x.id === e.id);
      if (!r) throw new Error('행 없음');
      return r;
    };
    /** n번째(1부터) findUnique 직후 실행할 동작 — 서비스는 이미 읽은 사본을 쓴다 */
    const afterRead = (fn: (call: number) => void) => {
      const table = app.prisma.calendarEvent;
      const orig = table.findUnique;
      let calls = 0;
      table.findUnique = async (args) => {
        const r = await orig(args);
        calls++;
        fn(calls);
        return r;
      };
      return () => calls;
    };
    return { app, admin, e, row, afterRead };
  }

  it('읽은 뒤 다른 운영진이 start_time 21:00을 커밋 → 다시 읽어 합친 값 검사 → 400 path end_time, A의 값은 쓰이지 않고 감사 없음', async () => {
    const { app, admin, e, row, afterRead } = await seeded();
    afterRead((n) => {
      if (n === 1) row().startTime = new Date('1970-01-01T21:00:00.000Z');
    });
    const body = await expectError(await patch(app, admin, `/admin/events/${e.id}`, { ends_on: '2026-11-08' }), 400, 'VALIDATION_FAILED');
    expect(body.details?.map((d) => d.path)).toEqual(['end_time']);
    // A의 ends_on은 쓰이지 않았다. (흉내 낸 B의 쓰기는 A 트랜잭션 안에서 일어나 fake 롤백에 함께 되돌려지므로 시각은 단언하지 않는다)
    expect(row().endsOn.toISOString()).toBe('2026-11-10T00:00:00.000Z');
    expect(auditRows(app, 'event.update')).toHaveLength(0);
  });

  it('상대 변경 뒤에도 규칙에 맞으면 다시 읽은 값으로 저장, 감사 before는 새로 읽은 값', async () => {
    const { app, admin, e, row, afterRead } = await seeded();
    const calls = afterRead((n) => {
      if (n === 1) row().startTime = new Date('1970-01-01T09:30:00.000Z');
    });
    const v = EventView.parse(await json(await patch(app, admin, `/admin/events/${e.id}`, { ends_on: '2026-11-08' })));
    expect(v).toMatchObject({ starts_on: '2026-11-08', ends_on: '2026-11-08', start_time: '09:30', end_time: '10:00' });
    expect(calls()).toBeGreaterThanOrEqual(3); // 첫 읽기 → 0행 → 다시 읽기 → 저장 → 응답용 읽기
    expect(auditRows(app, 'event.update')[0]?.details).toEqual({ before: { ends_on: '2026-11-10' }, after: { ends_on: '2026-11-08' } });
  });

  it('읽은 뒤 삭제되면 404, 매번 바뀌면 재시도 한도 뒤 500(아무것도 쓰지 않음)', async () => {
    const { app, admin, e, row, afterRead } = await seeded();
    afterRead((n) => {
      // 읽을 때마다 상대가 시작 시각을 바꾼다(09:01, 09:02, …)
      row().startTime = new Date(`1970-01-01T09:0${n}:00.000Z`);
    });
    await expectError(await patch(app, admin, `/admin/events/${e.id}`, { title: '사흘 행사(수정)' }), 500, 'INTERNAL_ERROR');
    expect(row().title).toBe('사흘 행사');
    expect(auditRows(app, 'event.update')).toHaveLength(0);

    const s2 = await seeded();
    s2.afterRead((n) => {
      if (n === 1) s2.app.prisma.calendarEvent.rows = [];
    });
    await expectError(await patch(s2.app, s2.admin, `/admin/events/${s2.e.id}`, { ends_on: '2026-11-08' }), 404, 'NOT_FOUND');
  });
});

describe('홈 news 블록(8-3)', () => {
  it('공지 1 + 패치 2(30일 경계) + 이벤트 2(오늘 이후 끝·30일 안 시작), subtitle 60자 자르기', async () => {
    const { app, admin, user } = await setup();
    const empty = GetDashboardSummaryResponse.parse(await json(await call(app, 'GET', '/dashboard/summary', user.token)));
    expect(empty.news).toEqual({ notice: null, items: [] });

    const long = '가'.repeat(70);
    const mkP = async (title: string, published_on: string, summary = '요약') =>
      PatchNoteView.parse(await json(await post(app, admin, '/admin/patch-notes', { game: 'lol', title, summary, published_on }), 201));
    const mkE = async (title: string, starts_on: string, ends_on: string, description?: string) =>
      EventView.parse(await json(await post(app, admin, '/admin/events', { title, starts_on, ends_on, description }), 201));
    await mkP('31일 전', '2026-10-01');
    const p30 = await mkP('정확히 30일 전', '2026-10-02');
    const pNew = await mkP('오늘 패치', '2026-11-01', `${long}\n둘째 줄`);
    await mkE('어제 끝남', '2026-10-20', '2026-10-31');
    const eToday = await mkE('오늘 끝남', '2026-10-20', '2026-11-01');
    const e30 = await mkE('30일 뒤 시작', '2026-12-01', '2026-12-01', '\n  첫 줄은 공백 뒤  \n둘째');
    await mkE('31일 뒤 시작', '2026-12-02', '2026-12-03');
    app.clock.advance(MIN);
    const n2 = NoticeView.parse(await json(await post(app, admin, '/admin/notices', { title: '최신 공지', body: '본문' }), 201));

    const s = GetDashboardSummaryResponse.parse(await json(await call(app, 'GET', '/dashboard/summary', user.token)));
    expect(s.news.notice).toEqual({ id: n2.id, title: '최신 공지', created_at: n2.created_at });
    expect(s.news.items.map((i) => [i.kind, i.id])).toEqual([
      ['patch_note', pNew.id],
      ['patch_note', p30.id],
      ['event', eToday.id],
      ['event', e30.id],
    ]);
    expect(s.news.items[0]).toMatchObject({ subtitle: `${'가'.repeat(59)}…`, date: '2026-11-01', game: { code: 'lol' } });
    expect(s.news.items[2]).toMatchObject({ kind: 'event', subtitle: null, date: '2026-10-20', ends_on: '2026-11-01', game: null });
    expect(s.news.items[3]).toMatchObject({ kind: 'event', subtitle: '첫 줄은 공백 뒤', date: '2026-12-01' });
  });
});

describe('GET·PATCH /me/notification-settings', () => {
  it('기본값·보낸 항목만 변경·빈 본문 400·GET /me 모양 불변', async () => {
    const { app, user } = await setup();
    const g = GetMyNotificationSettingsResponse.parse(await json(await call(app, 'GET', '/me/notification-settings', user.token)));
    expect(g).toEqual({ scrim_start: true, patch: false, discord_linked: false });
    const p = GetMyNotificationSettingsResponse.parse(await json(await patch(app, user, '/me/notification-settings', { patch: true })));
    expect(p).toEqual({ scrim_start: true, patch: true, discord_linked: false });
    const p2 = GetMyNotificationSettingsResponse.parse(await json(await patch(app, user, '/me/notification-settings', { scrim_start: false })));
    expect(p2).toEqual({ scrim_start: false, patch: true, discord_linked: false });
    const row = app.prisma.users.find((u) => u.id === user.userId);
    expect(row).toMatchObject({ notifyScrimStart: false, notifyPatch: true, notifyResult: true, notifyWaitlist: true });
    await expectError(await patch(app, user, '/me/notification-settings', {}), 400, 'VALIDATION_FAILED');
    await expectError(await patch(app, user, '/me/notification-settings', { result: false }), 400, 'VALIDATION_FAILED');
    await expectError(await call(app, 'GET', '/me/notification-settings'), 401, 'UNAUTHENTICATED');
    const me = await json<Record<string, unknown>>(await call(app, 'GET', '/me', user.token));
    expect(GetMeResponse.strict().safeParse(me).success).toBe(true);
    expect(me).not.toHaveProperty('notify_patch');
    // 연동 회원은 discord_linked true
    if (row) row.discordId = '123456789012345678';
    expect(GetMyNotificationSettingsResponse.parse(await json(await call(app, 'GET', '/me/notification-settings', user.token))).discord_linked).toBe(true);
  });
});

describe('PATCH updated_at = APP_CLOCK(QA minor 3)', () => {
  it('공지(일반·notify 조건부 경로)·패치노트·이벤트 수정 시 updated_at이 서버 시계 값, 변경 없음이면 그대로', async () => {
    const { app, admin } = await setup();
    const n = NoticeView.parse(await json(await post(app, admin, '/admin/notices', { title: '시각 공지', body: '본문' }), 201));
    const p = PatchNoteView.parse(
      await json(await post(app, admin, '/admin/patch-notes', { game: 'lol', title: '시각 패치', summary: '요약', published_on: '2026-11-01' }), 201),
    );
    const e = EventView.parse(await json(await post(app, admin, '/admin/events', { title: '시각 행사', starts_on: '2026-11-02' }), 201));
    expect([n.updated_at, p.updated_at, e.updated_at]).toEqual([NOW, NOW, NOW]);

    app.clock.advance(60 * MIN);
    const t1 = app.clock.now().toISOString();
    const n1 = NoticeView.parse(await json(await patch(app, admin, `/admin/notices/${n.id}`, { title: '시각 공지 수정' })));
    const p1 = PatchNoteView.parse(await json(await patch(app, admin, `/admin/patch-notes/${p.id}`, { summary: '요약 수정' })));
    const e1 = EventView.parse(await json(await patch(app, admin, `/admin/events/${e.id}`, { title: '시각 행사 수정' })));
    expect([n1.updated_at, p1.updated_at, e1.updated_at]).toEqual([t1, t1, t1]);
    expect([n1.created_at, p1.created_at, e1.created_at]).toEqual([NOW, NOW, NOW]);

    app.clock.advance(60 * MIN);
    const t2 = app.clock.now().toISOString();
    // notify_discord 변경은 조건부 updateMany 경로
    const n2 = NoticeView.parse(await json(await patch(app, admin, `/admin/notices/${n.id}`, { notify_discord: true })));
    const p2 = PatchNoteView.parse(await json(await patch(app, admin, `/admin/patch-notes/${p.id}`, { notify_discord: true })));
    expect([n2.updated_at, p2.updated_at]).toEqual([t2, t2]);

    app.clock.advance(60 * MIN);
    // 같은 값 PATCH는 쓰지 않으므로 updated_at 유지
    const n3 = NoticeView.parse(await json(await patch(app, admin, `/admin/notices/${n.id}`, { notify_discord: true })));
    const e3 = EventView.parse(await json(await patch(app, admin, `/admin/events/${e.id}`, { title: '시각 행사 수정' })));
    expect([n3.updated_at, e3.updated_at]).toEqual([t2, t1]);
  });
});
