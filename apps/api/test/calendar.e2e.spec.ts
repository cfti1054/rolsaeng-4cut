/**
 * S6 후속 커뮤니티 캘린더 GET /calendar HTTP 테스트(DB 없이 FakePrisma, 계약 S6 23절 D282–D297).
 * 고정 시계 2026-10-31T15:00Z = KST 11-01 00:00(자정 경계 — month 생략 시 '2026-11').
 * 2026-11 격자: 2026-10-26(월) ~ 2026-12-06(일), 내전 구간 [2026-10-25T15:00Z, 2026-12-06T15:00Z).
 */
import {
  CALENDAR_EVENTS_MAX,
  CALENDAR_SCRIMS_MAX,
  type CalendarEventItem,
  type CalendarScrimItem,
  EventView,
  GetCalendarResponse,
  ListScrimsResponse,
  type ScrimStatus,
  type ScrimSummary,
} from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { type Who, login, member } from './support/s4-helpers';
import { bot, seedApiKey } from './support/s5-helpers';
import { json } from './support/s6-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-31T15:00:00.000Z';

async function setup(clock = NOW) {
  t = await createTestApp({ fixedClock: clock });
  const admin = await login(t, 'admin_a', 'admin');
  const user = await login(t, 'member_u');
  const host = await member(t, '방장');
  return { app: t, admin, user, host };
}

/** 정렬 확인용 고정 uuid(끝 12자리가 n) */
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function seedScrim(
  app: TestApp,
  hostId: string,
  o: { at: string; status?: ScrimStatus; game?: 'lol' | 'tft'; title?: string; id?: string; capacity?: number },
) {
  return app.prisma.scrim.insert({
    ...(o.id ? { id: o.id } : {}),
    gameId: app.prisma.gameId(o.game ?? 'lol'),
    hostId,
    title: o.title ?? '캘린더 내전',
    scheduledAt: new Date(o.at),
    capacity: o.capacity ?? 10,
    status: o.status ?? 'recruiting',
    cancelledAt: o.status === 'cancelled' ? new Date(NOW) : null,
  });
}

function seedPlayer(app: TestApp, scrimId: string, userId: string, status: 'joined' | 'waitlist' | 'no_show' | 'cancelled' = 'joined') {
  return app.prisma.scrimPlayer.insert({ scrimId, userId, status, joinedAt: new Date('2026-10-20T00:00:00.000Z') });
}

function seedEvent(
  app: TestApp,
  o: { from: string; to?: string; game?: 'lol' | 'tft' | null; title?: string; id?: string; start?: string; end?: string },
) {
  return app.prisma.calendarEvent.insert({
    ...(o.id ? { id: o.id } : {}),
    gameId: o.game ? app.prisma.gameId(o.game) : null,
    title: o.title ?? '운영진 일정',
    startsOn: new Date(`${o.from}T00:00:00.000Z`),
    endsOn: new Date(`${o.to ?? o.from}T00:00:00.000Z`),
    // 시각 컬럼(23-8-1): db-date toDbTime과 같은 변환
    ...(o.start ? { startTime: new Date(`1970-01-01T${o.start}:00.000Z`) } : {}),
    ...(o.end ? { endTime: new Date(`1970-01-01T${o.end}:00.000Z`) } : {}),
  });
}

async function calendar(app: TestApp, who: Who, query = ''): Promise<GetCalendarResponse> {
  const text = await (async () => {
    const res = await call(app, 'GET', `/calendar${query}`, who.token);
    const body = await res.text();
    expect({ status: res.status, body }).toMatchObject({ status: 200 });
    return body;
  })();
  return GetCalendarResponse.parse(JSON.parse(text));
}

const scrimsOf = (r: GetCalendarResponse) => r.items.filter((i): i is CalendarScrimItem => i.kind === 'scrim');
const eventsOf = (r: GetCalendarResponse) => r.items.filter((i): i is CalendarEventItem => i.kind === 'event');

describe('권한(23-5)', () => {
  it('비로그인 401, 봇 키 401, 멤버·운영진 200(같은 모양)', async () => {
    const { app, admin, user, host } = await setup();
    seedScrim(app, host, { at: '2026-11-06T12:00:00.000Z' });
    seedEvent(app, { from: '2026-11-08' });
    await expectError(await call(app, 'GET', '/calendar'), 401, 'UNAUTHENTICATED');
    const key = seedApiKey(app);
    await expectError(await bot(app, 'GET', '/calendar', key.raw), 401, 'UNAUTHENTICATED');
    const m = await calendar(app, user);
    const a = await calendar(app, admin);
    expect(m.items.map((i) => [i.kind, i.id])).toEqual(a.items.map((i) => [i.kind, i.id]));
    expect(Object.keys(a)).toEqual(Object.keys(m));
    expect(m.items).toHaveLength(2);
  });
});

describe('구간(23-2·23-3)', () => {
  it('month 생략 + 시계 10-31T15:00Z → 2026-11, 격자 10-26(월) ~ 12-06(일)', async () => {
    const { app, user } = await setup();
    const r = await calendar(app, user);
    expect(r).toEqual({ month: '2026-11', from: '2026-10-26', to: '2026-12-06', items: [], truncated: { scrims: false, events: false } });
    // 시계 1ms 전(KST 10-31 23:59:59.999)이면 10월
    await t?.close();
    const s2 = await setup('2026-10-31T14:59:59.999Z');
    const oct = await calendar(s2.app, s2.user);
    expect(oct.month).toBe('2026-10');
    expect([oct.from, oct.to]).toEqual(['2026-09-28', '2026-11-01']);
  });

  it('month 지정: 1일이 월요일인 2027-02 → 02-01 ~ 02-28, 연 넘김 2026-12 → 11-30 ~ 2027-01-03', async () => {
    const { app, user } = await setup();
    const feb = await calendar(app, user, '?month=2027-02');
    expect([feb.month, feb.from, feb.to]).toEqual(['2027-02', '2027-02-01', '2027-02-28']);
    const dec = await calendar(app, user, '?month=2026-12');
    expect([dec.month, dec.from, dec.to]).toEqual(['2026-12', '2026-11-30', '2027-01-03']);
  });

  it('내전 KST 경계: 10-25T15:00Z 포함(date 10-26)·14:59:59.999Z 제외, 12-06T14:59:59.999Z 포함(date 12-06)·15:00Z 제외', async () => {
    const { app, user, host } = await setup();
    const inFirst = seedScrim(app, host, { at: '2026-10-25T15:00:00.000Z', status: 'finished' });
    seedScrim(app, host, { at: '2026-10-25T14:59:59.999Z', status: 'finished' });
    const inLast = seedScrim(app, host, { at: '2026-12-06T14:59:59.999Z' });
    seedScrim(app, host, { at: '2026-12-06T15:00:00.000Z' });
    const r = await calendar(app, user, '?month=2026-11');
    expect(scrimsOf(r).map((s) => [s.id, s.date])).toEqual([
      [inFirst.id, '2026-10-26'],
      [inLast.id, '2026-12-06'],
    ]);
  });

  it('일정 겹침: 10-20~10-26 포함, 10-20~10-25 제외, 12-06~12-10 포함, 12-07 제외, 격자를 덮는 긴 일정 포함', async () => {
    const { app, user } = await setup();
    const a = seedEvent(app, { from: '2026-10-20', to: '2026-10-26', title: '앞 걸침' });
    seedEvent(app, { from: '2026-10-20', to: '2026-10-25', title: '앞 밖' });
    const b = seedEvent(app, { from: '2026-12-06', to: '2026-12-10', title: '뒤 걸침' });
    seedEvent(app, { from: '2026-12-07', title: '뒤 밖' });
    const c = seedEvent(app, { from: '2026-10-01', to: '2026-12-31', title: '덮음' });
    const r = await calendar(app, user, '?month=2026-11');
    expect(eventsOf(r).map((e) => e.id)).toEqual([c.id, a.id, b.id]);
  });

  it('형식 오류 400 VALIDATION_FAILED(path month·game), 페이징 파라미터 없음', async () => {
    const { app, user } = await setup();
    for (const q of ['?month=2026-13', '?month=2026-1', '?month=1999-12', '?month=2026-11-01', '?game=valorant']) {
      const body = await expectError(await call(app, 'GET', `/calendar${q}`, user.token), 400, 'VALIDATION_FAILED');
      expect(JSON.stringify(body)).toMatch(q.includes('game') ? /game/ : /month/);
    }
  });
});

describe('상태·값(23-2, D287)', () => {
  it('cancelled 제외, recruiting·full·playing·finished 포함, 값이 같은 요청자의 GET /scrims 카드와 같다', async () => {
    const { app, user, host } = await setup();
    const other = await member(app, '다른 회원');
    const rec = seedScrim(app, host, { at: '2026-11-03T10:00:00.000Z', status: 'recruiting', capacity: 4 });
    const full = seedScrim(app, host, { at: '2026-11-04T10:00:00.000Z', status: 'full', capacity: 2 });
    const playing = seedScrim(app, host, { at: '2026-10-30T10:00:00.000Z', status: 'playing', capacity: 4 });
    const fin = seedScrim(app, host, { at: '2026-10-28T10:00:00.000Z', status: 'finished', capacity: 4 });
    seedScrim(app, host, { at: '2026-11-05T10:00:00.000Z', status: 'cancelled' });
    for (const s of [rec, full, playing, fin]) seedPlayer(app, s.id, host);
    seedPlayer(app, rec.id, user.userId, 'waitlist');
    seedPlayer(app, rec.id, other, 'joined');
    seedPlayer(app, full.id, other, 'joined');
    seedPlayer(app, playing.id, user.userId, 'joined');
    seedPlayer(app, playing.id, other, 'no_show');
    seedPlayer(app, fin.id, user.userId, 'joined');
    app.prisma.scrimResult.insert({
      scrimId: fin.id,
      status: 'approved',
      winnerTeam: 'blue',
      submittedById: host,
      createdAt: new Date('2026-10-28T12:00:00.000Z'),
    });

    const r = await calendar(app, user, '?month=2026-11');
    const items = scrimsOf(r);
    expect(items.map((s) => s.id)).toEqual([fin.id, playing.id, rec.id, full.id]);
    expect(items.map((s) => s.status)).toEqual(['finished', 'playing', 'recruiting', 'full']);

    const cards = new Map<string, ScrimSummary>();
    for (const tab of ['open', 'playing', 'ended']) {
      const list = ListScrimsResponse.parse(await json(await call(app, 'GET', `/scrims?status=${tab}&limit=50`, user.token)));
      for (const c of list.items) cards.set(c.id, c);
    }
    for (const s of items) {
      const c = cards.get(s.id);
      expect(c).toBeDefined();
      if (!c) continue;
      expect(s).toEqual({
        kind: 'scrim',
        id: c.id,
        title: c.title,
        game: c.game,
        steam_app: c.steam_app,
        date: s.date,
        scheduled_at: c.scheduled_at,
        status: c.status,
        capacity: c.capacity,
        joined_count: c.joined_count,
        join_closed: c.join_closed,
        my_status: c.my_status,
        result_status: c.result_status,
      });
    }
    const byId = new Map(items.map((s) => [s.id, s]));
    expect(byId.get(rec.id)).toMatchObject({ my_status: 'waitlist', joined_count: 2, date: '2026-11-03' });
    expect(byId.get(playing.id)).toMatchObject({ my_status: 'joined', joined_count: 3 });
    expect(byId.get(full.id)?.my_status).toBeNull();
    expect(byId.get(fin.id)?.result_status).toBe('approved');
  });

  it('응답 JSON에 방장·참가자 명단·다른 회원의 참가 상태가 없다', async () => {
    const { app, user, host } = await setup();
    const other = await member(app, '숨겨질회원');
    const s = seedScrim(app, host, { at: '2026-11-06T12:00:00.000Z' });
    seedPlayer(app, s.id, host);
    seedPlayer(app, s.id, other, 'joined');
    seedEvent(app, { from: '2026-11-08' });
    const res = await call(app, 'GET', '/calendar', user.token);
    const text = await res.text();
    expect(res.status).toBe(200);
    for (const k of ['host', 'players', 'waitlist', 'winner', 'nickname', 'avatar', 'email', 'discord', 'created_by']) {
      expect(text).not.toContain(`"${k}`);
    }
    expect(text).not.toContain(host);
    expect(text).not.toContain(other);
    expect(text).not.toContain('숨겨질회원');
    expect(text).not.toContain('방장');
    const item = scrimsOf(GetCalendarResponse.parse(JSON.parse(text)))[0];
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ['capacity', 'date', 'game', 'id', 'join_closed', 'joined_count', 'kind', 'my_status', 'result_status', 'scheduled_at', 'status', 'steam_app', 'title'].sort(),
    );
  });
});

describe('게임 필터(D288)', () => {
  it('그 게임 내전·일정만, 게임 무관(null) 일정 제외. 필터 없으면 전부', async () => {
    const { app, user, host } = await setup();
    const lolS = seedScrim(app, host, { at: '2026-11-06T12:00:00.000Z', game: 'lol' });
    const tftS = seedScrim(app, host, { at: '2026-11-07T12:00:00.000Z', game: 'tft' });
    const lolE = seedEvent(app, { from: '2026-11-02', game: 'lol' });
    const tftE = seedEvent(app, { from: '2026-11-03', game: 'tft' });
    const anyE = seedEvent(app, { from: '2026-11-01', game: null });
    const lol = await calendar(app, user, '?month=2026-11&game=lol');
    expect(lol.items.map((i) => i.id)).toEqual([lolE.id, lolS.id]);
    const tft = await calendar(app, user, '?game=tft');
    expect(tft.items.map((i) => i.id)).toEqual([tftE.id, tftS.id]);
    const all = await calendar(app, user);
    expect(all.items.map((i) => i.id)).toEqual([anyE.id, lolE.id, tftE.id, lolS.id, tftS.id]);
    expect(eventsOf(all)[0]?.game).toBeNull();
    expect(eventsOf(lol)[0]?.game?.code).toBe('lol');
  });

  it('games 행이 없는 게임 코드 → items [], truncated 둘 다 false(오류 아님)', async () => {
    const { app, user } = await setup();
    seedEvent(app, { from: '2026-11-02', game: null });
    app.prisma.game.rows = app.prisma.game.rows.filter((g) => g.code !== 'steam');
    const r = await calendar(app, user, '?game=steam');
    expect(r).toEqual({ month: '2026-11', from: '2026-10-26', to: '2026-12-06', items: [], truncated: { scrims: false, events: false } });
  });
});

describe('순서(D290)', () => {
  it('일정 전부(starts_on, ends_on, id ASC) 다음 내전 전부(scheduled_at, id ASC)', async () => {
    const { app, user, host } = await setup();
    const e3 = seedEvent(app, { from: '2026-11-05', to: '2026-11-07', id: uid(3) });
    const e1 = seedEvent(app, { from: '2026-11-05', to: '2026-11-06', id: uid(9) });
    const e2 = seedEvent(app, { from: '2026-11-05', to: '2026-11-07', id: uid(1) });
    const e0 = seedEvent(app, { from: '2026-11-01', to: '2026-11-30', id: uid(5) });
    const s2 = seedScrim(app, host, { at: '2026-11-02T10:00:00.000Z', id: uid(20) });
    const s1 = seedScrim(app, host, { at: '2026-11-02T10:00:00.000Z', id: uid(10) });
    const s0 = seedScrim(app, host, { at: '2026-10-27T10:00:00.000Z', id: uid(30), status: 'finished' });
    const s3 = seedScrim(app, host, { at: '2026-11-20T10:00:00.000Z', id: uid(2) });
    const r = await calendar(app, user);
    expect(r.items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      ...[e0, e1, e2, e3].map((e) => `event:${e.id}`),
      ...[s0, s1, s2, s3].map((s) => `scrim:${s.id}`),
    ]);
  });
});

describe('일정 시각(23-8, D298·D302)', () => {
  it('일정 항목에 start_time·end_time(HH:mm | null), 같은 날은 종일 → 08:00 → 21:00, 같은 시작이면 ends_on·id. 내전은 여전히 일정 뒤', async () => {
    const { app, user, host } = await setup();
    const late = seedEvent(app, { from: '2026-11-08', id: uid(1), start: '21:00', end: '23:00' });
    const early = seedEvent(app, { from: '2026-11-08', id: uid(2), start: '08:00' });
    const allDayB = seedEvent(app, { from: '2026-11-08', id: uid(4) });
    const allDayA = seedEvent(app, { from: '2026-11-08', id: uid(3) });
    const allDayLong = seedEvent(app, { from: '2026-11-08', to: '2026-11-09', id: uid(0) });
    const lateLong = seedEvent(app, { from: '2026-11-08', to: '2026-11-10', id: uid(5), start: '21:00' });
    const prevDay = seedEvent(app, { from: '2026-11-07', id: uid(9), start: '23:59' });
    const s = seedScrim(app, host, { at: '2026-11-08T00:00:00.000Z' });
    const r = await calendar(app, user);
    expect(r.items.map((i) => i.id)).toEqual([prevDay, allDayA, allDayB, allDayLong, early, late, lateLong].map((e) => e.id).concat(s.id));
    const byId = new Map(eventsOf(r).map((e) => [e.id, e]));
    expect(byId.get(late.id)).toMatchObject({ start_time: '21:00', end_time: '23:00' });
    expect(byId.get(early.id)).toMatchObject({ start_time: '08:00', end_time: null });
    expect(byId.get(allDayA.id)).toMatchObject({ start_time: null, end_time: null });
    // 필수 필드(D305 2단계): api는 두 필드를 항상 싣는다
    for (const e of eventsOf(r)) {
      expect(e).toHaveProperty('start_time');
      expect(e).toHaveProperty('end_time');
    }
  });

  it('운영진 POST(시각) → 캘린더 항목 = EventView 그대로, PATCH로 종일 일정에 08:00을 넣으면 21:00 일정 앞에 그대로', async () => {
    const { app, admin, user } = await setup();
    const timed = EventView.parse(
      await json(await call(app, 'POST', '/admin/events', admin.token, { title: '저녁 일정', starts_on: '2026-11-08', start_time: '21:00', end_time: '23:00' }), 201),
    );
    const allDay = EventView.parse(await json(await call(app, 'POST', '/admin/events', admin.token, { title: '종일 일정', starts_on: '2026-11-08' }), 201));
    let r = await calendar(app, user);
    expect(eventsOf(r)).toEqual([
      { kind: 'event', ...allDay },
      { kind: 'event', ...timed },
    ]);
    // 종일 일정에 시각을 넣으면 21:00 일정보다 앞(08:00)
    const moved = EventView.parse(await json(await call(app, 'PATCH', `/admin/events/${allDay.id}`, admin.token, { start_time: '08:00' })));
    r = await calendar(app, user);
    expect(eventsOf(r).map((e) => [e.id, e.start_time])).toEqual([
      [moved.id, '08:00'],
      [timed.id, '21:00'],
    ]);
  });
});

describe('한도(D286)', () => {
  it('정확히 300·100이면 truncated false', async () => {
    const { app, user, host } = await setup();
    const base = Date.parse('2026-11-01T00:00:00.000Z');
    for (let i = 0; i < CALENDAR_SCRIMS_MAX; i++) seedScrim(app, host, { at: new Date(base + i * 60_000).toISOString() });
    for (let i = 0; i < CALENDAR_EVENTS_MAX; i++) seedEvent(app, { from: '2026-11-10', title: `일정 ${i}` });
    const r = await calendar(app, user);
    expect(scrimsOf(r)).toHaveLength(CALENDAR_SCRIMS_MAX);
    expect(eventsOf(r)).toHaveLength(CALENDAR_EVENTS_MAX);
    expect(r.truncated).toEqual({ scrims: false, events: false });
  });

  it('내전 301개 → 이른 300개 + truncated.scrims, 일정 101개 → 앞 100개 + truncated.events', async () => {
    const { app, user, host } = await setup();
    const base = Date.parse('2026-11-01T00:00:00.000Z');
    const scrims = [];
    for (let i = 0; i < CALENDAR_SCRIMS_MAX + 1; i++) scrims.push(seedScrim(app, host, { at: new Date(base + i * 60_000).toISOString() }));
    const events = [];
    for (let i = 0; i < CALENDAR_EVENTS_MAX + 1; i++) {
      events.push(seedEvent(app, { from: `2026-11-${String(1 + Math.floor(i / 5)).padStart(2, '0')}`, id: uid(1000 + i) }));
    }
    const r = await calendar(app, user);
    expect(r.truncated).toEqual({ scrims: true, events: true });
    expect(scrimsOf(r).map((s) => s.id)).toEqual(scrims.slice(0, CALENDAR_SCRIMS_MAX).map((s) => s.id));
    expect(eventsOf(r).map((e) => e.id)).toEqual(events.slice(0, CALENDAR_EVENTS_MAX).map((e) => e.id));
    // 다른 달 요청은 이 달 행 수와 무관
    const g = await calendar(app, user, '?month=2026-12');
    expect(g.truncated).toEqual({ scrims: false, events: false });
  });
});

describe('일정 쓰기 왕복(23-4, 기존 /admin/events)', () => {
  it('운영진 POST → GET /calendar에 나옴(EventView 그대로 + kind), PATCH → 바뀐 값, DELETE → 사라짐. 멤버 쓰기 403', async () => {
    const { app, admin, user } = await setup();
    const created = EventView.parse(
      await json(
        await call(app, 'POST', '/admin/events', admin.token, { title: '11월 정기 내전의 날', starts_on: '2026-11-08', game: 'lol' }),
        201,
      ),
    );
    let r = await calendar(app, user);
    expect(eventsOf(r)).toEqual([{ kind: 'event', ...created }]);

    const updated = EventView.parse(
      await json(await call(app, 'PATCH', `/admin/events/${created.id}`, admin.token, { title: '11월 정기 내전의 날(변경)', ends_on: '2026-11-09', game: null })),
    );
    r = await calendar(app, user, '?month=2026-11');
    expect(eventsOf(r)).toEqual([{ kind: 'event', ...updated }]);
    expect(eventsOf(r)[0]).toMatchObject({ title: '11월 정기 내전의 날(변경)', starts_on: '2026-11-08', ends_on: '2026-11-09', game: null });
    // game null로 바뀌었으므로 lol 필터에서는 빠진다
    expect((await calendar(app, user, '?game=lol')).items).toEqual([]);

    await expectError(await call(app, 'DELETE', `/admin/events/${created.id}`, user.token), 403, 'FORBIDDEN');
    expect((await call(app, 'DELETE', `/admin/events/${created.id}`, admin.token)).status).toBe(204);
    r = await calendar(app, user);
    expect(r.items).toEqual([]);
  });
});
