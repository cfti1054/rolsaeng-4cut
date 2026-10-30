/**
 * S3 결과 승인·제출 동시성 e2e — 실제 PostgreSQL 필요. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 * 계약 S3 5-5(D114–D117), 11절: 내전 행 FOR UPDATE → 시즌 생성 advisory → 사용자별 advisory(user_id 오름차순),
 * 결과 조건부 update, rating_history (scrim_id, user_id) 유일, 부분 고유 인덱스 scrim_results_one_active_per_scrim.
 *
 * 실행 방법(scrims.db.e2e.spec.ts와 같다):
 *   docker compose up -d postgres
 *   set TEST_DATABASE_URL=postgresql://gcd:gcd@localhost:5432/gcd?schema=test
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:deploy
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:seed
 *   corepack pnpm --filter api test
 *
 * 주의: 각 테스트 전에 users·scrims·seasons·ratings·rating_history를 비운다(CASCADE). 운영 스키마를 가리키지 말 것.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { API_PREFIX, DevLoginResponse, GAME_SEED, ScrimDetail } from '@gcd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG } from '../../src/config/env';
import { DISCORD_OAUTH_CLIENT } from '../../src/modules/auth/discord-oauth.client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { mockDiscord, testConfig } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;
const HOUR = 3_600_000;

describe.skipIf(!DB_URL)('[DB] 결과 승인·제출 동시성 e2e (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;

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
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE rating_history, ratings, scrim_results, seasons, scrims, users CASCADE');
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

  const req = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** playing 롤 내전 + 팀 배정(blue = 앞 절반, orange = 뒤 절반)을 DB에 직접 만든다 */
  async function playingScrim(hostId: string, userIds: string[]): Promise<string> {
    const lol = await prisma.game.findUniqueOrThrow({ where: { code: 'lol' } });
    const now = Date.now();
    const s = await prisma.scrim.create({
      data: {
        gameId: lol.id,
        hostId,
        title: '동시 승인',
        scheduledAt: new Date(now - HOUR),
        capacity: userIds.length,
        status: 'playing',
        startedAt: new Date(now - HOUR / 2),
        rated: true,
        autoBalance: true,
        usePositions: false,
      },
    });
    const half = userIds.length / 2;
    for (const [i, userId] of userIds.entries()) {
      await prisma.scrimPlayer.create({
        data: {
          scrimId: s.id,
          userId,
          status: 'joined',
          joinedAt: new Date(now - 2 * HOUR + i * 1000),
          team: i < half ? 'blue' : 'orange',
        },
      });
    }
    return s.id;
  }

  async function submitted(hostToken: string, scrimId: string, winner: 'blue' | 'orange'): Promise<string> {
    const res = await req('POST', `/scrims/${scrimId}/result`, hostToken, { winner_team: winner });
    expect(res.status).toBe(200);
    return ScrimDetail.parse(await res.json()).result?.id as string;
  }

  it('같은 결과 동시 승인 Promise.all(2) → 1건 200·1건 409 SCRIM_RESULT_NOT_PENDING, 이력 중복 없음', async () => {
    const host = await login('host');
    const a = await login('alice');
    const admin1 = await login('boss1', 'admin');
    const admin2 = await login('boss2', 'admin');
    const id = await playingScrim(host.userId, [host.userId, a.userId]);
    const rid = await submitted(host.token, id, 'blue');
    const [r1, r2] = await Promise.all([
      req('POST', `/scrims/${id}/result/approve`, admin1.token, { result_id: rid }),
      req('POST', `/scrims/${id}/result/approve`, admin2.token, { result_id: rid }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(((await loser.json()) as { code: string }).code).toBe('SCRIM_RESULT_NOT_PENDING');
    expect(await prisma.ratingHistory.count({ where: { scrimId: id } })).toBe(2);
    expect(await prisma.season.count()).toBe(1);
    const scrim = await prisma.scrim.findUniqueOrThrow({ where: { id } });
    expect(scrim.status).toBe('finished');
  });

  it('같은 사용자가 낀 두 내전 동시 승인 → 사용자 잠금으로 순차 반영(둘째 elo_before = 첫째 elo_after), 경기 수 2', async () => {
    const host = await login('host');
    const shared = await login('shared');
    const x = await login('x');
    const y = await login('y');
    const admin = await login('boss', 'admin');
    const s1 = await prisma.season.create({
      data: { name: '시즌 1', startsAt: new Date(Date.now() - 30 * 24 * HOUR), endsAt: new Date(Date.now() + 30 * 24 * HOUR) },
    });
    const id1 = await playingScrim(host.userId, [shared.userId, x.userId]);
    const id2 = await playingScrim(host.userId, [shared.userId, y.userId]);
    const r1 = await submitted(host.token, id1, 'blue');
    const r2 = await submitted(host.token, id2, 'blue');
    const res = await Promise.all([
      req('POST', `/scrims/${id1}/result/approve`, admin.token, { result_id: r1 }),
      req('POST', `/scrims/${id2}/result/approve`, admin.token, { result_id: r2 }),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const hist = await prisma.ratingHistory.findMany({ where: { userId: shared.userId }, orderBy: { eloBefore: 'asc' } });
    expect(hist).toHaveLength(2);
    expect(hist[1]?.eloBefore).toBe(hist[0]?.eloAfter);
    expect(hist.every((h) => h.seasonId === s1.id)).toBe(true);
    const rating = await prisma.rating.findFirstOrThrow({ where: { userId: shared.userId, seasonId: s1.id } });
    expect(rating).toMatchObject({ wins: 2, losses: 0, elo: hist[1]?.eloAfter });
  });

  it('시즌 없음에서 서로 다른 내전 동시 승인 2건 → 시즌 1개만 자동 생성(season-auto-create advisory)', async () => {
    const host = await login('host');
    const users = await Promise.all(['a', 'b', 'c', 'd'].map((n) => login(n)));
    const admin = await login('boss', 'admin');
    const id1 = await playingScrim(host.userId, [users[0]!.userId, users[1]!.userId]);
    const id2 = await playingScrim(host.userId, [users[2]!.userId, users[3]!.userId]);
    const r1 = await submitted(host.token, id1, 'orange');
    const r2 = await submitted(host.token, id2, 'orange');
    const res = await Promise.all([
      req('POST', `/scrims/${id1}/result/approve`, admin.token, { result_id: r1 }),
      req('POST', `/scrims/${id2}/result/approve`, admin.token, { result_id: r2 }),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.season.count()).toBe(1);
    const season = await prisma.season.findFirstOrThrow();
    expect(await prisma.ratingHistory.count({ where: { seasonId: season.id } })).toBe(4);
  });

  it('동시 결과 제출 Promise.all(2) → 1건 200, 1건 409 SCRIM_RESULT_EXISTS(내전 잠금 + 부분 고유 인덱스)', async () => {
    const host = await login('host');
    const a = await login('alice');
    const admin = await login('boss', 'admin');
    const id = await playingScrim(host.userId, [host.userId, a.userId]);
    const [r1, r2] = await Promise.all([
      req('POST', `/scrims/${id}/result`, host.token, { winner_team: 'blue' }),
      req('POST', `/scrims/${id}/result`, admin.token, { winner_team: 'orange' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await prisma.scrimResult.count({ where: { scrimId: id, status: { in: ['pending', 'approved'] } } })).toBe(1);
  });

  it('부분 고유 인덱스: 잠금을 우회한 직접 insert도 두 번째 활성 행은 P2002, rejected 행은 여러 개 허용', async () => {
    const host = await login('host');
    const a = await login('alice');
    const id = await playingScrim(host.userId, [host.userId, a.userId]);
    await prisma.scrimResult.create({ data: { scrimId: id, status: 'rejected', winnerTeam: 'blue', submittedById: host.userId } });
    await prisma.scrimResult.create({ data: { scrimId: id, status: 'rejected', winnerTeam: 'blue', submittedById: host.userId } });
    await prisma.scrimResult.create({ data: { scrimId: id, status: 'pending', winnerTeam: 'blue', submittedById: host.userId } });
    await expect(
      prisma.scrimResult.create({ data: { scrimId: id, status: 'approved', winnerTeam: 'blue', submittedById: host.userId } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('잠금 SQL이 실제 DB에서 동작(2-인자 hashtext advisory, 시즌 advisory)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'season-auto-create'}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rating:x'}), hashtext(${'00000000-0000-4000-8000-000000000000'}))`;
    });
  });
});
