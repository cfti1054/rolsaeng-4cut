/**
 * 스팀 내전 게임 선택(D98): GET /steam-apps 검색, POST·PATCH /scrims의 steam_app_id, 응답 steam_app.
 * 상점 호출은 목(mockSteam.searchStoreApps·getStoreApp), 멤버 보유 게임은 steam_playtime 행을 직접 심는다.
 */
import { randomUUID } from 'node:crypto';
import { ListGamesResponse, ListScrimsResponse, ScrimDetail, SearchSteamAppsResponse } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ExternalApiError } from '../src/integrations/contracts';
import { call, expectError } from './support/s1-helpers';
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

/** 연동 계정 n개가 같은 게임을 가진 것처럼 steam_playtime 행을 심는다 */
function own(app: TestApp, appId: number, appName: string | null, accounts: number): void {
  for (let i = 0; i < accounts; i++) {
    app.prisma.steamPlaytime.insert({ gameAccountId: randomUUID(), appId, appName, minutesTotal: 10 });
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
    own(t, 730, 'Counter-Strike 2', 3);
    own(t, 570, 'Dota 2', 1);
    own(t, 440, 'Team Fortress 2', 1);
    own(t, 999, null, 5);
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
    own(t, 1172470, 'Apex Legends', 2);
    own(t, 2000, 'Other', 1);
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

  it('상점 실패 → 200 + store_unavailable(보유 게임만), 검색어 51자 → 400, 인증 없음 → 401', async () => {
    t = await createTestApp({ fixedClock: true });
    const a = await login(t, 'alice');
    own(t, 730, 'Counter-Strike 2', 1);
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
    own(t, 730, 'Counter-Strike 2', 1);
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
    own(t, 730, 'Counter-Strike 2', 1);
    own(t, 570, 'Dota 2', 1);
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
