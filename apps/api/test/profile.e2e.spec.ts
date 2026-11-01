/**
 * S1 GET /users/:id/profile HTTP 테스트(DB 없이). 계약 8절, D38·D39·D40·D50·D56·D57.
 */
import { GetUserProfileResponse, type LolMatchSummary } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { STEAM_ID_A } from './support/s1-mocks';
import { call, devLogin, expectError, expectNoExternalIds, linkRiot } from './support/s1-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function profile(app: TestApp, token: string, userId: string) {
  const res = await call(app, 'GET', `/users/${userId}/profile`, token);
  expect(res.status).toBe(200);
  const text = await res.text();
  expectNoExternalIds(text);
  expect(text).not.toMatch(/dev-|discord_id|email/);
  return GetUserProfileResponse.strict().parse(JSON.parse(text));
}

function summary(over: Partial<LolMatchSummary> = {}): LolMatchSummary {
  return { queue_id: 420, champion_id: 266, champion_key: 'Aatrox', position: 'top', kills: 5, deaths: 2, assists: 7, duration_sec: 1800, ...over };
}

function setIdle(app: TestApp, over: Record<string, unknown> = {}): void {
  for (const r of app.prisma.gameAccount.rows) Object.assign(r, { syncState: 'idle', syncStateAt: app.clock.now(), ...over });
}

describe('GET /users/:id/profile', () => {
  it('빈 상태(연동 없음): tiers [], main_position·recent_matches null, scrim 빈 객체(S3 D119)·badges [](S4 D159), 본인이면 sync_quota', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const p = await profile(t, token, userId);
    expect(p.is_self).toBe(true);
    expect(p.user).toMatchObject({ id: userId, nickname: 'alice', role: 'member', avatar_url: null, discord_linked: false });
    expect(p.game_accounts).toEqual([]);
    expect(p.tiers).toEqual([]);
    expect(p.main_position).toBeNull();
    expect(p.recent_matches).toBeNull();
    expect(p.scrim).toEqual({ season: null, ratings: [], recent: [] });
    expect(p.badges).toEqual([]);
    expect(p.sync_quota).toMatchObject({ limit: 5, used: 0, remaining: 5 });
    expect(t.queue.jobs).toEqual([]);
  });

  it('다른 멤버 조회: is_self=false, sync_quota null, discord_linked(실제 디스코드 사용자)', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    const row = t.prisma.users.find((u) => u.id === bob.userId);
    Object.assign(row as object, { discordId: '123456789012345678', discordAvatar: 'hash', email: 'bob@example.com' });
    const p = await profile(t, alice.token, bob.userId);
    expect(p.is_self).toBe(false);
    expect(p.sync_quota).toBeNull();
    expect(p.user.discord_linked).toBe(true);
    expect(p.user.avatar_url).toContain('cdn.discordapp.com');
  });

  it('대표 계정 기준: 티어 카드 lol·tft(최신 스냅샷), 주 포지션·최근 전적은 대표 lol 행만, 부계정은 game_accounts에만', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const alpha = await linkRiot(t, token, 'alpha');
    t.clock.advance(60_000);
    const bravo = await linkRiot(t, token, 'bravo');
    const synced = new Date('2026-10-28T02:30:00.000Z');
    setIdle(t, { lastSyncedAt: synced, matchesSyncedAt: synced });
    const [aLol, aTft] = alpha.accounts.map((a) => a.id) as [string, string];
    const bLol = bravo.accounts[0]?.id as string;
    t.prisma.rankSnapshot.insert({ gameAccountId: aLol, queue: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'I', lp: 50, wins: 10, losses: 8, capturedAt: synced });
    t.prisma.rankSnapshot.insert({ gameAccountId: bLol, queue: 'RANKED_SOLO_5x5', tier: 'DIAMOND', division: 'IV', lp: 1, capturedAt: synced });
    // 대표 lol: 12경기(top 7, mid 4, null 1), 부계정 lol: jungle 3경기
    for (let i = 0; i < 12; i++) {
      const position = i < 7 ? 'top' : i < 11 ? 'mid' : null;
      t.prisma.recentMatch.insert({
        gameAccountId: aLol,
        externalMatchId: `KR_${9000000000 + i}`,
        playedAt: new Date(Date.UTC(2026, 9, 27, 0, i)),
        win: i % 2 === 0,
        summary: summary({ position, champion_id: i === 11 ? 1 : 266, champion_key: i === 11 ? 'Annie' : 'Aatrox' }),
      });
    }
    // 형식이 깨진 행은 건너뜀
    t.prisma.recentMatch.insert({ gameAccountId: aLol, externalMatchId: 'KR_1', playedAt: new Date(Date.UTC(2026, 9, 28)), win: true, summary: { broken: true } });
    for (let i = 0; i < 3; i++) {
      t.prisma.recentMatch.insert({ gameAccountId: bLol, externalMatchId: `KR_${8000000000 + i}`, playedAt: new Date(), win: true, summary: summary({ position: 'jungle' }) });
    }

    const p = await profile(t, token, userId);
    expect(p.game_accounts).toHaveLength(4);
    expect(p.tiers).toEqual([
      { game_account_id: aLol, game: 'lol', queue: 'RANKED_SOLO_5x5', rank: { tier: 'GOLD', division: 'I', lp: 50, wins: 10, losses: 8 }, synced_at: synced.toISOString() },
      { game_account_id: aTft, game: 'tft', queue: 'RANKED_TFT', rank: null, synced_at: synced.toISOString() },
    ]);
    expect(p.main_position).toEqual({
      source: 'riot_ranked_solo',
      sample_size: 11,
      positions: [
        { position: 'top', count: 7, ratio: 0.64 },
        { position: 'mid', count: 4, ratio: 0.36 },
      ],
    });
    expect(p.recent_matches?.items).toHaveLength(10);
    expect(p.recent_matches?.synced_at).toBe(synced.toISOString());
    expect(p.recent_matches?.refresh_queued).toBe(false);
    const latest = p.recent_matches?.items[0];
    expect(latest).toMatchObject({ champion_id: 1, champion_key: 'Annie', champion_name: 'Annie', champion_image_url: null, position: null });
    expect(p.recent_matches?.items[1]).toMatchObject({ champion_name: '아트록스', position: 'mid', kills: 5, duration_sec: 1800 });
    expect(t.queue.jobs.filter((j) => j.kind === 'riot-matches')).toEqual([]);

    // 대표를 바꾸면 프로필 기준도 바뀐다
    expect((await call(t, 'POST', `/me/game-accounts/${bLol}/primary`, token)).status).toBe(200);
    const p2 = await profile(t, token, userId);
    expect(p2.tiers[0]).toMatchObject({ game_account_id: bLol, rank: { tier: 'DIAMOND' } });
    expect(p2.main_position?.positions).toEqual([{ position: 'jungle', count: 3, ratio: 1 }]);
  });

  it('전적 6시간 지남 + idle → riot-matches(profile-view) 등록, refresh_queued=true(차감 없음)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const alpha = await linkRiot(t, token, 'alpha');
    const lolId = alpha.accounts[0]?.id as string;
    setIdle(t, { matchesSyncedAt: new Date(t.clock.now().getTime() - 6 * 3600_000) });
    t.queue.jobs.length = 0;
    const p = await profile(t, token, userId);
    expect(p.recent_matches).toEqual({ items: [], synced_at: expect.any(String), refresh_queued: true });
    expect(t.queue.jobs).toEqual([{ kind: 'riot-matches', gameAccountId: lolId, reason: 'profile-view', priority: 2 }]);
    expect(p.sync_quota?.used).toBe(0);
  });

  it('전적 갱신 안 함: 6시간 이내 / 30분 안 실패 기록 / 이미 갱신 중(refresh_queued=true)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    await linkRiot(t, token, 'alpha');
    t.queue.jobs.length = 0;
    // 연동 직후 queued → 이미 갱신 중
    expect((await profile(t, token, userId)).recent_matches?.refresh_queued).toBe(true);
    // 실패 29분 전, 전적 없음
    setIdle(t, { matchesSyncedAt: null, lastSyncError: 'PROVIDER_UNAVAILABLE', lastSyncErrorAt: new Date(t.clock.now().getTime() - 29 * 60_000) });
    expect((await profile(t, token, userId)).recent_matches?.refresh_queued).toBe(false);
    // 31분 지나면 다시 등록
    t.clock.advance(2 * 60_000);
    expect((await profile(t, token, userId)).recent_matches?.refresh_queued).toBe(true);
    expect(t.queue.jobs).toHaveLength(1);
  });

  it('스팀만 연동: tiers [], recent_matches null, game_accounts에 스팀', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    t.prisma.gameAccount.insert({ userId: bob.userId, gameId: t.prisma.gameId('steam'), externalId: STEAM_ID_A, displayName: '밥스팀', verified: true, verifiedAt: new Date(), isPrimary: true });
    const p = await profile(t, alice.token, bob.userId);
    expect(p.tiers).toEqual([]);
    expect(p.recent_matches).toBeNull();
    expect(p.game_accounts.map((a) => a.display_name)).toEqual(['밥스팀']);
  });

  it('없는 사용자 → 404, UUID 아님 → 400, 인증 없음 → 401', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    await expectError(await call(t, 'GET', '/users/00000000-0000-4000-8000-000000000000/profile', token), 404, 'NOT_FOUND');
    await expectError(await call(t, 'GET', '/users/abc/profile', token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/users/00000000-0000-4000-8000-000000000000/profile'), 401, 'UNAUTHENTICATED');
  });
});
