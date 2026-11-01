import { tierSeedRating } from '@gcd/core';
import { GameCode, RANKED_QUEUE_BY_GAME, RankTier } from '@gcd/shared';
import type { Game, Prisma } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'gameAccount' | 'rankSnapshot'>;

/** 그 게임의 랭크 큐(없으면 null — steam 등 티어가 없는 게임) */
export function rankedQueueOf(game: Pick<Game, 'code'>): string | null {
  const code = GameCode.safeParse(game.code);
  if (!code.success) return null;
  return (RANKED_QUEUE_BY_GAME as Partial<Record<GameCode, string>>)[code.data] ?? null;
}

/**
 * 밸런스 티어 환산값(D103·D189, 계약 S3 13절 backend 5번). ELO 시작값이 아니다(시작값은 RATING_START_ELO, D182).
 * 사용자·게임의 대표(is_primary) 계정 →
 * RANKED_QUEUE_BY_GAME 큐의 최신 rank_snapshot tier → core tierSeedRating.
 * 큐가 없는 게임·계정 없음·스냅샷 없음·모르는 티어 문자열 → tierSeedRating(null) = 1000.
 * 여러 사용자를 한 번에 조회한다(계정 1회 + 스냅샷 1회).
 */
export async function loadTierSeeds(db: Db, game: Pick<Game, 'id' | 'code'>, userIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(userIds)];
  for (const id of ids) out.set(id, tierSeedRating(null));
  const queue = rankedQueueOf(game);
  if (queue === null || ids.length === 0) return out;

  const accounts = await db.gameAccount.findMany({
    where: { userId: { in: ids }, gameId: game.id, isPrimary: true },
    select: { id: true, userId: true },
  });
  if (accounts.length === 0) return out;
  const snaps = await db.rankSnapshot.findMany({
    where: { gameAccountId: { in: accounts.map((a) => a.id) }, queue },
    orderBy: [{ capturedAt: 'desc' }, { createdAt: 'desc' }],
    select: { gameAccountId: true, tier: true },
  });
  const latestTier = new Map<string, string>();
  for (const s of snaps) if (!latestTier.has(s.gameAccountId)) latestTier.set(s.gameAccountId, s.tier);
  for (const a of accounts) {
    const tier = RankTier.safeParse(latestTier.get(a.id));
    out.set(a.userId, tierSeedRating(tier.success ? tier.data : null));
  }
  return out;
}
