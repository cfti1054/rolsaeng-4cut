/**
 * S4 랭킹 캐시 저장소·최신 스냅샷 쿼리 e2e — 실제 PostgreSQL 필요. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 * 계약 S4 7-1 ON CONFLICT … WHERE 조건부 쓰기, 7-2 DISTINCT ON 최신 스냅샷.
 * 실행 방법은 season-close.db.e2e.spec.ts와 같다. 각 테스트 전에 관련 표를 비운다. 운영 스키마를 가리키지 말 것.
 */
import { GAME_SEED, type TierRankingCachePayload } from '@gcd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaRankingCacheStore } from '../../src/modules/rankings/ranking-cache.store';
import { RankingCalculator, tierTarget } from '../../src/modules/rankings/ranking-calculator.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { testConfig } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('[DB] 랭킹 캐시 e2e (PostgreSQL)', () => {
  let prisma: PrismaService;
  let store: PrismaRankingCacheStore;
  let calculator: RankingCalculator;
  let lolId: string;

  const row = (computedAt: string, marker: number) => ({
    payload: { entries: [], marker },
    computedAt: new Date(computedAt),
    baselinePeriodStart: new Date('2026-10-25T15:00:00.000Z'),
    baselineRanks: {},
  });

  beforeAll(async () => {
    prisma = new PrismaService({ datasources: { db: { url: DB_URL as string } } });
    store = new PrismaRankingCacheStore(prisma);
    calculator = new RankingCalculator(prisma, store, testConfig({ DATABASE_URL: DB_URL }));
    const lol = GAME_SEED.find((g) => g.code === 'lol');
    lolId = (
      await prisma.game.upsert({
        where: { code: 'lol' },
        update: {},
        create: {
          code: 'lol',
          name: lol?.name ?? 'lol',
          hasPositions: true,
          hasTeams: true,
          positions: [...(lol?.positions ?? [])],
          sortOrder: 0,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE ranking_caches, rank_snapshots, game_accounts, users CASCADE');
  });

  it('행이 없으면 INSERT, computed_at이 더 새로우면 덮어쓰고 실패 표시를 지운다', async () => {
    await store.write('rankings:test', row('2026-10-28T00:00:00.000Z', 1));
    await store.markFailed('rankings:test', new Date('2026-10-28T00:05:00.000Z'), 'boom');
    expect(await store.read('rankings:test')).toMatchObject({ payload: { marker: 1 }, lastFailedAt: new Date('2026-10-28T00:05:00.000Z') });
    await store.write('rankings:test', row('2026-10-28T00:10:00.000Z', 2));
    const after = await prisma.rankingCache.findUniqueOrThrow({ where: { cacheKey: 'rankings:test' } });
    expect(after).toMatchObject({ payload: { marker: 2 }, lastFailedAt: null, lastError: null });
  });

  it('computed_at이 더 오래된 쓰기는 무시한다. 같은 시각은 덮어쓴다', async () => {
    await store.write('rankings:test', row('2026-10-28T00:10:00.000Z', 1));
    await store.write('rankings:test', row('2026-10-28T00:05:00.000Z', 2));
    expect((await store.read('rankings:test'))?.payload).toMatchObject({ marker: 1 });
    await store.write('rankings:test', row('2026-10-28T00:10:00.000Z', 3));
    expect((await store.read('rankings:test'))?.payload).toMatchObject({ marker: 3 });
  });

  it('markFailed는 행이 없으면 아무것도 안 한다, deleteExcept는 rankings: 키만 지운다', async () => {
    await store.markFailed('rankings:none', new Date(), 'x');
    expect(await store.read('rankings:none')).toBeNull();
    await store.write('rankings:keep', row('2026-10-28T00:00:00.000Z', 1));
    await store.write('rankings:drop', row('2026-10-28T00:00:00.000Z', 2));
    await store.write('other:key', row('2026-10-28T00:00:00.000Z', 3));
    expect(await store.deleteExcept(['rankings:keep'])).toBe(1);
    expect(await prisma.rankingCache.count()).toBe(2);
  });

  it('DISTINCT ON: 계정별 그 큐 최신 스냅샷 1행(captured_at → created_at), 부계정·다른 큐 제외', async () => {
    const user = await prisma.user.create({ data: { nickname: 'dia' } });
    const main = await prisma.gameAccount.create({
      data: { userId: user.id, gameId: lolId, externalId: 'p1', displayName: '본계#KR1', verified: true, isPrimary: true },
    });
    const sub = await prisma.gameAccount.create({
      data: { userId: user.id, gameId: lolId, externalId: 'p2', displayName: '부계#KR1', verified: true, isPrimary: false },
    });
    const at = (iso: string) => new Date(iso);
    const queue = 'RANKED_SOLO_5x5';
    await prisma.rankSnapshot.createMany({
      data: [
        { gameAccountId: main.id, queue, tier: 'GOLD', division: 'IV', lp: 1, capturedAt: at('2026-10-01T00:00:00Z') },
        { gameAccountId: main.id, queue, tier: 'DIAMOND', division: 'II', lp: 45, capturedAt: at('2026-10-20T00:00:00Z') },
        { gameAccountId: main.id, queue: 'RANKED_FLEX_SR', tier: 'CHALLENGER', division: null, lp: 900, capturedAt: at('2026-10-25T00:00:00Z') },
        { gameAccountId: sub.id, queue, tier: 'CHALLENGER', division: null, lp: 900, capturedAt: at('2026-10-25T00:00:00Z') },
      ],
    });
    const now = new Date('2026-10-28T03:00:00.000Z');
    const out = await calculator.computeAndStore(tierTarget({ id: lolId, code: 'lol' }), now);
    const { entries } = out.payload as TierRankingCachePayload;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ rank: 1, tier: 'DIAMOND', score: 2645, account_name: '본계#KR1' });
    expect(JSON.stringify(entries)).not.toContain('p1');
  });
});
