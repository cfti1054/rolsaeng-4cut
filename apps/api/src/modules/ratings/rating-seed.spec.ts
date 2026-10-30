import { describe, expect, it } from 'vitest';
import { FakePrisma } from '../../../test/support/fake-prisma';
import { loadTierSeeds, rankedQueueOf } from './rating-seed';

/** 티어 시드(D103): 대표 계정 → 게임 랭크 큐 최신 스냅샷 → core tierSeedRating */
describe('loadTierSeeds', () => {
  const U1 = '00000000-0000-4000-8000-000000000001';
  const U2 = '00000000-0000-4000-8000-000000000002';
  const U3 = '00000000-0000-4000-8000-000000000003';
  const U4 = '00000000-0000-4000-8000-000000000004';

  function setup() {
    const db = new FakePrisma();
    const lol = db.game.rows.find((g) => g.code === 'lol');
    const steam = db.game.rows.find((g) => g.code === 'steam');
    if (!lol || !steam) throw new Error('seed');
    const account = (userId: string, isPrimary: boolean) =>
      db.gameAccount.insert({ userId, gameId: lol.id, externalId: `P-${userId}-${isPrimary}`, displayName: 'x#KR1', verified: true, isPrimary });
    const snap = (accId: string, queue: string, tier: string, at: string) =>
      db.rankSnapshot.insert({ gameAccountId: accId, queue, tier, capturedAt: new Date(at) });
    // U1: 대표 계정 최신 스냅샷 DIAMOND(이전 GOLD), 다른 큐(TFT) CHALLENGER는 무시
    const a1 = account(U1, true);
    snap(a1.id, 'RANKED_SOLO_5x5', 'GOLD', '2026-10-01T00:00:00Z');
    snap(a1.id, 'RANKED_SOLO_5x5', 'DIAMOND', '2026-10-20T00:00:00Z');
    snap(a1.id, 'RANKED_TFT', 'CHALLENGER', '2026-10-25T00:00:00Z');
    // U2: 대표 아닌 계정만(MASTER) → 1000
    snap(account(U2, false).id, 'RANKED_SOLO_5x5', 'MASTER', '2026-10-20T00:00:00Z');
    // U3: UNRANKED → 1000
    snap(account(U3, true).id, 'RANKED_SOLO_5x5', 'UNRANKED', '2026-10-20T00:00:00Z');
    // U4: 계정 없음 → 1000
    return { db, lol, steam };
  }

  it('대표 계정·게임 큐·최신 스냅샷만, 없거나 UNRANKED면 1000', async () => {
    const { db, lol } = setup();
    const seeds = await loadTierSeeds(db as never, lol, [U1, U2, U3, U4]);
    expect(Object.fromEntries(seeds)).toEqual({ [U1]: 1800, [U2]: 1000, [U3]: 1000, [U4]: 1000 });
  });

  it('큐가 없는 게임(steam)은 조회 없이 전원 1000', async () => {
    const { db, steam } = setup();
    expect(rankedQueueOf(steam)).toBeNull();
    expect(Object.fromEntries(await loadTierSeeds(db as never, steam, [U1]))).toEqual({ [U1]: 1000 });
  });
});
