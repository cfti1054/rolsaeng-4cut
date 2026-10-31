import { LolMatchSummary, RECENT_MATCHES_MAX } from '@gcd/shared';
import type { Prisma } from '@prisma/client';

export type StoredLolMatch = { id: string; playedAt: Date; win: boolean; summary: LolMatchSummary };

/**
 * 롤 계정의 저장된 최신 RECENT_MATCHES_MAX경기(playedAt DESC, id ASC). summary 형식이 깨졌거나 win이 null인 행은 건너뛴다.
 * 프로필 main_position·최근 전적과 라인 추천(계약 20-5)이 같은 조회·필터를 써야 두 값이 일치한다.
 */
export async function loadRecentLolMatches(
  db: Pick<Prisma.TransactionClient, 'recentMatch'>,
  gameAccountId: string,
): Promise<StoredLolMatch[]> {
  const rows = await db.recentMatch.findMany({
    where: { gameAccountId },
    orderBy: [{ playedAt: 'desc' }, { id: 'asc' }],
    take: RECENT_MATCHES_MAX,
  });
  const out: StoredLolMatch[] = [];
  for (const r of rows) {
    const summary = LolMatchSummary.safeParse(r.summary);
    if (!summary.success || r.win === null) continue;
    out.push({ id: r.id, playedAt: r.playedAt, win: r.win, summary: summary.data });
  }
  return out;
}
