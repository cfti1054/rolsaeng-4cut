/**
 * S1 게임 계정 연동(라이엇 소유 확인·대표·해제·조회) HTTP 테스트(DB 없이): Nest 앱 + FakePrisma + 외부 API 목.
 * 계약: _workspace/01_architect_contract.md 4·5절, D56–D61.
 */
import {
  ConfirmRiotVerificationResponse,
  GetMyGameAccountsResponse,
  LinkGameAccountResponse,
  SetPrimaryGameAccountResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ExternalApiError } from '../src/integrations/contracts';
import { PUUID_A, PUUID_B } from './support/s1-mocks';
import { call, devLogin, expectError, expectNoExternalIds, linkRiot } from './support/s1-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const LIST = '/me/game-accounts';
const confirmPath = (id: string) => `/me/game-accounts/riot-verifications/${id}/confirm`;
const verificationPath = (id: string) => `/me/game-accounts/riot-verifications/${id}`;

async function startRiot(app: TestApp, token: string, name: string) {
  const res = await call(app, 'POST', LIST, token, { provider: 'riot', riot_id: `${name}#KR1` });
  return res;
}

async function startedVerification(app: TestApp, token: string, name: string) {
  const res = await startRiot(app, token, name);
  expect(res.status).toBe(200);
  const body = LinkGameAccountResponse.parse(await res.json());
  if (body.provider !== 'riot') throw new Error('riot 아님');
  return body.verification;
}

async function list(app: TestApp, token: string) {
  const res = await call(app, 'GET', LIST, token);
  expect(res.status).toBe(200);
  const text = await res.text();
  expectNoExternalIds(text);
  return GetMyGameAccountsResponse.strict().parse(JSON.parse(text));
}

describe('GET /me/game-accounts', () => {
  it('빈 상태: accounts [], riot_verification null, sync_quota 5/0/5, limits(D61)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const body = await list(t, token);
    expect(body.accounts).toEqual([]);
    expect(body.riot_verification).toBeNull();
    expect(body.sync_quota).toEqual({ limit: 5, used: 0, remaining: 5, resets_at: '2026-10-29T00:00:00.000+09:00' });
    expect(body.limits).toEqual({ riot_accounts_max: 3, steam_accounts_max: 1 });
  });

  it('limits.riot_accounts_max = RIOT_ACCOUNTS_MAX, sync limit = SYNC_DAILY_LIMIT', async () => {
    t = await createTestApp({ fixedClock: true, env: { RIOT_ACCOUNTS_MAX: '2', SYNC_DAILY_LIMIT: '7' } });
    const { token } = await devLogin(t, 'alice');
    const body = await list(t, token);
    expect(body.limits.riot_accounts_max).toBe(2);
    expect(body.sync_quota.limit).toBe(7);
  });

  it('인증 없음 → 401', async () => {
    t = await createTestApp();
    await expectError(await call(t, 'GET', LIST), 401, 'UNAUTHENTICATED');
  });
});

describe('라이엇 소유 확인 시작 (POST /me/game-accounts riot)', () => {
  it('200: pending 확인, 현재 아이콘과 다른 아이콘, 아이콘 이미지, expires_at = now + 600초, PUUID 비노출', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const res = await startRiot(t, token, 'alpha');
    expect(res.status).toBe(200);
    const text = await res.text();
    expectNoExternalIds(text);
    const body = LinkGameAccountResponse.parse(JSON.parse(text));
    if (body.provider !== 'riot') throw new Error();
    const v = body.verification;
    expect(v.status).toBe('pending');
    expect(v.display_name).toBe('Alpha#KR1');
    expect(v.icon_id).toBe(0); // random=0 → 후보(현재 7 제외)의 첫 번째
    expect(v.icon_image_url).toContain('/profileicon/0.png');
    expect(v.expires_at).toBe('2026-10-28T03:10:00.000Z');
    expect(t.riot.getAccountByRiotId).toHaveBeenCalledWith('alpha', 'KR1', 'interactive');
    // 설정 화면 상태
    expect((await list(t, token)).riot_verification?.id).toBe(v.id);
  });

  it('새 확인을 시작하면 이전 pending은 cancelled', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const first = await startedVerification(t, token, 'alpha');
    const second = await startedVerification(t, token, 'bravo');
    const rows = t.prisma.riotLinkVerification.rows;
    expect(rows.find((r) => r.id === first.id)?.status).toBe('cancelled');
    expect(rows.find((r) => r.id === second.id)?.status).toBe('pending');
    await expectError(await call(t, 'POST', confirmPath(first.id), token), 410, 'OWNERSHIP_CHECK_EXPIRED');
  });

  it.each([
    ['형식 오류', { provider: 'riot', riot_id: 'no-tag' }],
    ['태그 6자', { provider: 'riot', riot_id: 'name#ABCDEF' }],
    ['provider 없음', { riot_id: 'a#b' }],
    ['모르는 키', { provider: 'steam', extra: 1 }],
  ])('%s → 400 VALIDATION_FAILED', async (_n, body) => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    await expectError(await call(t, 'POST', LIST, token, body), 400, 'VALIDATION_FAILED');
  });

  it('RIOT_API_KEY 없음 → 503 GAME_PROVIDER_NOT_CONFIGURED (외부 호출 없음)', async () => {
    t = await createTestApp({ fixedClock: true, env: { RIOT_API_KEY: '' } });
    const { token } = await devLogin(t, 'alice');
    await expectError(await startRiot(t, token, 'alpha'), 503, 'GAME_PROVIDER_NOT_CONFIGURED');
    expect(t.riot.getAccountByRiotId).not.toHaveBeenCalled();
  });

  it('라이엇 ID 없음 → 404 RIOT_ID_NOT_FOUND, 소환사 없음 → 404 RIOT_SUMMONER_NOT_FOUND', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    await expectError(await startRiot(t, token, 'nobody'), 404, 'RIOT_ID_NOT_FOUND');
    t.riot.icons.delete(PUUID_A);
    await expectError(await startRiot(t, token, 'alpha'), 404, 'RIOT_SUMMONER_NOT_FOUND');
  });

  it('외부 429 → 503 GAME_PROVIDER_RATE_LIMITED + Retry-After, 401/5xx → 502 GAME_PROVIDER_ERROR', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    t.riot.getAccountByRiotId.mockRejectedValueOnce(new ExternalApiError('rate_limited', 'x', { retryAfterSec: 12 }));
    const res = await startRiot(t, token, 'alpha');
    expect(res.headers.get('retry-after')).toBe('12');
    await expectError(res, 503, 'GAME_PROVIDER_RATE_LIMITED');
    t.riot.getAccountByRiotId.mockRejectedValueOnce(new ExternalApiError('auth'));
    await expectError(await startRiot(t, token, 'alpha'), 502, 'GAME_PROVIDER_ERROR');
    t.riot.getSummonerByPuuid.mockRejectedValueOnce(new ExternalApiError('unavailable'));
    await expectError(await startRiot(t, token, 'alpha'), 502, 'GAME_PROVIDER_ERROR');
  });

  it('하루(KST) 10회 시작 후 11번째 → 429 RATE_LIMITED, Retry-After = 다음 KST 자정까지(D51)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    for (let i = 0; i < 10; i++) await startedVerification(t, token, 'alpha');
    const res = await startRiot(t, token, 'alpha');
    expect(res.headers.get('retry-after')).toBe(String(12 * 3600)); // 12:00 KST → 자정 12시간
    await expectError(res, 429, 'RATE_LIMITED');
    // KST 자정이 지나면 다시 가능
    t.clock.set('2026-10-28T15:00:00.000Z');
    expect((await startRiot(t, token, 'alpha')).status).toBe(200);
  });

  it('본인이 이미 연동한 라이엇 ID → 409 GAME_ACCOUNT_ALREADY_LINKED_TO_ME, 다른 멤버 → 409 GAME_ACCOUNT_ALREADY_LINKED', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    await linkRiot(t, alice.token, 'alpha');
    await expectError(await startRiot(t, alice.token, 'alpha'), 409, 'GAME_ACCOUNT_ALREADY_LINKED_TO_ME');
    await expectError(await startRiot(t, bob.token, 'alpha'), 409, 'GAME_ACCOUNT_ALREADY_LINKED');
  });

  it('라이엇 ID 3개 연동 후 4번째 시작 → 409 GAME_ACCOUNT_LIMIT_REACHED', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    await linkRiot(t, token, 'alpha');
    await linkRiot(t, token, 'bravo');
    await linkRiot(t, token, 'charlie');
    await expectError(await startRiot(t, token, 'delta'), 409, 'GAME_ACCOUNT_LIMIT_REACHED');
    expect(t.riot.getAccountByRiotId).toHaveBeenCalledTimes(3);
  });
});

describe('라이엇 소유 확인 확인·취소', () => {
  it('성공: lol·tft 2행(verified, 첫 연동 대표, queued), riot-full(link) 등록, 확인 verified, 재확인은 멱등', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const v = await startedVerification(t, token, 'alpha');
    t.riot.icons.set(PUUID_A, v.icon_id);
    const res = await call(t, 'POST', confirmPath(v.id), token);
    expect(res.status).toBe(200);
    const text = await res.text();
    expectNoExternalIds(text);
    const body = ConfirmRiotVerificationResponse.strict().parse(JSON.parse(text));
    expect(body.verification.status).toBe('verified');
    expect(body.accounts.map((a) => a.game)).toEqual(['lol', 'tft']);
    for (const a of body.accounts) {
      expect(a).toMatchObject({ provider: 'riot', display_name: 'Alpha#KR1', is_primary: true, rank: null });
      expect(a.sync).toEqual({ state: 'queued', synced_at: null, matches_synced_at: null, error: null });
      expect(a.verified_at).toBe('2026-10-28T03:00:00.000Z');
    }
    const lol = body.accounts[0];
    expect(t.queue.jobs).toEqual([{ kind: 'riot-full', gameAccountId: lol?.id, reason: 'link', priority: 1 }]);
    // 사용자 advisory lock
    expect(t.prisma.rawCalls.some((c) => c.sql.includes('pg_advisory_xact_lock') && c.values[0] === `game-accounts:${userId}`)).toBe(true);
    // DB: external_id = PUUID, verified
    const rows = t.prisma.gameAccount.rows.filter((r) => r.userId === userId);
    expect(rows.every((r) => r.externalId === PUUID_A && r.verified && r.isPrimary)).toBe(true);

    t.clock.advance(10_000);
    const again = await call(t, 'POST', confirmPath(v.id), token);
    expect(again.status).toBe(200);
    expect(ConfirmRiotVerificationResponse.parse(await again.json()).accounts).toHaveLength(2);
    expect(t.prisma.gameAccount.rows).toHaveLength(2);
    expect(t.queue.jobs).toHaveLength(1);
    // 진행 중 확인이 없으므로 설정 화면 riot_verification null
    expect((await list(t, token)).riot_verification).toBeNull();
  });

  it('두 번째 라이엇 ID는 부계정(is_primary=false), 정렬: 대표 → 부계정', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    await linkRiot(t, token, 'alpha');
    t.clock.advance(60_000);
    const second = await linkRiot(t, token, 'bravo');
    expect(second.accounts.every((a) => !a.is_primary)).toBe(true);
    const body = await list(t, token);
    expect(body.accounts.map((a) => [a.display_name, a.game, a.is_primary])).toEqual([
      ['Alpha#KR1', 'lol', true],
      ['Alpha#KR1', 'tft', true],
      ['Bravo#KR1', 'lol', false],
      ['Bravo#KR1', 'tft', false],
    ]);
  });

  it('아이콘 불일치 → 409 OWNERSHIP_CHECK_FAILED(pending 유지), 5초 안 재확인 → 429 RATE_LIMITED + Retry-After, 5초 뒤 성공', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const v = await startedVerification(t, token, 'alpha');
    await expectError(await call(t, 'POST', confirmPath(v.id), token), 409, 'OWNERSHIP_CHECK_FAILED');
    expect(t.prisma.riotLinkVerification.rows[0]?.status).toBe('pending');
    expect(t.prisma.riotLinkVerification.rows[0]?.checkCount).toBe(1);
    t.clock.advance(2_000);
    const limited = await call(t, 'POST', confirmPath(v.id), token);
    expect(limited.headers.get('retry-after')).toBe('3');
    await expectError(limited, 429, 'RATE_LIMITED');
    t.clock.advance(3_000);
    t.riot.icons.set(PUUID_A, v.icon_id);
    expect((await call(t, 'POST', confirmPath(v.id), token)).status).toBe(200);
  });

  it('제한 시간 경과 → 410 OWNERSHIP_CHECK_EXPIRED, 상태 expired(GET은 만료 직후 expired로 표시)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const v = await startedVerification(t, token, 'alpha');
    t.clock.advance(600_000);
    expect((await list(t, token)).riot_verification?.status).toBe('expired');
    t.riot.icons.set(PUUID_A, v.icon_id);
    await expectError(await call(t, 'POST', confirmPath(v.id), token), 410, 'OWNERSHIP_CHECK_EXPIRED');
    expect(t.prisma.riotLinkVerification.rows[0]?.status).toBe('expired');
    expect(t.prisma.gameAccount.rows).toHaveLength(0);
    expect((await list(t, token)).riot_verification).toBeNull();
  });

  it('확인 시점에 다른 멤버가 먼저 연동 → 409 GAME_ACCOUNT_ALREADY_LINKED, 본인이 같은 ID를 이미 연동 → ALREADY_LINKED_TO_ME', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    const v = await startedVerification(t, alice.token, 'alpha');
    await linkRiot(t, bob.token, 'alpha');
    t.riot.icons.set(PUUID_A, v.icon_id);
    await expectError(await call(t, 'POST', confirmPath(v.id), alice.token), 409, 'GAME_ACCOUNT_ALREADY_LINKED');

    // 본인: 확인 2개를 따로 만든 뒤(시작 6단계 통과) 하나를 먼저 확인
    const carol = await devLogin(t, 'carol');
    const v1 = await startedVerification(t, carol.token, 'bravo');
    // 두 번째 pending을 직접 만들어 둔다(새 시작은 이전 pending을 취소하므로)
    const v2 = t.prisma.riotLinkVerification.insert({
      userId: carol.userId,
      puuid: PUUID_B,
      gameName: 'Bravo',
      tagLine: 'KR1',
      iconId: v1.icon_id,
      status: 'pending',
      expiresAt: new Date('2026-10-28T03:10:00.000Z'),
    });
    t.riot.icons.set(PUUID_B, v1.icon_id);
    expect((await call(t, 'POST', confirmPath(v1.id), carol.token)).status).toBe(200);
    await expectError(await call(t, 'POST', confirmPath(v2.id), carol.token), 409, 'GAME_ACCOUNT_ALREADY_LINKED_TO_ME');
  });

  it('확인 시점에 한도 도달 → 409 GAME_ACCOUNT_LIMIT_REACHED', async () => {
    t = await createTestApp({ fixedClock: true, env: { RIOT_ACCOUNTS_MAX: '1' } });
    const { token, userId } = await devLogin(t, 'alice');
    const v = await startedVerification(t, token, 'alpha');
    // 다른 경로(다른 탭)로 이미 1개 연동된 상황
    t.prisma.gameAccount.insert({ userId, gameId: t.prisma.gameId('lol'), externalId: PUUID_B, displayName: 'Bravo#KR1', verified: true, verifiedAt: new Date(), isPrimary: true });
    t.riot.icons.set(PUUID_A, v.icon_id);
    await expectError(await call(t, 'POST', confirmPath(v.id), token), 409, 'GAME_ACCOUNT_LIMIT_REACHED');
    expect(t.prisma.riotLinkVerification.rows.find((r) => r.id === v.id)?.status).toBe('pending');
  });

  it('취소: 204, 이후 확인 → 410, 다시 취소 → 204(변경 없음)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const v = await startedVerification(t, token, 'alpha');
    expect((await call(t, 'DELETE', verificationPath(v.id), token)).status).toBe(204);
    expect(t.prisma.riotLinkVerification.rows[0]?.status).toBe('cancelled');
    expect((await list(t, token)).riot_verification).toBeNull();
    await expectError(await call(t, 'POST', confirmPath(v.id), token), 410, 'OWNERSHIP_CHECK_EXPIRED');
    expect((await call(t, 'DELETE', verificationPath(v.id), token)).status).toBe(204);
  });

  it('남의 확인 id·없는 id → 404 NOT_FOUND, UUID 아님 → 400', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    const v = await startedVerification(t, alice.token, 'alpha');
    await expectError(await call(t, 'POST', confirmPath(v.id), bob.token), 404, 'NOT_FOUND');
    await expectError(await call(t, 'DELETE', verificationPath(v.id), bob.token), 404, 'NOT_FOUND');
    await expectError(await call(t, 'POST', confirmPath('00000000-0000-4000-8000-000000000000'), alice.token), 404, 'NOT_FOUND');
    await expectError(await call(t, 'POST', confirmPath('not-a-uuid'), alice.token), 400, 'VALIDATION_FAILED');
    expect(t.prisma.riotLinkVerification.rows[0]?.status).toBe('pending');
  });
});

describe('대표 지정 POST /me/game-accounts/:id/primary (D56)', () => {
  it('부계정 tft id로 지정 → 그 라이엇 ID lol·tft가 대표, 기존 대표 false(false 먼저 → true 순서)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    await linkRiot(t, token, 'alpha');
    const bravo = await linkRiot(t, token, 'bravo');
    const tftId = bravo.accounts.find((a) => a.game === 'tft')?.id as string;
    const res = await call(t, 'POST', `/me/game-accounts/${tftId}/primary`, token);
    expect(res.status).toBe(200);
    const body = SetPrimaryGameAccountResponse.strict().parse(await res.json());
    expect(body.accounts.map((a) => [a.display_name, a.game, a.is_primary])).toEqual([
      ['Bravo#KR1', 'lol', true],
      ['Bravo#KR1', 'tft', true],
      ['Alpha#KR1', 'lol', false],
      ['Alpha#KR1', 'tft', false],
    ]);
  });

  it('이미 대표·스팀 행 → 변경 없이 200, 남의 계정 → 404, UUID 아님 → 400', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    const a = await linkRiot(t, alice.token, 'alpha');
    const lolId = a.accounts[0]?.id as string;
    const res = await call(t, 'POST', `/me/game-accounts/${lolId}/primary`, alice.token);
    expect(res.status).toBe(200);
    expect(SetPrimaryGameAccountResponse.parse(await res.json()).accounts.every((x) => x.is_primary)).toBe(true);
    const steam = t.prisma.gameAccount.insert({ userId: alice.userId, gameId: t.prisma.gameId('steam'), externalId: '76561190000000009', displayName: '스팀', verified: true, verifiedAt: new Date(), isPrimary: true });
    expect((await call(t, 'POST', `/me/game-accounts/${steam.id}/primary`, alice.token)).status).toBe(200);
    await expectError(await call(t, 'POST', `/me/game-accounts/${lolId}/primary`, bob.token), 404, 'NOT_FOUND');
    await expectError(await call(t, 'POST', `/me/game-accounts/xyz/primary`, alice.token), 400, 'VALIDATION_FAILED');
  });

  it('부분 고유 인덱스(가짜 DB 흉내): 대표 2개를 만들려는 갱신은 P2002', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    await linkRiot(t, token, 'alpha');
    await linkRiot(t, token, 'bravo');
    await expect(
      t.prisma.gameAccount.updateMany({ where: { userId, externalId: PUUID_B }, data: { isPrimary: true } }),
    ).rejects.toMatchObject({ code: 'P2002', meta: { target: 'game_accounts_one_primary_per_user_game' } });
  });
});

describe('연동 해제 DELETE /me/game-accounts/:id', () => {
  it('대표 라이엇 해제(tft id) → lol·tft 함께 삭제, 가장 먼저 연동한 부계정 승격, 스냅샷 Cascade, 횟수 기록 유지', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const alpha = await linkRiot(t, token, 'alpha');
    t.clock.advance(60_000);
    await linkRiot(t, token, 'bravo');
    t.clock.advance(60_000);
    await linkRiot(t, token, 'charlie');
    const alphaLol = alpha.accounts[0]?.id as string;
    const alphaTft = alpha.accounts[1]?.id as string;
    t.prisma.rankSnapshot.insert({ gameAccountId: alphaLol, queue: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'II', capturedAt: new Date() });
    t.prisma.gameAccountSyncRequest.insert({ userId, gameAccountId: alphaLol });

    expect((await call(t, 'DELETE', `/me/game-accounts/${alphaTft}`, token)).status).toBe(204);
    const body = await list(t, token);
    expect(body.accounts.map((a) => [a.display_name, a.game, a.is_primary])).toEqual([
      ['Bravo#KR1', 'lol', true],
      ['Bravo#KR1', 'tft', true],
      ['Charlie#KR1', 'lol', false],
      ['Charlie#KR1', 'tft', false],
    ]);
    expect(t.prisma.rankSnapshot.rows).toHaveLength(0);
    expect(t.prisma.gameAccountSyncRequest.rows).toEqual([expect.objectContaining({ userId, gameAccountId: null })]);
    // 해제해도 횟수는 회복되지 않는다(D41)
    expect(body.sync_quota.used).toBe(1);
  });

  it('부계정 해제 → 대표 그대로, 남의 계정 → 404, 이미 해제 → 404', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    await linkRiot(t, alice.token, 'alpha');
    const bravo = await linkRiot(t, alice.token, 'bravo');
    const id = bravo.accounts[0]?.id as string;
    await expectError(await call(t, 'DELETE', `/me/game-accounts/${id}`, bob.token), 404, 'NOT_FOUND');
    expect((await call(t, 'DELETE', `/me/game-accounts/${id}`, alice.token)).status).toBe(204);
    const body = await list(t, alice.token);
    expect(body.accounts.map((a) => [a.display_name, a.is_primary])).toEqual([
      ['Alpha#KR1', true],
      ['Alpha#KR1', true],
    ]);
    await expectError(await call(t, 'DELETE', `/me/game-accounts/${id}`, alice.token), 404, 'NOT_FOUND');
  });

  it('스팀 해제 → 그 행만 삭제(플레이타임 Cascade), 해제 후 같은 라이엇 ID 다시 연동 가능', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const alpha = await linkRiot(t, token, 'alpha');
    const steam = t.prisma.gameAccount.insert({ userId, gameId: t.prisma.gameId('steam'), externalId: '76561190000000009', displayName: '스팀', verified: true, verifiedAt: new Date(), isPrimary: true });
    t.prisma.steamPlaytime.insert({ gameAccountId: steam.id, appId: 570, minutesTotal: 10, syncedAt: new Date() });
    expect((await call(t, 'DELETE', `/me/game-accounts/${steam.id}`, token)).status).toBe(204);
    expect(t.prisma.gameAccount.rows).toHaveLength(2);
    expect(t.prisma.steamPlaytime.rows).toHaveLength(0);
    expect((await call(t, 'DELETE', `/me/game-accounts/${alpha.accounts[0]?.id}`, token)).status).toBe(204);
    t.clock.advance(10_000);
    const again = await linkRiot(t, token, 'alpha');
    expect(again.accounts.every((a) => a.is_primary)).toBe(true);
  });
});

describe('GameAccountView 직렬화', () => {
  it('rank = 최신 스냅샷, sync.error 모르는 코드 → INTERNAL_ERROR, matches_synced_at은 lol 행만, 스팀 보유 게임 수', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const alpha = await linkRiot(t, token, 'alpha');
    const [lolId, tftId] = [alpha.accounts[0]?.id as string, alpha.accounts[1]?.id as string];
    const synced = new Date('2026-10-28T02:00:00.000Z');
    for (const r of t.prisma.gameAccount.rows) {
      Object.assign(r, { syncState: 'idle', lastSyncedAt: synced, matchesSyncedAt: synced, lastSyncError: 'WHATEVER', lastSyncErrorAt: synced });
    }
    t.prisma.rankSnapshot.insert({ gameAccountId: lolId, queue: 'RANKED_SOLO_5x5', tier: 'SILVER', division: 'I', lp: 10, capturedAt: new Date('2026-10-27T00:00:00Z') });
    t.prisma.rankSnapshot.insert({ gameAccountId: lolId, queue: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'IV', lp: 0, wins: 3, losses: 2, capturedAt: new Date('2026-10-28T00:00:00Z') });
    t.prisma.rankSnapshot.insert({ gameAccountId: tftId, queue: 'RANKED_TFT', tier: 'MASTER', division: null, lp: 120, capturedAt: new Date() });
    const steam = t.prisma.gameAccount.insert({ userId, gameId: t.prisma.gameId('steam'), externalId: '76561190000000009', displayName: '스팀닉', verified: true, verifiedAt: new Date(), isPrimary: true, lastSyncError: 'STEAM_PROFILE_PRIVATE', lastSyncErrorAt: synced });
    t.prisma.steamPlaytime.insert({ gameAccountId: steam.id, appId: 570, minutesTotal: 10, syncedAt: synced });
    t.prisma.steamPlaytime.insert({ gameAccountId: steam.id, appId: 730, minutesTotal: 5, syncedAt: synced });

    const body = await list(t, token);
    const [lol, tft, st] = body.accounts;
    expect(lol?.rank).toEqual({ tier: 'GOLD', division: 'IV', lp: 0, wins: 3, losses: 2 });
    expect(tft?.rank).toEqual({ tier: 'MASTER', division: null, lp: 120, wins: 0, losses: 0 });
    expect(lol?.sync.matches_synced_at).toBe(synced.toISOString());
    expect(tft?.sync.matches_synced_at).toBeNull();
    expect(lol?.sync.error).toEqual({ code: 'INTERNAL_ERROR', at: synced.toISOString() });
    expect(st).toMatchObject({ provider: 'steam', game: 'steam', is_primary: true, rank: null, steam_owned_game_count: 2 });
    expect(st?.sync.error?.code).toBe('STEAM_PROFILE_PRIVATE');
    expect(lol?.steam_owned_game_count).toBeNull();
  });
});
