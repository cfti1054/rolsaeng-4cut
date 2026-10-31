/**
 * S1 실제 PostgreSQL이 필요한 e2e. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 * 인메모리 FakePrisma로는 검증할 수 없는 것: advisory lock SQL 실행, 실제 P2002 meta.target 형식,
 * 부분 고유 인덱스 game_accounts_one_primary_per_user_game, 동시 요청 직렬화.
 *
 * 실행 방법(auth.db.e2e.spec.ts와 같음):
 *   docker compose up -d postgres
 *   set TEST_DATABASE_URL=postgresql://gcd:gcd@localhost:5432/gcd?schema=test
 *   DATABASE_URL=%TEST_DATABASE_URL% corepack pnpm --filter api prisma:deploy
 *   corepack pnpm --filter api test
 *
 * 주의: 각 테스트 전에 users를 비운다(game_accounts·확인·횟수 기록 CASCADE). 운영 스키마를 가리키지 말 것.
 */
import { GAME_SEED, SyncGameAccountResponse } from '@gcd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { classifyGameAccountUniqueViolation } from '../../src/common/unique-violation';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { FakePrisma } from '../support/fake-prisma';
import { PUUID_A, PUUID_B, STEAM_ID_A } from '../support/s1-mocks';
import { call, devLogin, linkRiot } from '../support/s1-helpers';
import { type TestApp, createTestApp } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('[DB] S1 게임 계정 e2e (PostgreSQL)', () => {
  let prisma: PrismaService;
  let t: TestApp;
  let gameIds: Record<string, string>;

  async function app(env: Record<string, string> = {}): Promise<TestApp> {
    await t?.close();
    t = await createTestApp({ prisma: prisma as unknown as FakePrisma, env: { DATABASE_URL: DB_URL as string, ...env } });
    return t;
  }

  beforeAll(async () => {
    prisma = new PrismaService({ datasources: { db: { url: DB_URL as string } } });
    for (const g of GAME_SEED) {
      await prisma.game.upsert({
        where: { code: g.code },
        update: {},
        create: { code: g.code, name: g.name, hasPositions: g.has_positions, hasTeams: g.has_teams, hasResults: g.has_results, positions: [...g.positions], sortOrder: g.sort_order },
      });
    }
    gameIds = Object.fromEntries((await prisma.game.findMany()).map((g) => [g.code, g.id]));
  });

  afterAll(async () => {
    await t?.close();
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
  });

  async function insertAccount(userId: string, code: string, externalId: string, isPrimary: boolean) {
    return prisma.gameAccount.create({
      data: { userId, gameId: gameIds[code] as string, externalId, displayName: 'x', verified: true, verifiedAt: new Date(), isPrimary },
    });
  }

  it('마이그레이션에 부분 고유 인덱스가 있다', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'game_accounts_one_primary_per_user_game'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX .* \(user_id, game_id\) WHERE is_primary/);
  });

  it('실제 P2002: (game_id, external_id) → external_id, 대표 2개(라이엇 lol) → one_primary, 스팀 2행 거부', async () => {
    await app();
    const alice = await devLogin(t, 'alice');
    const bob = await devLogin(t, 'bob');
    await insertAccount(alice.userId, 'lol', PUUID_A, true);
    const dup = await insertAccount(bob.userId, 'lol', PUUID_A, false).catch((e: unknown) => e);
    expect(classifyGameAccountUniqueViolation(dup)).toBe('external_id');
    const twoPrimary = await insertAccount(alice.userId, 'lol', PUUID_B, true).catch((e: unknown) => e);
    expect(classifyGameAccountUniqueViolation(twoPrimary)).toBe('one_primary');
    await insertAccount(alice.userId, 'steam', STEAM_ID_A, true);
    const secondSteam = await insertAccount(alice.userId, 'steam', '76561190000000002', true).catch((e: unknown) => e);
    expect(classifyGameAccountUniqueViolation(secondSteam)).toBe('one_primary');
  });

  it('advisory lock SQL이 실행되고 소유 확인 → 연동이 끝까지 된다', async () => {
    await app();
    const { token } = await devLogin(t, 'alice');
    const confirmed = await linkRiot(t, token, 'alpha');
    expect(confirmed.accounts.map((a) => [a.game, a.is_primary])).toEqual([
      ['lol', true],
      ['tft', true],
    ]);
  });

  it('동시 대표 지정(Promise.all) → 둘 다 200, 대표는 라이엇 ID 1개(lol·tft)', async () => {
    await app();
    const { token, userId } = await devLogin(t, 'alice');
    await linkRiot(t, token, 'alpha');
    const b = await linkRiot(t, token, 'bravo');
    const c = await linkRiot(t, token, 'charlie');
    const res = await Promise.all([
      call(t, 'POST', `/me/game-accounts/${b.accounts[0]?.id}/primary`, token),
      call(t, 'POST', `/me/game-accounts/${c.accounts[1]?.id}/primary`, token),
    ]);
    expect(res.map((r) => r.status)).toEqual([200, 200]);
    const primaries = await prisma.gameAccount.findMany({ where: { userId, isPrimary: true } });
    expect(primaries).toHaveLength(2);
    expect(new Set(primaries.map((p) => p.externalId)).size).toBe(1);
  });

  it('동시 확인(한도 1) → 하나만 연동, 나머지 409 GAME_ACCOUNT_LIMIT_REACHED', async () => {
    await app({ RIOT_ACCOUNTS_MAX: '1' });
    const { token, userId } = await devLogin(t, 'alice');
    const expiresAt = new Date(Date.now() + 600_000);
    const [v1, v2] = await Promise.all(
      [PUUID_A, PUUID_B].map((puuid, i) =>
        prisma.riotLinkVerification.create({
          data: { userId, puuid, gameName: i === 0 ? 'Alpha' : 'Bravo', tagLine: 'KR1', iconId: 3, expiresAt },
        }),
      ),
    );
    t.riot.icons.set(PUUID_A, 3);
    t.riot.icons.set(PUUID_B, 3);
    const res = await Promise.all([
      call(t, 'POST', `/me/game-accounts/riot-verifications/${v1?.id}/confirm`, token),
      call(t, 'POST', `/me/game-accounts/riot-verifications/${v2?.id}/confirm`, token),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.gameAccount.count({ where: { userId } })).toBe(2);
  });

  it('동시 수동 새로고침 한도 경계: 사용 4회 + 서로 다른 계정 2건 동시 → 202 1건, 429 1건', async () => {
    await app();
    const { token, userId } = await devLogin(t, 'alice');
    const riot = await linkRiot(t, token, 'alpha');
    const steam = await insertAccount(userId, 'steam', STEAM_ID_A, true);
    await prisma.gameAccount.updateMany({ where: { userId }, data: { syncState: 'idle', syncStateAt: new Date() } });
    await prisma.gameAccountSyncRequest.createMany({ data: Array.from({ length: 4 }, () => ({ userId })) });
    const res = await Promise.all([
      call(t, 'POST', `/me/game-accounts/${riot.accounts[0]?.id}/sync`, token),
      call(t, 'POST', `/me/game-accounts/${steam.id}/sync`, token),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([202, 429]);
    const ok = res.find((r) => r.status === 202) as Response;
    expect(SyncGameAccountResponse.parse(await ok.json()).sync_quota.used).toBe(5);
    expect(await prisma.gameAccountSyncRequest.count({ where: { userId } })).toBe(5);
  });

  it('해제 시 sync_requests는 SET NULL로 남는다', async () => {
    await app();
    const { token, userId } = await devLogin(t, 'alice');
    const riot = await linkRiot(t, token, 'alpha');
    await prisma.gameAccount.updateMany({ where: { userId }, data: { syncState: 'idle', syncStateAt: new Date() } });
    expect((await call(t, 'POST', `/me/game-accounts/${riot.accounts[0]?.id}/sync`, token)).status).toBe(202);
    expect((await call(t, 'DELETE', `/me/game-accounts/${riot.accounts[0]?.id}`, token)).status).toBe(204);
    const rows = await prisma.gameAccountSyncRequest.findMany({ where: { userId } });
    expect(rows).toEqual([expect.objectContaining({ gameAccountId: null })]);
  });
});
