/**
 * S4 시즌 종료·승인 잠금 e2e — 실제 PostgreSQL 필요. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 * 계약 S4 6-2·6-3·15절: 승인 시즌 행 FOR SHARE ↔ 종료 FOR NO KEY UPDATE, try lock, 유일 키, 사용자 잠금 직렬화.
 *
 * 실행 방법(scrims.db.e2e.spec.ts와 같다):
 *   docker compose up -d postgres
 *   set TEST_DATABASE_URL=postgresql://gcd:gcd@localhost:5432/gcd?schema=test
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:deploy
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:seed
 *   corepack pnpm --filter api test
 *
 * 주의: 각 테스트 전에 관련 표를 비운다(CASCADE). 운영 스키마를 가리키지 말 것.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { API_PREFIX, DevLoginResponse, GAME_SEED } from '@gcd/shared';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG } from '../../src/config/env';
import { DISCORD_OAUTH_CLIENT } from '../../src/modules/auth/discord-oauth.client';
import { SeasonCloser } from '../../src/modules/rankings/season-closer';
import { lockSeasonForRating } from '../../src/modules/ratings/rating-locks';
import { PrismaService } from '../../src/prisma/prisma.service';
import { mockDiscord, testConfig } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!DB_URL)('[DB] 시즌 종료·승인 잠금 e2e (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let closer: SeasonCloser;
  let lolId: string;

  beforeAll(async () => {
    prisma = new PrismaService({ datasources: { db: { url: DB_URL as string } } });
    const config = testConfig({ DATABASE_URL: DB_URL });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(DISCORD_OAUTH_CLIENT)
      .useValue(mockDiscord())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, config);
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as { port: number };
    base = `http://127.0.0.1:${port}${API_PREFIX}`;
    closer = app.get(SeasonCloser);
    for (const g of GAME_SEED) {
      await prisma.game.upsert({
        where: { code: g.code },
        update: {},
        create: {
          code: g.code,
          name: g.name,
          hasPositions: g.has_positions,
          hasTeams: g.has_teams,
          positions: g.positions,
          sortOrder: g.sort_order,
          capacityMin: g.capacity_min,
          capacityMax: g.capacity_max,
          capacityDefault: g.capacity_default,
          capacityStep: g.capacity_step,
          startRequiresFull: g.start_requires_full,
          requiresSteamApp: g.requires_steam_app,
        },
      });
    }
    lolId = (await prisma.game.findUniqueOrThrow({ where: { code: 'lol' } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE user_badges, badges, season_standings, rating_history, ratings, scrim_results, seasons, scrims, users CASCADE',
    );
  });

  async function login(username: string, role?: 'admin') {
    const res = await fetch(`${base}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(role ? { username, role } : { username }),
    });
    const body = DevLoginResponse.parse(await res.json());
    return { token: body.access_token, userId: body.user.id };
  }

  /** ends_at이 지난(유예 포함) 시즌 + 5경기 이상 레이팅 */
  async function endedSeason(userId: string) {
    const now = Date.now();
    const season = await prisma.season.create({
      data: { name: '지난', startsAt: new Date(now - 30 * DAY), endsAt: new Date(now - DAY) },
    });
    await prisma.rating.create({ data: { userId, gameId: lolId, seasonId: season.id, elo: 1400, wins: 5, losses: 0 } });
    return season;
  }

  async function seedPending(blue: string, orange: string, submittedById: string) {
    const now = Date.now();
    const scrim = await prisma.scrim.create({
      data: {
        gameId: lolId,
        hostId: blue,
        title: '승인 대상',
        scheduledAt: new Date(now - 3_600_000),
        capacity: 2,
        status: 'playing',
        startedAt: new Date(now - 1_800_000),
      },
    });
    await prisma.scrimPlayer.createMany({
      data: [
        { scrimId: scrim.id, userId: blue, status: 'joined', team: 'blue' },
        { scrimId: scrim.id, userId: orange, status: 'joined', team: 'orange' },
      ],
    });
    const result = await prisma.scrimResult.create({
      data: { scrimId: scrim.id, status: 'pending', winnerTeam: 'blue', submittedById },
    });
    return { scrimId: scrim.id, resultId: result.id };
  }

  it('승인이 FOR SHARE를 쥐는 동안 종료 작업은 기다리고, 승인 커밋 값을 읽어 standings에 넣는다', async () => {
    const a = await login('a');
    const season = await endedSeason(a.userId);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let locked: () => void = () => undefined;
    const held = new Promise<void>((r) => (locked = r));

    // 승인을 흉내: FOR SHARE를 잡고 값을 바꾼 뒤 커밋을 미룬다
    const approval = prisma.$transaction(
      async (tx) => {
        await lockSeasonForRating(tx, season.id);
        await tx.rating.updateMany({ where: { seasonId: season.id, userId: a.userId }, data: { elo: 1450 } });
        locked();
        await gate;
      },
      { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    await held;
    const closing = closer.closeOne(season.id, new Date());
    await sleep(300);
    const whileHeld = await prisma.season.findUniqueOrThrow({ where: { id: season.id } });
    expect(whileHeld.closedAt).toBeNull();
    release();
    await approval;
    expect(await closing).toBe('closed');
    const standing = await prisma.seasonStanding.findFirstOrThrow({ where: { seasonId: season.id } });
    expect(standing.elo).toBe(1450);
  });

  it('종료 동시 실행 2건 → 뱃지 1벌', async () => {
    const a = await login('a');
    const season = await endedSeason(a.userId);
    const runs = await Promise.all([closer.runOnce(), closer.runOnce()]);
    expect(runs.reduce((n, r) => n + r.closed, 0)).toBe(1);
    expect(await prisma.userBadge.count({ where: { seasonId: season.id } })).toBe(1);
    expect(await prisma.seasonStanding.count({ where: { seasonId: season.id } })).toBe(1);
  });

  it('closeOne 동시 호출(try lock을 뚫은 경우): 한쪽만 closed, 나머지는 skipped', async () => {
    const a = await login('a');
    const season = await endedSeason(a.userId);
    const now = new Date();
    const out = await Promise.all([closer.closeOne(season.id, now), closer.closeOne(season.id, now)]);
    expect(out.sort()).toEqual(['closed', 'skipped']);
    expect(await prisma.userBadge.count({ where: { seasonId: season.id } })).toBe(1);
  });

  it('종료 작업이 시즌 행을 잠근 동안 새 행의 FK 검사(FOR KEY SHARE)는 기다리지 않는다', async () => {
    const a = await login('a');
    const b = await login('b');
    const season = await endedSeason(a.userId);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let locked: () => void = () => undefined;
    const held = new Promise<void>((r) => (locked = r));
    const lockTx = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM seasons WHERE id = ${season.id}::uuid FOR NO KEY UPDATE`;
        locked();
        await gate;
      },
      { timeout: 20_000 },
    );
    await held;
    // 승인 9단계 새 행(20절: RATING_START_ELO, carried 없음)은 닫히는 중인 지난 시즌 잠금에 막히지 않는다
    const next = await prisma.season.create({
      data: { name: '다음', startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + DAY) },
    });
    const insert = prisma.rating.create({
      data: { userId: b.userId, gameId: lolId, seasonId: next.id, elo: 1000 },
    });
    const finished = await Promise.race([insert.then(() => 'done'), sleep(2000).then(() => 'blocked')]);
    release();
    await lockTx;
    expect(finished).toBe('done');
  });

  it('동시 첫 승인 2건: 사용자 잠금으로 직렬화, 새 행 1개(1000, carried null)', async () => {
    const admin = await login('admin', 'admin');
    const a = await login('a');
    const b = await login('b');
    const c = await login('c');
    const now = Date.now();
    const prev = await prisma.season.create({
      data: { name: '이전', startsAt: new Date(now - 60 * DAY), endsAt: new Date(now - 30 * DAY) },
    });
    const cur = await prisma.season.create({
      data: { name: '현재', startsAt: new Date(now - 30 * DAY), endsAt: new Date(now + 30 * DAY) },
    });
    await prisma.rating.create({ data: { userId: a.userId, gameId: lolId, seasonId: prev.id, elo: 1600, wins: 5 } });
    const first = await seedPending(a.userId, b.userId, a.userId);
    const second = await seedPending(a.userId, c.userId, a.userId);
    const post = (ids: { scrimId: string; resultId: string }) =>
      fetch(`${base}/scrims/${ids.scrimId}/result/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_id: ids.resultId }),
      });
    const res = await Promise.all([post(first), post(second)]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const rows = await prisma.rating.findMany({ where: { userId: a.userId, seasonId: cur.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.carriedFromSeasonId).toBeNull();
    const history = await prisma.ratingHistory.findMany({ where: { userId: a.userId }, orderBy: { createdAt: 'asc' } });
    expect(history[0]?.eloBefore).toBe(1000);
    expect(history[1]?.eloBefore).toBe(history[0]?.eloAfter);
  });
});
