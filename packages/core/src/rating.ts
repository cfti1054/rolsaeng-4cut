import type { RankTier, ScrimPlayerStatus, ScrimTeam } from '@gcd/shared';
import { ELO_SCALE, RATING_SEED_BY_TIER, RATING_SEED_DEFAULT } from './config';

// =============================================================================
// S3 내전 ELO(문서 7-1, 계약 S3 7-3). I/O 없음. K 값은 EloPolicy 인자(env)로 받는다.
// =============================================================================

/** K 정책(env SCRIM_ELO_K_BASE / K_NEW / NEW_PLAYER_GAMES) */
export type EloPolicy = { kBase: number; kNew: number; newPlayerGames: number };
/** 반영 대상 1명: 현재 시즌 elo, (user, game) rating_history 수(이번 경기 반영 전) */
export type RatedPlayer = { userId: string; elo: number; gamesPlayed: number };
export type EloUpdate = {
  userId: string;
  eloBefore: number;
  eloAfter: number;
  delta: number;
  kFactor: number;
  outcome: 'win' | 'loss';
  /** 개인 순위: 다시 매긴 순위(1..M), 팀 게임: null */
  placement: number | null;
};

function assertFiniteNumber(v: number, name: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new RangeError(`${name}: 유한한 숫자여야 함 (${v})`);
  }
}

function assertCount(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${name}: 0 이상의 정수여야 함 (${v})`);
  }
}

/** 티어 시드(D103). UNRANKED·null·undefined → RATING_SEED_DEFAULT(1000). 디비전·LP는 보지 않는다 */
export function tierSeedRating(tier: RankTier | null | undefined): number {
  if (tier == null || tier === 'UNRANKED') return RATING_SEED_DEFAULT;
  return RATING_SEED_BY_TIER[tier] ?? RATING_SEED_DEFAULT;
}

/** K 계수: gamesPlayed(이번 경기 반영 전) < newPlayerGames → kNew, 아니면 kBase */
export function eloKFactor(gamesPlayed: number, policy: EloPolicy): number {
  assertCount(gamesPlayed, 'gamesPlayed');
  return gamesPlayed < policy.newPlayerGames ? policy.kNew : policy.kBase;
}

/** 기대 승률 E_A = 1 / (1 + 10^((R_B − R_A) / 400)) */
export function expectedScore(ratingA: number, ratingB: number): number {
  assertFiniteNumber(ratingA, 'ratingA');
  assertFiniteNumber(ratingB, 'ratingB');
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / ELO_SCALE));
}

/** 0에서 먼 쪽 반올림(2.5 → 3, −2.5 → −3). 부동소수 오차 대비 |x|에 1e-9를 더한 뒤 floor(+0.5) */
export function roundHalfAwayFromZero(x: number): number {
  assertFiniteNumber(x, 'x');
  const r = Math.floor(Math.abs(x) + 1e-9 + 0.5);
  if (r === 0) return 0; // −0 방지
  return x < 0 ? -r : r;
}

/** 산술 평균(반올림 안 함). 빈 배열 RangeError */
export function meanRating(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('values: 빈 배열의 평균은 정의되지 않음');
  let sum = 0;
  for (const v of values) {
    assertFiniteNumber(v, 'values[]');
    sum += v;
  }
  return sum / values.length;
}

/**
 * 팀 게임 ELO(D104). 팀 레이팅 = 팀원 elo 평균, 참가자별 K, delta = round(k × (S − E_team)).
 * 출력 순서 = blue 입력 순서 → orange 입력 순서. 하한 없음. 한 팀이 비면 RangeError.
 */
export function computeTeamEloUpdates(input: {
  blue: readonly RatedPlayer[];
  orange: readonly RatedPlayer[];
  winner: ScrimTeam;
  policy: EloPolicy;
}): EloUpdate[] {
  const { blue, orange, winner, policy } = input;
  if (blue.length === 0 || orange.length === 0) {
    throw new RangeError('blue·orange: 두 팀 모두 1명 이상이어야 함');
  }
  if (winner !== 'blue' && winner !== 'orange') {
    throw new RangeError(`winner: blue 또는 orange (${String(winner)})`);
  }
  const rBlue = meanRating(blue.map((p) => p.elo));
  const rOrange = meanRating(orange.map((p) => p.elo));
  const eBlue = expectedScore(rBlue, rOrange);
  const eOrange = 1 - eBlue;

  const side = (players: readonly RatedPlayer[], team: ScrimTeam, e: number): EloUpdate[] =>
    players.map((p) => {
      const s = winner === team ? 1 : 0;
      const k = eloKFactor(p.gamesPlayed, policy);
      const delta = roundHalfAwayFromZero(k * (s - e));
      return {
        userId: p.userId,
        eloBefore: p.elo,
        eloAfter: p.elo + delta,
        delta,
        kFactor: k,
        outcome: s === 1 ? 'win' : 'loss',
        placement: null,
      };
    });

  return [...side(blue, 'blue', eBlue), ...side(orange, 'orange', eOrange)];
}

/** 개인 순위 게임 승패(D105): 상위 절반(2 × rank ≤ count)이 승 */
export function isPlacementWin(rank: number, count: number): boolean {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`count: 1 이상의 정수 (${count})`);
  if (!Number.isInteger(rank) || rank < 1 || rank > count) {
    throw new RangeError(`rank: 1..${count} 정수 (${rank})`);
  }
  return 2 * rank <= count;
}

/**
 * 개인 순위 ELO(D105, 메인 기본값 3). 모든 쌍을 1:1(순위가 높은 쪽 승)로 보고 K/(M−1)로 나눠 합산.
 * placement 오름차순으로 rank 1..M을 다시 매긴다. M < 2 또는 placement 중복 → RangeError. 출력 rank 순.
 */
export function computePlacementEloUpdates(input: {
  players: readonly (RatedPlayer & { placement: number })[];
  policy: EloPolicy;
}): EloUpdate[] {
  const { players, policy } = input;
  const m = players.length;
  if (m < 2) throw new RangeError(`players: 2명 이상이어야 함 (${m})`);
  const seen = new Set<number>();
  for (const p of players) {
    assertFiniteNumber(p.placement, 'placement');
    if (seen.has(p.placement)) throw new RangeError(`placement 중복 (${p.placement})`);
    seen.add(p.placement);
  }
  const ranked = [...players].sort((a, b) => a.placement - b.placement);

  return ranked.map((pi, i) => {
    let raw = 0;
    ranked.forEach((pj, j) => {
      if (i === j) return;
      const s = i < j ? 1 : 0;
      raw += s - expectedScore(pi.elo, pj.elo);
    });
    const k = eloKFactor(pi.gamesPlayed, policy);
    const delta = roundHalfAwayFromZero((k / (m - 1)) * raw);
    const rank = i + 1;
    return {
      userId: pi.userId,
      eloBefore: pi.elo,
      eloAfter: pi.elo + delta,
      delta,
      kFactor: k,
      outcome: isPlacementWin(rank, m) ? 'win' : 'loss',
      placement: rank,
    };
  });
}

/** 승률: 합 0 → null, 아니면 wins ÷ 합을 소수 셋째 자리 반올림 */
export function computeWinRate(wins: number, losses: number): number | null {
  assertCount(wins, 'wins');
  assertCount(losses, 'losses');
  const total = wins + losses;
  if (total === 0) return null;
  return Math.round((wins / total) * 1000) / 1000;
}

/** 밸런스·팀 요약의 예상 ELO 변동(팀 평균 레이팅, 단일 K). 반올림 = roundHalfAwayFromZero */
export function previewTeamElo(input: { blueAvg: number; orangeAvg: number; k: number }): {
  blue: { win: number; lose: number };
  orange: { win: number; lose: number };
} {
  const { blueAvg, orangeAvg, k } = input;
  assertFiniteNumber(k, 'k');
  const eB = expectedScore(blueAvg, orangeAvg);
  const eO = 1 - eB;
  return {
    blue: { win: roundHalfAwayFromZero(k * (1 - eB)), lose: roundHalfAwayFromZero(k * (0 - eB)) },
    orange: { win: roundHalfAwayFromZero(k * (1 - eO)), lose: roundHalfAwayFromZero(k * (0 - eO)) },
  };
}

export type RatedParticipantsSelection =
  | { kind: 'teams'; blue: string[]; orange: string[] }
  | { kind: 'placements'; ranked: { userId: string; placement: number }[] }
  | { kind: 'skip' };

/**
 * 승인 시점 반영 대상(D115).
 * - 팀 게임: status joined && team != null. 한 팀이라도 0명 → skip. blue·orange = players 입력 순서.
 * - 개인 순위: placements 중 players에서 status joined인 사용자, placement 오름차순으로 1..M 재부여. M < 2 → skip.
 *   placements null → skip.
 */
export function selectRatedParticipants(input: {
  hasTeams: boolean;
  players: readonly { userId: string; status: ScrimPlayerStatus; team: ScrimTeam | null }[];
  placements: readonly { userId: string; placement: number }[] | null;
}): RatedParticipantsSelection {
  const { hasTeams, players, placements } = input;
  if (hasTeams) {
    const blue: string[] = [];
    const orange: string[] = [];
    for (const p of players) {
      if (p.status !== 'joined') continue;
      if (p.team === 'blue') blue.push(p.userId);
      else if (p.team === 'orange') orange.push(p.userId);
    }
    if (blue.length === 0 || orange.length === 0) return { kind: 'skip' };
    return { kind: 'teams', blue, orange };
  }

  if (placements == null) return { kind: 'skip' };
  const joined = new Set(players.filter((p) => p.status === 'joined').map((p) => p.userId));
  const used = new Set<string>();
  const kept: { userId: string; placement: number; idx: number }[] = [];
  placements.forEach((p, idx) => {
    if (!joined.has(p.userId) || used.has(p.userId)) return;
    used.add(p.userId);
    kept.push({ userId: p.userId, placement: p.placement, idx });
  });
  if (kept.length < 2) return { kind: 'skip' };
  kept.sort((a, b) => a.placement - b.placement || a.idx - b.idx);
  return { kind: 'placements', ranked: kept.map((p, i) => ({ userId: p.userId, placement: i + 1 })) };
}
