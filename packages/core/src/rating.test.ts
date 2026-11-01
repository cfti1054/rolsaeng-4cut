import { describe, expect, it } from 'vitest';
import {
  RiotTier,
  SCRIM_ELO_K_BASE_DEFAULT,
  SCRIM_ELO_K_NEW_DEFAULT,
  SCRIM_ELO_LOSS_RATIO_DEFAULT,
  SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT,
} from '@gcd/shared';
import {
  applyLossRatio,
  computePlacementEloUpdates,
  computeTeamEloUpdates,
  computeWinRate,
  eloKFactor,
  expectedScore,
  isPlacementWin,
  meanRating,
  previewTeamElo,
  RATING_SEED_BY_TIER,
  RATING_SEED_DEFAULT,
  roundHalfAwayFromZero,
  selectRatedParticipants,
  tierSeedRating,
  type EloPolicy,
  type RatedPlayer,
} from './index';

const policy: EloPolicy = {
  kBase: SCRIM_ELO_K_BASE_DEFAULT,
  kNew: SCRIM_ELO_K_NEW_DEFAULT,
  newPlayerGames: SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT,
  // 이 파일의 기존 수치 테스트는 배율 1로 값이 그대로임을 보인다. 배율 적용은 맨 아래 D169 절
  lossRatio: 1,
};
/** 신규 K가 걸리지 않게 경기 수 충분 */
const vet = (userId: string, elo: number): RatedPlayer => ({ userId, elo, gamesPlayed: 50 });

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('정책 기본값', () => {
  it('K 32 / 신규 40 / 기준 10경기', () => {
    expect(policy).toEqual({ kBase: 32, kNew: 40, newPlayerGames: 10, lossRatio: 1 });
  });
  it('패배 배율 기본값 0.5', () => {
    expect(SCRIM_ELO_LOSS_RATIO_DEFAULT).toBe(0.5);
  });
});

describe('tierSeedRating (D103)', () => {
  it('시드 표 전 티어', () => {
    const expected: Record<RiotTier, number> = {
      IRON: 600,
      BRONZE: 800,
      SILVER: 1000,
      GOLD: 1200,
      PLATINUM: 1400,
      EMERALD: 1600,
      DIAMOND: 1800,
      MASTER: 2000,
      GRANDMASTER: 2000,
      CHALLENGER: 2000,
    };
    expect(RATING_SEED_BY_TIER).toEqual(expected);
    for (const t of RiotTier.options) expect(tierSeedRating(t)).toBe(expected[t]);
  });
  it('UNRANKED·null·undefined → 1000', () => {
    expect(RATING_SEED_DEFAULT).toBe(1000);
    expect(tierSeedRating('UNRANKED')).toBe(1000);
    expect(tierSeedRating(null)).toBe(1000);
    expect(tierSeedRating(undefined)).toBe(1000);
  });
});

describe('eloKFactor', () => {
  it('경기 9 → K 40, 경기 10 → K 32 (경계)', () => {
    expect(eloKFactor(0, policy)).toBe(40);
    expect(eloKFactor(9, policy)).toBe(40);
    expect(eloKFactor(10, policy)).toBe(32);
    expect(eloKFactor(11, policy)).toBe(32);
  });
  it('정책 값을 그대로 쓴다(env 조정)', () => {
    expect(eloKFactor(4, { kBase: 20, kNew: 24, newPlayerGames: 5, lossRatio: 1 })).toBe(24);
    expect(eloKFactor(5, { kBase: 20, kNew: 24, newPlayerGames: 5, lossRatio: 1 })).toBe(20);
  });
  it('음수·소수 경기 수 → RangeError', () => {
    expect(() => eloKFactor(-1, policy)).toThrow(RangeError);
    expect(() => eloKFactor(1.5, policy)).toThrow(RangeError);
  });
});

describe('expectedScore', () => {
  it('동일 레이팅 0.5, 대칭', () => {
    expect(expectedScore(1000, 1000)).toBe(0.5);
    expect(expectedScore(1400, 1300) + expectedScore(1300, 1400)).toBeCloseTo(1, 12);
  });
  it('100점 차 ≈ 0.640, 400점 차 = 10/11', () => {
    expect(expectedScore(1400, 1300)).toBeCloseTo(0.6401, 4);
    expect(expectedScore(1400, 1000)).toBeCloseTo(10 / 11, 12);
  });
});

describe('roundHalfAwayFromZero', () => {
  it('x.5 양쪽 부호', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.4999)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4999)).toBe(-2);
    expect(roundHalfAwayFromZero(11.52)).toBe(12);
    expect(roundHalfAwayFromZero(-20.48)).toBe(-20);
  });
  it('부동소수 오차(2.4999999999999996 → 3), 0은 +0', () => {
    expect(roundHalfAwayFromZero((32 / 3) * 1.5 - 13.5)).toBe(3); // 2.5 부근 부동소수 결과
    expect(roundHalfAwayFromZero(2.4999999999999996)).toBe(3);
    expect(roundHalfAwayFromZero(-2.4999999999999996)).toBe(-3);
    expect(Object.is(roundHalfAwayFromZero(-0.2), 0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(0), 0)).toBe(true);
  });
});

describe('meanRating', () => {
  it('반올림 없는 평균, 빈 배열 RangeError', () => {
    expect(meanRating([1000, 1001])).toBe(1000.5);
    expect(() => meanRating([])).toThrow(RangeError);
  });
});

describe('computeTeamEloUpdates (D104)', () => {
  it('1000 대 1000, K 32 → 승 +16 / 패 −16', () => {
    const r = computeTeamEloUpdates({
      blue: [vet('b1', 1000)],
      orange: [vet('o1', 1000)],
      winner: 'blue',
      policy,
    });
    expect(r).toEqual([
      { userId: 'b1', eloBefore: 1000, eloAfter: 1016, delta: 16, kFactor: 32, outcome: 'win', placement: null },
      { userId: 'o1', eloBefore: 1000, eloAfter: 984, delta: -16, kFactor: 32, outcome: 'loss', placement: null },
    ]);
  });

  it('팀 평균 1400 대 1300, K 32 → 블루 승 +12 / 블루 패 −20 (E = 0.640)', () => {
    const blue = [vet('b1', 1500), vet('b2', 1300)]; // 평균 1400
    const orange = [vet('o1', 1300), vet('o2', 1300)];
    const win = computeTeamEloUpdates({ blue, orange, winner: 'blue', policy });
    expect(win.map((u) => u.delta)).toEqual([12, 12, -12, -12]);
    const lose = computeTeamEloUpdates({ blue, orange, winner: 'orange', policy });
    expect(lose.map((u) => u.delta)).toEqual([-20, -20, 20, 20]);
    expect(lose[0]!.eloAfter).toBe(1480);
  });

  it('참가자별 K: 신규(경기 9) K 40, 경기 10 K 32', () => {
    const r = computeTeamEloUpdates({
      blue: [
        { userId: 'new', elo: 1000, gamesPlayed: 9 },
        { userId: 'old', elo: 1000, gamesPlayed: 10 },
      ],
      orange: [vet('o1', 1000), vet('o2', 1000)],
      winner: 'blue',
      policy,
    });
    expect(r.map((u) => [u.userId, u.kFactor, u.delta])).toEqual([
      ['new', 40, 20],
      ['old', 32, 16],
      ['o1', 32, -16],
      ['o2', 32, -16],
    ]);
  });

  it('출력 순서 = blue 입력 → orange 입력, 인원이 달라도 계산(홀수)', () => {
    const r = computeTeamEloUpdates({
      blue: [vet('b2', 1000), vet('b1', 1000)],
      orange: [vet('o3', 1000), vet('o1', 1000), vet('o2', 1000)],
      winner: 'orange',
      policy,
    });
    expect(r.map((u) => u.userId)).toEqual(['b2', 'b1', 'o3', 'o1', 'o2']);
    expect(r.map((u) => u.delta)).toEqual([-16, -16, 16, 16, 16]);
  });

  it('하한 없음(음수 elo 허용)', () => {
    const r = computeTeamEloUpdates({ blue: [vet('b', 5)], orange: [vet('o', 5)], winner: 'orange', policy });
    expect(r[0]!.eloAfter).toBe(-11);
  });

  it('한 팀이 비면 RangeError', () => {
    expect(() => computeTeamEloUpdates({ blue: [], orange: [vet('o', 1000)], winner: 'blue', policy })).toThrow(
      RangeError,
    );
    expect(() => computeTeamEloUpdates({ blue: [vet('b', 1000)], orange: [], winner: 'blue', policy })).toThrow(
      RangeError,
    );
  });
});

describe('isPlacementWin (D105 상위 절반)', () => {
  it('8명 1–4위 승, 5위부터 패', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((r) => isPlacementWin(r, 8))).toEqual([
      true, true, true, true, false, false, false, false,
    ]);
  });
  it('3명은 1위만, 2명은 1위만, 5명은 1–2위', () => {
    expect([1, 2, 3].map((r) => isPlacementWin(r, 3))).toEqual([true, false, false]);
    expect([1, 2].map((r) => isPlacementWin(r, 2))).toEqual([true, false]);
    expect([1, 2, 3, 4, 5].map((r) => isPlacementWin(r, 5))).toEqual([true, true, false, false, false]);
  });
  it('범위 밖 RangeError', () => {
    expect(() => isPlacementWin(0, 4)).toThrow(RangeError);
    expect(() => isPlacementWin(5, 4)).toThrow(RangeError);
  });
});

describe('computePlacementEloUpdates (메인 기본값 3)', () => {
  it('4명 동일 1000, K 32 → +16 / +5 / −5 / −16, 합계 0', () => {
    const r = computePlacementEloUpdates({
      players: [
        { ...vet('c', 1000), placement: 3 },
        { ...vet('a', 1000), placement: 1 },
        { ...vet('d', 1000), placement: 4 },
        { ...vet('b', 1000), placement: 2 },
      ],
      policy,
    });
    expect(r.map((u) => [u.userId, u.placement, u.delta, u.outcome])).toEqual([
      ['a', 1, 16, 'win'],
      ['b', 2, 5, 'win'],
      ['c', 3, -5, 'loss'],
      ['d', 4, -16, 'loss'],
    ]);
    expect(r.reduce((s, u) => s + u.delta, 0)).toBe(0);
    expect(r.every((u) => u.kFactor === 32 && u.eloAfter === u.eloBefore + u.delta)).toBe(true);
  });

  it('2명이면 1:1 팀 ELO와 같다', () => {
    const p = computePlacementEloUpdates({
      players: [
        { ...vet('a', 1400), placement: 1 },
        { ...vet('b', 1300), placement: 2 },
      ],
      policy,
    });
    const t = computeTeamEloUpdates({ blue: [vet('a', 1400)], orange: [vet('b', 1300)], winner: 'blue', policy });
    expect(p.map((u) => u.delta)).toEqual(t.map((u) => u.delta));
  });

  it('placement가 1..M이 아니어도 오름차순으로 다시 매긴다', () => {
    const r = computePlacementEloUpdates({
      players: [
        { ...vet('x', 1000), placement: 7 },
        { ...vet('y', 1000), placement: 2 },
        { ...vet('z', 1000), placement: 5 },
      ],
      policy,
    });
    expect(r.map((u) => [u.userId, u.placement])).toEqual([
      ['y', 1],
      ['z', 2],
      ['x', 3],
    ]);
    expect(r.map((u) => u.delta)).toEqual([16, 0, -16]);
  });

  it('신규 K는 참가자별(K/(M−1))', () => {
    const r = computePlacementEloUpdates({
      players: [
        { userId: 'a', elo: 1000, gamesPlayed: 0, placement: 1 },
        { ...vet('b', 1000), placement: 2 },
        { ...vet('c', 1000), placement: 3 },
      ],
      policy,
    });
    // a: 40/2 × (0.5 + 0.5) = 20, b: 0, c: −16
    expect(r.map((u) => [u.kFactor, u.delta])).toEqual([
      [40, 20],
      [32, 0],
      [32, -16],
    ]);
  });

  it('무작위: K가 같으면 합계는 반올림 오차 ±M/2 안', () => {
    const rnd = mulberry32(7);
    for (let trial = 0; trial < 300; trial++) {
      const m = 2 + Math.floor(rnd() * 15);
      const players = Array.from({ length: m }, (_, i) => ({
        ...vet(`u${i}`, 600 + Math.floor(rnd() * 1600)),
        placement: i + 1,
      }));
      const r = computePlacementEloUpdates({ players, policy });
      const sum = r.reduce((s, u) => s + u.delta, 0);
      expect(Math.abs(sum)).toBeLessThanOrEqual(m / 2);
    }
  });

  it('M < 2, placement 중복 → RangeError', () => {
    expect(() => computePlacementEloUpdates({ players: [{ ...vet('a', 1000), placement: 1 }], policy })).toThrow(
      RangeError,
    );
    expect(() =>
      computePlacementEloUpdates({
        players: [
          { ...vet('a', 1000), placement: 1 },
          { ...vet('b', 1000), placement: 1 },
        ],
        policy,
      }),
    ).toThrow(RangeError);
  });
});

describe('computeWinRate', () => {
  it('합 0 → null, 소수 셋째 자리 반올림', () => {
    expect(computeWinRate(0, 0)).toBeNull();
    expect(computeWinRate(17, 11)).toBe(0.607);
    expect(computeWinRate(2, 1)).toBe(0.667);
    expect(computeWinRate(1, 0)).toBe(1);
    expect(computeWinRate(0, 3)).toBe(0);
  });
});

describe('previewTeamElo', () => {
  it('1400 대 1300, K 32 → 블루 +12/−20, 오렌지 +20/−12', () => {
    expect(previewTeamElo({ blueAvg: 1400, orangeAvg: 1300, k: 32, lossRatio: 1 })).toEqual({
      blue: { win: 12, lose: -20 },
      orange: { win: 20, lose: -12 },
    });
  });
  it('동일 → ±16', () => {
    expect(previewTeamElo({ blueAvg: 1000, orangeAvg: 1000, k: 32, lossRatio: 1 })).toEqual({
      blue: { win: 16, lose: -16 },
      orange: { win: 16, lose: -16 },
    });
  });
});

describe('selectRatedParticipants (D115)', () => {
  const players = [
    { userId: 'a', status: 'joined', team: 'blue' },
    { userId: 'b', status: 'no_show', team: 'blue' },
    { userId: 'c', status: 'joined', team: null },
    { userId: 'd', status: 'joined', team: 'orange' },
    { userId: 'e', status: 'joined', team: 'blue' },
    { userId: 'f', status: 'waitlist', team: null },
  ] as const;

  it('팀: joined && team, 노쇼·미배정 제외, 입력 순서', () => {
    expect(selectRatedParticipants({ hasTeams: true, players, placements: null })).toEqual({
      kind: 'teams',
      blue: ['a', 'e'],
      orange: ['d'],
    });
  });

  it('팀: 한 팀 전원 노쇼 → skip', () => {
    expect(
      selectRatedParticipants({
        hasTeams: true,
        players: [
          { userId: 'a', status: 'joined', team: 'blue' },
          { userId: 'd', status: 'no_show', team: 'orange' },
        ],
        placements: null,
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('개인 순위: joined만, 순위 다시 매김', () => {
    expect(
      selectRatedParticipants({
        hasTeams: false,
        players,
        placements: [
          { userId: 'b', placement: 1 }, // 노쇼 → 제외
          { userId: 'e', placement: 4 },
          { userId: 'a', placement: 2 },
          { userId: 'zz', placement: 3 }, // 명단에 없음 → 제외
        ],
      }),
    ).toEqual({
      kind: 'placements',
      ranked: [
        { userId: 'a', placement: 1 },
        { userId: 'e', placement: 2 },
      ],
    });
  });

  it('개인 순위: 남은 인원 < 2 또는 placements null → skip', () => {
    expect(
      selectRatedParticipants({
        hasTeams: false,
        players,
        placements: [
          { userId: 'a', placement: 1 },
          { userId: 'b', placement: 2 },
        ],
      }),
    ).toEqual({ kind: 'skip' });
    expect(selectRatedParticipants({ hasTeams: false, players, placements: null })).toEqual({ kind: 'skip' });
    expect(selectRatedParticipants({ hasTeams: false, players: [], placements: [] })).toEqual({ kind: 'skip' });
  });
});

describe('패배 배율 (19-1, D169–D171)', () => {
  const half: EloPolicy = { ...policy, lossRatio: 0.5 };
  const withKBase = (kBase: number, lossRatio: number): EloPolicy => ({ ...policy, kBase, lossRatio });
  /** 팀 1:1 결과: [승자 delta, 패자 delta] */
  const duel = (winnerElo: number, loserElo: number, p: EloPolicy) => {
    const r = computeTeamEloUpdates({ blue: [vet('w', winnerElo)], orange: [vet('l', loserElo)], winner: 'blue', policy: p });
    return r.map((u) => u.delta);
  };
  const placements = (elos: readonly number[], p: EloPolicy) =>
    computePlacementEloUpdates({
      players: elos.map((elo, i) => ({ ...vet(`p${i + 1}`, elo), placement: i + 1 })),
      policy: p,
    });

  describe('applyLossRatio', () => {
    it('음수에만 곱한다', () => {
      expect(applyLossRatio(-16, 0.5)).toBe(-8);
      expect(applyLossRatio(16, 0.5)).toBe(16);
      expect(applyLossRatio(0, 0.5)).toBe(0);
    });
    it('ratio 1 → 그대로, ratio 0 → 0(−0 없음)', () => {
      expect(applyLossRatio(-7.68, 1)).toBe(-7.68);
      expect(applyLossRatio(-7.68, 0)).toBe(0);
      expect(applyLossRatio(7.68, 0)).toBe(7.68);
    });
    it('반올림하지 않는다', () => {
      expect(applyLossRatio(-5, 0.5)).toBe(-2.5);
    });
    it('범위 밖 ratio는 변동 부호와 무관하게 RangeError', () => {
      for (const ratio of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number]) {
        expect(() => applyLossRatio(-16, ratio)).toThrow(RangeError);
        expect(() => applyLossRatio(16, ratio)).toThrow(RangeError);
      }
    });
    it('유한하지 않은 변동 RangeError', () => {
      expect(() => applyLossRatio(Number.NaN, 0.5)).toThrow(RangeError);
    });
  });

  it.each([
    ['1000 vs 1000, K 32', 1000, 1000, 32, [16, -16], [16, -8]],
    ['1500 vs 1300, K 32, 높은 팀 승', 1500, 1300, 32, [8, -8], [8, -4]],
    ['1500 vs 1300, K 32, 낮은 팀 승', 1300, 1500, 32, [24, -24], [24, -12]],
    ['1500 vs 1300, K 40, 높은 팀 승', 1500, 1300, 40, [10, -10], [10, -5]],
  ] as const)('검증 값: %s', (_name, winner, loser, k, ratio1, ratioHalf) => {
    expect(duel(winner, loser, withKBase(k, 1))).toEqual(ratio1);
    expect(duel(winner, loser, withKBase(k, 0.5))).toEqual(ratioHalf);
  });

  it('검증 값: 개인 4명 동일 1000, K 32', () => {
    const elos = [1000, 1000, 1000, 1000];
    expect(placements(elos, policy).map((u) => u.delta)).toEqual([16, 5, -5, -16]);
    expect(placements(elos, half).map((u) => u.delta)).toEqual([16, 5, -3, -8]);
  });

  it('검증 값: 개인 1000·1400·1000·1000, K 32. 2위는 win인데 내려가므로 배율을 받는다(D170)', () => {
    const elos = [1000, 1400, 1000, 1000];
    expect(placements(elos, policy).map((u) => u.delta)).toEqual([20, -8, -1, -12]);
    const r = placements(elos, half);
    expect(r.map((u) => u.delta)).toEqual([20, -4, 0, -6]);
    expect(r[1]).toMatchObject({ outcome: 'win', delta: -4, eloAfter: 1396 });
    expect(r.map((u) => u.outcome)).toEqual(['win', 'win', 'loss', 'loss']);
  });

  it('반올림 전에 곱한다: 변동 −4.5 × 0.5 = −2.25 → −2(먼저 반올림하면 −3)', () => {
    expect(duel(1000, 1000, withKBase(9, 0.5))).toEqual([5, -2]);
    expect(previewTeamElo({ blueAvg: 1000, orangeAvg: 1000, k: 9, lossRatio: 0.5 }).blue).toEqual({ win: 5, lose: -2 });
  });

  it('참가자별 K: 신규는 kNew 기준으로 줄어든다', () => {
    const r = computeTeamEloUpdates({
      blue: [vet('b', 1000)],
      orange: [
        { userId: 'new', elo: 1000, gamesPlayed: 3 },
        { userId: 'old', elo: 1000, gamesPlayed: 50 },
      ],
      winner: 'blue',
      policy: half,
    });
    expect(r.map((u) => [u.userId, u.delta, u.kFactor])).toEqual([
      ['b', 16, 32],
      ['new', -10, 40],
      ['old', -8, 32],
    ]);
  });

  it('ratio 0: 진 쪽 변동 0, outcome은 패배 그대로', () => {
    const zero = withKBase(32, 0);
    const team = computeTeamEloUpdates({ blue: [vet('b', 1000)], orange: [vet('o', 1000)], winner: 'blue', policy: zero });
    expect(team.map((u) => [u.delta, u.outcome])).toEqual([
      [16, 'win'],
      [0, 'loss'],
    ]);
    expect(team[1]!.eloAfter).toBe(1000);
    expect(Object.is(team[1]!.delta, 0)).toBe(true);
    const solo = placements([1000, 1000, 1000, 1000], zero);
    expect(solo.map((u) => [u.delta, u.outcome])).toEqual([
      [16, 'win'],
      [5, 'win'],
      [0, 'loss'],
      [0, 'loss'],
    ]);
  });

  it('범위 밖 lossRatio는 팀·개인·미리보기 모두 RangeError', () => {
    const bad = withKBase(32, 1.5);
    expect(() => duel(1000, 1000, bad)).toThrow(RangeError);
    expect(() => placements([1000, 1000], bad)).toThrow(RangeError);
    expect(() => previewTeamElo({ blueAvg: 1000, orangeAvg: 1000, k: 32, lossRatio: 1.5 })).toThrow(RangeError);
  });

  it('previewTeamElo: lose만 줄고 win은 그대로, 실제 반영과 같다', () => {
    expect(previewTeamElo({ blueAvg: 1500, orangeAvg: 1300, k: 32, lossRatio: 0.5 })).toEqual({
      blue: { win: 8, lose: -12 },
      orange: { win: 24, lose: -4 },
    });
    const preview = previewTeamElo({ blueAvg: 1500, orangeAvg: 1300, k: 32, lossRatio: 0.5 });
    expect(duel(1500, 1300, half)).toEqual([preview.blue.win, preview.orange.lose]);
    expect(duel(1300, 1500, half)).toEqual([preview.orange.win, preview.blue.lose]);
  });

  it('ratio 1은 배율 도입 전 식과 정확히 같고, ratio r은 반올림 전 곱과 같다(무작위)', () => {
    const rnd = mulberry32(2026);
    for (let t = 0; t < 3000; t++) {
      const count = 2 + Math.floor(rnd() * 7);
      const elos = Array.from({ length: count }, () => 600 + Math.floor(rnd() * 1800));
      const r = rnd();
      const raw = elos.map(
        (e, i) =>
          (32 / (count - 1)) *
          elos.reduce((sum, o, j) => (i === j ? sum : sum + (i < j ? 1 : 0) - expectedScore(e, o)), 0),
      );
      expect(placements(elos, policy).map((u) => u.delta)).toEqual(raw.map((x) => roundHalfAwayFromZero(x)));
      expect(placements(elos, withKBase(32, r)).map((u) => u.delta)).toEqual(
        raw.map((x) => roundHalfAwayFromZero(x < 0 ? x * r : x)),
      );

      const [a, b] = [elos[0]!, elos[1]!];
      const eA = expectedScore(a, b);
      const legacy = [roundHalfAwayFromZero(32 * (1 - eA)), roundHalfAwayFromZero(32 * (0 - (1 - eA)))];
      expect(duel(a, b, policy)).toEqual(legacy);
      expect(previewTeamElo({ blueAvg: a, orangeAvg: b, k: 32, lossRatio: 1 })).toEqual({
        blue: { win: roundHalfAwayFromZero(32 * (1 - eA)), lose: roundHalfAwayFromZero(-32 * eA) },
        orange: { win: roundHalfAwayFromZero(32 * eA), lose: roundHalfAwayFromZero(-32 * (1 - eA)) },
      });
    }
  });

  it('배율은 결과의 eloBefore·eloAfter·delta로만 나타나고 별도 필드가 없다(D172)', () => {
    const [w, l] = computeTeamEloUpdates({ blue: [vet('b', 1000)], orange: [vet('o', 1000)], winner: 'blue', policy: half });
    expect(l).toEqual({ userId: 'o', eloBefore: 1000, eloAfter: 992, delta: -8, kFactor: 32, outcome: 'loss', placement: null });
    expect(w).toMatchObject({ eloAfter: 1016, delta: 16 });
  });
});
