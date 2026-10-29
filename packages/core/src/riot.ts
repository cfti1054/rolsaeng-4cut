import {
  RECENT_MATCHES_TTL_HOURS,
  RIOT_APEX_TIERS,
  RIOT_VERIFICATION_ICON_IDS,
  RiotDivision,
  RiotTier,
  type RankValue,
} from '@gcd/shared';
import { HOUR_MS } from './config';

/**
 * 소유 확인 아이콘 선택(계약 5-1 8단계, D32).
 * RIOT_VERIFICATION_ICON_IDS에서 현재 아이콘을 뺀 목록 중 floor(random()*n)번째.
 * random은 [0, 1) 값을 돌려주는 함수(서버는 Math.random, 테스트는 고정값).
 * 범위를 벗어난 값(1 이상·음수)은 마지막·처음 항목으로 고정, NaN은 RangeError.
 */
export function pickVerificationIcon(currentIconId: number, random: () => number): number {
  const candidates = RIOT_VERIFICATION_ICON_IDS.filter((id) => id !== currentIconId);
  const n = candidates.length;
  if (n === 0) {
    throw new RangeError('RIOT_VERIFICATION_ICON_IDS: 현재 아이콘 외 후보가 없음');
  }
  const r = random();
  if (Number.isNaN(r)) {
    throw new RangeError('random(): NaN');
  }
  const idx = Math.min(n - 1, Math.max(0, Math.floor(r * n)));
  return candidates[idx] as number;
}

/** 라이엇 리그 항목 중 toRankValue가 쓰는 필드(integration RiotLeagueEntry와 구조 호환) */
export type RiotLeagueEntryLike = {
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

function assertCount(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${name}: 0 이상의 정수여야 함 (${v})`);
  }
}

/**
 * 라이엇 리그 항목 → RankValue(계약 10절, 6-2 결과 저장 규칙).
 * - undefined(해당 큐 기록 없음) → UNRANKED, division null, 0/0/0.
 * - RIOT_APEX_TIERS(MASTER·GRANDMASTER·CHALLENGER)면 division null. 이때 rank 문자열은 보지 않는다.
 * - 모르는 tier(대소문자 구분, 'UNRANKED' 포함), apex가 아닌데 모르는 rank,
 *   음수·정수 아닌 LP·승·패 → RangeError(작업자는 INTERNAL_ERROR로 기록).
 */
export function toRankValue(entry: RiotLeagueEntryLike | undefined): RankValue {
  if (entry === undefined) {
    return { tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0 };
  }
  const tier = RiotTier.safeParse(entry.tier);
  if (!tier.success) {
    throw new RangeError(`tier: 알 수 없는 값 ${JSON.stringify(entry.tier)}`);
  }
  let division: RankValue['division'] = null;
  if (!RIOT_APEX_TIERS.includes(tier.data)) {
    const rank = RiotDivision.safeParse(entry.rank);
    if (!rank.success) {
      throw new RangeError(`rank: 알 수 없는 값 ${JSON.stringify(entry.rank)}`);
    }
    division = rank.data;
  }
  assertCount(entry.leaguePoints, 'leaguePoints');
  assertCount(entry.wins, 'wins');
  assertCount(entry.losses, 'losses');
  return {
    tier: tier.data,
    division,
    lp: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
  };
}

/** 두 티어 값이 같은지(tier·division·lp·wins·losses 모두). false일 때만 새 스냅샷(D55). */
export function isSameRank(a: RankValue, b: RankValue): boolean {
  return (
    a.tier === b.tier &&
    a.division === b.division &&
    a.lp === b.lp &&
    a.wins === b.wins &&
    a.losses === b.losses
  );
}

/**
 * 최근 전적 캐시가 오래됐는지(계약 6-2 riot-matches, D50).
 * null 또는 now − matchesSyncedAt ≥ ttlHours(기본 RECENT_MATCHES_TTL_HOURS=6)이면 true.
 * matchesSyncedAt이 now보다 미래(시계 차이)면 false.
 * ttlHours가 음수·유한수가 아니거나 Date가 Invalid Date면 RangeError.
 */
export function isMatchesCacheStale(
  matchesSyncedAt: Date | null,
  now: Date,
  ttlHours: number = RECENT_MATCHES_TTL_HOURS,
): boolean {
  if (!Number.isFinite(ttlHours) || ttlHours < 0) {
    throw new RangeError(`ttlHours: 0 이상의 유한수여야 함 (${ttlHours})`);
  }
  if (Number.isNaN(now.getTime())) throw new RangeError('now: 올바른 Date가 아님');
  if (matchesSyncedAt === null) return true;
  if (Number.isNaN(matchesSyncedAt.getTime())) {
    throw new RangeError('matchesSyncedAt: 올바른 Date가 아님');
  }
  return now.getTime() - matchesSyncedAt.getTime() >= ttlHours * HOUR_MS;
}
