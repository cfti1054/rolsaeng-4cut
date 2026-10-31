/**
 * S2 내전 동시성 e2e — 실제 PostgreSQL 필요. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 * 계약 S2 5-0(D85): 명단을 바꾸는 경로는 트랜잭션 첫 문장에서 SELECT … FROM scrims WHERE id=? FOR UPDATE.
 *
 * 실행 방법(auth.db.e2e.spec.ts와 같다):
 *   docker compose up -d postgres
 *   set TEST_DATABASE_URL=postgresql://gcd:gcd@localhost:5432/gcd?schema=test
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:deploy
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:seed
 *   corepack pnpm --filter api test
 *
 * 주의: 각 테스트 전에 users·scrims를 비운다(CASCADE). 운영 스키마를 가리키지 말 것.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { API_PREFIX, DevLoginResponse, GAME_SEED, ScrimDetail } from '@gcd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG } from '../../src/config/env';
import { DISCORD_OAUTH_CLIENT } from '../../src/modules/auth/discord-oauth.client';
import { ScrimAutoCloser } from '../../src/modules/scrims/scrim-auto-close';
import { PrismaService } from '../../src/prisma/prisma.service';
import { mockDiscord, testConfig } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;

describe.skipIf(!DB_URL)('[DB] 내전 동시성·불변식 e2e (PostgreSQL)', () => {
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
    // 시드(정원 컬럼 포함)를 보장
    for (const g of GAME_SEED) {
      await prisma.game.upsert({
        where: { code: g.code },
        update: {
          capacityMin: g.capacity_min,
          capacityMax: g.capacity_max,
          capacityDefault: g.capacity_default,
          capacityStep: g.capacity_step,
          startRequiresFull: g.start_requires_full,
          requiresSteamApp: g.requires_steam_app,
          hasTeams: g.has_teams,
          hasResults: g.has_results,
        },
        create: {
          code: g.code,
          name: g.name,
          hasPositions: g.has_positions,
          hasTeams: g.has_teams,
          hasResults: g.has_results,
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
    await prisma.$executeRawUnsafe('TRUNCATE TABLE scrims, users CASCADE');
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

  async function createTft(token: string, capacity: number, scheduledInMs = DAY) {
    const res = await req('POST', '/scrims', token, {
      game: 'tft',
      title: '동시성 테스트',
      capacity,
      scheduled_at: new Date(Date.now() + scheduledInMs).toISOString(),
    });
    expect(res.status).toBe(201);
    return ScrimDetail.parse(await res.json());
  }

  async function counts(scrimId: string) {
    const rows = await prisma.scrimPlayer.groupBy({ by: ['status'], where: { scrimId }, _count: { _all: true } });
    const c = Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Record<string, number>;
    const scrim = await prisma.scrim.findUniqueOrThrow({ where: { id: scrimId } });
    return { joined: c.joined ?? 0, waitlist: c.waitlist ?? 0, cancelled: c.cancelled ?? 0, status: scrim.status, capacity: scrim.capacity };
  }

  /** 불변식(5-0): 대기가 있으면 joined = capacity, joined ≤ capacity, status = joined ≥ capacity ? full : recruiting */
  function expectInvariant(c: Awaited<ReturnType<typeof counts>>) {
    expect(c.joined).toBeLessThanOrEqual(c.capacity);
    if (c.waitlist > 0) expect(c.joined).toBe(c.capacity);
    expect(c.status).toBe(c.joined >= c.capacity ? 'full' : 'recruiting');
  }

  it('마지막 자리 동시 참가 Promise.all(10) → joined = capacity, 나머지 waitlist, 대기 순번 중복 없음', async () => {
    const host = await login('host');
    const s = await createTft(host.token, 4); // 방장 1 + 빈 자리 3
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => login(`racer${i}`)));
    const results = await Promise.all(users.map((u) => req('POST', `/scrims/${s.id}/join`, u.token, {})));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const c = await counts(s.id);
    expect(c).toMatchObject({ joined: 4, waitlist: 7, status: 'full' });
    expectInvariant(c);
    const detail = ScrimDetail.parse(await (await req('GET', `/scrims/${s.id}`, host.token)).json());
    expect(detail.waitlist.map((w) => w.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('동시 취소 + 참가 섞어서 → 불변식 유지(대기 있으면 꽉 참)', async () => {
    const host = await login('host');
    const s = await createTft(host.token, 4);
    const first = await Promise.all(Array.from({ length: 6 }, (_, i) => login(`m${i}`)));
    for (const u of first) expect((await req('POST', `/scrims/${s.id}/join`, u.token, {})).status).toBe(200);
    const late = await Promise.all(Array.from({ length: 4 }, (_, i) => login(`late${i}`)));
    const ops = [
      ...first.slice(0, 4).map((u) => req('DELETE', `/scrims/${s.id}/join`, u.token)),
      ...late.map((u) => req('POST', `/scrims/${s.id}/join`, u.token, {})),
    ];
    const results = await Promise.all(ops);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const c = await counts(s.id);
    expectInvariant(c);
    expect(c.joined + c.waitlist).toBe(1 + 6 - 4 + 4);
  });

  it('동시 정원 확대 + 참가 → 불변식 유지', async () => {
    const host = await login('host');
    const s = await createTft(host.token, 2);
    const users = await Promise.all(Array.from({ length: 5 }, (_, i) => login(`u${i}`)));
    for (const u of users.slice(0, 3)) await req('POST', `/scrims/${s.id}/join`, u.token, {});
    await Promise.all([
      req('PATCH', `/scrims/${s.id}`, host.token, { capacity: 5 }),
      ...users.slice(3).map((u) => req('POST', `/scrims/${s.id}/join`, u.token, {})),
    ]);
    const c = await counts(s.id);
    expectInvariant(c);
    expect(c).toMatchObject({ joined: 5, waitlist: 1, capacity: 5 });
  });

  it('동시 시작 + 모집 취소 → 한쪽만 성공(나머지 409 SCRIM_NOT_RECRUITING)', async () => {
    const host = await login('host');
    const a = await login('alice');
    const s = await createTft(host.token, 2);
    await req('POST', `/scrims/${s.id}/join`, a.token, {});
    const [start, cancel] = await Promise.all([
      req('POST', `/scrims/${s.id}/start`, host.token),
      req('POST', `/scrims/${s.id}/cancel`, host.token),
    ]);
    expect([start.status, cancel.status].sort()).toEqual([200, 409]);
  });

  it('자동 마감: 두 번 동시에 돌려도 advisory xact lock으로 한 번만 처리', async () => {
    const host = await login('host');
    const s = await createTft(host.token, 2, 60_000);
    await prisma.scrim.update({ where: { id: s.id }, data: { scheduledAt: new Date(Date.now() - 2 * 3_600_000) } });
    const closer = app.get(ScrimAutoCloser);
    const runs = await Promise.all([closer.runOnce(), closer.runOnce()]);
    expect(runs.reduce((n, r) => n + r.cancelled, 0)).toBe(1);
    const row = await prisma.scrim.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: 'cancelled', cancelReason: 'not_started' });
  });

  it('행 잠금 SQL이 실제 스키마에서 동작(uuid 캐스팅·enum 텍스트)', async () => {
    const host = await login('host');
    const s = await createTft(host.token, 2);
    const rows = await prisma.$transaction(
      (tx) => tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM scrims WHERE id = ${s.id}::uuid FOR UPDATE`,
    );
    expect(rows).toEqual([{ status: 'recruiting' }]);
  });
});
