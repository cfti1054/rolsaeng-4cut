import { describe, expect, it } from 'vitest';
import { RANKING_STALE_AFTER_SEC, type RankTier, type RiotDivision, type RiotTier } from '@gcd/shared';
import {
  buildEloRanking,
  buildTierRanking,
  compareRanking,
  computeRankChange,
  isRankingStale,
  rollRankBaseline,
  tierScore,
} from './index';

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

function shuffled<T>(list: readonly T[], rnd: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const cmp = (userId: string, value: number, wins: number, losses: number) => ({ userId, value, wins, losses });
const sign = (n: number) => Math.sign(n);

describe('tierScore (9-2 검증 값)', () => {
  it.each<[RiotTier, RiotDivision | null, number, number]>([
    ['DIAMOND', 'II', 45, 2645],
    ['EMERALD', 'I', 80, 2380],
    ['EMERALD', 'III', 12, 2112],
    ['PLATINUM', 'I', 67, 1967],
    ['GOLD', 'I', 90, 1590],
    ['GOLD', 'II', 20, 1420],
    ['IRON', 'IV', 0, 0],
    ['MASTER', null, 0, 2800],
    ['GRANDMASTER', null, 0, 3200],
    ['CHALLENGER', null, 1000, 4600],
  ])('%s %s %i LP = %i', (tier, division, lp, expected) => {
    expect(tierScore({ tier, division, lp })).toBe(expected);
  });

  it('마스터 이상은 디비전이 들어와도 0으로 계산한다(라이엇 원본 rank=I 방어)', () => {
    expect(tierScore({ tier: 'MASTER', division: 'I', lp: 10 })).toBe(2810);
    expect(tierScore({ tier: 'CHALLENGER', division: 'IV', lp: 0 })).toBe(3600);
  });

  it('LP 음수·정수 아님·모르는 티어 RangeError', () => {
    expect(() => tierScore({ tier: 'GOLD', division: 'I', lp: -1 })).toThrow(RangeError);
    expect(() => tierScore({ tier: 'GOLD', division: 'I', lp: 1.5 })).toThrow(RangeError);
    expect(() => tierScore({ tier: 'UNRANKED' as RiotTier, division: null, lp: 0 })).toThrow(RangeError);
    expect(() => tierScore({ tier: 'GOLD', division: 'V' as RiotDivision, lp: 0 })).toThrow(RangeError);
  });
});

describe('tierScore 프로토타입 키', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('tier·division이 %s면 NaN이 아니라 RangeError', (key) => {
    expect(() => tierScore({ tier: key as RiotTier, division: null, lp: 0 })).toThrow(RangeError);
    expect(() => tierScore({ tier: 'GOLD', division: key as RiotDivision, lp: 0 })).toThrow(RangeError);
  });
});

describe('compareRanking (동점 4단계, D152)', () => {
  it('1단계 value DESC가 승률·경기 수보다 앞선다', () => {
    expect(sign(compareRanking(cmp('z', 1500, 0, 9), cmp('a', 1499, 9, 0)))).toBe(-1);
  });
  it('2단계 승률 DESC', () => {
    expect(sign(compareRanking(cmp('z', 1500, 3, 1), cmp('a', 1500, 5, 5)))).toBe(-1);
  });
  it('3단계 경기 수 DESC', () => {
    expect(sign(compareRanking(cmp('z', 1500, 6, 6), cmp('a', 1500, 3, 3)))).toBe(-1);
  });
  it('4단계 userId ASC', () => {
    expect(sign(compareRanking(cmp('a', 1500, 3, 3), cmp('b', 1500, 3, 3)))).toBe(-1);
    expect(compareRanking(cmp('a', 1500, 3, 3), cmp('a', 1500, 3, 3))).toBe(0);
  });
  it('승률 교차 곱: 2/3 vs 4/6은 승률 동률이라 경기 수로 정한다', () => {
    expect(sign(compareRanking(cmp('a', 1500, 2, 1), cmp('b', 1500, 4, 2)))).toBe(1);
    expect(sign(compareRanking(cmp('b', 1500, 4, 2), cmp('a', 1500, 2, 1)))).toBe(-1);
  });
  it('반올림하면 같아지는 승률도 구분한다(2001/3001 > 2000/3000)', () => {
    expect(sign(compareRanking(cmp('z', 1500, 2001, 1000), cmp('a', 1500, 2000, 1000)))).toBe(-1);
  });
  it('0경기 = 승률 0: 승이 있는 상대보다 뒤', () => {
    expect(sign(compareRanking(cmp('a', 1500, 0, 0), cmp('z', 1500, 3, 2)))).toBe(1);
    expect(sign(compareRanking(cmp('z', 1500, 3, 2), cmp('a', 1500, 0, 0)))).toBe(-1);
  });
  it('0경기 vs 전패: 승률이 둘 다 0이라 경기 수로 정한다', () => {
    expect(sign(compareRanking(cmp('a', 1500, 0, 0), cmp('z', 1500, 0, 5)))).toBe(1);
  });
  it('0경기끼리는 userId', () => {
    expect(sign(compareRanking(cmp('a', 1500, 0, 0), cmp('b', 1500, 0, 0)))).toBe(-1);
  });
  it('반대칭: 서로 다른 행은 부호가 반대', () => {
    const rnd = mulberry32(11);
    const pick = (n: number) => Math.floor(rnd() * n);
    for (let i = 0; i < 2000; i++) {
      const a = cmp(`u${pick(4)}`, 1000 + pick(3), pick(4), pick(4));
      const b = cmp(`u${pick(4)}`, 1000 + pick(3), pick(4), pick(4));
      expect(sign(compareRanking(a, b))).toBe(-sign(compareRanking(b, a)) || 0);
    }
  });
});

describe('buildTierRanking', () => {
  const row = (
    userId: string,
    tier: RankTier,
    division: RiotDivision | null,
    lp: number,
    wins = 10,
    losses = 10,
  ) => ({ userId, tier, division, lp, wins, losses, accountName: `${userId}#KR1` });

  it('점수 내림차순 rank 1.., 입력 필드 유지', () => {
    const out = buildTierRanking([row('a', 'GOLD', 'II', 20), row('b', 'DIAMOND', 'II', 45)]);
    expect(out.map((r) => [r.userId, r.rank, r.score])).toEqual([
      ['b', 1, 2645],
      ['a', 2, 1420],
    ]);
    expect(out[0]).toMatchObject({ accountName: 'b#KR1', tier: 'DIAMOND', division: 'II', lp: 45 });
    expect(out[0]).not.toHaveProperty('value');
  });
  it('호출자 행의 value 필드는 보존되고 정렬에 쓰이지 않는다', () => {
    const out = buildTierRanking([
      { ...row('a', 'GOLD', 'II', 20), value: 9999 },
      { ...row('b', 'DIAMOND', 'II', 45), value: 1 },
    ]);
    expect(out.map((r) => [r.userId, r.rank, r.value])).toEqual([
      ['b', 1, 1],
      ['a', 2, 9999],
    ]);
  });
  it('UNRANKED 제외', () => {
    const out = buildTierRanking([row('a', 'UNRANKED', null, 0), row('b', 'IRON', 'IV', 0)]);
    expect(out.map((r) => r.userId)).toEqual(['b']);
    expect(out[0]!.rank).toBe(1);
  });
  it('빈 입력·전원 언랭 → 빈 결과', () => {
    expect(buildTierRanking([])).toEqual([]);
    expect(buildTierRanking([row('a', 'UNRANKED', null, 0)])).toEqual([]);
  });
  it('같은 점수는 다른 조합이어도 동점 규칙으로', () => {
    // Emerald IV 100 LP와 Emerald III 0 LP는 둘 다 2100
    const out = buildTierRanking([row('a', 'EMERALD', 'IV', 100, 5, 5), row('b', 'EMERALD', 'III', 0, 6, 4)]);
    expect(out.map((r) => [r.userId, r.score])).toEqual([
      ['b', 2100],
      ['a', 2100],
    ]);
  });
  it('공동 순위 없음, 입력 순서 무관, 입력을 바꾸지 않음', () => {
    const rows = [
      row('c', 'GOLD', 'I', 50),
      row('a', 'GOLD', 'I', 50),
      row('b', 'GOLD', 'I', 50),
      row('d', 'MASTER', null, 0),
      row('e', 'UNRANKED', null, 0),
    ];
    const snapshot = structuredClone(rows);
    const expected = buildTierRanking(rows);
    expect(expected.map((r) => [r.userId, r.rank])).toEqual([
      ['d', 1],
      ['a', 2],
      ['b', 3],
      ['c', 4],
    ]);
    const rnd = mulberry32(5);
    for (let i = 0; i < 30; i++) expect(buildTierRanking(shuffled(rows, rnd))).toEqual(expected);
    expect(rows).toEqual(snapshot);
  });
});

describe('buildEloRanking', () => {
  const row = (userId: string, elo: number, wins: number, losses: number) => ({ userId, elo, wins, losses, name: userId });

  it('minGames 경계: 4경기 제외, 5경기 포함', () => {
    const out = buildEloRanking({ rows: [row('a', 2000, 4, 0), row('b', 1000, 4, 1)], minGames: 5 });
    expect(out.map((r) => r.userId)).toEqual(['b']);
  });
  it('rank·games·winRate 추가, 입력 필드 유지', () => {
    const [first] = buildEloRanking({ rows: [row('a', 1421, 22, 9)], minGames: 5 });
    expect(first).toEqual({ userId: 'a', elo: 1421, wins: 22, losses: 9, name: 'a', rank: 1, games: 31, winRate: 0.71 });
  });
  it('호출자 행의 value 필드는 보존되고 정렬에 쓰이지 않는다', () => {
    const out = buildEloRanking({
      rows: [
        { ...row('a', 1100, 3, 3), value: 'caller-a' },
        { ...row('b', 1200, 3, 3), value: 'caller-b' },
      ],
      minGames: 5,
    });
    expect(out.map((r) => [r.userId, r.rank, r.value])).toEqual([
      ['b', 1, 'caller-b'],
      ['a', 2, 'caller-a'],
    ]);
  });
  it('elo 동점 → 승률 → 경기 수 → userId', () => {
    const rows = [
      row('d', 1500, 3, 3),
      row('c', 1500, 3, 3),
      row('b', 1500, 6, 6),
      row('a', 1500, 4, 2),
      row('z', 1600, 0, 5),
    ];
    const rnd = mulberry32(9);
    for (let i = 0; i < 30; i++) {
      expect(buildEloRanking({ rows: shuffled(rows, rnd), minGames: 5 }).map((r) => [r.userId, r.rank])).toEqual([
        ['z', 1],
        ['a', 2],
        ['b', 3],
        ['c', 4],
        ['d', 5],
      ]);
    }
  });
  it('음수 elo도 정렬한다', () => {
    const out = buildEloRanking({ rows: [row('a', -10, 3, 3), row('b', 5, 3, 3)], minGames: 1 });
    expect(out.map((r) => r.userId)).toEqual(['b', 'a']);
  });
  it('빈 입력 → 빈 결과', () => {
    expect(buildEloRanking({ rows: [], minGames: 5 })).toEqual([]);
  });
  it('minGames가 1 미만·정수 아님이면 RangeError(0경기 행의 winRate null 차단)', () => {
    expect(() => buildEloRanking({ rows: [], minGames: 0 })).toThrow(RangeError);
    expect(() => buildEloRanking({ rows: [], minGames: 2.5 })).toThrow(RangeError);
  });
});

describe('computeRankChange', () => {
  it('기준 − 현재', () => {
    expect(computeRankChange(5, 2)).toBe(3);
    expect(computeRankChange(2, 5)).toBe(-3);
    expect(computeRankChange(3, 3)).toBe(0);
  });
  it('기준 없음 → null', () => {
    expect(computeRankChange(undefined, 1)).toBeNull();
    expect(computeRankChange({}['u1' as never], 1)).toBeNull();
  });
});

describe('rollRankBaseline (7-7)', () => {
  const lastWeek = new Date('2026-10-25T15:00:00.000Z');
  const weekStart = new Date('2026-11-01T15:00:00.000Z');

  it('저장된 기준이 이번 주 것 → 그대로(이전 payload를 쓰지 않음)', () => {
    const stored = { periodStart: new Date(weekStart.getTime()), ranks: { a: 1 } };
    expect(rollRankBaseline({ stored, previousRanks: { a: 9 }, weekStart })).toEqual(stored);
  });
  it('기준이 지난 주 것 + 이전 payload → 이번 주, 이전 payload 순위', () => {
    expect(
      rollRankBaseline({
        stored: { periodStart: lastWeek, ranks: { a: 1 } },
        previousRanks: { a: 2, b: 1 },
        weekStart,
      }),
    ).toEqual({ periodStart: weekStart, ranks: { a: 2, b: 1 } });
  });
  it('몇 주 비어 있었어도 같다', () => {
    const old = new Date('2026-09-06T15:00:00.000Z');
    expect(rollRankBaseline({ stored: { periodStart: old, ranks: {} }, previousRanks: { a: 3 }, weekStart })).toEqual({
      periodStart: weekStart,
      ranks: { a: 3 },
    });
  });
  it('행 없음(첫 계산) → 이번 주, 빈 기준', () => {
    expect(rollRankBaseline({ stored: null, previousRanks: null, weekStart })).toEqual({
      periodStart: weekStart,
      ranks: {},
    });
  });
  it('기준이 지난 주 것인데 이전 payload를 못 읽음 → 빈 기준(옛 순위를 다시 쓰지 않는다)', () => {
    expect(
      rollRankBaseline({ stored: { periodStart: lastWeek, ranks: { a: 1 } }, previousRanks: null, weekStart }),
    ).toEqual({ periodStart: weekStart, ranks: {} });
  });
  it('저장 기준 없이 payload만 있음 → 빈 기준(시점 모르는 값을 기준으로 삼지 않는다)', () => {
    expect(rollRankBaseline({ stored: null, previousRanks: { a: 1 }, weekStart })).toEqual({
      periodStart: weekStart,
      ranks: {},
    });
  });
  it('weekStart보다 새 기준은 되돌리지 않는다', () => {
    const stored = { periodStart: weekStart, ranks: { a: 1 } };
    expect(rollRankBaseline({ stored, previousRanks: { a: 9 }, weekStart: lastWeek })).toEqual(stored);
  });
  it('한 주 동안 기준이 고정된다: 5분마다 다시 돌려도 값이 같다', () => {
    let baseline = rollRankBaseline({
      stored: { periodStart: lastWeek, ranks: {} },
      previousRanks: { a: 1, b: 2 },
      weekStart,
    });
    for (let i = 0; i < 5; i++) {
      baseline = rollRankBaseline({ stored: baseline, previousRanks: { a: 2, b: 1 }, weekStart });
    }
    expect(baseline).toEqual({ periodStart: weekStart, ranks: { a: 1, b: 2 } });
  });
  it('결과는 입력과 별개 객체', () => {
    const stored = { periodStart: new Date(weekStart.getTime()), ranks: { a: 1 } };
    const out = rollRankBaseline({ stored, previousRanks: null, weekStart });
    out.ranks.a = 99;
    out.periodStart.setTime(0);
    expect(stored.ranks.a).toBe(1);
    expect(stored.periodStart.getTime()).toBe(weekStart.getTime());
  });
  it('Invalid Date RangeError', () => {
    expect(() => rollRankBaseline({ stored: null, previousRanks: null, weekStart: new Date('nope') })).toThrow(
      RangeError,
    );
  });
});

describe('isRankingStale', () => {
  const computedAt = new Date('2026-10-30T12:00:00.000Z');
  const at = (ms: number) => new Date(computedAt.getTime() + ms);
  const LIMIT = RANKING_STALE_AFTER_SEC * 1000;

  it('경과 시간 경계: 정확히 660초는 신선, +1ms는 stale', () => {
    expect(isRankingStale({ computedAt, lastFailedAt: null, now: at(LIMIT) })).toBe(false);
    expect(isRankingStale({ computedAt, lastFailedAt: null, now: at(LIMIT + 1) })).toBe(true);
  });
  it('성공 뒤 실패 → 시간이 안 지났어도 stale', () => {
    expect(isRankingStale({ computedAt, lastFailedAt: at(1), now: at(2) })).toBe(true);
  });
  it('실패 시각이 성공과 같거나 이전 → 실패로 보지 않는다', () => {
    expect(isRankingStale({ computedAt, lastFailedAt: computedAt, now: at(1) })).toBe(false);
    expect(isRankingStale({ computedAt, lastFailedAt: at(-1), now: at(1) })).toBe(false);
  });
  it('시계가 앞선 now(음수 경과)는 stale 아님', () => {
    expect(isRankingStale({ computedAt, lastFailedAt: null, now: at(-5000) })).toBe(false);
  });
});
