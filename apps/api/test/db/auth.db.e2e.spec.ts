/**
 * 실제 PostgreSQL이 필요한 e2e. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 *
 * 실행 방법:
 *   docker compose up -d postgres
 *   set TEST_DATABASE_URL=postgresql://gcd:gcd@localhost:5432/gcd?schema=test
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:deploy
 *   corepack pnpm --filter api test
 *
 * 주의: 각 테스트 전에 users(→ refresh_tokens CASCADE)를 비운다. 운영 스키마를 가리키지 말 것.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  API_PREFIX,
  AUTH_COOKIE,
  DevLoginResponse,
  ErrorBody,
  GAME_SEED,
  RefreshTokenResponse,
  UpdateMeResponse,
} from '@gcd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { APP_CONFIG } from '../../src/config/env';
import { DISCORD_OAUTH_CLIENT } from '../../src/modules/auth/discord-oauth.client';
import { hashRefreshToken } from '../../src/modules/auth/refresh-token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { cookieValue, findSetCookie, mockDiscord, testConfig } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('[DB] auth·me e2e (PostgreSQL)', () => {
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
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    vi.useRealTimers();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
  });

  async function devLogin(username: string) {
    const res = await fetch(`${base}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const body = DevLoginResponse.parse(await res.json());
    return { body, rt: cookieValue(findSetCookie(res, AUTH_COOKIE.refresh)) as string };
  }

  const refresh = (rt: string) =>
    fetch(`${base}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `${AUTH_COOKIE.refresh}=${encodeURIComponent(rt)}` },
    });

  /** (S2 D73) 회전은 발급 후 24시간부터. 회전 경로 테스트는 현재 토큰의 created_at을 24시간 전으로 옮긴다 */
  const ageTokens = (hours = 24) =>
    prisma.refreshToken.updateMany({ where: { revokedAt: null }, data: { createdAt: new Date(Date.now() - hours * 3_600_000) } });

  it('(D73) 발급 후 24시간 미만: 200, Set-Cookie 없음, DB 행 수·폐기 상태 그대로', async () => {
    const { rt } = await devLogin('keep_user');
    await ageTokens(23);
    for (let i = 0; i < 3; i++) {
      const res = await refresh(rt);
      expect(res.status).toBe(200);
      expect(findSetCookie(res, AUTH_COOKIE.refresh)).toBeUndefined();
    }
    expect(await prisma.refreshToken.count()).toBe(1);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('리프레시 회전(24시간 경과): 같은 family·같은 expires_at, 원문 미저장', async () => {
    const { rt } = await devLogin('rot_user');
    await ageTokens();
    const res = await refresh(rt);
    expect(res.status).toBe(200);
    RefreshTokenResponse.parse(await res.json());
    const next = cookieValue(findSetCookie(res, AUTH_COOKIE.refresh)) as string;
    const rows = await prisma.refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.replacedById).toBe(rows[1]?.id);
    expect(rows[1]?.familyId).toBe(rows[0]?.familyId);
    expect(rows[1]?.expiresAt.getTime()).toBe(rows[0]?.expiresAt.getTime());
    expect(rows[1]?.tokenHash).toBe(hashRefreshToken(next));
    expect(rows.some((r) => r.tokenHash === rt || r.tokenHash === next)).toBe(false);
  });

  it('유예 10초 안 재사용 → 200(쿠키 없음), 10초 후 → REUSED + family 폐기', async () => {
    const { rt } = await devLogin('grace_user');
    await ageTokens();
    expect((await refresh(rt)).status).toBe(200);
    const inGrace = await refresh(rt);
    expect(inGrace.status).toBe(200);
    expect(findSetCookie(inGrace, AUTH_COOKIE.refresh)).toBeUndefined();

    await prisma.refreshToken.updateMany({
      where: { replacedById: { not: null } },
      data: { revokedAt: new Date(Date.now() - 11_000) },
    });
    const reuse = await refresh(rt);
    expect(reuse.status).toBe(401);
    expect(ErrorBody.parse(await reuse.json()).code).toBe('REFRESH_TOKEN_REUSED');
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('동시 refresh 24시간 경계 Promise.all(5): 모두 200, 회전 1번, 살아 있는 토큰 1개', async () => {
    const { rt } = await devLogin('race_user');
    await ageTokens();
    const results = await Promise.all(Array.from({ length: 5 }, () => refresh(rt)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.filter((r) => findSetCookie(r, AUTH_COOKIE.refresh))).toHaveLength(1);
    expect(await prisma.refreshToken.count()).toBe(2);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('PATCH /me NICKNAME_TAKEN(DB UNIQUE, 정규화 값 기준)', async () => {
    const a = await devLogin('nick_a');
    const b = await devLogin('nick_b');
    const patch = (token: string, nickname: string) =>
      fetch(`${base}/me`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname }),
      });
    const ok = await patch(a.body.access_token, '롤 생');
    UpdateMeResponse.parse(await ok.json());
    const taken = await patch(b.body.access_token, '  롤   생 ');
    expect(taken.status).toBe(409);
    expect(ErrorBody.parse(await taken.json()).code).toBe('NICKNAME_TAKEN');

    // 동시에 같은 닉네임: 하나만 200
    const both = await Promise.all([patch(a.body.access_token, '경쟁닉'), patch(b.body.access_token, '경쟁닉')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('games 시드 적용(2회 실행해도 3행)', async () => {
    const apiDir = resolve(__dirname, '../..');
    const run = () =>
      execFileSync(process.execPath, ['--import', 'tsx', '--conditions=source', 'prisma/seed.ts'], {
        cwd: apiDir,
        env: { ...process.env, DATABASE_URL: DB_URL },
        stdio: 'pipe',
      });
    run();
    run();
    const games = await prisma.game.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(games.map((g) => g.code)).toEqual(GAME_SEED.map((g) => g.code));
  });
});
