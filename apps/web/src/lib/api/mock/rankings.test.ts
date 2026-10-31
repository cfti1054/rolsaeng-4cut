import {
  ApiPath,
  DevLoginResponse,
  GetDashboardSummaryResponse,
  GetEloRankingResponse,
  GetTierRankingResponse,
  GetUserProfileResponse,
  GAME_SEED,
  ListSeasonsResponse,
  fillPath,
} from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { createMockBackend, type MockDb } from './backend';
import { baselineEloRanks, mockProfileBadges, type MockRankingScenario } from './rankings';
import type { MockHistory, S3Data } from './ratings';

/** S4 목이 계약을 지키는지: 실제 클라이언트(zod parse)로 호출 */
async function setup(scenario: MockRankingScenario | null = null) {
  let db: MockDb | null = null;
  const now = Date.parse('2026-10-28T03:00:00.000Z');
  const mock = createMockBackend({
    storage: { get: () => db, set: (d) => (db = d) },
    cookies: { hasRefresh: () => true, setRefresh: () => {}, clearRefresh: () => {} },
    now: () => now,
    s1: { origin: () => 'http://localhost:3000' },
    s2: { rankings: { scenario: () => scenario } },
  });
  const api = createApiClient({ fetch: mock.fetch });
  const res = await api.request(ApiPath.authDevLogin, DevLoginResponse, { method: 'POST', body: { username: 'host_kim' }, auth: false });
  api.setSession(res);
  return {
    api,
    me: res.user,
    db: () => db!,
    tier: (game: string) => api.request(`${ApiPath.rankingsTier}?game=${game}`, GetTierRankingResponse),
    elo: (game: string, season?: string) => api.request(`${ApiPath.rankingsElo}?game=${game}${season ? `&season=${season}` : ''}`, GetEloRankingResponse),
    summary: () => api.request(ApiPath.dashboardSummary, GetDashboardSummaryResponse),
    seasons: () => api.request(ApiPath.seasons, ListSeasonsResponse),
    profile: (id: string) => api.request(fillPath(ApiPath.userProfile, { id }), GetUserProfileResponse),
  };
}

describe('S4 목: 랭킹', () => {
  it('티어: 점수 내림차순·순위 1씩, 내 행, 언랭 제외, 시즌 없는 경우와 무관', async () => {
    const t = await setup();
    const r = await t.tier('lol');
    expect(r.items.map((e) => e.rank)).toEqual(r.items.map((_, i) => i + 1));
    expect(r.items[0]).toMatchObject({ score: 2645, tier: 'DIAMOND', division: 'II', lp: 45 });
    expect(r.items.some((e) => e.user.nickname === '칼바람러')).toBe(false);
    expect(r.me?.user.id).toBe(t.me.id);
    expect(r.me?.score).toBe(2112);
    expect(r.total).toBe(r.items.length);
    expect(r.next_cursor).toBeNull();
    expect(r.items.some((e) => e.rank_change === null)).toBe(true);
    expect(r.items.some((e) => (e.rank_change ?? 0) > 0)).toBe(true);
  });

  it('티어: steam은 VALIDATION_FAILED', async () => {
    const t = await setup();
    await expect(t.tier('steam')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('ELO 기본 시즌: 5경기 이상만, rating 내림차순, is_final false, synced_at 5분 단위', async () => {
    const t = await setup();
    const r = await t.elo('lol');
    expect(r.season?.name).toBe('시즌 2');
    expect(r.is_final).toBe(false);
    expect(r.min_games).toBe(5);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((e) => e.games >= r.min_games)).toBe(true);
    const elos = r.items.map((e) => e.elo);
    expect([...elos].sort((a, b) => b - a)).toEqual(elos);
    expect(Date.parse(r.synced_at!) % 300_000).toBe(0);
    expect(r.stale).toBe(false);
  });

  it('ELO 순위 변동 = 이번 KST 주 시작 순위 − 현재 순위(이력으로 되짚음)', async () => {
    const t = await setup();
    const before = await t.elo('lol');
    expect(before.items.every((e) => e.rank_change === 0)).toBe(true);
    const myRank = before.me!.rank;
    // 이번 주에 내 레이팅만 오른 상황: 이력은 그대로, 현재 값만 1위로 올린다
    const row = t.db().s2!.ratings.find((r) => r.user_id === t.me.id && r.game === 'lol' && r.season_id === before.season!.id)!;
    row.elo = before.items[0]!.elo + 1;
    const after = await t.elo('lol');
    expect(after.me).toMatchObject({ rank: 1, rank_change: myRank - 1 });
    expect(after.items[1]!.rank_change).toBe(-1);
  });

  it('ELO 끝난 시즌: is_final, rank_change 전부 null, stale false', async () => {
    const t = await setup();
    const s1 = (await t.seasons()).items.find((s) => s.name === '시즌 1')!;
    const r = await t.elo('lol', s1.id);
    expect(r.is_final).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((e) => e.rank_change === null)).toBe(true);
    expect(r.stale).toBe(false);
  });

  it('ELO 없는 시즌 id → NOT_FOUND', async () => {
    const t = await setup();
    await expect(t.elo('lol', '11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('stale 시나리오: synced_at은 남고 stale true', async () => {
    const t = await setup('stale');
    const r = await t.tier('lol');
    expect(r.stale).toBe(true);
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('me_outside: 내 행은 items 밖, me로만 온다', async () => {
    const t = await setup('me_outside');
    const r = await t.elo('lol');
    expect(r.items.some((e) => e.user.id === t.me.id)).toBe(false);
    expect(r.me?.user.id).toBe(t.me.id);
    expect(r.total).toBe(r.items.length + 1);
  });

  it('시나리오는 GET /seasons에도 적용된다', async () => {
    expect((await (await setup('no_season')).seasons()).items).toEqual([]);
    const final = (await (await setup('final')).seasons()).items;
    expect(final.map((s) => [s.name, s.is_current])).toEqual([['시즌 1', false]]);
  });

  it('시드 이력은 시간순이라 그래프 마지막 값 = 시즌 최종 값', async () => {
    const t = await setup();
    const s1 = (await t.seasons()).items.find((s) => s.name === '시즌 1')!;
    const final = await t.elo('lol', s1.id);
    const history = t.db().s2!.history.filter((h) => h.season_id === s1.id && h.game === 'lol');
    for (const e of final.items) {
      const mine = history.filter((h) => h.user_id === e.user.id);
      expect(mine.map((h) => Date.parse(h.created_at))).toEqual(mine.map((h) => Date.parse(h.created_at)).sort((a, b) => a - b));
      expect(mine[mine.length - 1]!.elo_after).toBe(e.elo);
    }
  });

  it('no_season: 시즌·목록·시각 모두 비어 있다', async () => {
    const t = await setup('no_season');
    const r = await t.elo('lol');
    expect(r).toMatchObject({ season: null, items: [], me: null, synced_at: null, stale: false, is_final: false });
  });

  it('error: 세 엔드포인트 INTERNAL_ERROR', async () => {
    const t = await setup('error');
    await expect(t.tier('lol')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(t.elo('lol')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(t.summary()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});

describe('S4 목: 주 시작 기준 순위', () => {
  it('승패는 delta 부호가 아니라 outcome으로 센다(승리로 세는 음수 변동)', () => {
    const season = { id: '11111111-1111-4111-8111-111111111111', name: '시즌 1', starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2026-12-01T00:00:00.000Z' };
    const A = '22222222-2222-4222-8222-222222222222';
    const B = '33333333-3333-4333-8333-333333333333';
    const row = (user_id: string, n: number, outcome: 'win' | 'loss', delta: number): MockHistory => ({
      id: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`,
      user_id,
      game: 'lol',
      season_id: season.id,
      scrim_id: season.id,
      result_id: season.id,
      elo_before: 1000,
      elo_after: 1000,
      delta,
      k_factor: 32,
      outcome,
      created_at: `2026-02-${String(n).padStart(2, '0')}T00:00:00.000Z`,
    });
    // 같은 점수·같은 경기 수. A는 승리지만 변동이 음수인 경기가 많아 부호로 세면 B가 앞선다
    const history = [
      ...[1, 2, 3].map((n) => row(A, n, 'win', -1)),
      ...[4, 5].map((n) => row(A, n, 'loss', 0)),
      ...[6, 7].map((n) => row(B, n, 'win', 8)),
      ...[8, 9, 10].map((n) => row(B, n, 'loss', -1)),
    ];
    const st: S3Data = { results: [], seasons: [season], ratings: [], history };
    expect(baselineEloRanks(st, 'lol', season, Date.parse('2026-03-01T00:00:00.000Z'))).toEqual({ [A]: 1, [B]: 2 });
  });
});

describe('S4 목: 요약', () => {
  it('시즌·정책·통계·상위 랭커·내 ELO', async () => {
    const t = await setup();
    const d = await t.summary();
    expect(d.season?.name).toBe('시즌 2');
    expect(d.season!.days_left).toBeGreaterThan(0);
    expect(d.rating_policy).toEqual({ soft_reset_ratio: 0.5, min_games: 5, k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5 });
    expect(d.stats.recruiting_scrims).toBeGreaterThan(d.recruiting.length);
    expect(d.stats.scrims_this_week).toBeGreaterThan(0);
    expect(d.top_rankers?.game).toBe('lol');
    expect(d.top_rankers?.is_final).toBe(false);
    expect(d.top_rankers!.items.length).toBeLessThanOrEqual(5);
    expect(d.me).toMatchObject({ game: 'lol' });
    expect(d.me!.rank).toBeGreaterThanOrEqual(1);
  });

  it('다음 내전 = 내가 joined인 가장 빠른 내전, 모집 목록에서 빠진다', async () => {
    const t = await setup();
    const d = await t.summary();
    expect(d.next_scrim).toMatchObject({ source: 'joined', scrim: { title: '골드 이하 초보 환영 내전' } });
    expect(d.next_scrim!.participants.length).toBeLessThanOrEqual(6);
    expect(d.recruiting.some((s) => s.id === d.next_scrim!.scrim.id)).toBe(false);
  });

  it('최근 결과: 최대 4개, 시각 내림차순, 승인 대기 포함, 스윙은 팀 게임 applied만', async () => {
    const t = await setup();
    const { recent_results: rs } = await t.summary();
    expect(rs).toHaveLength(4);
    expect(rs.map((r) => Date.parse(r.at))).toEqual([...rs.map((r) => Date.parse(r.at))].sort((a, b) => b - a));
    expect(rs.some((r) => r.result_status === 'pending' && r.rating_status === 'waiting')).toBe(true);
    for (const r of rs) expect(r.elo_swing !== null).toBe(r.rating_status === 'applied' && r.game.has_teams);
  });

  it('final 시나리오: 현재 시즌 없음 → 사이드바 null, 상위 랭커는 지난 시즌 최종, me null', async () => {
    const t = await setup('final');
    const d = await t.summary();
    expect(d.season).toBeNull();
    expect(d.me).toBeNull();
    expect(d.top_rankers).toMatchObject({ is_final: true, season: { name: '시즌 1' } });
    expect(d.top_rankers!.items.length).toBeGreaterThan(0);
    expect((await t.elo('lol')).is_final).toBe(true);
  });

  it('no_season: top_rankers null, 카드는 남는다', async () => {
    const t = await setup('no_season');
    const d = await t.summary();
    expect(d).toMatchObject({ season: null, top_rankers: null, me: null });
  });

  it('empty: 다음 내전·모집·결과 없음, 숫자 0', async () => {
    const t = await setup('empty');
    const d = await t.summary();
    expect(d).toMatchObject({ next_scrim: null, recruiting: [], recent_results: [], me: null });
    expect(d.stats).toMatchObject({ recruiting_scrims: 0, scrims_this_week: 0 });
    expect(d.top_rankers?.items).toEqual([]);
  });
});

describe('S4 목: 프로필', () => {
  it('badges는 항상 배열, 내 레이팅 rank = 랭킹 순위', async () => {
    const t = await setup();
    const p = await t.profile(t.me.id);
    expect(Array.isArray(p.badges)).toBe(true);
    const lol = p.scrim!.ratings.find((r) => r.game === 'lol')!;
    const elo = await t.elo('lol');
    expect(lol.rank).toBe(elo.me!.rank);
  });

  it('지난 시즌 1·2·3위에게 게임별 시즌 뱃지, 그 밖의 멤버는 없음', async () => {
    const t = await setup();
    const now = Date.parse('2026-10-28T03:00:00.000Z');
    const s1 = (await t.seasons()).items.find((s) => s.name === '시즌 1')!;
    const items = (await t.elo('lol', s1.id)).items;
    const badgesOf = (userId: string) => mockProfileBadges(t.db().s2!, { userId, now, games: GAME_SEED, scenario: null });
    for (const e of items.slice(0, 3)) {
      expect(badgesOf(e.user.id)).toEqual([
        expect.objectContaining({ code: `season_lol_top${e.rank}`, place: e.rank, game: 'lol', earned_at: s1.ends_at, season: expect.objectContaining({ id: s1.id }) }),
      ]);
    }
    expect(badgesOf(items[3]!.user.id)).toEqual([]);
  });
});
