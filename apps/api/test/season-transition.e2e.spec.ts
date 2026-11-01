/**
 * S4 시즌 전환: 새 행 시작값(20절, 전원 RATING_START_ELO), 승인 7c·9단계(6-2), 시즌 종료(6-3), 뱃지(6-4), 경합 시나리오(6-5),
 * 읽기 실력값(D160·D187: 현재 시즌 경기 수로 w).
 * DB 없이 FakePrisma. 실제 행 잠금 대기는 test/db/season-close.db.e2e.spec.ts(PostgreSQL 필요).
 */
import { RATING_START_ELO, type ScrimDetail, seasonBadgeCode } from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import {
  type Who,
  approve,
  closer,
  login,
  member,
  ratingOf,
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
  vi.restoreAllMocks();
});

const NOW = '2026-10-28T03:00:00.000Z';
const Q2 = ['2026-07-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z'] as const;
const Q3 = ['2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'] as const;

async function setup(env?: Record<string, string>) {
  t = await createTestApp({ fixedClock: NOW, env });
  const admin = await login(t, 'admin', 'admin');
  const blue = await member(t, 'blue1');
  const orange = await member(t, 'orange1');
  return { app: t, admin, blue, orange };
}

async function approveOk(app: TestApp, admin: Who, blue: string, orange: string) {
  const ids = seedPendingTeamResult(app, [blue], [orange]);
  const res = await approve(app, admin, ids);
  expect(res.status).toBe(200);
  return ids;
}

describe('6-1 시작값(승인으로 새 시즌 첫 행 생성, 20절: 티어·이전 시즌 무관 RATING_START_ELO)', () => {
  const eloBefore = (app: TestApp, userId: string) => app.prisma.ratingHistory.rows.find((h) => h.userId === userId)?.eloBefore;

  it.each([
    ['5경기 이상 1421', 1421, 15, 10],
    ['5경기 미만 1512', 1512, 1, 1],
    ['1000 미만 800', 800, 5, 5],
  ])('지난 시즌 행이 있어도 새 시즌 첫 행 = 1000, carried null — %s', async (_n, elo, wins, losses) => {
    const { app, admin, blue, orange } = await setup();
    const prev = seedSeason(app, '시즌 1', ...Q2);
    const cur = seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, prev.id, { elo, wins, losses });
    await approveOk(app, admin, blue, orange);
    expect(eloBefore(app, blue)).toBe(RATING_START_ELO);
    expect(ratingOf(app, blue, cur.id)?.carriedFromSeasonId).toBeNull();
    expect(ratingOf(app, blue, prev.id)).toMatchObject({ elo, wins, losses });
  });

  it('다이아 신규(이전 시즌 없음)도 1000. 지난 시즌 상위권과 같은 자리에서 시작', async () => {
    const { app, admin, blue, orange } = await setup();
    const prev = seedSeason(app, '시즌 1', ...Q2);
    const cur = seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, prev.id, { elo: 1600, wins: 10 });
    seedAccount(app, orange, { tier: 'DIAMOND', division: 'II' });
    await approveOk(app, admin, blue, orange);
    expect([eloBefore(app, blue), eloBefore(app, orange)]).toEqual([1000, 1000]);
    expect([ratingOf(app, blue, cur.id)?.carriedFromSeasonId, ratingOf(app, orange, cur.id)?.carriedFromSeasonId]).toEqual([null, null]);
  });

  it('연속 빈 시즌 뒤 자동 생성 시즌(6-5 #10)도 1000, carried null', async () => {
    const { app, admin, blue, orange } = await setup();
    const old = seedSeason(app, '시즌 1', '2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z');
    seedRating(app, blue, old.id, { elo: 1500, wins: 5 });
    await approveOk(app, admin, blue, orange);
    const created = app.prisma.season.rows.find((s) => s.id !== old.id);
    expect(created).toBeDefined();
    expect(ratingOf(app, blue, created?.id as string)).toMatchObject({ carriedFromSeasonId: null });
    expect(eloBefore(app, blue)).toBe(1000);
  });

  it('현재 시즌에 이미 있는 행(예전 규칙 1800)은 다시 계산하지 않고 이어지며, 새 멤버만 1000(D193)', async () => {
    const { app, admin, blue, orange } = await setup();
    const prev = seedSeason(app, '시즌 1', ...Q2);
    const cur = seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, cur.id, { elo: 1800, wins: 3, losses: 2 });
    seedRating(app, orange, prev.id, { elo: 1700, wins: 10 });
    seedAccount(app, orange, { tier: 'DIAMOND', division: 'II' });
    await approveOk(app, admin, blue, orange);
    expect([eloBefore(app, blue), eloBefore(app, orange)]).toEqual([1800, 1000]);
    expect(ratingOf(app, blue, cur.id)).toMatchObject({ wins: 4, losses: 2 });
    expect(app.prisma.rating.rows.filter((r) => r.seasonId === cur.id)).toHaveLength(2);

    const first = ratingOf(app, orange, cur.id)?.elo as number;
    await approveOk(app, admin, blue, orange);
    expect(app.prisma.ratingHistory.rows.filter((h) => h.userId === orange)[1]?.eloBefore).toBe(first);
    expect(app.prisma.rating.rows.filter((r) => r.seasonId === cur.id)).toHaveLength(2);
  });

  it('승인은 현재 시즌 ratings 행만 읽고, 새 행에 carriedFromSeasonId를 쓰지 않는다', async () => {
    const { app, admin, blue, orange } = await setup();
    const prev = seedSeason(app, '시즌 1', ...Q2);
    const cur = seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, prev.id, { elo: 1600, wins: 10 });
    const ids = seedPendingTeamResult(app, [blue], [orange]);
    const reads: unknown[] = [];
    const writes: unknown[] = [];
    const { findMany, createMany } = app.prisma.rating;
    vi.spyOn(app.prisma.rating, 'findMany').mockImplementation((args) => {
      reads.push(args?.where?.seasonId);
      return findMany(args);
    });
    vi.spyOn(app.prisma.rating, 'createMany').mockImplementation((args) => {
      writes.push(args.data);
      return createMany(args);
    });
    expect((await approve(app, admin, ids)).status).toBe(200);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((id) => id === cur.id)).toBe(true);
    const lolId = app.prisma.gameId('lol');
    expect(writes.flat()).toHaveLength(2);
    expect(writes.flat()).toEqual(
      expect.arrayContaining([blue, orange].map((u) => ({ userId: u, gameId: lolId, seasonId: cur.id, elo: 1000 }))),
    );
  });

  it('없어진 SEASON_SOFT_RESET_RATIO가 env에 남아 있어도 기동되고 시작값은 1000(20-2)', async () => {
    const { app, admin, blue, orange } = await setup({ SEASON_SOFT_RESET_RATIO: '0.25' });
    const prev = seedSeason(app, '시즌 1', ...Q2);
    seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, prev.id, { elo: 1400 });
    await approveOk(app, admin, blue, orange);
    expect(eloBefore(app, blue)).toBe(1000);
  });
});

describe('6-2 승인 7c', () => {
  it('시즌 행 FOR SHARE는 사용자 잠금 뒤, ratings 쓰기 전(순서는 rawCalls + rating 쓰기 기록)', async () => {
    const { app, admin, blue, orange } = await setup();
    const cur = seedSeason(app, '시즌 2', ...Q3);
    const ids = seedPendingTeamResult(app, [blue], [orange]);
    app.prisma.rawCalls = [];
    // rating 쓰기를 raw 호출과 같은 기록에 끼워 넣어 순서를 한 줄로 비교한다
    const record = (sql: string) => app.prisma.rawCalls.push({ sql, values: [] });
    const { createMany, update } = app.prisma.rating;
    vi.spyOn(app.prisma.rating, 'createMany').mockImplementation((args) => {
      record('rating.createMany');
      return createMany(args);
    });
    vi.spyOn(app.prisma.rating, 'update').mockImplementation((args) => {
      record('rating.update');
      return update(args);
    });
    expect((await approve(app, admin, ids)).status).toBe(200);
    const sqls = app.prisma.rawCalls.map((r) => r.sql);
    const share = sqls.findIndex((s) => /FROM seasons WHERE id/.test(s) && /FOR SHARE/.test(s));
    const lastUserLock = sqls.findLastIndex((s) => /pg_advisory_xact_lock\(hashtext\(.*\), hashtext/.test(s));
    const firstRatingWrite = sqls.findIndex((s) => s.startsWith('rating.'));
    expect(lastUserLock).toBeGreaterThanOrEqual(0);
    expect(sqls[firstRatingWrite]).toBe('rating.createMany'); // 새 시즌 첫 행 경로를 실제로 지났는지
    expect(share).toBeGreaterThan(lastUserLock);
    expect(share).toBeLessThan(firstRatingWrite);
    expect(app.prisma.rawCalls[share]?.values).toEqual([cur.id]);
  });

  it('시나리오 4: 닫힌 시즌 승인 → 500, 전체 롤백, 결과 pending 유지. 시즌이 지난 뒤 재시도하면 다음 시즌에 반영', async () => {
    const { app, admin, blue, orange } = await setup();
    const closed = seedSeason(app, '시즌 1', ...Q3, '2026-10-20T00:00:00.000Z');
    const ids = seedPendingTeamResult(app, [blue], [orange]);
    const err = await expectError(await approve(app, admin, ids), 500, 'INTERNAL_ERROR');
    expect(err.message).not.toContain(closed.id); // 상세는 로그만
    expect(app.prisma.scrimResult.rows[0]).toMatchObject({ status: 'pending', approvedAt: null });
    expect(app.prisma.scrim.rows[0]?.status).toBe('playing');
    expect(app.prisma.rating.rows).toEqual([]);
    expect(app.prisma.ratingHistory.rows).toEqual([]);

    app.clock.set('2027-01-02T00:00:00.000Z');
    expect((await approve(app, admin, ids)).status).toBe(200);
    const next = app.prisma.season.rows.find((s) => s.id !== closed.id);
    expect(app.prisma.ratingHistory.rows[0]?.seasonId).toBe(next?.id);
  });

  it('rated=false 승인은 시즌을 건드리지 않는다(반영 없음 경로 그대로)', async () => {
    const { app, admin, blue, orange } = await setup();
    seedSeason(app, '시즌 1', ...Q3, '2026-10-20T00:00:00.000Z');
    const ids = seedPendingTeamResult(app, [blue], [orange], { rated: false });
    expect((await approve(app, admin, ids)).status).toBe(200);
  });
});

/** 시즌 S에 멤버 3명을 뛰게 한 상태 */
async function seasonWithPlayers(app: TestApp) {
  const s = seedSeason(app, '시즌 1', ...Q2);
  const a = await member(app, 'a');
  const b = await member(app, 'b');
  const c = await member(app, 'c');
  seedRating(app, a, s.id, { elo: 1400, wins: 8, losses: 2 });
  seedRating(app, b, s.id, { elo: 1300, wins: 6, losses: 4 });
  seedRating(app, c, s.id, { elo: 1200, wins: 3, losses: 3 });
  return { s, a, b, c };
}

const standingsOf = (app: TestApp, seasonId: string) =>
  app.prisma.seasonStanding.rows
    .filter((r) => r.seasonId === seasonId)
    .sort((x, y) => x.rank - y.rank)
    .map((r) => ({ userId: r.userId, rank: r.rank, elo: r.elo, wins: r.wins, losses: r.losses }));

describe('6-3 시즌 종료 작업', () => {
  it('끝난 시즌 종료: standings·뱃지·closed_at. ratings는 쓰지 않고 다음 시즌도 만들지 않는다', async () => {
    const { app } = await setup();
    const { s, a, b, c } = await seasonWithPlayers(app);
    const ratingsBefore = app.prisma.rating.snapshot();
    const run = await closer(app).runOnce();
    expect(run).toEqual({ acquired: true, closed: 1, skipped: 0, failed: 0 });
    expect(standingsOf(app, s.id).map((r) => [r.userId, r.rank])).toEqual([
      [a, 1],
      [b, 2],
      [c, 3],
    ]);
    expect(app.prisma.season.rows[0]?.closedAt).toEqual(app.clock.now());
    expect(app.prisma.rating.rows).toEqual(ratingsBefore);
    expect(app.prisma.season.rows).toHaveLength(1);
    const codes = app.prisma.userBadge.rows.map((u) => [
      u.userId,
      app.prisma.badge.rows.find((b2) => b2.id === u.badgeId)?.code,
      u.seasonId,
      u.earnedAt,
    ]);
    expect(codes).toEqual([
      [a, 'season_lol_top1', s.id, s.endsAt],
      [b, 'season_lol_top2', s.id, s.endsAt],
      [c, 'season_lol_top3', s.id, s.endsAt],
    ]);
  });

  it('유예 경계: ends_at + 60초 직전은 대상 아님, 정확히 그 시각은 대상', async () => {
    const { app } = await setup();
    const s = seedSeason(app, '시즌', '2026-10-01T00:00:00.000Z', '2026-10-28T03:00:00.000Z');
    app.clock.set('2026-10-28T03:00:59.999Z');
    expect((await closer(app).runOnce()).closed).toBe(0);
    expect(await closer(app).closeOne(s.id, app.clock.now())).toBe('skipped');
    app.clock.set('2026-10-28T03:01:00.000Z');
    expect((await closer(app).runOnce()).closed).toBe(1);
  });

  it('빈 시즌: closed_at만 찍힌다', async () => {
    const { app } = await setup();
    seedSeason(app, '시즌 1', ...Q2);
    expect((await closer(app).runOnce()).closed).toBe(1);
    expect(app.prisma.seasonStanding.rows).toEqual([]);
    expect(app.prisma.userBadge.rows).toEqual([]);
    expect(app.prisma.badge.rows).toEqual([]);
    expect(app.prisma.season.rows[0]?.closedAt).not.toBeNull();
  });

  it('5경기 미만은 standings 제외 + 다음 시즌은 1000에서 시작', async () => {
    const { app, admin, blue, orange } = await setup();
    const s = seedSeason(app, '시즌 1', ...Q2);
    seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, s.id, { elo: 1500, wins: 2, losses: 2 });
    seedRating(app, orange, s.id, { elo: 1200, wins: 3, losses: 2 });
    await closer(app).runOnce();
    expect(standingsOf(app, s.id).map((r) => r.userId)).toEqual([orange]);
    expect(app.prisma.userBadge.rows).toHaveLength(1);
    await approveOk(app, admin, blue, orange);
    expect(app.prisma.ratingHistory.rows.find((h) => h.userId === blue)?.eloBefore).toBe(1000);
  });

  it('최소 경기 수는 설정값(RANKING_ELO_MIN_GAMES)', async () => {
    const { app } = await setup({ RANKING_ELO_MIN_GAMES: '2' });
    const s = seedSeason(app, '시즌 1', ...Q2);
    const a = await member(app, 'a');
    seedRating(app, a, s.id, { elo: 1500, wins: 1, losses: 1 });
    await closer(app).runOnce();
    expect(standingsOf(app, s.id)).toHaveLength(1);
  });

  it('동점: 승률 → 경기 수 → user id', async () => {
    const { app } = await setup();
    const s = seedSeason(app, '시즌 1', ...Q2);
    const hi = await member(app, 'hi');
    const lo = await member(app, 'lo');
    const big = await member(app, 'big');
    const small = await member(app, 'small');
    seedRating(app, lo, s.id, { elo: 1300, wins: 3, losses: 3 });
    seedRating(app, hi, s.id, { elo: 1300, wins: 4, losses: 2 });
    seedRating(app, small, s.id, { elo: 1200, wins: 3, losses: 2 });
    seedRating(app, big, s.id, { elo: 1200, wins: 6, losses: 4 });
    await closer(app).runOnce();
    expect(standingsOf(app, s.id).map((r) => r.userId)).toEqual([hi, lo, big, small]);
  });

  it('게임별 뱃지, 같은 사용자 두 게임 1위', async () => {
    const { app } = await setup();
    const s = seedSeason(app, '시즌 1', ...Q2);
    const a = await member(app, 'a');
    seedRating(app, a, s.id, { game: 'lol', elo: 1500, wins: 5 });
    seedRating(app, a, s.id, { game: 'tft', elo: 1100, wins: 5 });
    await closer(app).runOnce();
    const codes = app.prisma.userBadge.rows
      .filter((u) => u.userId === a)
      .map((u) => app.prisma.badge.rows.find((b) => b.id === u.badgeId)?.code)
      .sort();
    expect(codes).toEqual([seasonBadgeCode('lol', 1), seasonBadgeCode('tft', 1)]);
    expect(app.prisma.seasonStanding.rows).toHaveLength(2);
  });

  it('시드가 이미 있으면 그 뱃지 행을 재사용한다', async () => {
    const { app } = await setup();
    const { s, a } = await seasonWithPlayers(app);
    const seeded = app.prisma.badge.insert({ code: 'season_lol_top1', name: '시드 이름', condition: 'x' });
    await closer(app).runOnce();
    expect(app.prisma.badge.rows.filter((b) => b.code === 'season_lol_top1')).toHaveLength(1);
    expect(app.prisma.userBadge.rows.find((u) => u.userId === a)).toMatchObject({ badgeId: seeded.id, seasonId: s.id });
  });

  it('시나리오 8 재실행: closed_at 때문에 대상 아님. closed_at을 지워 강제 재실행해도 standings·뱃지 불변', async () => {
    const { app } = await setup();
    const { s } = await seasonWithPlayers(app);
    await closer(app).runOnce();
    const standings = app.prisma.seasonStanding.snapshot();
    const badges = app.prisma.userBadge.snapshot();
    const closedAt = app.prisma.season.rows[0]?.closedAt;

    app.clock.advance(300_000);
    expect(await closer(app).runOnce()).toEqual({ acquired: true, closed: 0, skipped: 0, failed: 0 });
    expect(await closer(app).closeOne(s.id, app.clock.now())).toBe('skipped');
    expect(app.prisma.season.rows[0]?.closedAt).toEqual(closedAt);

    Object.assign(app.prisma.season.rows[0] as object, { closedAt: null });
    expect(await closer(app).closeOne(s.id, app.clock.now())).toBe('closed');
    expect(app.prisma.seasonStanding.rows).toEqual(standings);
    expect(app.prisma.userBadge.rows).toEqual(badges);
  });

  it('시나리오 6: try lock 실패면 아무것도 하지 않는다', async () => {
    const { app } = await setup();
    await seasonWithPlayers(app);
    app.prisma.advisoryAvailable = false;
    expect(await closer(app).runOnce()).toEqual({ acquired: false, closed: 0, skipped: 0, failed: 0 });
    expect(app.prisma.season.rows[0]?.closedAt).toBeNull();
    expect(app.prisma.seasonStanding.rows).toEqual([]);
  });

  it('시나리오 7: 중간 실패는 시즌 전체 롤백(부분 지급 없음), 다음 호출에 처음부터', async () => {
    const { app } = await setup();
    const { s } = await seasonWithPlayers(app);
    const spy = vi.spyOn(app.prisma.userBadge, 'createMany').mockRejectedValueOnce(new Error('boom'));
    await expect(closer(app).closeOne(s.id, app.clock.now())).rejects.toThrow('boom');
    expect(app.prisma.seasonStanding.rows).toEqual([]);
    expect(app.prisma.badge.rows).toEqual([]);
    expect(app.prisma.season.rows[0]?.closedAt).toBeNull();
    spy.mockRestore();
    expect(await closer(app).closeOne(s.id, app.clock.now())).toBe('closed');
    expect(app.prisma.seasonStanding.rows).toHaveLength(3);
  });

  it('시나리오 9: 끝난 시즌 여러 개를 ends_at 오름차순으로 전부 처리, 한 시즌 실패가 다음을 막지 않는다', async () => {
    const { app } = await setup();
    const later = seedSeason(app, '시즌 2', '2026-04-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    const earlier = seedSeason(app, '시즌 1', '2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z');
    const order: string[] = [];
    const real = closer(app).closeOne.bind(closer(app));
    vi.spyOn(closer(app), 'closeOne').mockImplementation(async (id, now) => {
      order.push(id);
      if (id === earlier.id) throw new Error('boom');
      return real(id, now);
    });
    expect(await closer(app).runOnce()).toEqual({ acquired: true, closed: 1, skipped: 0, failed: 1 });
    expect(order).toEqual([earlier.id, later.id]);
    expect(app.prisma.season.rows.find((s) => s.id === later.id)?.closedAt).not.toBeNull();
    expect(app.prisma.season.rows.find((s) => s.id === earlier.id)?.closedAt).toBeNull();
  });
});

describe('6-5 경합: 승인 ↔ 종료 순서', () => {
  /** 같은 준비로 순서만 바꾼 두 흐름의 결과가 같아야 한다 */
  async function flow(order: 'close-first' | 'approve-first') {
    const { app, admin, blue, orange } = await setup();
    const s = seedSeason(app, '시즌 1', ...Q2);
    seedRating(app, blue, s.id, { elo: 1421, wins: 6, losses: 4 });
    seedRating(app, orange, s.id, { elo: 1300, wins: 5, losses: 5 });
    if (order === 'close-first') await closer(app).runOnce();
    await approveOk(app, admin, blue, orange);
    if (order === 'approve-first') await closer(app).runOnce();
    const next = app.prisma.season.rows.find((x) => x.id !== s.id);
    const out = {
      starts: [blue, orange].map((u) => app.prisma.ratingHistory.rows.find((h) => h.userId === u)?.eloBefore),
      after: [blue, orange].map((u) => app.prisma.ratingHistory.rows.find((h) => h.userId === u)?.eloAfter),
      carried: [blue, orange].map((u) => ratingOf(app, u, next?.id as string)?.carriedFromSeasonId),
      standings: standingsOf(app, s.id).map((r) => ({ rank: r.rank, elo: r.elo, wins: r.wins, losses: r.losses })),
      badges: app.prisma.userBadge.rows.length,
      closed: app.prisma.season.rows.find((x) => x.id === s.id)?.closedAt !== null,
    };
    await app.close();
    t = undefined;
    return out;
  }

  it('시나리오 1·2: 종료 → 승인과 승인 → 종료의 결과가 같다', async () => {
    const a = await flow('close-first');
    const b = await flow('approve-first');
    expect(a).toEqual(b);
    expect(a.starts).toEqual([1000, 1000]);
    expect(a.carried).toEqual([null, null]);
    expect(a.standings).toHaveLength(2);
    expect(a.closed).toBe(true);
  });

  it('시나리오 11: 시즌 경계에서 pending이던 결과는 승인 시각 기준 다음 시즌. S 순위에 안 들어간다', async () => {
    const { app, admin, blue, orange } = await setup();
    const s = seedSeason(app, '시즌 1', '2026-07-01T00:00:00.000Z', '2026-10-28T02:00:00.000Z');
    seedRating(app, blue, s.id, { elo: 1100, wins: 5 });
    await approveOk(app, admin, blue, orange);
    expect(app.prisma.rating.rows.find((r) => r.seasonId === s.id && r.userId === blue)).toMatchObject({ elo: 1100, wins: 5 });
    expect(app.prisma.ratingHistory.rows[0]?.seasonId).not.toBe(s.id);
    await closer(app).runOnce();
    expect(standingsOf(app, s.id)).toMatchObject([{ userId: blue, elo: 1100, wins: 5 }]);
  });
});

describe('D160·D187 읽기: 실력값 w는 현재 시즌 경기 수, 행을 만들지 않는다', () => {
  async function detail(app: TestApp, who: Who, scrimId: string): Promise<ScrimDetail> {
    const res = await call(app, 'GET', `/scrims/${scrimId}`, who.token);
    expect(res.status).toBe(200);
    return (await res.json()) as ScrimDetail;
  }

  /** rating_history 10건(K 판정·is_new는 모든 시즌 이력 수, D106) */
  function playedTen(app: TestApp, userId: string, seasonId: string): void {
    for (let i = 0; i < 10; i++) {
      app.prisma.ratingHistory.insert({
        userId,
        scrimId: crypto.randomUUID(),
        scrimResultId: crypto.randomUUID(),
        gameId: app.prisma.gameId('lol'),
        seasonId,
        eloBefore: 1000,
        eloAfter: 1000,
        kFactor: 32,
      });
    }
  }

  const playerOf = (d: ScrimDetail, userId: string) => d.players.find((p) => p.user.id === userId);

  it('지난 시즌 경기가 많아도 새 시즌 0경기면 skill = 티어 환산값. is_new는 모든 시즌 이력으로 false. 행은 만들지 않는다', async () => {
    const { app, admin, blue, orange } = await setup();
    const prev = seedSeason(app, '시즌 1', ...Q2);
    const cur = seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, prev.id, { elo: 1600, wins: 10 });
    playedTen(app, blue, prev.id);
    seedAccount(app, blue, { tier: 'DIAMOND', division: 'II' });
    const { scrimId } = seedPendingTeamResult(app, [blue], [orange]);
    const d = await detail(app, admin, scrimId);
    expect(playerOf(d, blue)).toMatchObject({ skill: 1800, is_new: false });
    expect(playerOf(d, orange)).toMatchObject({ skill: 1000, is_new: true });
    expect(app.prisma.rating.rows.some((r) => r.seasonId === cur.id)).toBe(false);
  });

  it.each([
    ['0경기 w 0', 1000, 0, 0, 1800],
    ['5경기 w 0.1', 1000, 3, 2, 1720],
    ['10경기 w 0.2', 1000, 6, 4, 1640],
    ['25경기 w 0.2(상한)', 1000, 20, 5, 1640],
    ['10경기 ELO 1400', 1400, 7, 3, 1720],
  ])('현재 시즌 행 %s: 다이아 II(1800)', async (_n, elo, wins, losses, skill) => {
    const { app, admin, blue, orange } = await setup();
    const cur = seedSeason(app, '시즌 2', ...Q3);
    seedRating(app, blue, cur.id, { elo, wins, losses });
    seedAccount(app, blue, { tier: 'DIAMOND', division: 'II' });
    const { scrimId } = seedPendingTeamResult(app, [blue], [orange]);
    expect(playerOf(await detail(app, admin, scrimId), blue)?.skill).toBe(skill);
  });

  it('현재 시즌이 없으면 지난 시즌 값과 무관하게 티어 환산값. 시즌·행을 만들지 않는다', async () => {
    const { app, admin, blue, orange } = await setup();
    const prev = seedSeason(app, '시즌 1', ...Q2);
    seedRating(app, blue, prev.id, { elo: 1600, wins: 10 });
    playedTen(app, blue, prev.id);
    const { scrimId } = seedPendingTeamResult(app, [blue], [orange]);
    const d = await detail(app, admin, scrimId);
    expect(playerOf(d, blue)?.skill).toBe(1000);
    expect(app.prisma.season.rows).toHaveLength(1);
    expect(app.prisma.rating.rows).toHaveLength(1);
  });
});
