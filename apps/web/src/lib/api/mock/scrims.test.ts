import {
  ApiPath,
  CreateScrimResponse,
  DevLoginResponse,
  GetMyScrimRestrictionResponse,
  GetScrimResponse,
  JoinScrimResponse,
  LeaveScrimResponse,
  LinkGameAccountResponse,
  ListGamesResponse,
  ListScrimsResponse,
  SearchSteamAppsResponse,
  SetScrimNoShowResponse,
  StartScrimResponse,
  CancelScrimResponse,
  UpdateScrimResponse,
  fillPath,
  type CreateScrimRequestInput,
  type ScrimListStatus,
  type UserRole,
} from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { createMockBackend, type MockDb } from './backend';
import { computeOpenPositions } from './scrims';

/** S2 목이 계약을 지키는지: 실제 클라이언트(zod 파싱)로 호출한다 */
function setup(login?: { username: string; role?: UserRole }) {
  let db: MockDb | null = null;
  let now = Date.parse('2026-10-28T03:00:00.000Z'); // KST 12:00
  const mock = createMockBackend({
    storage: { get: () => db, set: (d) => (db = d) },
    cookies: { hasRefresh: () => true, setRefresh: () => {}, clearRefresh: () => {} },
    now: () => now,
    s1: { origin: () => 'http://localhost:3000' },
  });
  const api = createApiClient({ fetch: mock.fetch });
  const ready = (async () => {
    if (!login) return mock.discordSignIn();
    const res = await api.request(ApiPath.authDevLogin, DevLoginResponse, { method: 'POST', body: login, auth: false });
    api.setSession(res);
    return res.user;
  })();

  const list = (status: ScrimListStatus, extra: Record<string, string> = {}) =>
    api.request(`${ApiPath.scrims}?${new URLSearchParams({ status, ...extra }).toString()}`, ListScrimsResponse);
  const get = (id: string) => api.request(fillPath(ApiPath.scrim, { id }), GetScrimResponse);
  const join = (id: string, preferred_positions: string[] = []) =>
    api.request(fillPath(ApiPath.scrimJoin, { id }), JoinScrimResponse, { method: 'POST', body: { preferred_positions } });
  const leave = (id: string) => api.request(fillPath(ApiPath.scrimJoin, { id }), LeaveScrimResponse, { method: 'DELETE' });
  const create = (body: CreateScrimRequestInput) =>
    api.request(ApiPath.scrims, CreateScrimResponse, { method: 'POST', body });
  const findByTitle = async (status: ScrimListStatus, title: string) => {
    const page1 = await list(status, { limit: '100' });
    const s = page1.items.find((x) => x.title === title);
    if (!s) throw new Error(`no scrim ${title}`);
    return s;
  };
  const kst = (hoursFromNow: number) => {
    const t = new Date(now + hoursFromNow * 3_600_000 + 9 * 3_600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:00:00+09:00`;
  };
  return {
    api,
    ready,
    list,
    get,
    join,
    leave,
    create,
    findByTitle,
    kst,
    db: () => db!,
    advance: (ms: number) => (now += ms),
  };
}

describe('S2 목: 게임·목록', () => {
  it('GET /games: sort_order 순, 정원 범위(롤 10 고정)', async () => {
    const t = setup();
    await t.ready;
    const res = await t.api.request(ApiPath.games, ListGamesResponse);
    expect(res.items.map((g) => g.code)).toEqual(['lol', 'tft', 'steam']);
    expect(res.items[0]!.capacity).toEqual({ min: 2, max: 10, default: 10, step: 2, start_requires_full: true });
    expect(res.next_cursor).toBeNull();
  });

  it('모집 중 탭: 시작 시각 오름차순, 커서 페이징, 다른 탭 커서는 VALIDATION_FAILED', async () => {
    const t = setup();
    await t.ready;
    const p1 = await t.list('open', { limit: '5' });
    expect(p1.items).toHaveLength(5);
    expect(p1.next_cursor).not.toBeNull();
    const times = p1.items.map((s) => Date.parse(s.scheduled_at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    const p2 = await t.list('open', { limit: '5', cursor: p1.next_cursor! });
    expect(p2.items[0]!.id).not.toBe(p1.items[4]!.id);
    expect(Date.parse(p2.items[0]!.scheduled_at)).toBeGreaterThanOrEqual(times[4]!);
    await expect(t.list('ended', { cursor: p1.next_cursor! })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'cursor' }],
    });
    const all = await t.list('open', { limit: '100' });
    expect(all.items.every((s) => s.status === 'recruiting' || s.status === 'full')).toBe(true);
    expect(all.next_cursor).toBeNull();
  });

  it('게임 필터와 탭 구분(진행 중·종료)', async () => {
    const t = setup();
    await t.ready;
    const tft = await t.list('open', { game: 'tft', limit: '100' });
    expect(tft.items.length).toBeGreaterThan(0);
    expect(tft.items.every((s) => s.game.code === 'tft')).toBe(true);
    expect((await t.list('playing')).items.every((s) => s.status === 'playing')).toBe(true);
    const ended = await t.list('ended');
    expect(ended.items.map((s) => s.status).sort()).toEqual(['cancelled', 'finished']);
  });

  it('카드 집계: open_positions(1지망 기준), my_status, 응답에 email·discord_id 없음', async () => {
    const t = setup();
    await t.ready;
    const s = await t.findByTitle('open', '화요일 저녁 5:5 내전');
    expect(s.joined_count).toBe(8);
    expect(s.open_positions).toEqual([
      { position: 'jungle', count: 1 },
      { position: 'support', count: 1 },
    ]);
    expect(s.my_status).toBeNull();
    expect((await t.findByTitle('open', '골드 이하 초보 환영 내전')).my_status).toBe('joined');
    const raw = JSON.stringify(await t.get(s.id));
    expect(raw).not.toContain('discord_id');
    expect(raw).not.toContain('email');
  });

  it('computeOpenPositions(D100): 합계가 빈 자리를 넘으면 [], 같거나 작으면 그대로', () => {
    const lol = ['top', 'jungle', 'mid', 'adc', 'support'];
    // 미드 9명 → 빈 자리 1인데 탑·정글·원딜·서폿 2씩(합계 8) → []
    expect(computeOpenPositions(lol, 10, Array(9).fill('mid'))).toEqual([]);
    // 1지망 고르게 8명 → 정글 1·서폿 1(합계 2 = 빈 자리 2) 그대로
    expect(computeOpenPositions(lol, 10, ['top', 'top', 'jungle', 'mid', 'mid', 'adc', 'adc', 'support'])).toEqual([
      { position: 'jungle', count: 1 },
      { position: 'support', count: 1 },
    ]);
    // null·positions 밖 값으로 합계가 넘는 경우 []
    expect(computeOpenPositions(lol, 10, [null, null, 'x', 'top', 'top', 'jungle', 'jungle', 'mid'])).toEqual([]);
    // 무작위 대조: 합계 ≤ 빈 자리. 실패해도 같은 입력을 다시 만들 수 있게 시드 고정(mulberry32)
    let seed = 0x5eed2d100;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const choices = [...lol, null, 'x'];
    for (let i = 0; i < 300; i++) {
      const n = Math.floor(rand() * 11);
      const picks = Array.from({ length: n }, () => choices[Math.floor(rand() * choices.length)] ?? null);
      const sum = computeOpenPositions(lol, 10, picks).reduce((a, o) => a + o.count, 0);
      expect(sum).toBeLessThanOrEqual(Math.max(0, 10 - n));
    }
  });
});

describe('S2 목: 참가·취소·대기열', () => {
  it('포지션 내전: 1지망 없으면 VALIDATION_FAILED, 참가 후 같은 POST는 포지션만 변경(멱등)', async () => {
    const t = setup();
    await t.ready;
    const s = await t.findByTitle('open', '화요일 저녁 5:5 내전');
    await expect(t.join(s.id, [])).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'preferred_positions' }] });
    await expect(t.join(s.id, ['carry'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const d = await t.join(s.id, ['support']);
    expect(d.viewer).toMatchObject({ status: 'joined', can_join: false, can_leave: true, preferred_positions: ['support'] });
    expect(d.joined_count).toBe(9);
    expect(d.open_positions).toEqual([{ position: 'jungle', count: 1 }]);
    const again = await t.join(s.id, ['mid', 'support']);
    expect(again.viewer.preferred_positions).toEqual(['mid', 'support']);
    expect(again.joined_count).toBe(9);
  });

  it('포지션 없는 게임에 포지션을 보내면 VALIDATION_FAILED', async () => {
    const t = setup();
    await t.ready;
    const s = await t.findByTitle('open', '롤체 8인 친선 로비');
    await expect(t.join(s.id, ['mid'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await t.join(s.id)).viewer.status).toBe('joined');
  });

  it('참가 확정자 취소 → 대기 1번 승격(포지션 유지), 재참가는 대기열 맨 뒤', async () => {
    const t = setup();
    const me = await t.ready;
    const s = await t.findByTitle('open', '주말 협곡 2판 연속');
    // 방장은 취소할 수 없다
    await expect(t.leave(s.id)).rejects.toMatchObject({ code: 'SCRIM_HOST_CANNOT_LEAVE', status: 409 });
    // 방장을 다른 사람으로 바꿔 일반 참가자 흐름을 본다(목 저장소 직접 수정)
    const row = t.db().s2!.scrims.find((x) => x.id === s.id)!;
    row.host_id = '5c0f0000-0000-4000-8000-000000000001';
    const before = await t.get(s.id);
    expect(before.status).toBe('full');
    expect(before.waitlist.map((w) => w.order)).toEqual([1, 2]);
    const first = before.waitlist[0]!;

    const after = await t.leave(s.id);
    expect(after.viewer.status).toBeNull();
    expect(after.status).toBe('full');
    const promoted = after.players.find((p) => p.user.id === first.user.id)!;
    expect(promoted.preferred_positions).toEqual(first.preferred_positions);
    expect(after.waitlist).toHaveLength(1);
    expect(after.players.some((p) => p.user.id === me.id)).toBe(false);

    const rejoin = await t.join(s.id, ['top']);
    expect(rejoin.viewer).toMatchObject({ status: 'waitlist', waitlist_order: 2 });
    expect(rejoin.waitlist[1]!.user.id).toBe(me.id);
  });

  it('대기열 없는 정원 마감에서 취소하면 full → recruiting, 멱등 취소는 200', async () => {
    const t = setup();
    await t.ready;
    const created = await t.create({ game: 'steam', title: '두 명 파티', scheduled_at: t.kst(5), capacity: 2, steam_app_id: 892970 });
    const scrim = t.db().s2!.players;
    scrim.push({
      id: crypto.randomUUID(),
      scrim_id: created.id,
      user_id: '5c0f0000-0000-4000-8000-000000000003',
      status: 'joined',
      preferred_positions: [],
      joined_at: new Date().toISOString(),
      no_show_marked_at: null,
      no_show_marked_by: null,
    });
    t.db().s2!.scrims.find((x) => x.id === created.id)!.status = 'full';
    // 방장을 바꿔 내가 나갈 수 있게
    t.db().s2!.scrims.find((x) => x.id === created.id)!.host_id = '5c0f0000-0000-4000-8000-000000000003';
    const left = await t.leave(created.id);
    expect(left.status).toBe('recruiting');
    expect((await t.leave(created.id)).viewer.status).toBeNull();
  });

  it('시작 시각이 지난 모집글: SCRIM_JOIN_CLOSED, 60분 뒤 자동 마감(롤 미달 → 취소 not_started)', async () => {
    const t = setup();
    await t.ready;
    const s = await t.findByTitle('open', '퇴근 후 칼바람 대신 협곡');
    expect(s.join_closed).toBe(true);
    await expect(t.join(s.id, ['top'])).rejects.toMatchObject({ code: 'SCRIM_JOIN_CLOSED', status: 409 });
    t.advance(60 * 60_000);
    const d = await t.get(s.id);
    expect(d).toMatchObject({ status: 'cancelled', cancel_reason: 'not_started' });
  });
});

describe('S2 목: 작성·수정·시작·취소', () => {
  it('작성 검증: 지난 시각·정원 범위·방장 포지션을 details로 한 번에', async () => {
    const t = setup();
    await t.ready;
    await expect(
      t.create({ game: 'lol', title: '테스트 내전', scheduled_at: t.kst(-2), capacity: 7, host_preferred_positions: [] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: 'scheduled_at' }, { path: 'capacity' }, { path: 'host_preferred_positions' }],
    });
    const d = await t.create({ game: 'lol', title: '  새   내전  ', scheduled_at: t.kst(3), capacity: 10, host_preferred_positions: ['mid'] });
    expect(d).toMatchObject({ title: '새 내전', status: 'recruiting', joined_count: 1 });
    expect(d.viewer).toMatchObject({ is_host: true, status: 'joined', can_edit: true, can_cancel: true, can_start: false, can_leave: false });
    expect(d.players[0]).toMatchObject({ is_host: true, preferred_positions: ['mid'] });
  });

  it('롤체(팀 없음)는 auto_balance 적용값 false, 시작은 2명부터, 모집 취소 이유 host', async () => {
    const t = setup();
    await t.ready;
    const d = await t.create({ game: 'tft', title: '롤체 로비', scheduled_at: t.kst(3), capacity: 4, auto_balance: true });
    expect(d.options).toEqual({ rated: true, auto_balance: false, use_positions: false });
    await expect(
      t.api.request(fillPath(ApiPath.scrimStart, { id: d.id }), StartScrimResponse, { method: 'POST' }),
    ).rejects.toMatchObject({ code: 'SCRIM_CANNOT_START' });
    const c = await t.api.request(fillPath(ApiPath.scrimCancel, { id: d.id }), CancelScrimResponse, { method: 'POST' });
    expect(c).toMatchObject({ status: 'cancelled', cancel_reason: 'host' });
    expect(c.viewer.can_edit).toBe(false);
  });

  it('수정: 정원을 참가 인원 아래로 → SCRIM_CAPACITY_BELOW_JOINED, 방장 아님 → FORBIDDEN', async () => {
    const t = setup();
    await t.ready;
    const d = await t.create({ game: 'steam', title: '스팀 파티', scheduled_at: t.kst(3), capacity: 4, steam_app_id: 578080 });
    const patch = (id: string, body: object) =>
      t.api.request(fillPath(ApiPath.scrim, { id }), UpdateScrimResponse, { method: 'PATCH', body });
    t.db().s2!.players.push({
      id: crypto.randomUUID(),
      scrim_id: d.id,
      user_id: '5c0f0000-0000-4000-8000-000000000004',
      status: 'joined',
      preferred_positions: [],
      joined_at: new Date().toISOString(),
      no_show_marked_at: null,
      no_show_marked_by: null,
    });
    await expect(patch(d.id, { capacity: 1 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(patch(d.id, { capacity: 2 })).resolves.toMatchObject({ capacity: 2, status: 'full' });
    await expect(patch(d.id, { title: '바뀐 제목', rules: '' })).resolves.toMatchObject({ title: '바뀐 제목', rules: null });
    const other = await t.findByTitle('open', '롤체 8인 친선 로비');
    await expect(patch(other.id, { title: '남의 글' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    t.db().s2!.players.push({
      id: crypto.randomUUID(),
      scrim_id: d.id,
      user_id: '5c0f0000-0000-4000-8000-000000000005',
      status: 'joined',
      preferred_positions: [],
      joined_at: new Date().toISOString(),
      no_show_marked_at: null,
      no_show_marked_by: null,
    });
    await expect(patch(d.id, { capacity: 2 })).rejects.toMatchObject({ code: 'SCRIM_CAPACITY_BELOW_JOINED' });
  });

  it('고정 정원 롤: 꽉 찬 내 내전은 시작 가능 → playing, 이후 참가는 SCRIM_NOT_RECRUITING', async () => {
    const t = setup();
    await t.ready;
    const s = await t.findByTitle('open', '주말 협곡 2판 연속');
    expect((await t.get(s.id)).viewer.can_start).toBe(true);
    const started = await t.api.request(fillPath(ApiPath.scrimStart, { id: s.id }), StartScrimResponse, { method: 'POST' });
    expect(started.status).toBe('playing');
    expect(started.started_at).not.toBeNull();
    expect(started.waitlist).toHaveLength(2);
    await expect(t.join(s.id, ['top'])).rejects.toMatchObject({ code: 'SCRIM_NOT_RECRUITING' });
  });
});

describe('스팀 게임 선택 목(D98)', () => {
  it('GET /steam-apps: 검색어 없으면 보유 게임만(보유 많은 순), 검색은 보유 먼저 + 상점, 「상점오류」는 store_unavailable', async () => {
    const t = setup();
    await t.ready;
    const search = (q?: string) =>
      t.api.request(q === undefined ? ApiPath.steamApps : `${ApiPath.steamApps}?q=${encodeURIComponent(q)}`, SearchSteamAppsResponse);
    const all = await search();
    expect(all.items.length).toBeGreaterThan(0);
    expect(all.items.every((a) => a.owner_count > 0)).toBe(true);
    expect(all.items.map((a) => a.owner_count)).toEqual([...all.items.map((a) => a.owner_count)].sort((a, b) => b - a));
    const pal = await search('pal');
    expect(pal.items.map((a) => [a.name, a.owner_count])).toEqual([['Palworld', 0]]);
    expect((await search('상점오류')).store_unavailable).toBe(true);
  });

  it('작성: 스팀은 steam_app_id 필수·목록에 없는 id는 VALIDATION_FAILED, 롤에 보내면 VALIDATION_FAILED, 응답 steam_app', async () => {
    const t = setup();
    await t.ready;
    const base = { game: 'steam' as const, title: '스팀 같이', scheduled_at: t.kst(3), capacity: 4 };
    await expect(t.create(base)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'steam_app_id' }] });
    await expect(t.create({ ...base, steam_app_id: 1 })).rejects.toMatchObject({ details: [{ path: 'steam_app_id' }] });
    await expect(
      t.create({ game: 'lol', title: '롤 내전', scheduled_at: t.kst(3), capacity: 10, host_preferred_positions: ['mid'], steam_app_id: 730 }),
    ).rejects.toMatchObject({ details: [{ path: 'steam_app_id' }] });
    const d = await t.create({ ...base, steam_app_id: 1966720 });
    expect(d.steam_app).toEqual({ app_id: 1966720, name: 'Lethal Company' });
    const u = await t.api.request(fillPath(ApiPath.scrim, { id: d.id }), UpdateScrimResponse, { method: 'PATCH', body: { steam_app_id: 730 } });
    expect(u.steam_app).toEqual({ app_id: 730, name: 'Counter-Strike 2' });
    const seeded = (await t.list('open', { game: 'steam', limit: '100' })).items;
    expect(seeded.every((s) => s.steam_app !== null)).toBe(true);
  });
});

describe('S2 목: 노쇼 제한·노쇼 표시', () => {
  it('최근 노쇼 3회 → 제한(새 참가·작성 403 + Retry-After), 이미 참가한 내전의 포지션 변경은 허용', async () => {
    const t = setup({ username: 'noshow_kim' });
    await t.ready;
    const r = await t.api.request(ApiPath.myScrimRestriction, GetMyScrimRestrictionResponse);
    expect(r).toMatchObject({
      restricted: true,
      recent_no_show_count: 3,
      policy: { threshold: 3, window_days: 30, restriction_days: 1, mark_window_days: 7 },
      scrim_policy: { schedule_max_days_ahead: 30, auto_close_after_min: 60 },
    });
    // 가장 늦은 발동 노쇼(6시간 전) + 1일
    expect(Date.parse(r.until!)).toBe(Date.parse('2026-10-28T03:00:00.000Z') - 6 * 3_600_000 + 86_400_000);

    const tft = await t.findByTitle('open', '롤체 8인 친선 로비');
    const err = await t.join(tft.id).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'SCRIM_BANNED', status: 403 });
    expect((err as { retryAfterSec?: number }).retryAfterSec).toBeGreaterThan(0);
    await expect(t.create({ game: 'tft', title: '제한 중 작성', scheduled_at: t.kst(3), capacity: 4 })).rejects.toMatchObject({
      code: 'SCRIM_BANNED',
    });
    const mine = await t.findByTitle('open', '골드 이하 초보 환영 내전');
    const d = await t.join(mine.id, ['jungle']);
    expect(d.viewer).toMatchObject({ status: 'joined', preferred_positions: ['jungle'] });
    expect(d.viewer.restricted_until).toBe(r.until);
  });

  it('노쇼 표시: 멤버는 FORBIDDEN, 운영진은 표시·정정, 모집 중 내전은 SCRIM_NO_SHOW_NOT_ALLOWED', async () => {
    const member = setup();
    await member.ready;
    const playing = (await member.list('playing')).items[0]!;
    const put = (t: ReturnType<typeof setup>, id: string, userId: string, no_show: boolean) =>
      t.api.request(fillPath(ApiPath.scrimPlayerNoShow, { id, userId }), SetScrimNoShowResponse, { method: 'PUT', body: { no_show } });
    const target = (await member.get(playing.id)).players[2]!.user.id;
    await expect(put(member, playing.id, target, true)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const admin = setup({ username: 'admin_kim', role: 'admin' });
    await admin.ready;
    const p = (await admin.list('playing')).items[0]!;
    const before = await admin.get(p.id);
    expect(before.viewer.can_mark_no_show).toBe(true);
    const uid = before.players[2]!.user.id;
    const marked = await put(admin, p.id, uid, true);
    const row = marked.players.find((x) => x.user.id === uid)!;
    expect(row.status).toBe('no_show');
    expect(row.no_show_marked_at).not.toBeNull();
    expect(marked.joined_count).toBe(before.joined_count);
    const fixed = await put(admin, p.id, uid, false);
    expect(fixed.players.find((x) => x.user.id === uid)!).toMatchObject({ status: 'joined', no_show_marked_at: null });

    const open = await admin.findByTitle('open', '화요일 저녁 5:5 내전');
    const openDetail = await admin.get(open.id);
    await expect(put(admin, open.id, openDetail.players[0]!.user.id, true)).rejects.toMatchObject({
      code: 'SCRIM_NO_SHOW_NOT_ALLOWED',
    });
  });

  it('id가 UUID가 아니면 VALIDATION_FAILED, 없는 내전은 NOT_FOUND', async () => {
    const t = setup();
    await t.ready;
    await expect(t.get('nope')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(t.get('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('스팀 팝업 목(S2 9-2)', () => {
  it('display=popup이면 authorize_url이 완료 페이지, 기본은 /settings', async () => {
    const t = setup();
    await t.ready;
    const popup = await t.api.request(ApiPath.myGameAccounts, LinkGameAccountResponse, {
      method: 'POST',
      body: { provider: 'steam', display: 'popup' },
    });
    expect(popup).toEqual({ provider: 'steam', authorize_url: 'http://localhost:3000/steam-link/complete?steam=linked' });

    const t2 = setup();
    await t2.ready;
    const redirect = await t2.api.request(ApiPath.myGameAccounts, LinkGameAccountResponse, {
      method: 'POST',
      body: { provider: 'steam' },
    });
    expect(redirect).toEqual({ provider: 'steam', authorize_url: 'http://localhost:3000/settings?steam=linked' });
  });
});

describe('S2 목: 백엔드 확정 사항 대조', () => {
  it('POST /join 본문이 없으면 VALIDATION_FAILED, {}는 허용(포지션 없는 게임)', async () => {
    const t = setup();
    await t.ready;
    const s = await t.findByTitle('open', '롤체 8인 친선 로비');
    await expect(t.api.request(fillPath(ApiPath.scrimJoin, { id: s.id }), JoinScrimResponse, { method: 'POST' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      t.api.request(fillPath(ApiPath.scrimJoin, { id: s.id }), JoinScrimResponse, { method: 'POST', body: {} }),
    ).resolves.toMatchObject({ viewer: { status: 'joined', preferred_positions: [] } });
  });

  it('노쇼 행의 viewer.preferred_positions는 [], 노쇼가 없으면 last_no_show_at null', async () => {
    const admin = setup({ username: 'admin_lee', role: 'admin' });
    const me = await admin.ready;
    const p = (await admin.list('playing')).items[0]!;
    const marked = await admin.api.request(fillPath(ApiPath.scrimPlayerNoShow, { id: p.id, userId: me.id }), SetScrimNoShowResponse, {
      method: 'PUT',
      body: { no_show: true },
    });
    expect(marked.viewer).toMatchObject({ status: 'no_show', preferred_positions: [] });

    const t = setup();
    await t.ready;
    const r = await t.api.request(ApiPath.myScrimRestriction, GetMyScrimRestrictionResponse);
    expect(r).toMatchObject({ restricted: false, until: null, last_no_show_at: null, recent_no_show_count: 0 });
    // 제한이 아니어도 정책 값은 채운다(D101)
    expect(r.policy.mark_window_days).toBe(7);
    expect(r.scrim_policy).toEqual({ schedule_max_days_ahead: 30, auto_close_after_min: 60 });
  });
});
