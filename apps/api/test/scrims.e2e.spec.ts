/**
 * S2 내전 모집·참가·대기열·노쇼 제한 HTTP 테스트(DB 없이): Nest 앱 + FakePrisma + 고정 시계.
 * 계약: _workspace/01_architect_contract.md(S2) 4–6절, 12절 backend 6번.
 * 실제 행 잠금·동시성은 test/db/scrims.db.e2e.spec.ts(PostgreSQL 필요).
 */
import { randomUUID } from 'node:crypto';
import {
  type CreateScrimRequestInput,
  GetMyScrimRestrictionResponse,
  ListGamesResponse,
  ListScrimsResponse,
  ScrimDetail,
  type UserRole,
} from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { SCRIM_AUTO_CLOSE_LOCK_KEY, ScrimAutoCloseScheduler, ScrimAutoCloser } from '../src/modules/scrims/scrim-auto-close';
import { ScrimsModule } from '../src/modules/scrims/scrims.module';
import { call, expectError } from './support/s1-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Who = { token: string; userId: string };

async function login(app: TestApp, username: string, role?: UserRole): Promise<Who> {
  const res = await fetch(`${app.base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(role ? { username, role } : { username }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

function at(app: TestApp, offsetMs: number): string {
  return new Date(app.clock.now().getTime() + offsetMs).toISOString();
}

/** 응답 원문 검사(D38): 사용자 email·discord_id 등 비공개 필드 없음 + ScrimDetail strict parse */
async function detailOf(res: Response, status = 200): Promise<ScrimDetail> {
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status });
  expect(text).not.toMatch(/email|discord/i);
  return ScrimDetail.parse(JSON.parse(text));
}

const LOL_BASE = { game: 'lol', title: '금요 내전', capacity: 10, host_preferred_positions: ['mid'] } as const;
const TFT_BASE = { game: 'tft', title: '롤체 한 판', capacity: 2 } as const;

async function create(app: TestApp, who: Who, over: Partial<CreateScrimRequestInput> = {}, base: object = LOL_BASE) {
  const res = await call(app, 'POST', '/scrims', who.token, { ...base, scheduled_at: at(app, DAY), ...over });
  return detailOf(res, 201);
}

const join = (app: TestApp, who: Who, id: string, positions: string[] = []) =>
  call(app, 'POST', `/scrims/${id}/join`, who.token, { preferred_positions: positions });
const leave = (app: TestApp, who: Who, id: string) => call(app, 'DELETE', `/scrims/${id}/join`, who.token);
const getScrim = async (app: TestApp, who: Who, id: string) => detailOf(await call(app, 'GET', `/scrims/${id}`, who.token));
const noShow = (app: TestApp, who: Who, id: string, userId: string, value: boolean) =>
  call(app, 'PUT', `/scrims/${id}/players/${userId}/no-show`, who.token, { no_show: value });

/** 노쇼 기록을 직접 심는다(다른 내전의 no_show 행) */
function seedNoShows(app: TestApp, userId: string, marks: Date[]): void {
  for (const m of marks) {
    app.prisma.scrimPlayer.insert({
      scrimId: randomUUID(),
      userId,
      status: 'no_show',
      joinedAt: new Date(m.getTime() - DAY),
      noShowMarkedAt: m,
    });
  }
}

/** 마지막 트랜잭션들이 내전 행 잠금(SELECT … FOR UPDATE)을 그 id로 했는지 */
function lockedIds(app: TestApp): unknown[] {
  return app.prisma.rawCalls.filter((c) => /FOR UPDATE/.test(c.sql)).map((c) => c.values[0]);
}

// -----------------------------------------------------------------------------

describe('GET /games', () => {
  it('sort_order 순 3개, 정원 범위(롤 2–10 짝수·꽉 차야 시작, 롤체 2–8, 스팀 2–16), id 비노출', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const res = await call(t, 'GET', '/games', a.token);
    expect(res.status).toBe(200);
    const body = ListGamesResponse.parse(await res.json());
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((g) => [g.code, g.capacity])).toEqual([
      ['lol', { min: 2, max: 10, default: 10, step: 2, start_requires_full: true }],
      ['tft', { min: 2, max: 8, default: 8, step: 1, start_requires_full: false }],
      ['steam', { min: 2, max: 16, default: 8, step: 1, start_requires_full: false }],
    ]);
    expect(body.items[0]?.positions).toEqual(['top', 'jungle', 'mid', 'bot', 'support']);
    expect(Object.keys(body.items[0] ?? {})).not.toContain('id');
    await expectError(await call(t, 'GET', '/games'), 401, 'UNAUTHENTICATED');
  });
});

describe('POST /scrims 작성', () => {
  it('201: 방장 자동 참가(joined, 1지망), recruiting, 적용값 options, balance·result null, 비공개 필드 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const d = await create(t, a, { rules: '  매너 게임  ', rated: false });
    expect(d).toMatchObject({
      status: 'recruiting',
      capacity: 10,
      joined_count: 1,
      waitlist_count: 0,
      rules: '매너 게임',
      options: { rated: false, auto_balance: true, use_positions: true },
      my_status: 'joined',
      join_closed: false,
      balance: null,
      result: null,
      started_at: null,
      cancel_reason: null,
    });
    expect(d.players).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ id: a.userId, nickname: 'alice', avatar_url: null }), is_host: true, status: 'joined', preferred_positions: ['mid'], position: null, team: null }),
    ]);
    expect(d.viewer).toMatchObject({ status: 'joined', is_host: true, can_edit: true, can_cancel: true, can_start: false, can_join: false, can_leave: false });
    expect(t.prisma.scrimPlayer.rows[0]?.joinedAt.toISOString()).toBe(t.clock.now().toISOString());
  });

  it('롤체: auto_balance(has_teams 아님)·use_positions(포지션 없음)는 입력이 true여도 false로 저장', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const d = await create(t, a, { auto_balance: true, use_positions: true }, TFT_BASE);
    expect(d.options).toEqual({ rated: true, auto_balance: false, use_positions: false });
    expect(d.game).toEqual({ code: 'tft', name: expect.any(String), has_positions: false, has_teams: false, positions: [] });
  });

  it('서버 검사 details를 한 번에: 지난 시각·정원 범위 밖·1지망 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const res = await call(t, 'POST', '/scrims', a.token, { ...LOL_BASE, scheduled_at: at(t, 0), capacity: 12, host_preferred_positions: [] });
    const err = await expectError(res, 400, 'VALIDATION_FAILED');
    expect(err.details?.map((x) => x.path).sort()).toEqual(['capacity', 'host_preferred_positions', 'scheduled_at']);
    expect(t.prisma.scrim.rows).toHaveLength(0);
  });

  it('롤 정원: 2·6·8 허용, 홀수 7 → 400(「2명 단위」 안내)', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    for (const capacity of [2, 6, 8]) expect((await create(t, a, { capacity })).capacity).toBe(capacity);
    const err = await expectError(await call(t, 'POST', '/scrims', a.token, { ...LOL_BASE, scheduled_at: at(t, DAY), capacity: 7 }), 400, 'VALIDATION_FAILED');
    expect(err.details).toEqual([{ path: 'capacity', message: '이 게임의 정원은 2–10명 2명 단위입니다.' }]);
    const s = await create(t, a);
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, a.token, { capacity: 5 }), 400, 'VALIDATION_FAILED');
    expect((await detailOf(await call(t, 'PATCH', `/scrims/${s.id}`, a.token, { capacity: 4 }))).capacity).toBe(4);
  });

  it('시작 시각 경계: 정확히 30일 뒤 허용, 30일 + 1ms 거부. 포지션 없는 게임에 포지션 → 400', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    await create(t, a, { scheduled_at: at(t, 30 * DAY) });
    const far = await call(t, 'POST', '/scrims', a.token, { ...LOL_BASE, scheduled_at: at(t, 30 * DAY + 1) });
    expect((await expectError(far, 400, 'VALIDATION_FAILED')).details?.[0]?.path).toBe('scheduled_at');
    const tft = await call(t, 'POST', '/scrims', a.token, { ...TFT_BASE, scheduled_at: at(t, DAY), host_preferred_positions: ['mid'] });
    expect((await expectError(tft, 400, 'VALIDATION_FAILED')).details?.[0]?.path).toBe('host_preferred_positions');
    const lolUnknown = await call(t, 'POST', '/scrims', a.token, { ...LOL_BASE, scheduled_at: at(t, DAY), host_preferred_positions: ['adc'] });
    expect((await expectError(lolUnknown, 400, 'VALIDATION_FAILED')).details?.[0]?.path).toBe('host_preferred_positions');
  });

  it('zod: 제목 1자·모르는 필드·포지션 중복 → 400', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    for (const over of [{ title: ' a ' }, { extra: 1 }, { host_preferred_positions: ['mid', 'mid'] }]) {
      await expectError(await call(t, 'POST', '/scrims', a.token, { ...LOL_BASE, scheduled_at: at(t, DAY), ...over }), 400, 'VALIDATION_FAILED');
    }
  });

  it('노쇼 제한 중 → 403 SCRIM_BANNED + Retry-After(해제까지 초, 올림), 본문은 {code, message}', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const now = t.clock.now().getTime();
    seedNoShows(t, a.userId, [new Date(now - 3 * HOUR), new Date(now - 2 * HOUR), new Date(now - HOUR - 500)]);
    const res = await call(t, 'POST', '/scrims', a.token, { ...LOL_BASE, scheduled_at: at(t, DAY) });
    expect(res.headers.get('retry-after')).toBe(String(Math.ceil((DAY - HOUR - 500) / 1000)));
    const err = await expectError(res, 403, 'SCRIM_BANNED');
    expect(Object.keys(err).sort()).toEqual(['code', 'message']);
  });
});

describe('GET /me/scrim-restriction', () => {
  it('제한 없음 / 30일 3회 → until = 마지막 발동 + 1일, policy', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const get = async () => GetMyScrimRestrictionResponse.parse(await (await call(t as TestApp, 'GET', '/me/scrim-restriction', a.token)).json());
    expect(await get()).toEqual({
      restricted: false,
      until: null,
      recent_no_show_count: 0,
      last_no_show_at: null,
      policy: { threshold: 3, window_days: 30, restriction_days: 1 },
    });
    const now = t.clock.now().getTime();
    const last = new Date(now - HOUR);
    seedNoShows(t, a.userId, [new Date(now - 20 * DAY), new Date(now - 10 * DAY), last]);
    const r = await get();
    expect(r).toMatchObject({ restricted: true, recent_no_show_count: 3, last_no_show_at: last.toISOString() });
    expect(r.until).toBe(new Date(last.getTime() + DAY).toISOString());
  });

  it('환경 변수 정책(SCRIM_NO_SHOW_THRESHOLD=2)', async () => {
    t = await createTestApp({ fixedClock: true, env: { SCRIM_NO_SHOW_THRESHOLD: '2' } });
    const a = await login(t, 'alice');
    const now = t.clock.now().getTime();
    seedNoShows(t, a.userId, [new Date(now - 2 * HOUR), new Date(now - HOUR)]);
    const r = GetMyScrimRestrictionResponse.parse(await (await call(t, 'GET', '/me/scrim-restriction', a.token)).json());
    expect(r.restricted).toBe(true);
    expect(r.policy.threshold).toBe(2);
  });
});

describe('GET /scrims 목록', () => {
  it('탭: open(ASC)·playing·ended(DESC), 게임 필터, my_status', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const b = await login(t, 'bob');
    const s2 = await create(t, a, { scheduled_at: at(t, 2 * DAY), title: '둘째' });
    const s1 = await create(t, a, { scheduled_at: at(t, DAY), title: '첫째' });
    const tft = await create(t, b, { scheduled_at: at(t, 3 * DAY) }, TFT_BASE);
    const play = await create(t, b, { scheduled_at: at(t, 4 * DAY) }, TFT_BASE);
    expect((await join(t, a, play.id)).status).toBe(200);
    expect((await call(t, 'POST', `/scrims/${play.id}/start`, b.token)).status).toBe(200);
    const gone = await create(t, b, { scheduled_at: at(t, 5 * DAY) }, TFT_BASE);
    const gone2 = await create(t, b, { scheduled_at: at(t, 6 * DAY) }, TFT_BASE);
    expect((await call(t, 'POST', `/scrims/${gone.id}/cancel`, b.token)).status).toBe(200);
    expect((await call(t, 'POST', `/scrims/${gone2.id}/cancel`, b.token)).status).toBe(200);

    const list = async (qs: string) => {
      const res = await call(t as TestApp, 'GET', `/scrims${qs}`, a.token);
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).not.toMatch(/email|discord/i);
      return ListScrimsResponse.parse(JSON.parse(text));
    };
    const open = await list('');
    expect(open.items.map((s) => s.id)).toEqual([s1.id, s2.id, tft.id]);
    expect(open.items.map((s) => s.my_status)).toEqual(['joined', 'joined', null]);
    expect((await list('?status=playing')).items.map((s) => [s.id, s.my_status, s.joined_count])).toEqual([[play.id, 'joined', 2]]);
    expect((await list('?status=ended')).items.map((s) => s.id)).toEqual([gone2.id, gone.id]);
    expect((await list('?game=tft')).items.map((s) => s.id)).toEqual([tft.id]);
    await expectError(await call(t, 'GET', '/scrims?status=recruiting', a.token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/scrims?game=valorant', a.token), 400, 'VALIDATION_FAILED');
  });

  it('커서: limit=1 페이지 넘김(같은 시각은 id 순), 마지막 next_cursor null, 다른 탭 커서·깨진 커서 → 400 path cursor', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const when = at(t, DAY);
    const ids = [
      (await create(t, a, { scheduled_at: when })).id,
      (await create(t, a, { scheduled_at: when })).id,
      (await create(t, a, { scheduled_at: at(t, 2 * DAY) })).id,
    ];
    const expected = [...ids.slice(0, 2).sort(), ids[2]];
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = `?limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const page = ListScrimsResponse.parse(await (await call(t, 'GET', `/scrims${qs}`, a.token)).json());
      seen.push(...page.items.map((s) => s.id));
      cursor = page.next_cursor;
    } while (cursor && seen.length < 10);
    expect(seen).toEqual(expected);

    const first = ListScrimsResponse.parse(await (await call(t, 'GET', '/scrims?limit=1', a.token)).json());
    const other = await call(t, 'GET', `/scrims?status=ended&cursor=${first.next_cursor}`, a.token);
    expect((await expectError(other, 400, 'VALIDATION_FAILED')).details).toEqual([{ path: 'cursor', message: expect.any(String) }]);
    const broken = await call(t, 'GET', '/scrims?cursor=@@@', a.token);
    expect((await expectError(broken, 400, 'VALIDATION_FAILED')).details?.[0]?.path).toBe('cursor');
  });

  it('open_positions: 롤 10명 = 포지션당 2, 1지망 기준으로 차감', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const b = await login(t, 'bob');
    const s = await create(t, a); // 방장 mid
    await join(t, b, s.id, ['mid', 'top']);
    const page = ListScrimsResponse.parse(await (await call(t, 'GET', '/scrims', b.token)).json());
    expect(page.items[0]?.open_positions).toEqual([
      { position: 'top', count: 2 },
      { position: 'jungle', count: 2 },
      { position: 'bot', count: 2 },
      { position: 'support', count: 2 },
    ]);
    expect(page.items[0]?.my_status).toBe('joined');
  });
});

describe('POST /scrims/:id/join 참가·대기·포지션 변경', () => {
  it('자리 있음 → joined, 마지막 자리 → full, 그다음 → waitlist(대기 1번), 모든 경로가 내전 행 잠금', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const b = await login(t, 'bob');
    const s = await create(t, host, { capacity: 2 }, TFT_BASE);
    const d1 = await detailOf(await join(t, a, s.id));
    expect(d1).toMatchObject({ status: 'full', joined_count: 2, waitlist_count: 0 });
    expect(d1.viewer).toMatchObject({ status: 'joined', waitlist_order: null, can_leave: true, can_join: false });
    const d2 = await detailOf(await join(t, b, s.id));
    expect(d2).toMatchObject({ status: 'full', joined_count: 2, waitlist_count: 1 });
    expect(d2.viewer).toMatchObject({ status: 'waitlist', waitlist_order: 1, can_leave: true });
    expect(d2.waitlist).toEqual([expect.objectContaining({ order: 1, user: expect.objectContaining({ id: b.userId }) })]);
    expect(lockedIds(t)).toEqual([s.id, s.id]);
  });

  it('재참가: 취소 후 다시 신청하면 대기열 맨 뒤(joined_at 갱신)', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const [a, b, c] = [await login(t, 'alice'), await login(t, 'bob'), await login(t, 'carol')];
    const s = await create(t, host, { capacity: 2 }, TFT_BASE);
    await join(t, a, s.id);
    t.clock.advance(1000);
    await join(t, b, s.id);
    t.clock.advance(1000);
    await join(t, c, s.id);
    t.clock.advance(1000);
    await leave(t, b, s.id);
    t.clock.advance(1000);
    const d = await detailOf(await join(t, b, s.id));
    expect(d.waitlist.map((w) => [w.order, w.user.id])).toEqual([
      [1, c.userId],
      [2, b.userId],
    ]);
    expect(d.viewer.waitlist_order).toBe(2);
    expect(t.prisma.scrimPlayer.rows.filter((r) => r.userId === b.userId)).toHaveLength(1);
  });

  it('이미 참가 중 → 희망 포지션만 변경(상태·joined_at 그대로, 멱등)', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const s = await create(t, host);
    const first = await detailOf(await join(t, a, s.id, ['top']));
    t.clock.advance(5000);
    const again = await detailOf(await join(t, a, s.id, ['jungle', 'top']));
    const mine = again.players.find((p) => p.user.id === a.userId);
    expect(mine).toMatchObject({ status: 'joined', preferred_positions: ['jungle', 'top'] });
    expect(mine?.joined_at).toBe(first.players.find((p) => p.user.id === a.userId)?.joined_at);
    expect(again.viewer.preferred_positions).toEqual(['jungle', 'top']);
    expect(again.joined_count).toBe(2);
  });

  it('포지션 검증: 롤 1지망 없음·없는 포지션 → 400, 롤체에 포지션 → 400 (path preferred_positions)', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const lol = await create(t, host);
    const tft = await create(t, host, {}, TFT_BASE);
    for (const [id, pos] of [
      [lol.id, []],
      [lol.id, ['adc']],
      [tft.id, ['mid']],
    ] as const) {
      const err = await expectError(await join(t, a, id, [...pos]), 400, 'VALIDATION_FAILED');
      expect(err.details?.[0]?.path).toBe('preferred_positions');
    }
    // 본문은 객체여야 한다. {} = 포지션 없음
    expect((await call(t, 'POST', `/scrims/${tft.id}/join`, a.token, {})).status).toBe(200);
  });

  it('시작 시각이 지나면(now ≥ scheduled_at) 참가·취소 409 SCRIM_JOIN_CLOSED, join_closed true', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const b = await login(t, 'bob');
    const s = await create(t, host, { capacity: 4, scheduled_at: at(t, HOUR) }, TFT_BASE);
    await join(t, a, s.id);
    t.clock.advance(HOUR);
    await expectError(await join(t, b, s.id), 409, 'SCRIM_JOIN_CLOSED');
    await expectError(await leave(t, a, s.id), 409, 'SCRIM_JOIN_CLOSED');
    const d = await getScrim(t, b, s.id);
    expect(d.join_closed).toBe(true);
    expect(d.viewer).toMatchObject({ can_join: false });
  });

  it('노쇼 제한: 새 신청 403(Retry-After), 이미 참가한 내전의 포지션 변경·참가 취소는 허용', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const s1 = await create(t, host);
    const s2 = await create(t, host);
    await join(t, a, s1.id, ['top']);
    const now = t.clock.now().getTime();
    seedNoShows(t, a.userId, [new Date(now - 3 * HOUR), new Date(now - 2 * HOUR), new Date(now - HOUR)]);
    const banned = await join(t, a, s2.id, ['top']);
    expect(banned.headers.get('retry-after')).toBe(String((DAY - HOUR) / 1000));
    await expectError(banned, 403, 'SCRIM_BANNED');
    const viewS2 = await getScrim(t, a, s2.id);
    expect(viewS2.viewer.can_join).toBe(false);
    expect(viewS2.viewer.restricted_until).toBe(new Date(now - HOUR + DAY).toISOString());
    expect((await join(t, a, s1.id, ['bot'])).status).toBe(200);
    expect((await leave(t, a, s1.id)).status).toBe(200);
    // 취소 후 재참가는 새 신청 → 막힘(제한 우회 불가)
    await expectError(await join(t, a, s1.id, ['bot']), 403, 'SCRIM_BANNED');
  });

  it('없는 내전 404, UUID 아님 400, 인증 없음 401', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    await expectError(await join(t, a, randomUUID()), 404, 'NOT_FOUND');
    await expectError(await call(t, 'GET', `/scrims/${randomUUID()}`, a.token), 404, 'NOT_FOUND');
    await expectError(await call(t, 'GET', '/scrims/abc', a.token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/scrims'), 401, 'UNAUTHENTICATED');
  });
});

describe('DELETE /scrims/:id/join 참가 취소', () => {
  it('확정자 취소 → 대기 1번 승격(희망 포지션·joined_at 유지), 대기 남으면 full 유지', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const players: Who[] = [];
    for (let i = 1; i <= 9; i++) players.push(await login(t, `p${i}`));
    const w1 = await login(t, 'wait_one');
    const w2 = await login(t, 'wait_two');
    const s = await create(t, host);
    for (const p of players) expect((await join(t, p, s.id, ['top'])).status).toBe(200);
    t.clock.advance(1000);
    const w1d = await detailOf(await join(t, w1, s.id, ['support', 'bot']));
    expect(w1d).toMatchObject({ status: 'full', waitlist_count: 1 });
    t.clock.advance(1000);
    await join(t, w2, s.id, ['jungle']);
    const w1JoinedAt = w1d.waitlist[0]?.joined_at;
    const d = await detailOf(await leave(t, players[0] as Who, s.id));
    expect(d).toMatchObject({ status: 'full', joined_count: 10, waitlist_count: 1 });
    const promoted = d.players.find((p) => p.user.id === w1.userId);
    expect(promoted).toMatchObject({ status: 'joined', preferred_positions: ['support', 'bot'], joined_at: w1JoinedAt });
    expect(d.waitlist.map((w) => [w.order, w.user.id])).toEqual([[1, w2.userId]]);
    expect(d.viewer.status).toBeNull();
    // 슬롯 순서: 방장 먼저
    expect(d.players[0]?.is_host).toBe(true);
    // 불변식: 대기가 있으면 joined = capacity
    expect(t.prisma.scrimPlayer.rows.filter((r) => r.scrimId === s.id && r.status === 'joined')).toHaveLength(10);
  });

  it('대기 없음 → full → recruiting, 대기자 취소는 승격 없이 cancelled', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const b = await login(t, 'bob');
    const s = await create(t, host, { capacity: 2 }, TFT_BASE);
    await join(t, a, s.id);
    await join(t, b, s.id);
    const d1 = await detailOf(await leave(t, b, s.id));
    expect(d1).toMatchObject({ status: 'full', joined_count: 2, waitlist_count: 0 });
    const d2 = await detailOf(await leave(t, a, s.id));
    expect(d2).toMatchObject({ status: 'recruiting', joined_count: 1 });
  });

  it('방장 → 409 SCRIM_HOST_CANNOT_LEAVE, 참가 기록 없음·이미 취소 → 변경 없이 200', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const s = await create(t, host, { capacity: 2 }, TFT_BASE);
    await expectError(await leave(t, host, s.id), 409, 'SCRIM_HOST_CANNOT_LEAVE');
    const d = await detailOf(await leave(t, a, s.id));
    expect(d.viewer.status).toBeNull();
    expect(t.prisma.scrimPlayer.rows).toHaveLength(1);
    await join(t, a, s.id);
    await leave(t, a, s.id);
    const again = await detailOf(await leave(t, a, s.id));
    expect(again).toMatchObject({ status: 'recruiting', joined_count: 1 });
  });
});

describe('PATCH /scrims/:id 수정', () => {
  it('정원 축소 < 참가 인원 → 409, 확대 → 대기열 순서대로 승격 + 상태 갱신', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const [a, b, c] = [await login(t, 'alice'), await login(t, 'bob'), await login(t, 'carol')];
    const s = await create(t, host, { capacity: 2 }, TFT_BASE);
    await join(t, a, s.id);
    t.clock.advance(1000);
    await join(t, b, s.id);
    t.clock.advance(1000);
    await join(t, c, s.id);
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { capacity: 1 }), 400, 'VALIDATION_FAILED');
    const d3 = await detailOf(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { capacity: 3 }));
    expect(d3).toMatchObject({ capacity: 3, status: 'full', joined_count: 3, waitlist_count: 1 });
    expect(d3.waitlist[0]?.user.id).toBe(c.userId);
    const d8 = await detailOf(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { capacity: 8 }));
    expect(d8).toMatchObject({ capacity: 8, status: 'recruiting', joined_count: 4, waitlist_count: 0 });
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { capacity: 3 }), 409, 'SCRIM_CAPACITY_BELOW_JOINED');
    const d4 = await detailOf(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { capacity: 4 }));
    expect(d4.status).toBe('full');
  });

  it('시작 시각이 지난 모집글도 미래로 미루면 join_closed 해제 → 참가 가능(D92)', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const s = await create(t, host, { capacity: 4, scheduled_at: at(t, HOUR) }, TFT_BASE);
    t.clock.advance(2 * HOUR);
    await expectError(await join(t, a, s.id), 409, 'SCRIM_JOIN_CLOSED');
    const titled = await detailOf(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { title: '제목만 바꿈' }));
    expect(titled.join_closed).toBe(true);
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { scheduled_at: at(t, -MIN) }), 400, 'VALIDATION_FAILED');
    const moved = await detailOf(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { scheduled_at: at(t, HOUR) }));
    expect(moved.join_closed).toBe(false);
    expect((await join(t, a, s.id)).status).toBe(200);
  });

  it('방장 아님 → 403(운영진도), 정원 범위 밖 → 400 path capacity, rules 빈 문자열 → null, auto_balance 적용값', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const admin = await login(t, 'boss', 'admin');
    const s = await create(t, host, { rules: '규칙' }, TFT_BASE);
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, a.token, { title: '남의 글' }), 403, 'FORBIDDEN');
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, admin.token, { title: '남의 글' }), 403, 'FORBIDDEN');
    await expectError(await call(t, 'PATCH', `/scrims/${randomUUID()}`, a.token, { title: '없음' }), 404, 'NOT_FOUND');
    const cap = await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { capacity: 9 }), 400, 'VALIDATION_FAILED');
    expect(cap.details?.[0]?.path).toBe('capacity');
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, {}), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { use_positions: true }), 400, 'VALIDATION_FAILED');
    const d = await detailOf(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { rules: '   ', auto_balance: true, rated: false }));
    expect(d.rules).toBeNull();
    expect(d.options).toEqual({ rated: false, auto_balance: false, use_positions: false });
  });

  it('모집 중이 아니면 409 SCRIM_NOT_RECRUITING', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const s = await create(t, host, {}, TFT_BASE);
    await call(t, 'POST', `/scrims/${s.id}/cancel`, host.token);
    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, host.token, { title: '다시' }), 409, 'SCRIM_NOT_RECRUITING');
  });
});

describe('POST /scrims/:id/start 시작', () => {
  it('롤(꽉 차야 시작) 10명 중 9명 → 409 SCRIM_CANNOT_START, 롤 4명 정원 4/4 → 시작, 롤체 1명 → 409, 2명 → playing(started_at), 대기열 그대로', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const lol = await create(t, host);
    for (let i = 1; i <= 8; i++) await join(t, await login(t, `p${i}`), lol.id, ['top']);
    expect((await getScrim(t, host, lol.id)).viewer.can_start).toBe(false);
    await expectError(await call(t, 'POST', `/scrims/${lol.id}/start`, host.token), 409, 'SCRIM_CANNOT_START');

    const lol4 = await create(t, host, { capacity: 4 });
    for (let i = 1; i <= 2; i++) await join(t, await login(t, `q${i}`), lol4.id, ['top']);
    expect((await getScrim(t, host, lol4.id)).viewer.can_start).toBe(false);
    await join(t, await login(t, 'q3'), lol4.id, ['top']);
    expect((await getScrim(t, host, lol4.id)).viewer.can_start).toBe(true);
    expect(await detailOf(await call(t, 'POST', `/scrims/${lol4.id}/start`, host.token))).toMatchObject({ status: 'playing', joined_count: 4 });

    const tft = await create(t, host, { capacity: 2 }, TFT_BASE);
    await expectError(await call(t, 'POST', `/scrims/${tft.id}/start`, host.token), 409, 'SCRIM_CANNOT_START');
    const a = await login(t, 'alice');
    const w = await login(t, 'waiter');
    await join(t, a, tft.id);
    await join(t, w, tft.id);
    expect((await getScrim(t, host, tft.id)).viewer.can_start).toBe(true);
    const d = await detailOf(await call(t, 'POST', `/scrims/${tft.id}/start`, host.token));
    expect(d).toMatchObject({ status: 'playing', started_at: t.clock.now().toISOString(), joined_count: 2, waitlist_count: 1 });
    expect(d.viewer).toMatchObject({ can_start: false, can_cancel: false, can_edit: false });
    await expectError(await call(t, 'POST', `/scrims/${tft.id}/start`, host.token), 409, 'SCRIM_NOT_RECRUITING');
    await expectError(await join(t, await login(t, 'late'), tft.id), 409, 'SCRIM_NOT_RECRUITING');
  });

  it('운영진은 남의 모집글 시작 가능(시작 시각 전이어도), 일반 멤버 → 403', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const admin = await login(t, 'boss', 'admin');
    const s = await create(t, host, { capacity: 4 }, TFT_BASE);
    await join(t, a, s.id);
    await expectError(await call(t, 'POST', `/scrims/${s.id}/start`, a.token), 403, 'FORBIDDEN');
    expect((await getScrim(t, admin, s.id)).viewer.can_start).toBe(true);
    const d = await detailOf(await call(t, 'POST', `/scrims/${s.id}/start`, admin.token));
    expect(d.status).toBe('playing');
  });
});

describe('POST /scrims/:id/cancel 모집 취소', () => {
  it('방장 → cancel_reason host, 운영진 → admin, 멤버 → 403, 참가자 행 그대로', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const admin = await login(t, 'boss', 'admin');
    const s1 = await create(t, host, {}, TFT_BASE);
    const s2 = await create(t, host, {}, TFT_BASE);
    await join(t, a, s1.id);
    await expectError(await call(t, 'POST', `/scrims/${s1.id}/cancel`, a.token), 403, 'FORBIDDEN');
    const d1 = await detailOf(await call(t, 'POST', `/scrims/${s1.id}/cancel`, host.token));
    expect(d1).toMatchObject({ status: 'cancelled', cancel_reason: 'host', cancelled_at: t.clock.now().toISOString(), joined_count: 2 });
    expect(d1.viewer).toMatchObject({ can_join: false, can_leave: false, can_cancel: false });
    const d2 = await detailOf(await call(t, 'POST', `/scrims/${s2.id}/cancel`, admin.token));
    expect(d2.cancel_reason).toBe('admin');
    await expectError(await call(t, 'POST', `/scrims/${s1.id}/cancel`, host.token), 409, 'SCRIM_NOT_RECRUITING');
    await expectError(await join(t, a, s1.id), 409, 'SCRIM_NOT_RECRUITING');
    await expectError(await leave(t, a, s1.id), 409, 'SCRIM_NOT_RECRUITING');
  });
});

describe('PUT /scrims/:id/players/:userId/no-show 노쇼', () => {
  async function playingScrim(app: TestApp) {
    const host = await login(app, 'host');
    const a = await login(app, 'alice');
    const w = await login(app, 'waiter');
    const admin = await login(app, 'boss', 'admin');
    const s = await create(app, host, { capacity: 2, scheduled_at: at(app, HOUR) }, TFT_BASE);
    await join(app, a, s.id);
    await join(app, w, s.id);
    return { host, a, w, admin, s };
  }

  it('운영진 아님 → 403(없는 내전이어도 FORBIDDEN이 먼저), 시작 전 → 409', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin, s } = await playingScrim(t);
    await expectError(await noShow(t, host, s.id, a.userId, true), 403, 'FORBIDDEN');
    await expectError(await noShow(t, host, randomUUID(), a.userId, true), 403, 'FORBIDDEN');
    await expectError(await noShow(t, admin, s.id, a.userId, true), 409, 'SCRIM_NO_SHOW_NOT_ALLOWED');
    await expectError(await noShow(t, admin, randomUUID(), a.userId, true), 404, 'NOT_FOUND');
    await expectError(await call(t, 'PUT', `/scrims/${s.id}/players/abc/no-show`, admin.token, { no_show: true }), 400, 'VALIDATION_FAILED');
  });

  it('표시(시각·표시자 기록, 멱등) → 정정(null), 방장도 대상, 대기자·기록 없음 → 409·404', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, w, admin, s } = await playingScrim(t);
    await call(t, 'POST', `/scrims/${s.id}/start`, host.token);
    t.clock.advance(2 * HOUR);
    expect((await getScrim(t, admin, s.id)).viewer.can_mark_no_show).toBe(true);
    expect((await getScrim(t, host, s.id)).viewer.can_mark_no_show).toBe(false);
    const d = await detailOf(await noShow(t, admin, s.id, a.userId, true));
    const marked = d.players.find((p) => p.user.id === a.userId);
    expect(marked).toMatchObject({ status: 'no_show', no_show_marked_at: t.clock.now().toISOString() });
    expect(d.joined_count).toBe(2);
    const row = t.prisma.scrimPlayer.rows.find((r) => r.userId === a.userId);
    expect(row).toMatchObject({ status: 'no_show', noShowMarkedById: admin.userId });
    const markedAt = row?.noShowMarkedAt?.toISOString();
    t.clock.advance(MIN);
    await detailOf(await noShow(t, admin, s.id, a.userId, true));
    expect(t.prisma.scrimPlayer.rows.find((r) => r.userId === a.userId)?.noShowMarkedAt?.toISOString()).toBe(markedAt);
    expect((await detailOf(await noShow(t, admin, s.id, host.userId, true))).players[0]?.status).toBe('no_show');

    const undo = await detailOf(await noShow(t, admin, s.id, a.userId, false));
    expect(undo.players.find((p) => p.user.id === a.userId)).toMatchObject({ status: 'joined', no_show_marked_at: null });
    expect(t.prisma.scrimPlayer.rows.find((r) => r.userId === a.userId)).toMatchObject({ noShowMarkedAt: null, noShowMarkedById: null });
    expect((await noShow(t, admin, s.id, a.userId, false)).status).toBe(200);

    await expectError(await noShow(t, admin, s.id, w.userId, true), 409, 'SCRIM_NO_SHOW_NOT_ALLOWED');
    await expectError(await noShow(t, admin, s.id, randomUUID(), true), 404, 'NOT_FOUND');
  });

  it('표시 기한: 시작 시각 + 7일 정각까지 허용, 지나면 409. 정정은 기한 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin, s } = await playingScrim(t);
    await call(t, 'POST', `/scrims/${s.id}/start`, host.token);
    const scheduled = new Date(s.scheduled_at).getTime();
    t.clock.set(new Date(scheduled + 7 * DAY));
    expect((await noShow(t, admin, s.id, host.userId, true)).status).toBe(200);
    t.clock.set(new Date(scheduled + 7 * DAY + 1));
    expect((await getScrim(t, admin, s.id)).viewer.can_mark_no_show).toBe(false);
    await expectError(await noShow(t, admin, s.id, a.userId, true), 409, 'SCRIM_NO_SHOW_NOT_ALLOWED');
    t.clock.advance(30 * DAY);
    expect((await noShow(t, admin, s.id, host.userId, false)).status).toBe(200);
  });

  it('노쇼 3회 표시 → 그 사용자 제한(작성·참가 403, 조회 restricted)', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const admin = await login(t, 'boss', 'admin');
    for (let i = 0; i < 3; i++) {
      const s = await create(t, host, { scheduled_at: at(t, HOUR) }, TFT_BASE);
      await join(t, a, s.id);
      await call(t, 'POST', `/scrims/${s.id}/start`, host.token);
      t.clock.advance(MIN);
      expect((await noShow(t, admin, s.id, a.userId, true)).status).toBe(200);
    }
    const r = GetMyScrimRestrictionResponse.parse(await (await call(t, 'GET', '/me/scrim-restriction', a.token)).json());
    expect(r).toMatchObject({ restricted: true, recent_no_show_count: 3 });
    await expectError(await call(t, 'POST', '/scrims', a.token, { ...TFT_BASE, scheduled_at: at(t, DAY) }), 403, 'SCRIM_BANNED');
  });
});

describe('자동 마감(ScrimAutoCloser, 5-5)', () => {
  it('시작 시각 + 60분: 조건 충족 → playing, 미달 → cancelled not_started, 59분 → 그대로, 이미 시작 → 건너뜀', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const a = await login(t, 'alice');
    const ok = await create(t, host, { scheduled_at: at(t, HOUR) }, TFT_BASE);
    await join(t, a, ok.id);
    const lonely = await create(t, host, { scheduled_at: at(t, HOUR) }, TFT_BASE);
    const lolNine = await create(t, host, { scheduled_at: at(t, HOUR) });
    for (let i = 1; i <= 8; i++) await join(t, await login(t, `p${i}`), lolNine.id, ['top']);
    const later = await create(t, host, { scheduled_at: at(t, HOUR + MIN) }, TFT_BASE);
    const started = await create(t, host, { scheduled_at: at(t, HOUR) }, TFT_BASE);
    await join(t, await login(t, 'bob'), started.id);
    await call(t, 'POST', `/scrims/${started.id}/start`, host.token);

    t.clock.advance(2 * HOUR); // 각 시작 시각 + 60분 정각(later는 + 59분)
    const closer = t.app.get(ScrimAutoCloser);
    t.prisma.rawCalls = [];
    const run = await closer.runOnce();
    expect(run).toEqual({ acquired: true, started: 1, cancelled: 2, skipped: 0, failed: 0 });
    const status = (id: string) => t?.prisma.scrim.rows.find((r) => r.id === id);
    expect(status(ok.id)).toMatchObject({ status: 'playing', startedAt: t.clock.now() });
    expect(status(lonely.id)).toMatchObject({ status: 'cancelled', cancelReason: 'not_started', cancelledAt: t.clock.now() });
    expect(status(lolNine.id)).toMatchObject({ status: 'cancelled', cancelReason: 'not_started' });
    expect(status(later.id)?.status).toBe('recruiting');
    expect(t.prisma.rawCalls[0]?.sql).toMatch(/pg_try_advisory_xact_lock\(hashtext/);
    expect(t.prisma.rawCalls[0]?.values).toEqual([SCRIM_AUTO_CLOSE_LOCK_KEY]);
    expect(lockedIds(t).sort()).toEqual([ok.id, lonely.id, lolNine.id].sort());

    // 그사이 다른 경로가 바꾼 건은 다시 판정해 건너뜀
    expect(await closer.closeOne(ok.id, t.clock.now())).toBeNull();
  });

  it('advisory lock을 못 얻으면 아무것도 하지 않는다', async () => {
    t = await createTestApp({ fixedClock: true });
    const host = await login(t, 'host');
    const s = await create(t, host, { scheduled_at: at(t, HOUR) }, TFT_BASE);
    t.clock.advance(3 * HOUR);
    t.prisma.advisoryAvailable = false;
    expect(await t.app.get(ScrimAutoCloser).runOnce()).toEqual({ acquired: false, started: 0, cancelled: 0, skipped: 0, failed: 0 });
    expect(t.prisma.scrim.rows.find((r) => r.id === s.id)?.status).toBe('recruiting');
  });

  it('SCRIM_AUTO_CLOSE_AFTER_MIN 반영(30분)', async () => {
    t = await createTestApp({ fixedClock: true, env: { SCRIM_AUTO_CLOSE_AFTER_MIN: '30' } });
    const host = await login(t, 'host');
    const s = await create(t, host, { scheduled_at: at(t, HOUR) }, TFT_BASE);
    t.clock.advance(HOUR + 30 * MIN);
    expect((await t.app.get(ScrimAutoCloser).runOnce()).cancelled).toBe(1);
    expect(t.prisma.scrim.rows.find((r) => r.id === s.id)?.status).toBe('cancelled');
  });
});

describe('ScrimsModule.forRoot SCRIM_JOBS_ENABLED (D96)', () => {
  it('false: 자동 마감 cron(ScrimAutoCloseScheduler)·ScheduleModule 미등록, 실행기(ScrimAutoCloser)는 항상 등록', () => {
    const off = ScrimsModule.forRoot({ SCRIM_JOBS_ENABLED: 'false' });
    expect(off.providers).not.toContain(ScrimAutoCloseScheduler);
    expect(off.providers).toContain(ScrimAutoCloser);
    expect(off.imports ?? []).toHaveLength(0);
    const on = ScrimsModule.forRoot({});
    expect(on.providers).toContain(ScrimAutoCloseScheduler);
    expect(on.imports).toHaveLength(1);
  });

  it('scheduler.tick은 실행 실패를 삼키고 null(다음 주기에 다시)', async () => {
    const failing = { runOnce: async () => Promise.reject(new Error('db down')) } as unknown as ScrimAutoCloser;
    expect(await new ScrimAutoCloseScheduler(failing).tick()).toBeNull();
  });
});
