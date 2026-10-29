import { LolPosition, RECENT_MATCHES_MAX, type MainPosition, type MainPositionShare } from '@gcd/shared';

/** 주 포지션으로 보여줄 최대 개수 */
export const MAIN_POSITION_MAX = 2;

/**
 * 주 포지션(계약 10절, D40).
 * - positions는 최신순. 앞 RECENT_MATCHES_MAX(20)개만 본다(null 포함해 20개).
 * - null(포지션 없음)은 제외. 남은 수 = sample_size, 0이면 null.
 * - 경기 수 내림차순, 동률은 LolPosition 순서(top, jungle, mid, bot, support), 최대 2개.
 * - ratio = count / sample_size, 소수 둘째 자리 반올림.
 * - LolPosition이 아닌 값은 RangeError.
 */
export function computeMainPosition(positions: readonly (LolPosition | null)[]): MainPosition | null {
  const order = LolPosition.options;
  const counts = new Map<LolPosition, number>();
  let sampleSize = 0;
  for (const p of positions.slice(0, RECENT_MATCHES_MAX)) {
    if (p === null) continue;
    if (!order.includes(p)) {
      throw new RangeError(`positions: 알 수 없는 포지션 ${String(p)}`);
    }
    counts.set(p, (counts.get(p) ?? 0) + 1);
    sampleSize += 1;
  }
  if (sampleSize === 0) return null;

  const shares: MainPositionShare[] = order
    .map((p, i) => ({ p, c: counts.get(p) ?? 0, i }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c || a.i - b.i)
    .slice(0, MAIN_POSITION_MAX)
    .map(({ p, c }) => ({
      position: p,
      count: c,
      // 정수 연산 후 나눠 부동소수 오차를 줄인다(c ≤ 20)
      ratio: Math.round((c * 100) / sampleSize) / 100,
    }));

  return { source: 'riot_ranked_solo', sample_size: sampleSize, positions: shares };
}
