/**
 * GET /me/position-suggestions?game= HTTP 테스트(DB 없이). 계약 20-5, D190–D192.
 * 대표 계정의 저장된 최근 전적 → computeMainPosition(= 프로필 main_position). 외부 호출·동기화 등록 없음.
 */
import { GetMyPositionSuggestionsResponse, GetUserProfileResponse, type LolMatchSummary } from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncEnqueuer } from '../src/modules/game-accounts/sync-enqueuer.service';
import { call, devLogin, expectError, linkRiot } from './support/s1-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const PATH = '/me/position-suggestions';

function summary(over: Partial<LolMatchSummary> = {}): LolMatchSummary {
  return { queue_id: 420, champion_id: 266, champion_key: 'Aatrox', position: 'top', kills: 5, deaths: 2, assists: 7, duration_sec: 1800, ...over };
}

async function suggestions(app: TestApp, token: string, game: string) {
  const res = await call(app, 'GET', `${PATH}?game=${game}`, token);
  expect(res.status).toBe(200);
  return GetMyPositionSuggestionsResponse.strict().parse(await res.json());
}

/** 그 계정에 경기를 최신순으로 심는다(i = 0이 가장 최근) */
function seedMatches(app: TestApp, gameAccountId: string, positions: (LolMatchSummary['position'])[], prefix = 9000000000): void {
  positions.forEach((position, i) => {
    app.prisma.recentMatch.insert({
      gameAccountId,
      externalMatchId: `KR_${prefix + i}`,
      playedAt: new Date(Date.UTC(2026, 9, 27, 12, 0) - i * 60_000),
      win: i % 2 === 0,
      summary: summary({ position }),
    });
  });
}

/** 연동 직후 queued 상태를 idle로, 전적 동기화 시각을 정한다 */
function setIdle(app: TestApp, matchesSyncedAt: Date | null): void {
  for (const r of app.prisma.gameAccount.rows) Object.assign(r, { syncState: 'idle', syncStateAt: app.clock.now(), matchesSyncedAt });
}

describe('GET /me/position-suggestions', () => {
  it('롤 경기 있음: 상위 2개·sample_size·synced_at, 깨진 행·win null 건너뜀, 프로필 main_position과 같은 값, 동기화 등록 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token, userId } = await devLogin(t, 'alice');
    const linked = await linkRiot(t, token, 'alpha');
    const lol = linked.accounts[0]?.id as string;
    // 7시간 전 → 프로필 조회라면 riot-matches를 등록할 상태
    const synced = new Date(t.clock.now().getTime() - 7 * 3600_000);
    setIdle(t, synced);
    seedMatches(t, lol, ['mid', 'top', 'mid', null, 'top', 'mid', 'support']);
    t.prisma.recentMatch.insert({ gameAccountId: lol, externalMatchId: 'KR_1', playedAt: new Date(Date.UTC(2026, 9, 28)), win: true, summary: { broken: true } });
    t.prisma.recentMatch.insert({ gameAccountId: lol, externalMatchId: 'KR_2', playedAt: new Date(Date.UTC(2026, 9, 28)), win: null, summary: summary({ position: 'jungle' }) });
    t.queue.jobs.length = 0;
    const enqueue = vi.spyOn(t.app.get(SyncEnqueuer), 'enqueue');

    const s = await suggestions(t, token, 'lol');
    expect(s).toEqual({ game: 'lol', positions: ['mid', 'top'], sample_size: 6, synced_at: synced.toISOString() });
    expect(enqueue).not.toHaveBeenCalled();
    expect(t.queue.jobs).toEqual([]);

    const res = await call(t, 'GET', `/users/${userId}/profile`, token);
    const p = GetUserProfileResponse.parse(await res.json());
    expect(p.main_position?.positions.map((x) => x.position)).toEqual(s.positions);
    expect(p.main_position?.sample_size).toBe(s.sample_size);
  });

  it('한 라인만: positions 1개', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const lol = (await linkRiot(t, token, 'alpha')).accounts[0]?.id as string;
    setIdle(t, null);
    seedMatches(t, lol, ['support', 'support', null]);
    expect(await suggestions(t, token, 'lol')).toEqual({ game: 'lol', positions: ['support'], sample_size: 2, synced_at: null });
  });

  it('기록 없음·포지션 없는 경기뿐: [], sample_size 0, synced_at은 계정 값', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const lol = (await linkRiot(t, token, 'alpha')).accounts[0]?.id as string;
    const synced = new Date('2026-10-28T02:00:00.000Z');
    setIdle(t, synced);
    expect(await suggestions(t, token, 'lol')).toEqual({ game: 'lol', positions: [], sample_size: 0, synced_at: synced.toISOString() });
    seedMatches(t, lol, [null, null]);
    expect((await suggestions(t, token, 'lol')).positions).toEqual([]);
  });

  it('포지션 없는 게임(롤체·스팀)과 계정 없음: [], sample_size 0, synced_at null', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    expect(await suggestions(t, token, 'lol')).toEqual({ game: 'lol', positions: [], sample_size: 0, synced_at: null });
    const linked = await linkRiot(t, token, 'alpha');
    setIdle(t, new Date('2026-10-28T02:00:00.000Z'));
    const tft = linked.accounts[1]?.id as string;
    seedMatches(t, tft, ['top', 'top']);
    for (const game of ['tft', 'steam']) {
      expect(await suggestions(t, token, game)).toEqual({ game, positions: [], sample_size: 0, synced_at: null });
    }
  });

  it('대표 계정만 본다. 다른 사용자 계정 값이 섞이지 않는다', async () => {
    t = await createTestApp({ fixedClock: true });
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    const main = (await linkRiot(t, alice.token, 'alpha')).accounts[0]?.id as string;
    t.clock.advance(60_000);
    const sub = (await linkRiot(t, alice.token, 'bravo')).accounts[0]?.id as string;
    const bobLol = (await linkRiot(t, bob.token, 'charlie')).accounts[0]?.id as string;
    setIdle(t, null);
    seedMatches(t, main, ['bot', 'bot', 'mid']);
    seedMatches(t, sub, ['jungle', 'jungle', 'jungle'], 8000000000);
    seedMatches(t, bobLol, ['top', 'top', 'top', 'top'], 7000000000);
    expect((await suggestions(t, alice.token, 'lol')).positions).toEqual(['bot', 'mid']);
    expect((await suggestions(t, bob.token, 'lol')).positions).toEqual(['top']);
    expect((await call(t, 'POST', `/me/game-accounts/${sub}/primary`, alice.token)).status).toBe(200);
    expect((await suggestions(t, alice.token, 'lol')).positions).toEqual(['jungle']);
  });

  it('games.positions에 없는 값은 뺀다(D191)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    const lol = (await linkRiot(t, token, 'alpha')).accounts[0]?.id as string;
    setIdle(t, null);
    seedMatches(t, lol, ['top', 'top', 'mid']);
    const game = t.prisma.game.rows.find((g) => g.code === 'lol');
    Object.assign(game as object, { positions: ['mid', 'jungle', 'bot', 'support'] });
    expect(await suggestions(t, token, 'lol')).toMatchObject({ positions: ['mid'], sample_size: 3 });
  });

  it('검증: game 누락·모르는 값 400 VALIDATION_FAILED, 인증 없음 401', async () => {
    t = await createTestApp({ fixedClock: true });
    const { token } = await devLogin(t, 'alice');
    await expectError(await call(t, 'GET', PATH, token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', `${PATH}?game=valorant`, token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', `${PATH}?game=lol`), 401, 'UNAUTHENTICATED');
  });
});
