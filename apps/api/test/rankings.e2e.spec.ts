/**
 * S4 GET /rankings/tier·/rankings/elo, 캐시 읽기(7-3)·갱신(7-4)·순위 변동(7-7), 프로필 badges·rank(4-4).
 * DB 없이 FakePrisma + MemoryRankingCache. SQL 조건부 쓰기·DISTINCT ON은 test/db/ranking-cache.db.e2e.spec.ts.
 */
import {
  GetEloRankingResponse,
  GetTierRankingResponse,
  GetUserProfileResponse,
  RANKING_ITEMS_MAX,
  RANKING_STALE_AFTER_SEC,
} from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activityRankingKey, eloRankingKey, tierRankingKey } from '../src/modules/rankings/ranking-keys';
import { call, expectError, expectNoExternalIds } from './support/s1-helpers';
import {
  closer,
  login,
  member,
  refresher,
  seedAccount,
  seedRating,
  seedSeason,
  seedSnapshot,
} from './support/s4-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-10-28T03:00:00.000Z'; // 수요일 12:00 KST
const CURRENT = ['2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'] as const;
const PAST = ['2026-07-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'] as const;

async function tier(app: TestApp, token: string, game: string): Promise<GetTierRankingResponse> {
  const res = await call(app, 'GET', `/rankings/tier?game=${game}`, token);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  expectNoExternalIds(text);
  expect(text).not.toMatch(/email|discord_id/i);
  return GetTierRankingResponse.strict().parse(JSON.parse(text));
}

async function elo(app: TestApp, token: string, query = 'game=lol'): Promise<GetEloRankingResponse> {
  const res = await call(app, 'GET', `/rankings/elo?${query}`, token);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  expect(text).not.toMatch(/email|discord_id/i);
  return GetEloRankingResponse.strict().parse(JSON.parse(text));
}

describe('인증·검증', () => {
  it('토큰 없음 401, game 누락·잘못된 값 400, steam 티어 400, season uuid 아님 400, 없는 season 404', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const { token } = await login(t, 'me');
    for (const p of ['/rankings/tier?game=lol', '/rankings/elo?game=lol', '/dashboard/summary']) {
      expect((await call(t, 'GET', p)).status).toBe(401);
    }
    await expectError(await call(t, 'GET', '/rankings/tier', token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/rankings/tier?game=steam', token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/rankings/elo', token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', '/rankings/elo?game=lol&season=abc', token), 400, 'VALIDATION_FAILED');
    await expectError(
      await call(t, 'GET', '/rankings/elo?game=lol&season=11111111-1111-4111-8111-111111111111', token),
      404,
      'NOT_FOUND',
    );
  });
});

describe('GET /rankings/tier', () => {
  it('대표 계정 최신 스냅샷, 점수 순. 언랭·미연동·미확인·스냅샷 없음·다른 큐·형식 불량 제외, 부계정 무시', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const dia = await member(t, 'dia');
    const emerald = await member(t, 'emerald');
    const unranked = await member(t, 'unranked');
    await member(t, 'nolink');
    const unverified = await member(t, 'unverified');
    const nosnap = await member(t, 'nosnap');
    const flex = await member(t, 'flex');
    const bad = await member(t, 'bad');
    seedAccount(t, dia, { name: '다이아#KR1', tier: 'DIAMOND', division: 'II', lp: 45, wins: 22, losses: 9 });
    // 부계정은 더 높아도 무시한다
    seedAccount(t, dia, { name: '부계정#KR1', primary: false, tier: 'CHALLENGER', division: null, lp: 900 });
    seedAccount(t, emerald, { tier: 'EMERALD', division: 'I', lp: 80 });
    seedAccount(t, me.userId, { name: '나#KR1', tier: 'EMERALD', division: 'III', lp: 12 });
    seedAccount(t, unranked, { tier: 'UNRANKED', division: null });
    seedAccount(t, unverified, { verified: false, tier: 'CHALLENGER', division: null, lp: 1000 });
    seedAccount(t, nosnap, { tier: null });
    seedAccount(t, flex, { tier: 'CHALLENGER', division: null, queue: 'RANKED_FLEX_SR' });
    seedAccount(t, bad, { tier: 'WOOD', division: 'I' });
    // 최신 스냅샷만: 이전 값 → 뒤에 들어온 최신 값
    const old = seedAccount(t, emerald, { game: 'tft', tier: 'GOLD', division: 'I', lp: 90, capturedAt: new Date('2026-10-01T00:00:00Z') });
    seedSnapshot(t, old.id, { game: 'tft', tier: 'GOLD', division: 'II', lp: 20, capturedAt: new Date('2026-10-20T00:00:00Z') });

    const r = await tier(t, me.token, 'lol');
    expect(r.items.map((i) => [i.rank, i.user.nickname, i.score])).toEqual([
      [1, 'dia', 2645],
      [2, 'emerald', 2380],
      [3, 'me', 2112],
    ]);
    expect(r.items[0]).toMatchObject({ account_name: '다이아#KR1', tier: 'DIAMOND', division: 'II', lp: 45, wins: 22, losses: 9, rank_change: null });
    expect(r).toMatchObject({ game: 'lol', total: 3, next_cursor: null, stale: false, synced_at: NOW });
    expect(r.me?.rank).toBe(3);

    const tft = await tier(t, me.token, 'tft');
    expect(tft.items.map((i) => [i.user.nickname, i.score])).toEqual([['emerald', 1420]]);
    expect(tft.me).toBeNull();
  });

  it('마스터 이상은 디비전 없이 점수 계산', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    seedAccount(t, me.userId, { tier: 'MASTER', division: null, lp: 0 });
    expect((await tier(t, me.token, 'lol')).items[0]).toMatchObject({ score: 2800, division: null });
  });
});

describe('GET /rankings/elo 출처 선택(4-2)', () => {
  it('시즌이 하나도 없음: season null, 빈 목록, 캐시 안 씀', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const r = await elo(t, me.token);
    expect(r).toEqual({
      items: [],
      next_cursor: null,
      game: 'lol',
      season: null,
      is_final: false,
      min_games: 5,
      total: 0,
      me: null,
      synced_at: null,
      stale: false,
    });
    expect(t.rankingCache.writes).toEqual([]);
  });

  it('시작 전 시즌 지정: 빈 목록, 캐시 안 씀', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '다음', '2027-01-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z');
    const r = await elo(t, me.token, `game=lol&season=${s.id}`);
    expect(r).toMatchObject({ items: [], is_final: false, synced_at: null, stale: false, season: { id: s.id } });
    expect(t.rankingCache.writes).toEqual([]);
  });

  it('진행 중 시즌: 캐시, 5경기 이상만, 내 행. 다른 시즌·게임 행 제외', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    const past = seedSeason(t, '지난', ...PAST);
    const a = await member(t, 'a');
    const few = await member(t, 'few');
    seedRating(t, a, s.id, { elo: 1500, wins: 8, losses: 2 });
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 3, losses: 2 });
    seedRating(t, few, s.id, { elo: 1900, wins: 4, losses: 0 });
    seedRating(t, few, past.id, { elo: 1900, wins: 40, losses: 0 });
    seedRating(t, few, s.id, { game: 'tft', elo: 1800, wins: 9, losses: 0 });
    const r = await elo(t, me.token);
    expect(r.items.map((i) => i.user.nickname)).toEqual(['a', 'me']);
    expect(r).toMatchObject({ is_final: false, total: 2, min_games: 5, synced_at: NOW, stale: false, season: { id: s.id } });
    expect(r.me).toMatchObject({ rank: 2, elo: 1421, games: 5, win_rate: 0.6, rank_change: null });
  });

  it('끝났지만 종료 처리 전 시즌: 기본값은 latestStarted, 캐시 출처(is_final false)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '지난', ...PAST);
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 5 });
    const r = await elo(t, me.token);
    expect(r).toMatchObject({ is_final: false, total: 1, season: { id: s.id }, synced_at: NOW });
    expect(t.rankingCache.writes).toEqual([eloRankingKey('lol', s.id)]);
  });

  it('닫힌 시즌: season_standings 출처, is_final, rank_change null, synced_at = closed_at. 캐시 미사용', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '지난', ...PAST);
    const a = await member(t, 'a');
    seedRating(t, a, s.id, { elo: 1500, wins: 8, losses: 2 });
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 3, losses: 2 });
    await closer(t).runOnce();
    // ratings를 바꿔도 standings 값이 나간다
    for (const row of t.prisma.rating.rows) row.elo = 1;
    const r = await elo(t, me.token, `game=lol&season=${s.id}`);
    expect(r.items.map((i) => [i.rank, i.user.nickname, i.elo, i.games, i.win_rate, i.rank_change])).toEqual([
      [1, 'a', 1500, 10, 0.8, null],
      [2, 'me', 1421, 5, 0.6, null],
    ]);
    expect(r).toMatchObject({ is_final: true, stale: false, synced_at: NOW, total: 2 });
    expect(r.me?.rank).toBe(2);
    expect(t.rankingCache.writes).toEqual([]);
  });

  it('탈퇴로 빠진 standings 행의 저장 rank는 다시 매기지 않는다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '지난', ...PAST, NOW);
    t.prisma.seasonStanding.insert({
      seasonId: s.id,
      gameId: t.prisma.gameId('lol'),
      userId: me.userId,
      rank: 2,
      elo: 1300,
      wins: 5,
      losses: 0,
    });
    const r = await elo(t, me.token);
    expect(r.items.map((i) => i.rank)).toEqual([2]);
  });

  it('me가 200위 밖: items는 200행, total 전체, me는 값이 있다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    for (let i = 0; i < RANKING_ITEMS_MAX + 3; i++) {
      seedRating(t, await member(t, `m${i}`), s.id, { elo: 2000 + i, wins: 5 });
    }
    seedRating(t, me.userId, s.id, { elo: 900, wins: 5 });
    const r = await elo(t, me.token);
    expect(r.items).toHaveLength(RANKING_ITEMS_MAX);
    expect(r.total).toBe(RANKING_ITEMS_MAX + 4);
    expect(r.me?.rank).toBe(RANKING_ITEMS_MAX + 4);
    expect(r.items.some((i) => i.user.id === me.userId)).toBe(false);
  });
});

describe('캐시 읽기(7-3)', () => {
  it('빈 캐시 첫 요청만 계산, 이후 재계산 없음(오래돼도 읽기는 계산하지 않음)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 5 });
    await elo(t, me.token);
    await tier(t, me.token, 'lol');
    expect(t.rankingCache.writes).toHaveLength(2);

    seedRating(t, await member(t, 'late'), s.id, { elo: 2000, wins: 9 });
    t.clock.advance(3_600_000);
    const r = await elo(t, me.token);
    expect(r.items.map((i) => i.user.nickname)).toEqual(['me']);
    expect(r).toMatchObject({ synced_at: NOW, stale: true });
    expect(t.rankingCache.writes).toHaveLength(2);
  });

  it('동시 첫 요청은 인스턴스 안에서 한 번만 계산', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 5 });
    const rs = await Promise.all([elo(t, me.token), elo(t, me.token), elo(t, me.token)]);
    expect(rs.map((r) => r.total)).toEqual([1, 1, 1]);
    expect(t.rankingCache.writes).toHaveLength(1);
  });

  it('형식이 깨진 캐시는 없음으로 보고 다시 계산', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 5 });
    await t.rankingCache.write(eloRankingKey('lol', s.id), {
      payload: { entries: [{ wrong: true }] },
      computedAt: new Date('2026-10-28T00:00:00Z'),
      baselinePeriodStart: new Date('2026-10-25T15:00:00Z'),
      baselineRanks: {},
    });
    expect((await elo(t, me.token)).total).toBe(1);
  });

  it('빈 캐시 첫 계산 실패는 500', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    t.rankingCache.failWrites.add(eloRankingKey('lol', s.id));
    await expectError(await call(t, 'GET', '/rankings/elo?game=lol', me.token), 500, 'INTERNAL_ERROR');
    t.rankingCache.failWrites.clear();
    expect((await elo(t, me.token)).total).toBe(0);
  });
});

describe('주기 작업(7-4)', () => {
  it('대상: 티어(lol·tft) + 게임 × 닫히지 않은 시작된 시즌. 시작 전·닫힌 시즌 제외, 닫힌 시즌 키 정리', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const s = seedSeason(t, '현재', ...CURRENT);
    const closed = seedSeason(t, '닫힘', ...PAST, NOW);
    const future = seedSeason(t, '다음', '2027-01-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z');
    await t.rankingCache.write(eloRankingKey('lol', closed.id), {
      payload: { entries: [] },
      computedAt: new Date(NOW),
      baselinePeriodStart: new Date(NOW),
      baselineRanks: {},
    });
    const run = await refresher(t).runOnce();
    // S5: 활동 week·month 2개가 항상 대상에 추가된다(계약 S5 7절). 스팀 보유자가 없어 playtime은 없다
    expect(run).toEqual({ acquired: true, refreshed: 7, failed: 0, deleted: 1 });
    expect([...t.rankingCache.rows.keys()].sort()).toEqual(
      [
        tierRankingKey('lol'),
        tierRankingKey('tft'),
        eloRankingKey('lol', s.id),
        eloRankingKey('tft', s.id),
        eloRankingKey('steam', s.id),
        activityRankingKey('week'),
        activityRankingKey('month'),
      ].sort(),
    );
    expect([...t.rankingCache.rows.keys()].some((k) => k.includes(future.id))).toBe(false);
  });

  it('try lock 실패면 미실행', async () => {
    t = await createTestApp({ fixedClock: NOW });
    seedSeason(t, '현재', ...CURRENT);
    t.prisma.advisoryAvailable = false;
    expect(await refresher(t).runOnce()).toEqual({ acquired: false, refreshed: 0, failed: 0, deleted: 0 });
    expect(t.rankingCache.writes).toEqual([]);
  });

  it('실패: 마지막 성공값 + 갱신 시각 유지, stale true. 한 키 실패가 다른 키에 영향 없음. 성공하면 복구', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 5 });
    seedRating(t, me.userId, s.id, { game: 'tft', elo: 1100, wins: 5 });
    await refresher(t).runOnce();

    seedRating(t, await member(t, 'new'), s.id, { elo: 2000, wins: 9 });
    t.clock.advance(300_000);
    const key = eloRankingKey('lol', s.id);
    t.rankingCache.failWrites.add(key);
    const run = await refresher(t).runOnce();
    expect(run).toMatchObject({ acquired: true, refreshed: 6, failed: 1 }); // S5: 활동 2개 포함
    expect(t.rankingCache.rows.get(key)).toMatchObject({ lastError: `write 실패: ${key}` });

    const failed = await elo(t, me.token);
    expect(failed).toMatchObject({ stale: true, synced_at: NOW, total: 1 });
    const other = await elo(t, me.token, 'game=tft');
    expect(other.stale).toBe(false);
    expect(other.synced_at).toBe(t.clock.now().toISOString());

    t.rankingCache.failWrites.clear();
    t.clock.advance(300_000);
    await refresher(t).runOnce();
    expect(await elo(t, me.token)).toMatchObject({ stale: false, total: 2 });
    expect(t.rankingCache.rows.get(key)).toMatchObject({ lastFailedAt: null, lastError: null });
  });

  it('실패 사유는 200자까지만 저장, 응답에 나가지 않는다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    seedSeason(t, '현재', ...CURRENT);
    await refresher(t).runOnce();
    const key = tierRankingKey('lol');
    vi.spyOn(t.rankingCache, 'write').mockRejectedValue(new Error('x'.repeat(500)));
    t.clock.advance(300_000);
    await refresher(t).runOnce();
    expect(t.rankingCache.rows.get(key)?.lastError).toHaveLength(200);
    vi.restoreAllMocks();
    const text = await (await call(t, 'GET', '/rankings/tier?game=lol', me.token)).text();
    expect(text).not.toContain('xxx');
    expect(JSON.parse(text).stale).toBe(true);
  });

  it('markFailed 자체가 실패해도 다음 키로 넘어간다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    seedSeason(t, '현재', ...CURRENT);
    vi.spyOn(t.rankingCache, 'markFailed').mockRejectedValue(new Error('down'));
    t.rankingCache.failWrites.add(tierRankingKey('lol'));
    expect(await refresher(t).runOnce()).toMatchObject({ acquired: true, refreshed: 6, failed: 1 }); // S5: 활동 2개 포함
  });

  it('stale 경계: RANKING_STALE_AFTER_SEC 정확히는 아님, 1ms 뒤는 stale', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    await tier(t, me.token, 'lol');
    t.clock.advance(RANKING_STALE_AFTER_SEC * 1000);
    expect((await tier(t, me.token, 'lol')).stale).toBe(false);
    t.clock.advance(1);
    expect((await tier(t, me.token, 'lol')).stale).toBe(true);
  });
});

describe('순위 변동(7-7)', () => {
  /** 이번 주 안 시각(월요일 이후). 월요일 00:00 KST = 2026-10-25T15:00Z */
  const MONDAY = '2026-10-25T15:00:00.000Z';

  async function twoPlayers(app: TestApp) {
    const s = seedSeason(app, '현재', ...CURRENT);
    const a = await member(app, 'a');
    const b = await member(app, 'b');
    seedRating(app, a, s.id, { elo: 1500, wins: 5 });
    seedRating(app, b, s.id, { elo: 1400, wins: 5 });
    return { s, a, b };
  }

  it('첫 주는 전부 null. 5분 재계산으로 순위가 바뀌어도 같은 주 안에서는 기준 고정(값 불변)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const { s, b } = await twoPlayers(t);
    await refresher(t).runOnce();
    expect((await elo(t, me.token)).items.map((i) => i.rank_change)).toEqual([null, null]);

    const baseline = t.rankingCache.rows.get(eloRankingKey('lol', s.id));
    expect(baseline?.baselinePeriodStart.toISOString()).toBe(MONDAY);
    expect(baseline?.baselineRanks).toEqual({});

    (t.prisma.rating.rows.find((r) => r.userId === b) as { elo: number }).elo = 1600;
    for (let i = 0; i < 3; i++) {
      t.clock.advance(300_000);
      await refresher(t).runOnce();
      expect((await elo(t, me.token)).items.map((x) => [x.user.nickname, x.rank_change])).toEqual([
        ['b', null],
        ['a', null],
      ]);
    }
  });

  it('주 경계: 일요일 23:59 KST까지는 지난 기준, 월요일 00:00 KST 이후 첫 계산이 직전 스냅샷을 기준으로 삼고 한 주 동안 고정', async () => {
    t = await createTestApp({ fixedClock: '2026-10-25T14:55:00.000Z' }); // 일요일 23:55 KST
    const me = await login(t, 'me');
    const { s, a, b } = await twoPlayers(t);
    await refresher(t).runOnce();
    const key = eloRankingKey('lol', s.id);
    expect(t.rankingCache.rows.get(key)?.baselinePeriodStart.toISOString()).toBe('2026-10-18T15:00:00.000Z');

    t.clock.set('2026-10-25T14:59:59.999Z');
    (t.prisma.rating.rows.find((r) => r.userId === b) as { elo: number }).elo = 1600;
    await refresher(t).runOnce(); // 아직 일요일: 기준 그대로, 이 값이 주 마지막 스냅샷
    expect((await elo(t, me.token)).items.map((x) => [x.user.nickname, x.rank_change])).toEqual([
      ['b', null],
      ['a', null],
    ]);

    t.clock.set(MONDAY);
    await refresher(t).runOnce();
    expect(t.rankingCache.rows.get(key)).toMatchObject({ baselineRanks: { [b]: 1, [a]: 2 } });
    expect((await elo(t, me.token)).items.map((x) => [x.user.nickname, x.rank_change])).toEqual([
      ['b', 0],
      ['a', 0],
    ]);

    (t.prisma.rating.rows.find((r) => r.userId === a) as { elo: number }).elo = 1700;
    t.clock.advance(300_000);
    await refresher(t).runOnce();
    expect((await elo(t, me.token)).items.map((x) => [x.user.nickname, x.rank_change])).toEqual([
      ['a', 1],
      ['b', -1],
    ]);
    t.clock.advance(3 * 24 * 3_600_000);
    await refresher(t).runOnce();
    expect((await elo(t, me.token)).items.map((x) => x.rank_change)).toEqual([1, -1]);
  });

  it('기준에 없는 새 멤버는 null', async () => {
    t = await createTestApp({ fixedClock: '2026-10-25T14:55:00.000Z' });
    const me = await login(t, 'me');
    const { s } = await twoPlayers(t);
    await refresher(t).runOnce();
    t.clock.set(MONDAY);
    await refresher(t).runOnce();
    seedRating(t, await member(t, 'late'), s.id, { elo: 1450, wins: 5 });
    t.clock.advance(300_000);
    await refresher(t).runOnce();
    expect((await elo(t, me.token)).items.map((x) => [x.user.nickname, x.rank_change])).toEqual([
      ['a', 0],
      ['late', null],
      ['b', -1],
    ]);
  });

  it('티어 랭킹도 같은 규칙', async () => {
    t = await createTestApp({ fixedClock: '2026-10-25T14:55:00.000Z' });
    const me = await login(t, 'me');
    seedAccount(t, me.userId, { tier: 'GOLD', division: 'I' });
    await refresher(t).runOnce();
    t.clock.set(MONDAY);
    await refresher(t).runOnce();
    expect((await tier(t, me.token, 'lol')).me?.rank_change).toBe(0);
  });

  it('캐시 payload에 사용자별 값이 없고 공용 행 하나를 쓴다(D150): 두 사용자가 다른 me를 받는다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const you = await login(t, 'you');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, me.userId, s.id, { elo: 1500, wins: 5 });
    seedRating(t, you.userId, s.id, { elo: 1400, wins: 5 });
    expect((await elo(t, me.token)).me?.user.id).toBe(me.userId);
    expect((await elo(t, you.token)).me?.user.id).toBe(you.userId);
    expect(t.rankingCache.writes).toHaveLength(1);
    const payload = t.rankingCache.rows.get(eloRankingKey('lol', s.id))?.payload as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['entries']);
  });
});

describe('프로필 badges·rank(4-4)', () => {
  async function profile(app: TestApp, token: string, userId: string): Promise<GetUserProfileResponse> {
    const res = await call(app, 'GET', `/users/${userId}/profile`, token);
    expect(res.status).toBe(200);
    return GetUserProfileResponse.strict().parse(await res.json());
  }

  it('badges: 종료 처리로 받은 뱃지, earned_at DESC, 시즌·게임·순위. 비시즌 뱃지는 null', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const older = seedSeason(t, '시즌 1', '2026-01-01T00:00:00.000Z', PAST[0]);
    const newer = seedSeason(t, '시즌 2', ...PAST);
    seedRating(t, me.userId, older.id, { game: 'tft', elo: 1200, wins: 5 });
    seedRating(t, me.userId, newer.id, { elo: 1500, wins: 5 });
    await closer(t).runOnce();
    const other = t.prisma.badge.insert({ code: 'event_first', name: '첫 참가', description: '설명', condition: 'x' });
    t.prisma.userBadge.insert({ userId: me.userId, badgeId: other.id, earnedAt: new Date('2025-01-01T00:00:00Z') });

    const p = await profile(t, me.token, me.userId);
    expect(p.badges?.map((b) => [b.code, b.name, b.season?.name ?? null, b.game, b.place, b.earned_at])).toEqual([
      ['season_lol_top1', '리그 오브 레전드 시즌 1위', '시즌 2', 'lol', 1, newer.endsAt.toISOString()],
      ['season_tft_top1', '전략적 팀 전투 시즌 1위', '시즌 1', 'tft', 1, older.endsAt.toISOString()],
      ['event_first', '첫 참가', null, null, null, '2025-01-01T00:00:00.000Z'],
    ]);
  });

  it('rank: 캐시 순위. 캐시가 없으면 null이고 프로필 조회가 계산을 일으키지 않는다. 경기 수 미달도 null', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    const a = await member(t, 'a');
    seedRating(t, a, s.id, { elo: 1500, wins: 5 });
    seedRating(t, me.userId, s.id, { elo: 1421, wins: 5 });
    seedRating(t, me.userId, s.id, { game: 'tft', elo: 1100, wins: 2 });

    const before = await profile(t, me.token, me.userId);
    expect(before.scrim?.ratings.map((r) => [r.game, r.rank])).toEqual([
      ['lol', null],
      ['tft', null],
    ]);
    expect(t.rankingCache.writes).toEqual([]);

    await refresher(t).runOnce();
    const after = await profile(t, me.token, me.userId);
    expect(after.scrim?.ratings.map((r) => [r.game, r.rank])).toEqual([
      ['lol', 2],
      ['tft', null],
    ]);
  });
});
