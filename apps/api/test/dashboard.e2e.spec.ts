/**
 * S4 GET /dashboard/summary(계약 8절, D156–D158). DB 없이 FakePrisma + MemoryRankingCache.
 */
import { GetDashboardSummaryBody, GetDashboardSummaryResponse } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { eloRankingKey } from '../src/modules/rankings/ranking-keys';
import { call, expectNoExternalIds } from './support/s1-helpers';
import {
  type Who,
  approve,
  closer,
  login,
  member,
  refresher,
  seedAccount,
  seedPendingTeamResult,
  seedRating,
  seedSeason,
} from './support/s4-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-28T03:00:00.000Z'; // 수요일 12:00 KST
const CURRENT = ['2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'] as const;
const PAST = ['2026-07-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'] as const;
const HOUR = 3_600_000;

async function summary(app: TestApp, who: Who): Promise<GetDashboardSummaryResponse> {
  const res = await call(app, 'GET', '/dashboard/summary', who.token);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  expectNoExternalIds(text);
  expect(text).not.toMatch(/email|discord_id|dev-/i);
  return GetDashboardSummaryResponse.parse(GetDashboardSummaryBody.strict().parse(JSON.parse(text)));
}

function seedScrim(
  app: TestApp,
  hostId: string,
  o: { at: number; status?: 'recruiting' | 'full' | 'playing' | 'finished' | 'cancelled'; title?: string; game?: 'lol' | 'tft' } ,
) {
  return app.prisma.scrim.insert({
    gameId: app.prisma.gameId(o.game ?? 'lol'),
    hostId,
    title: o.title ?? '내전',
    scheduledAt: new Date(app.clock.now().getTime() + o.at),
    capacity: 10,
    status: o.status ?? 'recruiting',
    usePositions: false,
  });
}

const join = (app: TestApp, scrimId: string, userId: string, status: 'joined' | 'waitlist' = 'joined', i = 0) =>
  app.prisma.scrimPlayer.insert({ scrimId, userId, status, joinedAt: new Date(app.clock.now().getTime() - 3 * HOUR + i * 1000) });

describe('GET /dashboard/summary 빈 상태', () => {
  it('시즌·내전 없음: 전부 null·빈 배열, 정책값은 env', async () => {
    t = await createTestApp({
      fixedClock: NOW,
      env: {
        RANKING_ELO_MIN_GAMES: '7',
        SCRIM_ELO_K_BASE: '24',
        SCRIM_ELO_K_NEW: '30',
        SCRIM_ELO_NEW_PLAYER_GAMES: '6',
        SCRIM_ELO_LOSS_RATIO: '0.25',
      },
    });
    const me = await login(t, 'me');
    expect(await summary(t, me)).toEqual({
      season: null,
      rating_policy: {
        min_games: 7,
        k_base: 24,
        k_new: 30,
        new_player_games: 6,
        loss_ratio: 0.25,
        full_weight_games: 10,
        elo_weight_max: 0.2,
      },
      next_scrim: null,
      recruiting: [],
      stats: { recruiting_scrims: 0, scrims_this_week: 0, week_start: '2026-10-26T00:00:00.000+09:00' },
      top_rankers: null,
      top_rankers_state: 'no_season',
      recent_results: [],
      me: null,
    });
  });
});

describe('시즌 카드', () => {
  it('days_left·progress는 core 값. 시즌이 끝나면 season null(D143)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    seedSeason(t, '현재', '2026-10-01T15:00:00.000Z', '2026-11-01T15:00:00.000Z');
    const s = await summary(t, me);
    expect(s.season).toMatchObject({ name: '현재', days_left: 4 });
    expect(s.season?.progress).toBe(0.855);
    t.clock.set('2026-11-01T14:59:59.000Z');
    expect((await summary(t, me)).season).toMatchObject({ days_left: 0 });
    t.clock.set('2026-11-01T15:00:00.000Z');
    const ended = await summary(t, me);
    expect(ended.season).toBeNull();
    expect(ended.top_rankers).toMatchObject({ season: { name: '현재' }, is_final: false });
  });
});

describe('next_scrim 3경로·recruiting', () => {
  it('① joined 우선(더 늦어도), ② 없으면 시작 전 recruiting, ③ 없으면 null. 목록은 next_scrim 제외, 최대 3개', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const host = await member(t, 'host');
    const early = seedScrim(t, host, { at: HOUR, title: '이른 모집' });
    const mine = seedScrim(t, host, { at: 5 * HOUR, status: 'full', title: '내 내전' });
    join(t, mine.id, host, 'joined', 0);
    join(t, mine.id, me.userId, 'joined', 1);
    for (const i of [2, 3, 4]) seedScrim(t, host, { at: i * HOUR, title: `모집 ${i}` });

    const s = await summary(t, me);
    expect(s.next_scrim).toMatchObject({ source: 'joined', scrim: { id: mine.id, my_status: 'joined' } });
    expect(s.next_scrim?.participants.map((p) => p.nickname)).toEqual(['host', 'me']);
    expect(s.recruiting.map((r) => r.title)).toEqual(['이른 모집', '모집 2', '모집 3']);
    expect(s.stats.recruiting_scrims).toBe(5);

    const you = await login(t, 'you');
    const y = await summary(t, you);
    expect(y.next_scrim).toMatchObject({ source: 'recruiting', scrim: { id: early.id, my_status: null } });
    expect(y.next_scrim?.participants).toEqual([]);
    expect(y.recruiting.map((r) => r.title)).toEqual(['모집 2', '모집 3', '모집 4']);

    for (const r of t.prisma.scrim.rows) r.status = 'cancelled';
    const none = await summary(t, you);
    expect(none.next_scrim).toBeNull();
    expect(none.recruiting).toEqual([]);
  });

  it('시작 시각이 지난 joined 내전은 남는다, 시작 지난 recruiting은 2번 경로 대상이 아니다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const host = await member(t, 'host');
    const past = seedScrim(t, host, { at: -10 * 60_000, title: '시작 지남' });
    expect((await summary(t, me)).next_scrim).toBeNull();
    join(t, past.id, me.userId);
    expect((await summary(t, me)).next_scrim).toMatchObject({ source: 'joined', scrim: { id: past.id } });
  });

  it('waitlist·playing은 다음 내전이 아니다(D158)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const host = await member(t, 'host');
    const wait = seedScrim(t, host, { at: HOUR, status: 'full' });
    join(t, wait.id, me.userId, 'waitlist');
    const playing = seedScrim(t, host, { at: -HOUR, status: 'playing' });
    join(t, playing.id, me.userId);
    expect((await summary(t, me)).next_scrim).toBeNull();
  });

  it('participants는 슬롯 순서(방장 먼저) 앞 6명, joined_count는 전체', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const host = await member(t, 'host');
    const s = seedScrim(t, host, { at: HOUR });
    join(t, s.id, me.userId, 'joined', 0);
    for (let i = 1; i <= 7; i++) join(t, s.id, await member(t, `m${i}`), 'joined', i);
    join(t, s.id, host, 'joined', 99);
    const r = await summary(t, me);
    expect(r.next_scrim?.participants.map((p) => p.nickname)).toEqual(['host', 'me', 'm1', 'm2', 'm3', 'm4']);
    expect(r.next_scrim?.scrim.joined_count).toBe(9);
  });
});

describe('stats 주 경계', () => {
  it('KST 월요일 00:00 시작, 끝은 제외, cancelled 제외', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const host = await member(t, 'host');
    const at = (iso: string, status?: 'cancelled' | 'finished') =>
      t?.prisma.scrim.insert({
        gameId: t.prisma.gameId('lol'),
        hostId: host,
        title: 'x',
        scheduledAt: new Date(iso),
        capacity: 10,
        status: status ?? 'finished',
      });
    at('2026-10-25T14:59:59.999Z'); // 일요일 23:59 KST: 지난 주
    at('2026-10-25T15:00:00.000Z'); // 월요일 00:00 KST: 이번 주
    at('2026-11-01T14:59:59.999Z'); // 다음 일요일: 이번 주
    at('2026-11-01T15:00:00.000Z'); // 다음 월요일: 다음 주
    at('2026-10-27T00:00:00.000Z', 'cancelled');
    const s = await summary(t, me);
    expect(s.stats).toEqual({ recruiting_scrims: 0, scrims_this_week: 2, week_start: '2026-10-26T00:00:00.000+09:00' });
  });
});

describe('top_rankers·me', () => {
  it('top_rankers: sort_order 순으로 행이 있는 첫 게임, 최대 5명', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    for (let i = 0; i < 6; i++) seedRating(t, await member(t, `m${i}`), s.id, { game: 'tft', elo: 1100 + i, wins: 5 });
    const r = await summary(t, me);
    expect(r.top_rankers).toMatchObject({ game: 'tft', is_final: false, season: { id: s.id }, synced_at: NOW, stale: false });
    expect(r.top_rankers?.items.map((i) => i.user.nickname)).toEqual(['m5', 'm4', 'm3', 'm2', 'm1']);
  });

  it('전부 비면 첫 게임 + items [], 시즌이 끝나고 닫혔으면 is_final', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '지난', ...PAST);
    const empty = await summary(t, me);
    expect(empty.top_rankers).toMatchObject({ game: 'lol', items: [], is_final: false });

    seedRating(t, me.userId, s.id, { game: 'tft', elo: 1200, wins: 5 });
    t.rankingCache.rows.clear();
    await closer(t).runOnce();
    const final = await summary(t, me);
    expect(final.season).toBeNull();
    expect(final.top_rankers).toMatchObject({ game: 'tft', is_final: true, stale: false, synced_at: NOW });
    expect(final.me).toBeNull();
    expect(final.top_rankers_state).toBe('ready');
  });

  it('첫 계산 실패는 요약 200·unavailable. 시즌·통계·me는 남고, 풀면 ready(21절)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, me.userId, s.id, { elo: 1300, wins: 5 });
    t.rankingCache.failWrites.add(eloRankingKey('lol', s.id));
    const failed = await summary(t, me);
    expect(failed.top_rankers_state).toBe('unavailable');
    expect(failed.top_rankers).toBeNull();
    expect(failed.season?.name).toBe('현재');
    expect(failed.stats.week_start).toBe('2026-10-26T00:00:00.000+09:00');
    expect(failed.me).toEqual({ game: 'lol', elo: 1300, rank: null, games: 5 });

    t.rankingCache.failWrites.clear();
    const again = await summary(t, me);
    expect(again.top_rankers_state).toBe('ready');
    expect(again.top_rankers?.game).toBe('lol');
    expect(again.me).toMatchObject({ elo: 1300, rank: 1 });
  });

  it('앞 게임이 비어 있고 다음 게임 계산이 실패하면 빈 블록으로 대체하지 않는다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    t.rankingCache.failWrites.add(eloRankingKey('tft', s.id));
    const r = await summary(t, me);
    expect(r.top_rankers_state).toBe('unavailable');
    expect(r.top_rankers).toBeNull();
    expect(r.season?.name).toBe('현재');
  });

  it('games 행이 없으면 unavailable, 시즌도 없으면 no_season이 우선', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    t.prisma.game.rows.splice(0);
    const noGames = await summary(t, me);
    expect(noGames.top_rankers_state).toBe('unavailable');
    expect(noGames.top_rankers).toBeNull();
    expect(noGames.season?.id).toBe(s.id);

    t.prisma.season.rows.splice(0);
    expect((await summary(t, me)).top_rankers_state).toBe('no_season');
  });

  it('me: 현재 시즌 경기 수 최다 게임, 같으면 sort_order, 캐시의 elo·rank 사용', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, await member(t, 'a'), s.id, { game: 'tft', elo: 1500, wins: 9 });
    const lol = seedRating(t, me.userId, s.id, { game: 'lol', elo: 1300, wins: 3, losses: 2 });
    seedRating(t, me.userId, s.id, { game: 'tft', elo: 1421, wins: 6, losses: 2 });
    await refresher(t).runOnce();
    lol.elo = 1;
    (t.prisma.rating.rows.find((r) => r.userId === me.userId && r.gameId === t?.prisma.gameId('tft')) as { elo: number }).elo = 9999;
    expect((await summary(t, me)).me).toEqual({ game: 'tft', elo: 1421, rank: 2, games: 8 });

    t.prisma.rating.rows.filter((r) => r.userId === me.userId).forEach((r) => Object.assign(r, { wins: 3, losses: 2 }));
    expect((await summary(t, me)).me?.game).toBe('lol');
  });

  it('me: 순위권 밖이면 ratings 값·rank null, 시즌 행이 없으면 null', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const you = await login(t, 'you');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, me.userId, s.id, { elo: 1100, wins: 2, losses: 1 });
    expect((await summary(t, me)).me).toEqual({ game: 'lol', elo: 1100, rank: null, games: 3 });
    expect((await summary(t, you)).me).toBeNull();
  });
});

describe('recent_results', () => {
  it('approved + pending 병합, at DESC, 앞 4개. 팀·개인 outcome, rating_status, elo_swing', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin', 'admin');
    const me = await login(t, 'me');
    const a = await member(t, 'a');
    const b = await member(t, 'b');
    seedSeason(t, '현재', ...CURRENT);

    const applied = seedPendingTeamResult(t, [a], [b], { title: '반영', winner: 'orange' });
    expect((await approve(t, admin, applied)).status).toBe(200);
    t.clock.advance(1000);
    const notRated = seedPendingTeamResult(t, [a], [b], { title: '미반영', rated: false });
    expect((await approve(t, admin, notRated)).status).toBe(200);
    t.clock.advance(1000);
    const skipped = seedPendingTeamResult(t, [a], [b], { title: '스킵' });
    t.prisma.scrimPlayer.rows.filter((p) => p.scrimId === skipped.scrimId && p.userId === b).forEach((p) => Object.assign(p, { team: null }));
    expect((await approve(t, admin, skipped)).status).toBe(200);
    t.clock.advance(1000);
    seedPendingTeamResult(t, [a], [b], { title: '대기' });
    t.clock.advance(1000);
    const tft = t.prisma.scrim.insert({
      gameId: t.prisma.gameId('tft'),
      hostId: a,
      title: '롤체',
      scheduledAt: t.clock.now(),
      capacity: 8,
      status: 'playing',
    });
    t.prisma.scrimResult.insert({
      scrimId: tft.id,
      status: 'pending',
      placements: [
        { user_id: a, placement: 2 },
        { user_id: b, placement: 1 },
      ],
      submittedById: a,
      createdAt: t.clock.now(),
    });

    const r = await summary(t, me);
    expect(
      r.recent_results.map((x) => [x.title, x.result_status, x.outcome.winner_team, x.outcome.winner?.nickname ?? null, x.rating_status, x.elo_swing]),
    ).toEqual([
      ['롤체', 'pending', null, 'b', 'waiting', null],
      ['대기', 'pending', 'blue', null, 'waiting', null],
      ['스킵', 'approved', 'blue', null, 'skipped', null],
      ['미반영', 'approved', 'blue', null, 'not_rated', null],
    ]);
    expect(r.recent_results[0]?.game).toMatchObject({ code: 'tft', has_teams: false });

    // 뒤 행을 밀어내 applied 확인
    t.prisma.scrimResult.rows = t.prisma.scrimResult.rows.filter((x) => x.scrimId === applied.scrimId);
    const only = await summary(t, me);
    const swing = t.prisma.ratingHistory.rows.map((h) => Math.abs(h.eloAfter - h.eloBefore));
    expect(only.recent_results).toMatchObject([{ title: '반영', rating_status: 'applied', elo_swing: Math.max(...swing) }]);
    expect(only.recent_results[0]?.at).toBe(new Date(NOW).toISOString());
  });
});

describe('사용자별 값 분리(D156)', () => {
  it('두 사용자가 번갈아 조회해도 next_scrim·my_status·me가 섞이지 않고, ELO 캐시 행은 공용 1개', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const a = await login(t, 'alice');
    const b = await login(t, 'bob');
    const s = seedSeason(t, '현재', ...CURRENT);
    seedRating(t, a.userId, s.id, { elo: 1500, wins: 5 });
    seedRating(t, b.userId, s.id, { elo: 1400, wins: 5 });
    const host = await member(t, 'host');
    const sa = seedScrim(t, host, { at: HOUR, title: 'A의 내전' });
    const sb = seedScrim(t, host, { at: 2 * HOUR, title: 'B의 내전' });
    join(t, sa.id, a.userId);
    join(t, sb.id, b.userId);

    for (let i = 0; i < 2; i++) {
      const ra = await summary(t, a);
      const rb = await summary(t, b);
      expect(ra.next_scrim?.scrim.id).toBe(sa.id);
      expect(rb.next_scrim?.scrim.id).toBe(sb.id);
      expect(ra.next_scrim?.scrim.my_status).toBe('joined');
      expect(ra.recruiting.map((x) => [x.id, x.my_status])).toEqual([[sb.id, null]]);
      expect(rb.recruiting.map((x) => [x.id, x.my_status])).toEqual([[sa.id, null]]);
      expect(ra.me).toMatchObject({ elo: 1500, rank: 1 });
      expect(rb.me).toMatchObject({ elo: 1400, rank: 2 });
    }
    expect(t.rankingCache.writes.filter((k) => k === eloRankingKey('lol', s.id))).toHaveLength(1);
  });

  it('모집 인원은 캐시되지 않는다: 참가 직후 요청에 반영', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const a = await login(t, 'alice');
    const host = await member(t, 'host');
    const s = seedScrim(t, host, { at: HOUR });
    expect((await summary(t, a)).next_scrim?.scrim.joined_count).toBe(0);
    join(t, s.id, await member(t, 'x'));
    expect((await summary(t, a)).next_scrim?.scrim.joined_count).toBe(1);
  });

  it('티어 계정이 있어도 응답에 외부 식별자가 없다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const a = await login(t, 'alice');
    seedAccount(t, a.userId, { tier: 'GOLD', division: 'I' });
    await summary(t, a);
  });
});
