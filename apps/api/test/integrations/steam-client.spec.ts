import { STEAM_OPENID_ENDPOINT } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { ExternalApiError } from '../../src/integrations/contracts';
import { HostRateLimiter } from '../../src/integrations/rate-limiter';
import { SteamHttpApi } from '../../src/integrations/steam/steam-client';
import { fakeClock, fakeFetch, fixture, testOptions } from '../support/integration-helpers';

const STEAM_ID = '76561190000000001';
const RETURN_TO = 'http://localhost:3000/api/v1/me/game-accounts/steam/callback?state=abc';

function make(routes: Parameters<typeof fakeFetch>[0], over = {}) {
  const clock = fakeClock();
  const fetchFn = fakeFetch(routes);
  const limiter = new HostRateLimiter(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, clock);
  return { api: new SteamHttpApi(testOptions(over), limiter, fetchFn, clock), fetchFn, limiter };
}

function assertion(over: Record<string, string> = {}): Record<string, string> {
  return {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID_ENDPOINT,
    'openid.claimed_id': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.identity': `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    'openid.return_to': RETURN_TO,
    'openid.response_nonce': '2026-10-28T00:00:00ZFAKE',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'FAKESIG=',
    ...over,
  };
}

describe('SteamHttpApi.getOwnedGames', () => {
  it('공개 프로필: include_appinfo·include_played_free_games 요청, 필드 변환', async () => {
    const { api, fetchFn } = make({ GetOwnedGames: { body: fixture('steam/owned-games-public.json') } });
    const r = await api.getOwnedGames(STEAM_ID);
    expect(r).toEqual({
      visibility: 'public',
      games: [
        { appId: 10, name: 'Counter-Strike', minutesTotal: 600, minutesRecent: 30 },
        { appId: 570, name: 'Dota 2', minutesTotal: 1200, minutesRecent: 0 },
      ],
    });
    const url = new URL(fetchFn.calls[0]!.url);
    expect(url.searchParams.get('include_appinfo')).toBe('1');
    expect(url.searchParams.get('include_played_free_games')).toBe('1');
    expect(url.searchParams.get('steamid')).toBe(STEAM_ID);
  });

  it('game_count 0 은 공개 + 보유 0개', async () => {
    const { api } = make({ GetOwnedGames: { body: fixture('steam/owned-games-empty.json') } });
    expect(await api.getOwnedGames(STEAM_ID)).toEqual({ visibility: 'public', games: [] });
  });

  it('{"response":{}} 는 비공개 프로필', async () => {
    const { api } = make({ GetOwnedGames: { body: fixture('steam/owned-games-private.json') } });
    expect(await api.getOwnedGames(STEAM_ID)).toEqual({ visibility: 'private' });
  });

  it('키 없음 / 401 / 429 / 5xx / 타임아웃', async () => {
    const kind = async (routes: Parameters<typeof fakeFetch>[0], over = {}) => {
      const { api } = make(routes, over);
      return api.getOwnedGames(STEAM_ID).catch((e: ExternalApiError) => e);
    };
    expect(((await kind({}, { steamApiKey: undefined })) as ExternalApiError).kind).toBe('not_configured');
    expect(((await kind({ GetOwnedGames: { status: 401 } })) as ExternalApiError).kind).toBe('auth');
    const rl = (await kind({ GetOwnedGames: { status: 429, headers: { 'Retry-After': '30' } } })) as ExternalApiError;
    expect([rl.kind, rl.retryAfterSec]).toEqual(['rate_limited', 30]);
    expect(((await kind({ GetOwnedGames: { status: 500 } })) as ExternalApiError).kind).toBe('unavailable');
    expect(((await kind({ GetOwnedGames: 'hang' }, { timeoutMs: 20 })) as ExternalApiError).kind).toBe('unavailable');
  });

  it('오류 메시지에 키가 들어가지 않는다', async () => {
    const { api } = make({ GetOwnedGames: { status: 500 } });
    const e = (await api.getOwnedGames(STEAM_ID).catch((x: Error) => x)) as Error;
    expect(e.message).not.toContain('test-steam-key');
  });
});

describe('SteamHttpApi.getPlayerSummary', () => {
  it('personaname 반환 / 없으면 null', async () => {
    expect((await make({ GetPlayerSummaries: { body: fixture('steam/player-summaries.json') } }).api.getPlayerSummary(STEAM_ID))).toEqual({
      personaName: '가짜스팀이름',
    });
    expect(await make({ GetPlayerSummaries: { body: fixture('steam/player-summaries-empty.json') } }).api.getPlayerSummary(STEAM_ID)).toBeNull();
  });
});

describe('SteamHttpApi 상점(D98)', () => {
  it('searchStoreApps: 키 없이 store.steampowered.com, 한국어·KR, 게임(app)만', async () => {
    const body = JSON.stringify({
      total: 3,
      items: [
        { type: 'app', id: 730, name: 'Counter-Strike 2', tiny_image: 'x' },
        { type: 'sub', id: 1, name: '번들' },
        { type: 'app', id: 570, name: 'Dota 2' },
      ],
    });
    const { api, fetchFn } = make({ '/api/storesearch/': { body } }, { steamApiKey: undefined });
    expect(await api.searchStoreApps('counter strike')).toEqual([
      { appId: 730, name: 'Counter-Strike 2' },
      { appId: 570, name: 'Dota 2' },
    ]);
    const url = new URL(fetchFn.calls[0]!.url);
    expect(url.host).toBe('store.steampowered.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({ term: 'counter strike', l: 'korean', cc: 'KR' });
  });

  it('getStoreApp: success → 이름, success false → null, 5xx → unavailable', async () => {
    const ok = make({ '/api/appdetails': { body: JSON.stringify({ '730': { success: true, data: { name: '카운터 스트라이크 2', type: 'game' } } }) } }, { steamApiKey: undefined });
    expect(await ok.api.getStoreApp(730)).toEqual({ appId: 730, name: '카운터 스트라이크 2' });
    expect(new URL(ok.fetchFn.calls[0]!.url).searchParams.get('appids')).toBe('730');
    const none = make({ '/api/appdetails': { body: JSON.stringify({ '1': { success: false } }) } });
    expect(await none.api.getStoreApp(1)).toBeNull();
    const down = make({ '/api/appdetails': { status: 503 } });
    await expect(down.api.getStoreApp(1)).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('SteamHttpApi.verifyOpenIdAssertion', () => {
  it('유효: check_authentication 으로 POST, mode 만 바꾸고 나머지는 그대로', async () => {
    const { api, fetchFn } = make({ '/openid/login': { body: fixture('steam/openid-valid.txt') } });
    const r = await api.verifyOpenIdAssertion({ ...assertion(), state: 'abc' }, RETURN_TO);
    expect(r).toEqual({ ok: true, steamId: STEAM_ID });
    const call = fetchFn.calls[0]!;
    expect(call.url).toBe(STEAM_OPENID_ENDPOINT);
    expect(call.init?.method).toBe('POST');
    const form = new URLSearchParams(call.init?.body as string);
    expect(form.get('openid.mode')).toBe('check_authentication');
    expect(form.get('openid.sig')).toBe('FAKESIG=');
    expect(form.has('state')).toBe(false);
  });

  it('is_valid:false → ok:false', async () => {
    const { api } = make({ '/openid/login': { body: fixture('steam/openid-invalid.txt') } });
    expect(await api.verifyOpenIdAssertion(assertion(), RETURN_TO)).toEqual({ ok: false });
  });

  it('형식 변조는 네트워크 호출 없이 ok:false (ns, op_endpoint, return_to, claimed_id, identity)', async () => {
    const tampered: Record<string, string>[] = [
      { 'openid.ns': 'http://evil.example/ns' },
      { 'openid.op_endpoint': 'https://evil.example/openid/login' },
      { 'openid.return_to': `${RETURN_TO}&x=1` },
      { 'openid.claimed_id': 'https://evil.example/openid/id/76561190000000001' },
      { 'openid.identity': 'https://steamcommunity.com/openid/id/76561190000000002' },
    ];
    for (const t of tampered) {
      const { api, fetchFn } = make({ '/openid/login': { body: fixture('steam/openid-valid.txt') } });
      const q = assertion(t);
      if ('openid.claimed_id' in t) q['openid.identity'] = t['openid.claimed_id']!;
      expect(await api.verifyOpenIdAssertion(q, RETURN_TO)).toEqual({ ok: false });
      expect(fetchFn.calls).toHaveLength(0);
    }
  });

  it('is_valid 줄이 다른 값 안에 섞여 있어도 줄 단위로만 인정', async () => {
    const { api } = make({ '/openid/login': { body: 'ns:x\nfoo:is_valid:true\n' } });
    expect(await api.verifyOpenIdAssertion(assertion(), RETURN_TO)).toEqual({ ok: false });
  });

  it('5xx·타임아웃은 ExternalApiError(unavailable)', async () => {
    const a = make({ '/openid/login': { status: 503 } }).api;
    await expect(a.verifyOpenIdAssertion(assertion(), RETURN_TO)).rejects.toMatchObject({ kind: 'unavailable' });
    const b = make({ '/openid/login': 'hang' }, { timeoutMs: 20 }).api;
    await expect(b.verifyOpenIdAssertion(assertion(), RETURN_TO)).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
