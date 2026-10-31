import { pickPreviousRating } from '@gcd/core';
import type { Game, Prisma, Rating } from '@prisma/client';

type Db = Pick<Prisma.TransactionClient, 'season' | 'rating'>;

export type PreviousRating = Pick<Rating, 'userId' | 'seasonId' | 'elo'>;

/**
 * 사용자별 「이전 시즌 행」(계약 S4 6-1, D142): targetStartsAt보다 먼저 시작한 시즌의 행 중 가장 최근 것(core pickPreviousRating).
 * 승인 9단계와 읽기(D160)가 같은 값을 쓴다. 이전 행이 없는 사용자는 Map에 없다.
 */
export async function loadPreviousRatings(
  db: Db,
  game: Pick<Game, 'id'>,
  targetStartsAt: Date,
  userIds: readonly string[],
): Promise<Map<string, PreviousRating>> {
  const out = new Map<string, PreviousRating>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return out;
  const seasons = await db.season.findMany({ where: { startsAt: { lt: targetStartsAt } } });
  if (seasons.length === 0) return out;
  const rows = await db.rating.findMany({
    where: { gameId: game.id, userId: { in: ids }, seasonId: { in: seasons.map((s) => s.id) } },
    select: { userId: true, seasonId: true, elo: true },
  });
  const byUser = new Map<string, PreviousRating[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  for (const [userId, list] of byUser) {
    const prev = pickPreviousRating({ rows: list, seasons, targetStartsAt });
    if (prev) out.set(userId, prev);
  }
  return out;
}
