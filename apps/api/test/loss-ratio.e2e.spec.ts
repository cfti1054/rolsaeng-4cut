/**
 * S4 후속 패배 배율(계약 19-1, D169–D172). 승인이 실제로 저장하는 변동, 미리보기, rating_policy 응답.
 * 계산식은 core가 맡고, 여기서는 env → 승인·미리보기 연결과 저장 값을 본다. DB 없이 FakePrisma.
 * test-app BASE_ENV는 기존 수치 테스트를 위해 ratio 1이므로 각 테스트가 env로 값을 정한다.
 */
import { BalanceScrimResponse, GetDashboardSummaryResponse, ScrimDetail } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { FakePrisma } from './support/fake-prisma';
import { call } from './support/s1-helpers';
import { type Who, approve, login, member, seedPendingTeamResult, seedRating, seedSeason } from './support/s4-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-28T03:00:00.000Z';
const CURRENT = ['2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'] as const;
/** 신규·기존 K를 같게 둬서 계약 19-1 검증 값(K 32)을 그대로 쓴다 */
const envK32 = (ratio: string) => ({ SCRIM_ELO_K_BASE: '32', SCRIM_ELO_K_NEW: '32', SCRIM_ELO_LOSS_RATIO: ratio });

async function setup(ratio: string, prisma?: FakePrisma) {
  t = await createTestApp({ fixedClock: NOW, env: envK32(ratio), prisma });
  const admin = await login(t, 'admin', 'admin');
  return { app: t, admin };
}

const historyOf = (app: TestApp, userId: string) => app.prisma.ratingHistory.rows.filter((h) => h.userId === userId);
const deltaOf = (app: TestApp, userId: string) => {
  const h = historyOf(app, userId)[0];
  if (!h) throw new Error('rating_history 없음');
  return h.eloAfter - h.eloBefore;
};
const rowOf = (app: TestApp, userId: string, seasonId: string) => {
  const r = app.prisma.rating.rows.find((x) => x.userId === userId && x.seasonId === seasonId);
  if (!r) throw new Error('ratings 행 없음');
  return r;
};

async function approveTeams(app: TestApp, admin: Who, blue: string, orange: string, winner: 'blue' | 'orange' = 'blue') {
  const ids = seedPendingTeamResult(app, [blue], [orange], { winner });
  expect((await approve(app, admin, ids)).status).toBe(200);
  return ids;
}

/** 롤체 4명 pending 결과. users 순서 = 순위 1..4 */
async function approvePlacements(app: TestApp, admin: Who, users: string[]) {
  const now = app.clock.now();
  const scrim = app.prisma.scrim.insert({
    gameId: app.prisma.gameId('tft'),
    hostId: users[0] as string,
    title: '롤체 내전',
    scheduledAt: new Date(now.getTime() - 3_600_000),
    capacity: users.length,
    status: 'playing',
    autoBalance: false,
    usePositions: false,
    startedAt: new Date(now.getTime() - 1_800_000),
  });
  users.forEach((userId, i) =>
    app.prisma.scrimPlayer.insert({ scrimId: scrim.id, userId, status: 'joined', joinedAt: new Date(now.getTime() - 7_200_000 + i) }),
  );
  const result = app.prisma.scrimResult.insert({
    scrimId: scrim.id,
    status: 'pending',
    placements: users.map((user_id, i) => ({ user_id, placement: i + 1 })),
    submittedById: users[0] as string,
    createdAt: now,
  });
  const res = await approve(app, admin, { scrimId: scrim.id, resultId: result.id });
  expect(res.status).toBe(200);
  return ScrimDetail.parse(await res.json());
}

describe('팀 게임 승인', () => {
  it.each([
    // 계약 19-1 검증 값: [블루 시작, 레드 시작, 승리 팀, 블루 변동, 레드 변동]
    ['0.5', 1000, 1000, 'blue', 16, -8],
    ['0.5', 1500, 1300, 'blue', 8, -4],
    ['0.5', 1500, 1300, 'orange', -12, 24],
    ['1', 1000, 1000, 'blue', 16, -16],
    ['1', 1500, 1300, 'orange', -24, 24],
    ['0', 1000, 1000, 'blue', 16, 0],
  ] as const)('ratio %s: %d vs %d, 승리 %s → %d / %d', async (ratio, blueElo, orangeElo, winner, blueDelta, orangeDelta) => {
    const { app, admin } = await setup(ratio);
    const s = seedSeason(app, '현재', ...CURRENT);
    const blue = await member(app, 'blue');
    const orange = await member(app, 'orange');
    seedRating(app, blue, s.id, { elo: blueElo });
    seedRating(app, orange, s.id, { elo: orangeElo });
    await approveTeams(app, admin, blue, orange, winner);
    expect(deltaOf(app, blue)).toBe(blueDelta);
    expect(deltaOf(app, orange)).toBe(orangeDelta);
    expect(rowOf(app, blue, s.id).elo).toBe(blueElo + blueDelta);
    expect(rowOf(app, orange, s.id).elo).toBe(orangeElo + orangeDelta);
    const loser = winner === 'blue' ? orange : blue;
    const winnerId = winner === 'blue' ? blue : orange;
    expect(rowOf(app, loser, s.id)).toMatchObject({ wins: 0, losses: 1 });
    expect(rowOf(app, winnerId, s.id)).toMatchObject({ wins: 1, losses: 0 });
  });

  it('승인 응답 rating_changes도 저장된 변동과 같다(배율을 저장하지 않고 before·after로 남긴다, D172)', async () => {
    const { app, admin } = await setup('0.5');
    const s = seedSeason(app, '현재', ...CURRENT);
    const blue = await member(app, 'blue');
    const orange = await member(app, 'orange');
    seedRating(app, blue, s.id);
    seedRating(app, orange, s.id);
    const ids = seedPendingTeamResult(app, [blue], [orange]);
    const d = ScrimDetail.parse(await (await approve(app, admin, ids)).json());
    expect(d.result?.rating_changes.map((c) => [c.user.id, c.outcome, c.elo_before, c.elo_after, c.delta])).toEqual([
      [blue, 'win', 1000, 1016, 16],
      [orange, 'loss', 1000, 992, -8],
    ]);
  });
});

describe('개인 순위 승인(합산 변동의 부호로 배율, D170)', () => {
  /** 순위 순서대로 [시작값, 변동, outcome]을 돌려준다 */
  async function run(ratio: string, elos: number[]) {
    const { app, admin } = await setup(ratio);
    const s = seedSeason(app, '현재', ...CURRENT);
    const users: string[] = [];
    for (const [i, elo] of elos.entries()) {
      const id = await member(app, `p${i}`);
      seedRating(app, id, s.id, { game: 'tft', elo });
      users.push(id);
    }
    const d = await approvePlacements(app, admin, users);
    return users.map((u) => ({
      delta: deltaOf(app, u),
      outcome: d.result?.rating_changes.find((c) => c.user.id === u)?.outcome,
      row: rowOf(app, u, s.id),
    }));
  }

  it('동일 4명: ratio 0.5 → +16, +5, −3, −8', async () => {
    expect((await run('0.5', [1000, 1000, 1000, 1000])).map((r) => r.delta)).toEqual([16, 5, -3, -8]);
  });

  it('ratio 1이면 기존 값 +16, +5, −5, −16', async () => {
    expect((await run('1', [1000, 1000, 1000, 1000])).map((r) => r.delta)).toEqual([16, 5, -5, -16]);
  });

  it('승리로 세면서 합산이 음수인 2위도 배율을 받는다: +20, −4, 0, −6. wins·losses는 승패 표시 기준', async () => {
    const r = await run('0.5', [1000, 1400, 1000, 1000]);
    expect(r.map((x) => x.delta)).toEqual([20, -4, 0, -6]);
    expect(r.map((x) => x.outcome)).toEqual(['win', 'win', 'loss', 'loss']);
    expect(r.map((x) => [x.row.wins, x.row.losses])).toEqual([
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
    ]);
    expect(r[1]?.row.elo).toBe(1396); // win인데 점수는 내려간다
    expect(r[2]?.row.elo).toBe(1000);
  });

  it('ratio 0: 내려가는 변동이 모두 0, 패배 수는 그대로 센다', async () => {
    const r = await run('0', [1000, 1000, 1000, 1000]);
    expect(r.map((x) => x.delta)).toEqual([16, 5, 0, 0]);
    expect(r.map((x) => x.row.losses)).toEqual([0, 0, 1, 1]);
  });
});

describe('미리보기(D171)', () => {
  /** 1000점 4명, 팀 배정된 full 내전 */
  async function fourPlayers(app: TestApp) {
    const s = seedSeason(app, '현재', ...CURRENT);
    const ids: string[] = [];
    for (const n of ['a', 'b', 'c', 'd']) ids.push(await member(app, n));
    for (const id of ids) seedRating(app, id, s.id);
    const now = app.clock.now().getTime();
    const scrim = app.prisma.scrim.insert({
      gameId: app.prisma.gameId('lol'),
      hostId: ids[0] as string,
      title: '미리보기',
      scheduledAt: new Date(now + 3_600_000),
      capacity: 4,
      status: 'full',
      usePositions: false,
    });
    ids.forEach((userId, i) =>
      app.prisma.scrimPlayer.insert({
        scrimId: scrim.id,
        userId,
        status: 'joined',
        team: i < 2 ? 'blue' : 'orange',
        joinedAt: new Date(now - 3_600_000 + i),
      }),
    );
    return { scrimId: scrim.id, ids };
  }

  it.each([
    ['0.5', 16, -8],
    ['1', 16, -16],
    ['0', 16, 0],
  ] as const)('ratio %s: 상세 balance와 POST /balance 안이 같은 값, rating_policy.loss_ratio 응답', async (ratio, win, lose) => {
    const { app, admin } = await setup(ratio);
    const { scrimId } = await fourPlayers(app);

    const detail = ScrimDetail.parse(await (await call(app, 'GET', `/scrims/${scrimId}`, admin.token)).json());
    expect(detail.balance?.blue.elo_preview).toEqual({ win, lose });
    expect(detail.balance?.orange.elo_preview).toEqual({ win, lose });

    const res = await call(app, 'POST', `/scrims/${scrimId}/balance`, admin.token);
    expect(res.status).toBe(200);
    const body = BalanceScrimResponse.parse(await res.json());
    expect(body.rating_policy.loss_ratio).toBe(Number(ratio));
    expect(body.options[0]?.blue.elo_preview).toEqual({ win, lose });
    expect(body.options[0]?.orange.elo_preview).toEqual({ win, lose });
  });

  it('미리보기와 승인 저장 값이 일치한다', async () => {
    const { app, admin } = await setup('0.5');
    const { scrimId, ids } = await fourPlayers(app);
    const detail = ScrimDetail.parse(await (await call(app, 'GET', `/scrims/${scrimId}`, admin.token)).json());
    const preview = detail.balance?.blue.elo_preview;
    const row = app.prisma.scrim.rows[0] as { status: string };
    row.status = 'playing';
    const result = app.prisma.scrimResult.insert({
      scrimId,
      status: 'pending',
      winnerTeam: 'blue',
      submittedById: ids[0] as string,
      createdAt: app.clock.now(),
    });
    expect((await approve(app, admin, { scrimId, resultId: result.id })).status).toBe(200);
    expect(deltaOf(app, ids[0] as string)).toBe(preview?.win);
    expect(deltaOf(app, ids[2] as string)).toBe(preview?.lose);
  });
});

describe('rating_policy·기존 행(D171, D172)', () => {
  it('/dashboard/summary는 env의 K·신규 기준·배율을 내려준다', async () => {
    const { app, admin } = await setup('0.5');
    const res = await call(app, 'GET', '/dashboard/summary', admin.token);
    expect(res.status).toBe(200);
    expect(GetDashboardSummaryResponse.parse(await res.json()).rating_policy).toEqual({
      min_games: 5,
      k_base: 32,
      k_new: 32,
      new_player_games: 10,
      loss_ratio: 0.5,
      full_weight_games: 10,
      elo_weight_max: 0.2,
    });
  });

  it('배율을 바꿔 재배포해도 이미 승인된 rating_history·점수는 다시 계산하지 않고, 이후 승인부터 적용된다', async () => {
    // 같은 저장소로 앱을 두 번 띄워 재배포를 흉내 낸다
    const prisma = new FakePrisma();
    const first = await setup('1', prisma);
    const s = seedSeason(first.app, '현재', ...CURRENT);
    const blue = await member(first.app, 'blue');
    const orange = await member(first.app, 'orange');
    seedRating(first.app, blue, s.id);
    seedRating(first.app, orange, s.id);
    await approveTeams(first.app, first.admin, blue, orange);
    const before = prisma.ratingHistory.snapshot();
    expect(rowOf(first.app, orange, s.id).elo).toBe(984);
    await first.app.close();
    t = undefined;

    const second = await setup('0.5', prisma);
    expect(prisma.ratingHistory.rows).toEqual(before);
    expect(rowOf(second.app, orange, s.id).elo).toBe(984);

    await approveTeams(second.app, second.admin, blue, orange);
    expect(prisma.ratingHistory.rows.slice(0, before.length)).toEqual(before);
    const latest = historyOf(second.app, orange).at(-1);
    // 1016 vs 984: 블루 기대 승률이 높아 승 +14, 패 −14의 절반
    expect(latest?.eloBefore).toBe(984);
    expect(latest ? latest.eloAfter - latest.eloBefore : null).toBe(-7);
  });
});
