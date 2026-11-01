import {
  RANKING_STALE_AFTER_SEC,
  RIOT_APEX_TIERS,
  RIOT_DIVISION_ORDER,
  RIOT_TIER_ORDER,
  type RankTier,
  type RiotDivision,
  type RiotTier,
} from '@gcd/shared';
import { computeWinRate } from './rating';
import { assertValidDate } from './time';

// =============================================================================
// S4 랭킹(문서 7-3, 계약 S4 7-7·9-2, D152·D153). I/O 없음. 시각·최소 경기 수는 인자로 받는다.
// 순위는 항상 1씩 증가한다(공동 순위 없음). 입력 순서는 결과에 영향을 주지 않는다.
// =============================================================================

export type RankingComparable = { userId: string; value: number; wins: number; losses: number };
export type RankBaseline = { periodStart: Date; ranks: Record<string, number> };

/** 티어 × 400 + 디비전 × 100 + LP. 마스터 이상은 입력에 디비전이 있어도 0으로 계산한다(D152) */
export function tierScore(rank: { tier: RiotTier; division: RiotDivision | null; lp: number }): number {
  const { tier, division, lp } = rank;
  if (!Object.hasOwn(RIOT_TIER_ORDER, tier)) throw new RangeError(`tier: 알 수 없는 값 (${String(tier)})`);
  const tierOrder = RIOT_TIER_ORDER[tier];
  if (!Number.isInteger(lp) || lp < 0) throw new RangeError(`lp: 0 이상의 정수여야 함 (${lp})`);
  if (division === null || RIOT_APEX_TIERS.includes(tier)) return tierOrder * 400 + lp;
  if (!Object.hasOwn(RIOT_DIVISION_ORDER, division)) {
    throw new RangeError(`division: 알 수 없는 값 (${String(division)})`);
  }
  return tierOrder * 400 + RIOT_DIVISION_ORDER[division] * 100 + lp;
}

/**
 * 정렬 비교: value DESC → 승률 DESC → 경기 수 DESC → userId ASC.
 * 승률은 반올림 동률을 피하려고 교차 곱으로 비교한다. 0경기 행은 교차 곱이 0(동률)으로 나오지만
 * 다음 단계 경기 수에서 뒤로 가므로 승률 0으로 취급한 순서와 같다.
 */
export function compareRanking(a: RankingComparable, b: RankingComparable): number {
  if (a.value !== b.value) return b.value - a.value;
  const aGames = a.wins + a.losses;
  const bGames = b.wins + b.losses;
  const byWinRate = b.wins * aGames - a.wins * bGames;
  if (byWinRate !== 0) return byWinRate;
  if (aGames !== bGames) return bGames - aGames;
  if (a.userId === b.userId) return 0;
  return a.userId < b.userId ? -1 : 1;
}

/** 행을 compareRanking 순으로 놓고 rank 1..을 매긴다. 정렬 키를 행 밖에 두어 호출자 필드와 섞이지 않게 한다 */
function assignRanks<R extends Omit<RankingComparable, 'value'>>(
  rows: readonly R[],
  valueOf: (row: R) => number,
): (R & { rank: number })[] {
  return rows
    .map((row) => ({ row, key: { userId: row.userId, value: valueOf(row), wins: row.wins, losses: row.losses } }))
    .sort((a, b) => compareRanking(a.key, b.key))
    .map(({ row }, i) => ({ ...row, rank: i + 1 }));
}

/** 티어 랭킹: UNRANKED 제외, value = tierScore */
export function buildTierRanking<
  T extends {
    userId: string;
    tier: RankTier;
    division: RiotDivision | null;
    lp: number;
    wins: number;
    losses: number;
  },
>(rows: readonly T[]): (T & { rank: number; score: number })[] {
  const scored = rows
    .filter((row) => row.tier !== 'UNRANKED')
    .map((row) => {
      const score = tierScore({ tier: row.tier as RiotTier, division: row.division, lp: row.lp });
      return { ...row, score };
    });
  return assignRanks(scored, (row) => row.score);
}

/**
 * ELO 랭킹: wins + losses ≥ minGames, value = elo.
 * minGames는 1 이상의 정수(RANKING_ELO_MIN_GAMES 규칙)라 결과의 games ≥ 1, winRate는 null이 아니다.
 */
export function buildEloRanking<T extends { userId: string; elo: number; wins: number; losses: number }>(input: {
  rows: readonly T[];
  minGames: number;
}): (T & { rank: number; games: number; winRate: number })[] {
  const { rows, minGames } = input;
  if (!Number.isInteger(minGames) || minGames < 1) {
    throw new RangeError(`minGames: 1 이상의 정수여야 함 (${minGames})`);
  }
  const eligible = rows
    .filter((row) => row.wins + row.losses >= minGames)
    .map((row) => ({
      ...row,
      games: row.wins + row.losses,
      winRate: computeWinRate(row.wins, row.losses) as number,
    }));
  return assignRanks(eligible, (row) => row.elo);
}

/** 기준 순위 − 현재 순위(양수 = 오름). 기준에 없으면 null */
export function computeRankChange(baselineRank: number | undefined, rank: number): number | null {
  if (baselineRank == null) return null;
  return baselineRank - rank;
}

/**
 * 순위 변동 기준 갱신(7-7). weekStart = 이번 KST 주 시작.
 * - 저장된 기준이 이번 주 것 → 그대로. weekStart보다 새 기준도 그대로 둔다(늦게 끝난 오래된 계산이 기준을 되돌리지 않게)
 * - 지난 기준 + 이전 payload → 이전 payload 순위를 이번 주 기준으로
 * - 그 외(행 없음, 이전 payload를 읽지 못함) → 빈 기준. 화면은 `—`
 */
export function rollRankBaseline(input: {
  stored: RankBaseline | null;
  previousRanks: Record<string, number> | null;
  weekStart: Date;
}): RankBaseline {
  const { stored, previousRanks, weekStart } = input;
  assertValidDate(weekStart, 'weekStart');
  const periodStart = new Date(weekStart.getTime());
  if (stored === null) return { periodStart, ranks: {} };
  assertValidDate(stored.periodStart, 'stored.periodStart');
  if (stored.periodStart.getTime() >= weekStart.getTime()) {
    return { periodStart: new Date(stored.periodStart.getTime()), ranks: { ...stored.ranks } };
  }
  return { periodStart, ranks: { ...(previousRanks ?? {}) } };
}

/** 마지막 갱신이 성공 뒤에 실패했거나, 마지막 성공이 RANKING_STALE_AFTER_SEC보다 오래됨(경계 값은 stale 아님) */
export function isRankingStale(input: { computedAt: Date; lastFailedAt: Date | null; now: Date }): boolean {
  const { computedAt, lastFailedAt, now } = input;
  assertValidDate(computedAt, 'computedAt');
  assertValidDate(now, 'now');
  if (lastFailedAt !== null) {
    assertValidDate(lastFailedAt, 'lastFailedAt');
    if (lastFailedAt.getTime() > computedAt.getTime()) return true;
  }
  return now.getTime() - computedAt.getTime() > RANKING_STALE_AFTER_SEC * 1000;
}
