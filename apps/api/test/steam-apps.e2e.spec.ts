/**
 * 스팀 내전 게임 선택(D98): GET /steam-apps 검색, POST·PATCH /scrims의 steam_app_id, 응답 steam_app.
 * 상점 호출은 목(mockSteam.searchStoreApps·getStoreApp), 멤버 보유 게임은 steam_playtime 행을 직접 심는다.
 * S5 D234: 「보유자」 = 플레이타임 랭킹과 같은 조건(대표·확인된 스팀 계정, minutes_total > 0, 탈퇴 제외).
 */
import { randomUUID } from 'node:crypto';
import { GetPlaytimeRankingResponse, ListGamesResponse, ListScrimsResponse, ScrimDetail, SearchSteamAppsResponse } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ExternalApiError } from '../src/integrations/contracts';
import { call, expectError } from './support/s1-helpers';
import { linkedMember, seedSteam } from './support/s5-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const DAY = 24 * 60 * 60_000;

type Who = { token: string; userId: string };

async function login(app: TestApp, username: string): Promise<Who> {
  const res = await fetch(`${app.base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

/** 보유자(대표·확인된 스팀 계정, 10분) n명이 같은 게임을 가진 것처럼 회원·계정·steam_playtime 행을 심는다 */
let ownerSeq = 0;
async function own(app: TestApp, appId: number, appName: string | null, accounts: number): Promise<void> {
  for (let i = 0; i < accounts; i++) {
    const u = await linkedMember(app, `owner${++ownerSeq}`);
    seedSteam(app, u.id, [{ appId, total: 10, name: appName }]);
  }
}

const STEAM_BASE = { game: 'steam', title: '스팀 같이 해요', capacity: 4 } as const;

async function search(app: TestApp, who: Who, q?: string): Promise<SearchSteamAppsResponse> {
  const res = await call(app, 'GET', q === undefined ? '/steam-apps' : `/steam-apps?q=${encodeURIComponent(q)}`, who.token);
  expect(res.status).toBe(200);
  return SearchSteamAppsResponse.parse(await res.json());
}

async function createSteam(app: TestApp, who: Who, body: object) {
  return call(app, 'POST', '/scrims', who.token, {
    ...STEAM_BASE,
    scheduled_at: new Date(app.clock.now().getTime() + DAY).toISOString(),
    ...body,
  });
}

describe('GET /games requires_steam_app', () => {
  it('스팀만 true', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const body = ListGamesResponse.parse(await (await call(t, 'GET', '/games', a.token)).json());
    expect(body.items.map((g) => [g.code, g.requires_steam_app])).toEqual([
      ['lol', false],
      ['tft', false],
      ['steam', true],
    ]);
  });
});

describe('GET /steam-apps', () => {
  it('검색어 없음: 멤버 보유 게임을 연동 계정 수 많은 순(같으면 app id 순), 이름 없는 행 제외, 상점 호출 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    await own(t, 730, 'Counter-Strike 2', 3);
    await own(t, 570, 'Dota 2', 1);
    await own(t, 440, 'Team Fortress 2', 1);
    await own(t, 999, null, 5);
    const r = await search(t, a);
    expect(r).toEqual({
      items: [
        { app_id: 730, name: 'Counter-Strike 2', owner_count: 3 },
        { app_id: 440, name: 'Team Fortress 2', owner_count: 1 },
        { app_id: 570, name: 'Dota 2', owner_count: 1 },
      ],
      store_unavailable: false,
    });
    expect(t.steam.searchStoreApps).not.toHaveBeenCalled();
  });

  it('검색어: 보유 게임(대소문자 무시) 먼저, 상점 결과는 중복 빼고 뒤에(보유 수 포함), 같은 검색어는 10분 캐시', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    await own(t, 1172470, 'Apex Legends', 2);
    await own(t, 2000, 'Other', 1);
    t.steam.searchStoreApps.mockResolvedValue([
      { appId: 1172470, name: 'Apex Legends™' },
      { appId: 3000, name: 'Apex Construct' },
    ]);
    const r = await search(t, a, '  apex  ');
    expect(r.items).toEqual([
      { app_id: 1172470, name: 'Apex Legends', owner_count: 2 },
      { app_id: 3000, name: 'Apex Construct', owner_count: 0 },
    ]);
    expect(t.steam.searchStoreApps).toHaveBeenCalledWith('apex');
    await search(t, a, 'APEX');
    expect(t.steam.searchStoreApps).toHaveBeenCalledTimes(1);
    t.clock.advance(10 * 60_000);
    await search(t, a, 'apex');
    expect(t.steam.searchStoreApps).toHaveBeenCalledTimes(2);
  });

  it('보유자 조건(D234): 부계정·미확인·0분·탈퇴 회원 행은 세지 않는다. q 없음 모든 항목 owner_count ≥ 1, 각 app의 플레이타임 순위 인원 = owner_count', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    await own(t, 730, 'Counter-Strike 2', 1);
    const sub = await linkedMember(t, 'sub');
    seedSteam(t, sub.id, [{ appId: 730, total: 999, name: 'Counter-Strike 2' }, { appId: 570, total: 999, name: 'Dota 2' }], { primary: false });
    const unverified = await linkedMember(t, 'unverified');
    seedSteam(t, unverified.id, [{ appId: 730, total: 999, name: 'Counter-Strike 2' }, { appId: 570, total: 999, name: 'Dota 2' }], { verified: false });
    const zero = await linkedMember(t, 'zero');
    seedSteam(t, zero.id, [{ appId: 730, total: 0, name: 'Counter-Strike 2' }, { appId: 440, total: 0, name: 'Team Fortress 2' }]);
    const gone = await linkedMember(t, 'gone', { leftAt: new Date('2026-01-01T00:00:00.000Z') });
    seedSteam(t, gone.id, [{ appId: 730, total: 50, name: 'Counter-Strike 2' }, { appId: 252490, total: 50, name: 'Rust' }]);
    const r = await search(t, a);
    // 570·440·252490은 보유자 0명이라 목록에 없다
    expect(r.items).toEqual([{ app_id: 730, name: 'Counter-Strike 2', owner_count: 1 }]);
    for (const item of r.items) {
      expect(item.owner_count).toBeGreaterThanOrEqual(1);
      const pt = GetPlaytimeRankingResponse.parse(await (await call(t, 'GET', `/rankings/playtime?app_id=${item.app_id}`, a.token)).json());
      expect(pt.total).toBe(item.owner_count);
    }
    // 상점 결과 owner_count도 같은 조건(570: 부계정·미확인만 → 0)
    t.steam.searchStoreApps.mockResolvedValue([{ appId: 570, name: 'Dota 2' }]);
    expect((await search(t, a, 'dota')).items).toEqual([{ app_id: 570, name: 'Dota 2', owner_count: 0 }]);
  });

  it('이름 규칙: 보유자 행 app_name 중 null·빈 문자열 아닌 값, synced_at 최신 우선. q는 그 이름으로 찾고 %·_는 글자 그대로', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const [u1, u2, u3] = [await linkedMember(t, 'u1'), await linkedMember(t, 'u2'), await linkedMember(t, 'u3')];
    seedSteam(t, u1.id, [
      { appId: 578080, total: 10, name: 'PLAYERUNKNOWN', syncedAt: '2026-10-01T00:00:00.000Z' },
      { appId: 100, total: 10, name: '100% Orange', syncedAt: '2026-10-30T00:00:00.000Z' },
      { appId: 103, total: 10, name: 'axb', syncedAt: '2026-10-30T00:00:00.000Z' },
    ]);
    seedSteam(t, u2.id, [
      { appId: 578080, total: 10, name: 'PUBG: BATTLEGROUNDS', syncedAt: '2026-10-20T00:00:00.000Z' },
      { appId: 101, total: 10, name: '1000 Orange', syncedAt: '2026-10-30T00:00:00.000Z' },
    ]);
    seedSteam(t, u3.id, [
      { appId: 578080, total: 10, name: '', syncedAt: '2026-10-30T00:00:00.000Z' },
      { appId: 102, total: 10, name: 'a_b', syncedAt: '2026-10-30T00:00:00.000Z' },
    ]);
    expect((await search(t, a)).items[0]).toEqual({ app_id: 578080, name: 'PUBG: BATTLEGROUNDS', owner_count: 3 });
    t.steam.searchStoreApps.mockResolvedValue([]);
    // 옛 이름(PLAYERUNKNOWN)으로는 보유 게임에 나오지 않는다
    expect((await search(t, a, 'playerunknown')).items).toEqual([]);
    expect((await search(t, a, 'battlegrounds')).items.map((i) => i.app_id)).toEqual([578080]);
    expect((await search(t, a, '100%')).items.map((i) => i.app_id)).toEqual([100]);
    expect((await search(t, a, 'a_b')).items.map((i) => i.app_id)).toEqual([102]);
  });

  it('상점 실패 → 200 + store_unavailable(보유 게임만), 검색어 51자 → 400, 인증 없음 → 401', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    await own(t, 730, 'Counter-Strike 2', 1);
    t.steam.searchStoreApps.mockRejectedValue(new ExternalApiError('unavailable'));
    expect(await search(t, a, 'counter')).toEqual({
      items: [{ app_id: 730, name: 'Counter-Strike 2', owner_count: 1 }],
      store_unavailable: true,
    });
    await expectError(await call(t, 'GET', `/steam-apps?q=${'a'.repeat(51)}`, a.token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/steam-apps'), 401, 'UNAUTHENTICATED');
  });
});

describe('POST /scrims 스팀 게임', () => {
  it('스팀인데 steam_app_id 없음·null → 400 path steam_app_id, 롤에 steam_app_id → 400', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    for (const body of [{}, { steam_app_id: null }]) {
      const err = await expectError(await createSteam(t, a, body), 400, 'VALIDATION_FAILED');
      expect(err.details).toEqual([{ path: 'steam_app_id', message: '스팀 게임을 골라 주세요.' }]);
    }
    const lol = await call(t, 'POST', '/scrims', a.token, {
      game: 'lol',
      title: '롤 내전',
      capacity: 10,
      host_preferred_positions: ['mid'],
      scheduled_at: new Date(t.clock.now().getTime() + DAY).toISOString(),
      steam_app_id: 730,
    });
    const err = await expectError(lol, 400, 'VALIDATION_FAILED');
    expect(err.details?.map((d) => d.path)).toEqual(['steam_app_id']);
    expect(t.prisma.scrim.rows).toHaveLength(0);
  });

  it('이름 결정: 보유 게임 이름(상점 호출 없음) → 최근 검색에서 본 이름 → 상점 조회. 상세·목록에 steam_app', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    await own(t, 730, 'Counter-Strike 2', 1);
    const owned = ScrimDetail.parse(await (await createSteam(t, a, { steam_app_id: 730 })).json());
    expect(owned.steam_app).toEqual({ app_id: 730, name: 'Counter-Strike 2' });
    expect(t.steam.getStoreApp).not.toHaveBeenCalled();

    t.steam.searchStoreApps.mockResolvedValue([{ appId: 3000, name: 'Apex Construct' }]);
    await search(t, a, 'apex');
    const seen = ScrimDetail.parse(await (await createSteam(t, a, { steam_app_id: 3000 })).json());
    expect(seen.steam_app).toEqual({ app_id: 3000, name: 'Apex Construct' });
    expect(t.steam.getStoreApp).not.toHaveBeenCalled();

    t.steam.getStoreApp.mockResolvedValue({ appId: 4000, name: 'Lethal Company' });
    const store = ScrimDetail.parse(await (await createSteam(t, a, { steam_app_id: 4000 })).json());
    expect(store.steam_app).toEqual({ app_id: 4000, name: 'Lethal Company' });
    expect(t.steam.getStoreApp).toHaveBeenCalledWith(4000);

    const list = ListScrimsResponse.parse(await (await call(t, 'GET', '/scrims?game=steam', a.token)).json());
    expect(list.items.map((s) => s.steam_app?.name).sort()).toEqual(['Apex Construct', 'Counter-Strike 2', 'Lethal Company']);
    const lol = await call(t, 'POST', '/scrims', a.token, {
      game: 'lol',
      title: '롤 내전',
      capacity: 10,
      host_preferred_positions: ['mid'],
      scheduled_at: new Date(t.clock.now().getTime() + DAY).toISOString(),
    });
    expect(ScrimDetail.parse(await lol.json()).steam_app).toBeNull();
  });

  it('상점에 없는 id → 400(내전 안 만듦), 상점 오류 → 502 GAME_PROVIDER_ERROR', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const err = await expectError(await createSteam(t, a, { steam_app_id: 123 }), 400, 'VALIDATION_FAILED');
    expect(err.details).toEqual([{ path: 'steam_app_id', message: '스팀 상점에서 찾을 수 없는 게임입니다.' }]);
    t.steam.getStoreApp.mockRejectedValue(new ExternalApiError('unavailable'));
    await expectError(await createSteam(t, a, { steam_app_id: 123 }), 502, 'GAME_PROVIDER_ERROR');
    expect(t.prisma.scrim.rows).toHaveLength(0);
  });
});

describe('PATCH /scrims/:id steam_app_id', () => {
  it('방장 → 바뀜, 방장 아님 → 403(상점 호출 없음), 롤 내전 → 400, 없는 내전 → 404', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    const b = await login(t, 'bob');
    await own(t, 730, 'Counter-Strike 2', 1);
    await own(t, 570, 'Dota 2', 1);
    const s = ScrimDetail.parse(await (await createSteam(t, a, { steam_app_id: 730 })).json());
    const res = await call(t, 'PATCH', `/scrims/${s.id}`, a.token, { steam_app_id: 570 });
    expect(res.status).toBe(200);
    expect(ScrimDetail.parse(await res.json()).steam_app).toEqual({ app_id: 570, name: 'Dota 2' });

    await expectError(await call(t, 'PATCH', `/scrims/${s.id}`, b.token, { steam_app_id: 9999 }), 403, 'FORBIDDEN');
    expect(t.steam.getStoreApp).not.toHaveBeenCalled();

    const lol = await call(t, 'POST', '/scrims', a.token, {
      game: 'lol',
      title: '롤 내전',
      capacity: 10,
      host_preferred_positions: ['mid'],
      scheduled_at: new Date(t.clock.now().getTime() + DAY).toISOString(),
    });
    const lolId = ScrimDetail.parse(await lol.json()).id;
    await expectError(await call(t, 'PATCH', `/scrims/${lolId}`, a.token, { steam_app_id: 730 }), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'PATCH', `/scrims/${randomUUID()}`, a.token, { steam_app_id: 730 }), 404, 'NOT_FOUND');
  });
});
