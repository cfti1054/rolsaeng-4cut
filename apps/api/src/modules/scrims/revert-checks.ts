import type { Prisma, RatingHistory } from '@prisma/client';

type Reader = Pick<Prisma.TransactionClient, 'ratingHistory'>;

export type HistoryKey = Pick<RatingHistory, 'scrimResultId' | 'userId' | 'gameId' | 'createdAt'>;

/**
 * 6-2 later_games 판정(D247): 결과마다, 그 결과 이력의 각 (user_id, game_id)에 대해 `scrim_result_id ≠ 이 결과`이고
 * `created_at ≥ 그 이력 created_at`인 rating_history가 있는 사용자. 모든 시즌. 같은 시각도 막는다.
 * 여러 결과를 한 번에(조회 1회): 반환 Map(결과 id → 이후 경기가 있는 user id 목록, 이력 순서).
 * 되돌리기 시도에서는 사용자 잠금 아래에서 부른다(같은 사용자의 다른 승인은 잠금을 기다린다). 큐·상세는 잠금 없이 표시용.
 */
export async function laterGameUsersByResult(db: Reader, history: readonly HistoryKey[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (history.length === 0) return out;
  const userIds = [...new Set(history.map((h) => h.userId))];
  const gameIds = [...new Set(history.map((h) => h.gameId))];
  const since = new Date(Math.min(...history.map((h) => h.createdAt.getTime())));
  const resultIds = new Set(history.map((h) => h.scrimResultId));
  const candidates = await db.ratingHistory.findMany({
    where: { userId: { in: userIds }, gameId: { in: gameIds }, createdAt: { gte: since } },
    select: { userId: true, gameId: true, scrimResultId: true, createdAt: true },
  });
  for (const rid of resultIds) out.set(rid, []);
  for (const h of history) {
    const later = candidates.some(
      (c) =>
        c.userId === h.userId &&
        c.gameId === h.gameId &&
        c.scrimResultId !== h.scrimResultId &&
        c.createdAt.getTime() >= h.createdAt.getTime(),
    );
    if (!later) continue;
    const list = out.get(h.scrimResultId) ?? [];
    if (!list.includes(h.userId)) list.push(h.userId);
    out.set(h.scrimResultId, list);
  }
  return out;
}
