/**
 * S1 수동 새로고침(7절, D41)과 스팀 OpenID 연동(5-2, 5-2a) HTTP 테스트(DB 없이).
 */
import { GetMyGameAccountsResponse, LinkGameAccountResponse, STEAM_OPENID_ENDPOINT, SyncGameAccountResponse } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ExternalApiError } from '../src/integrations/contracts';
import { STEAM_ID_A } from './support/s1-mocks';
import { call, devLogin, expectError, expectNoExternalIds, linkRiot } from './support/s1-helpers';
import { type TestApp, TEST_WEB_ORIGIN, createTestApp, findSetCookie } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const syncPath = (id: string) => `/me/game-accounts/${id}/sync`;

function setAllIdle(app: TestApp): void {
  for (const r of app.prisma.gameAccount.rows) Object.assign(r, { syncState: 'idle', syncStateAt: app.clock.now() });
}

async function sync(app: TestApp, token: string, id: string) {
  const res = await call(app, 'POST', syncPath(id), token);
  return res;
}

describe('POST /me/game-accounts/:id/sync', () => {
  it('202: 차감 1, lol·tft queued, riot-full(manual) 등록(lol id), 응답 스키마·외부 식별자 비노출', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const a = await linkRiot(t, token, 'alpha');
    setAllIdle(t);
    t.queue.jobs.length = 0;
    const tftId = a.accounts[1]?.id as string;
    const res = await sync(t, token, tftId);
    expect(res.status).toBe(202);
    const text = await res.text();
    expectNoExternalIds(text);
    const body = SyncGameAccountResponse.strict().parse(JSON.parse(text));
    expect(body.quota_consumed).toBe(true);
    expect(body.sync_quota).toEqual({ limit: 5, used: 1, remaining: 4, resets_at: '2026-10-29T00:00:00.000+09:00' });
    expect(body.accounts.every((x) => x.sync.state === 'queued')).toBe(true);
    expect(t.queue.jobs).toEqual([{ kind: 'riot-full', gameAccountId: a.accounts[0]?.id, reason: 'manual', priority: 1 }]);
    expect(t.prisma.gameAccountSyncRequest.rows).toEqual([expect.objectContaining({ userId, gameAccountId: tftId })]);
    expect(t.prisma.rawCalls.some((c) => c.values[0] === `sync-quota:${userId}`)).toBe(true);
  });

  it('이미 queued(10분 이내) → 차감 없이 202(quota_consumed=false), 10분 지난 멈춘 행 → 다시 차감', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const a = await linkRiot(t, token, 'alpha'); // 연동 직후 queued(차감 없음)
    const id = a.accounts[0]?.id as string;
    const first = SyncGameAccountResponse.parse(await (await sync(t, token, id)).json());
    expect(first.quota_consumed).toBe(false);
    expect(first.sync_quota.used).toBe(0);
    t.clock.advance(10 * 60_000 + 1);
    const second = SyncGameAccountResponse.parse(await (await sync(t, token, id)).json());
    expect(second.quota_consumed).toBe(true);
    expect(second.sync_quota.used).toBe(1);
  });

  it('running(10분 이내) → 차감 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const a = await linkRiot(t, token, 'alpha');
    for (const r of t.prisma.gameAccount.rows) Object.assign(r, { syncState: 'running', syncStateAt: t.clock.now() });
    const body = SyncGameAccountResponse.parse(await (await sync(t, token, a.accounts[0]?.id as string)).json());
    expect(body.quota_consumed).toBe(false);
    expect(body.accounts.every((x) => x.sync.state === 'running')).toBe(true);
  });

  it('하루 5회(라이엇·스팀 합산) 후 → 429 SYNC_LIMIT_EXCEEDED + Retry-After(다음 KST 자정까지), 자정 지나면 초기화', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const a = await linkRiot(t, token, 'alpha');
    const steam = t.prisma.gameAccount.insert({ userId, gameId: t.prisma.gameId('steam'), externalId: STEAM_ID_A, displayName: '스팀', verified: true, verifiedAt: new Date(), isPrimary: true });
    const riotId = a.accounts[0]?.id as string;
    for (let i = 0; i < 5; i++) {
      setAllIdle(t);
      const res = await sync(t, token, i % 2 === 0 ? riotId : steam.id);
      expect(res.status).toBe(202);
    }
    setAllIdle(t);
    t.clock.set('2026-10-28T14:59:30.000Z'); // KST 23:59:30
    const over = await sync(t, token, steam.id);
    expect(over.headers.get('retry-after')).toBe('30');
    await expectError(over, 429, 'SYNC_LIMIT_EXCEEDED');
    const quota = GetMyGameAccountsResponse.parse(await (await call(t, 'GET', '/me/game-accounts', token)).json()).sync_quota;
    expect(quota).toMatchObject({ used: 5, remaining: 0 });
    t.clock.set('2026-10-28T15:00:00.000Z'); // KST 자정
    expect((await sync(t, token, steam.id)).status).toBe(202);
    expect(t.queue.jobs.filter((j) => j.kind === 'steam-playtime').at(-1)).toEqual({ kind: 'steam-playtime', gameAccountId: steam.id, reason: 'manual', priority: 1 });
  });

  it('해제 후 재연동해도 오늘 횟수는 회복되지 않는다(D41)', async () => {
    t = await createTestApp({ fixedClock: true, env: { SYNC_DAILY_LIMIT: '1' } });
    const { token } = await devLogin(t, 'alice');
    const a = await linkRiot(t, token, 'alpha');
    setAllIdle(t);
    expect((await sync(t, token, a.accounts[0]?.id as string)).status).toBe(202);
    expect((await call(t, 'DELETE', `/me/game-accounts/${a.accounts[0]?.id}`, token)).status).toBe(204);
    t.clock.advance(10_000);
    const again = await linkRiot(t, token, 'alpha');
    setAllIdle(t);
    await expectError(await sync(t, token, again.accounts[0]?.id as string), 429, 'SYNC_LIMIT_EXCEEDED');
  });

  it('동시 요청(Promise.all 3건, 같은 계정) → 차감 1번(인메모리: 트랜잭션 직렬화)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const a = await linkRiot(t, token, 'alpha');
    setAllIdle(t);
    const id = a.accounts[0]?.id as string;
    const results = await Promise.all([sync(t, token, id), sync(t, token, id), sync(t, token, id)]);
    const bodies = await Promise.all(results.map(async (r) => SyncGameAccountResponse.parse(await r.json())));
    expect(bodies.filter((b) => b.quota_consumed)).toHaveLength(1);
    expect(t.prisma.gameAccountSyncRequest.rows).toHaveLength(1);
  });

  it('남의 계정 → 404, UUID 아님 → 400, 제공자 키 없음 → 503', async () => {
    t = await createTestApp({ fixedClock: true, env: { STEAM_API_KEY: '' } });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    const a = await linkRiot(t, alice.token, 'alpha');
    await expectError(await sync(t, bob.token, a.accounts[0]?.id as string), 404, 'NOT_FOUND');
    await expectError(await sync(t, alice.token, 'abc'), 400, 'VALIDATION_FAILED');
    const steam = t.prisma.gameAccount.insert({ userId: alice.userId, gameId: t.prisma.gameId('steam'), externalId: STEAM_ID_A, displayName: '스팀', verified: true, verifiedAt: new Date(), isPrimary: true });
    await expectError(await sync(t, alice.token, steam.id), 503, 'GAME_PROVIDER_NOT_CONFIGURED');
    expect(t.prisma.gameAccountSyncRequest.rows).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// 스팀
// -----------------------------------------------------------------------------

async function startSteam(app: TestApp, token: string) {
  const res = await call(app, 'POST', '/me/game-accounts', token, { provider: 'steam' });
  expect(res.status).toBe(200);
  const setCookie = findSetCookie(res, 'gcd_steam') as string;
  const body = LinkGameAccountResponse.parse(await res.json());
  if (body.provider !== 'steam') throw new Error('steam 아님');
  const url = new URL(body.authorize_url);
  const returnTo = url.searchParams.get('openid.return_to') as string;
  const state = new URL(returnTo).searchParams.get('state') as string;
  return { setCookie, cookie: setCookie.split(';')[0] as string, url, returnTo, state };
}

function openIdQuery(returnTo: string, over: Record<string, string> = {}): Record<string, string> {
  const claimed = `https://steamcommunity.com/openid/id/${STEAM_ID_A}`;
  return {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID_ENDPOINT,
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': returnTo,
    'openid.response_nonce': '2026-10-28T03:00:00Zabc',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...over,
  };
}

async function callback(app: TestApp, state: string | undefined, query: Record<string, string>, cookie?: string) {
  const qs = new URLSearchParams({ ...(state === undefined ? {} : { state }), ...query });
  return fetch(`${app.base}/me/game-accounts/steam/callback?${qs.toString()}`, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function expectRedirect(res: Response, query: string): void {
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(`${TEST_WEB_ORIGIN}/settings?${query}`);
  const cleared = findSetCookie(res, 'gcd_steam');
  expect(cleared).toBeDefined();
  expect(cleared).toMatch(/Path=\/api\/v1\/me\/game-accounts\/steam/);
  expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
}

describe('스팀 OpenID 연동', () => {
  it('시작: authorize_url(checkid_setup, return_to=웹 오리진 콜백?state, realm=웹 오리진), gcd_steam 쿠키 속성', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const s = await startSteam(t, token);
    expect(`${s.url.origin}${s.url.pathname}`).toBe(STEAM_OPENID_ENDPOINT);
    expect(s.url.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(s.url.searchParams.get('openid.ns')).toBe('http://specs.openid.net/auth/2.0');
    expect(s.url.searchParams.get('openid.realm')).toBe(TEST_WEB_ORIGIN);
    expect(s.url.searchParams.get('openid.identity')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
    expect(s.url.searchParams.get('openid.claimed_id')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
    expect(s.returnTo).toBe(`${TEST_WEB_ORIGIN}/api/v1/me/game-accounts/steam/callback?state=${s.state}`);
    expect(s.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.setCookie).toMatch(/HttpOnly/);
    expect(s.setCookie).toMatch(/SameSite=Lax/);
    expect(s.setCookie).toMatch(/Path=\/api\/v1\/me\/game-accounts\/steam(;|$)/);
    expect(s.setCookie).toMatch(/Max-Age=600/);
    expect(s.setCookie).not.toMatch(/Secure/);
  });

  it('성공: 302 /settings?steam=linked, 스팀 행(verified, 대표, queued, personaname), steam-playtime(link) 등록', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const s = await startSteam(t, token);
    const res = await callback(t, s.state, openIdQuery(s.returnTo), s.cookie);
    expectRedirect(res, 'steam=linked');
    expect(t.steam.verifyOpenIdAssertion).toHaveBeenCalledWith(expect.objectContaining({ 'openid.mode': 'id_res' }), s.returnTo);
    expect(t.steam.getPlayerSummary).toHaveBeenCalledWith(STEAM_ID_A);
    const row = t.prisma.gameAccount.rows.find((r) => r.userId === userId);
    expect(row).toMatchObject({ externalId: STEAM_ID_A, displayName: '스팀닉', verified: true, isPrimary: true, syncState: 'queued' });
    expect(t.queue.jobs).toEqual([{ kind: 'steam-playtime', gameAccountId: row?.id, reason: 'link', priority: 1 }]);
    const list = await (await call(t, 'GET', '/me/game-accounts', token)).text();
    expectNoExternalIds(list);
    // 이미 스팀이 있으면 시작 → 409
    await expectError(await call(t, 'POST', '/me/game-accounts', token, { provider: 'steam' }), 409, 'GAME_ACCOUNT_LIMIT_REACHED');
  });

  it('GetPlayerSummaries 실패 → 이름 「스팀 사용자」로 연동(D52)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    t.steam.getPlayerSummary.mockRejectedValueOnce(new ExternalApiError('unavailable'));
    const s = await startSteam(t, token);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam=linked');
    expect(t.prisma.gameAccount.rows[0]?.displayName).toBe('스팀 사용자');
  });

  it.each([
    ['openid.mode=cancel', (r: string) => openIdQuery(r, { 'openid.mode': 'cancel' }), 'STEAM_LINK_CANCELLED'],
    ['openid.mode 다른 값', (r: string) => openIdQuery(r, { 'openid.mode': 'setup_needed' }), 'STEAM_OPENID_INVALID'],
    ['return_to 변조', (r: string) => openIdQuery(r, { 'openid.return_to': `${r}&x=1` }), 'STEAM_OPENID_INVALID'],
    [
      'claimed_id 변조(identity와 다름)',
      (r: string) => openIdQuery(r, { 'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561190000000002' }),
      'STEAM_OPENID_INVALID',
    ],
  ])('%s → steam_error=%s', async (_n, q, code) => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const s = await startSteam(t, token);
    expectRedirect(await callback(t, s.state, q(s.returnTo), s.cookie), `steam_error=${code}`);
    expect(t.prisma.gameAccount.rows).toHaveLength(0);
  });

  it('check_authentication is_valid 아님(ok:false) → STEAM_OPENID_INVALID, 네트워크·5xx → GAME_PROVIDER_ERROR, 429 → GAME_PROVIDER_RATE_LIMITED', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    t.steam.verifyOpenIdAssertion.mockResolvedValueOnce({ ok: false });
    let s = await startSteam(t, token);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam_error=STEAM_OPENID_INVALID');
    t.steam.verifyOpenIdAssertion.mockRejectedValueOnce(new ExternalApiError('unavailable'));
    s = await startSteam(t, token);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam_error=GAME_PROVIDER_ERROR');
    t.steam.verifyOpenIdAssertion.mockRejectedValueOnce(new ExternalApiError('rate_limited', 'x', { retryAfterSec: 5 }));
    s = await startSteam(t, token);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam_error=GAME_PROVIDER_RATE_LIMITED');
  });

  it('state: 쿠키 없음·쿼리 state 불일치·위조 서명·600초 초과 → STEAM_LINK_STATE_INVALID', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const s = await startSteam(t, token);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo)), 'steam_error=STEAM_LINK_STATE_INVALID');
    expectRedirect(await callback(t, 'other-state', openIdQuery(s.returnTo), s.cookie), 'steam_error=STEAM_LINK_STATE_INVALID');
    const [name, value] = s.cookie.split('=') as [string, string];
    const forged = `${name}=${value.slice(0, -4)}AAAA`;
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), forged), 'steam_error=STEAM_LINK_STATE_INVALID');
    t.clock.advance(601_000);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam_error=STEAM_LINK_STATE_INVALID');
    expect(t.steam.verifyOpenIdAssertion).not.toHaveBeenCalled();
  });

  it('다른 멤버가 이미 연동한 스팀 ID → GAME_ACCOUNT_ALREADY_LINKED, 쿠키 사용자 삭제됨 → UNAUTHENTICATED', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    t.prisma.gameAccount.insert({ userId: bob.userId, gameId: t.prisma.gameId('steam'), externalId: STEAM_ID_A, displayName: 'b', verified: true, verifiedAt: new Date(), isPrimary: true });
    let s = await startSteam(t, alice.token);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam_error=GAME_ACCOUNT_ALREADY_LINKED');

    const carol = await devLogin(t, 'carol');
    s = await startSteam(t, carol.token);
    t.prisma.users = t.prisma.users.filter((u) => u.id !== carol.userId);
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam_error=UNAUTHENTICATED');
  });

  it('시작 후 다른 탭에서 스팀 연동 완료 → 콜백 GAME_ACCOUNT_LIMIT_REACHED', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const s = await startSteam(t, token);
    t.prisma.gameAccount.insert({ userId, gameId: t.prisma.gameId('steam'), externalId: '76561190000000003', displayName: 'x', verified: true, verifiedAt: new Date(), isPrimary: true });
    expectRedirect(await callback(t, s.state, openIdQuery(s.returnTo), s.cookie), 'steam_error=GAME_ACCOUNT_LIMIT_REACHED');
  });

  it('STEAM_API_KEY 없음 → 시작 503, 콜백 GAME_PROVIDER_NOT_CONFIGURED', async () => {
    t = await createTestApp({ fixedClock: true, env: { STEAM_API_KEY: '' } });
    const { token } = await devLogin(t, 'alice');
    await expectError(await call(t, 'POST', '/me/game-accounts', token, { provider: 'steam' }), 503, 'GAME_PROVIDER_NOT_CONFIGURED');
  });

  it('콜백은 JWT 없이 동작하고 Authorization만으로는 연동되지 않는다(쿠키 필수)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const s = await startSteam(t, token);
    const qs = new URLSearchParams({ state: s.state, ...openIdQuery(s.returnTo) });
    const res = await fetch(`${t.base}/me/game-accounts/steam/callback?${qs.toString()}`, {
      redirect: 'manual',
      headers: { Authorization: `Bearer ${token}` },
    });
    expectRedirect(res, 'steam_error=STEAM_LINK_STATE_INVALID');
  });
});
