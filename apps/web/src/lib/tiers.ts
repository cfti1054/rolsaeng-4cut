import type { RankTier, RankValue } from '@gcd/shared';

/**
 * 티어 → 표시 메타. 목업의 티어 고정 hex 색은 들이지 않고 기존 토큰으로 매핑한다(D53).
 * 이 표가 웹에서 티어 색을 정하는 유일한 곳이다. 색만으로 구분하지 않도록 항상 mark·라벨 텍스트를 같이 쓴다.
 */
export const TIER_META: Record<RankTier, { label: string; mark: string; text: string }> = {
  IRON: { label: 'Iron', mark: 'I', text: 'text-faint' },
  BRONZE: { label: 'Bronze', mark: 'B', text: 'text-bronze-text' },
  SILVER: { label: 'Silver', mark: 'S', text: 'text-silver-text' },
  GOLD: { label: 'Gold', mark: 'G', text: 'text-gold-text' },
  PLATINUM: { label: 'Platinum', mark: 'P', text: 'text-cyan-text' },
  EMERALD: { label: 'Emerald', mark: 'E', text: 'text-accent-ink' },
  DIAMOND: { label: 'Diamond', mark: 'D', text: 'text-blue-text' },
  MASTER: { label: 'Master', mark: 'M', text: 'text-violet-text' },
  GRANDMASTER: { label: 'Grandmaster', mark: 'GM', text: 'text-pink-ink' },
  CHALLENGER: { label: 'Challenger', mark: 'C', text: 'text-orange-text' },
  UNRANKED: { label: '언랭크', mark: '—', text: 'text-muted' },
};

const DIVISION_NUM = { I: '1', II: '2', III: '3', IV: '4' } as const;

/** `Emerald III`, `Master`, `언랭크` */
export function tierLabel(rank: RankValue): string {
  const m = TIER_META[rank.tier];
  return rank.division ? `${m.label} ${rank.division}` : m.label;
}

/** 육각형 안 짧은 표기: `E3`, `M`, `GM`, `—` */
export function tierMark(rank: RankValue): string {
  const m = TIER_META[rank.tier];
  return rank.division ? `${m.mark}${DIVISION_NUM[rank.division]}` : m.mark;
}

/**
 * 롤 솔로 랭크 보조 줄: `12 LP · 48승 41패`. 언랭은 `이번 시즌 기록 없음`.
 */
export function lolRankSub(rank: RankValue): string {
  if (rank.tier === 'UNRANKED') return '이번 시즌 기록 없음';
  return `${rank.lp} LP · ${rank.wins}승 ${rank.losses}패`;
}

/**
 * 롤체 보조 줄(D66): TFT 리그 wins = 1위 횟수, losses = 2–8위. 「순방 %」는 쓰지 않고 「1위 N회 (비율)」.
 * 예: `33 LP · 1위 12회 (13%)`
 */
export function tftRankSub(rank: RankValue): string {
  if (rank.tier === 'UNRANKED') return '이번 시즌 기록 없음';
  const games = rank.wins + rank.losses;
  const pct = games > 0 ? ` (${Math.round((rank.wins / games) * 100)}%)` : '';
  return `${rank.lp} LP · 1위 ${rank.wins}회${pct}`;
}
