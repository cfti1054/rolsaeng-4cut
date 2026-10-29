import { describe, expect, it } from 'vitest';
import { RankValue, RIOT_VERIFICATION_ICON_IDS } from '@gcd/shared';
import { isMatchesCacheStale, isSameRank, pickVerificationIcon, toRankValue } from './index';

describe('pickVerificationIcon', () => {
  it('후보는 0–28(29개)', () => {
    expect(RIOT_VERIFICATION_ICON_IDS).toHaveLength(29);
  });

  it('현재 아이콘이 후보 밖이면 29개 중 선택', () => {
    expect(pickVerificationIcon(4567, () => 0)).toBe(0);
    expect(pickVerificationIcon(4567, () => 0.999999)).toBe(28);
    expect(pickVerificationIcon(4567, () => 0.5)).toBe(14); // floor(0.5*29)=14
  });

  it('현재 아이콘은 절대 나오지 않는다(현재 0, random 0 → 1)', () => {
    expect(pickVerificationIcon(0, () => 0)).toBe(1);
  });

  it('현재 28, random 최대 → 27', () => {
    expect(pickVerificationIcon(28, () => 0.999999)).toBe(27);
  });

  it('현재 아이콘 앞뒤 인덱스 이동: 현재 10 → floor(r*28)=10이면 11', () => {
    expect(pickVerificationIcon(10, () => 10.5 / 28)).toBe(11);
    expect(pickVerificationIcon(10, () => 9.5 / 28)).toBe(9);
  });

  it('모든 현재 아이콘·random 값에서 현재와 다르고 후보 안에 있다', () => {
    for (const cur of [...RIOT_VERIFICATION_ICON_IDS, 29, 999, -1]) {
      for (let k = 0; k < 100; k++) {
        const got = pickVerificationIcon(cur, () => k / 100);
        expect(got).not.toBe(cur);
        expect(RIOT_VERIFICATION_ICON_IDS).toContain(got);
      }
    }
  });

  it('random 범위 밖: 1 이상 → 마지막, 음수 → 처음, NaN → RangeError', () => {
    expect(pickVerificationIcon(5, () => 1)).toBe(28);
    expect(pickVerificationIcon(28, () => 1)).toBe(27);
    expect(pickVerificationIcon(0, () => -0.5)).toBe(1);
    expect(() => pickVerificationIcon(0, () => Number.NaN)).toThrow(RangeError);
  });

  it('random을 정확히 한 번 호출', () => {
    let calls = 0;
    pickVerificationIcon(3, () => {
      calls++;
      return 0.3;
    });
    expect(calls).toBe(1);
  });
});

const entry = (tier: string, rank: string, lp = 0, wins = 0, losses = 0) => ({ tier, rank, leaguePoints: lp, wins, losses });

describe('toRankValue', () => {
  it('undefined → UNRANKED, division null, 0/0/0', () => {
    const r = toRankValue(undefined);
    expect(r).toEqual({ tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0 });
    expect(RankValue.parse(r)).toEqual(r);
  });

  it('일반 티어는 division 유지', () => {
    const r = toRankValue(entry('GOLD', 'II', 54, 31, 28));
    expect(r).toEqual({ tier: 'GOLD', division: 'II', lp: 54, wins: 31, losses: 28 });
    expect(RankValue.parse(r)).toEqual(r);
  });

  it.each(['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'])('%s × I–IV 모두 division 유지', (tier) => {
    for (const d of ['I', 'II', 'III', 'IV']) {
      const r = toRankValue(entry(tier, d, 99));
      expect(r.division).toBe(d);
      expect(RankValue.parse(r)).toEqual(r);
    }
  });

  it.each(['MASTER', 'GRANDMASTER', 'CHALLENGER'])('%s(apex)는 rank="I"를 받아도 division null', (tier) => {
    const r = toRankValue(entry(tier, 'I', 1234, 200, 150));
    expect(r).toEqual({ tier, division: null, lp: 1234, wins: 200, losses: 150 });
    expect(RankValue.parse(r)).toEqual(r);
  });

  it('apex는 rank 문자열을 보지 않는다(빈 문자열도 허용)', () => {
    expect(toRankValue(entry('MASTER', '')).division).toBeNull();
  });

  it('DIAMOND I 100LP 경계(apex 아님) → division I 유지', () => {
    expect(toRankValue(entry('DIAMOND', 'I', 100))).toMatchObject({ tier: 'DIAMOND', division: 'I', lp: 100 });
  });

  it('LP 0, 승패 0 허용', () => {
    expect(toRankValue(entry('IRON', 'IV', 0, 0, 0))).toEqual({ tier: 'IRON', division: 'IV', lp: 0, wins: 0, losses: 0 });
  });

  it('모르는 tier → RangeError(소문자, UNRANKED, 빈 문자열, 미래 티어)', () => {
    for (const t of ['gold', 'UNRANKED', '', 'TITAN']) {
      expect(() => toRankValue(entry(t, 'I'))).toThrow(RangeError);
    }
  });

  it('apex가 아닌데 모르는 rank → RangeError', () => {
    for (const d of ['V', '', 'i', '1']) {
      expect(() => toRankValue(entry('GOLD', d))).toThrow(RangeError);
    }
  });

  it('음수·정수 아닌 LP/승/패 → RangeError', () => {
    expect(() => toRankValue(entry('GOLD', 'I', -1))).toThrow(RangeError);
    expect(() => toRankValue(entry('GOLD', 'I', 1.5))).toThrow(RangeError);
    expect(() => toRankValue(entry('GOLD', 'I', 0, -1))).toThrow(RangeError);
    expect(() => toRankValue(entry('MASTER', 'I', 0, 0, Number.NaN))).toThrow(RangeError);
  });

  it('추가 필드(queueType 등)가 있어도 결과에 섞이지 않는다', () => {
    const r = toRankValue({ ...entry('SILVER', 'III', 10, 1, 2), queueType: 'RANKED_SOLO_5x5' } as never);
    expect(Object.keys(r).sort()).toEqual(['division', 'losses', 'lp', 'tier', 'wins']);
  });
});

describe('isSameRank', () => {
  const base: RankValue = { tier: 'GOLD', division: 'II', lp: 54, wins: 31, losses: 28 };

  it('모두 같으면 true(다른 객체여도)', () => {
    expect(isSameRank(base, { ...base })).toBe(true);
  });

  it.each([
    ['tier', { tier: 'PLATINUM' }],
    ['division', { division: 'I' }],
    ['lp', { lp: 55 }],
    ['wins', { wins: 32 }],
    ['losses', { losses: 29 }],
  ] as const)('%s 하나만 달라도 false', (_k, patch) => {
    expect(isSameRank(base, { ...base, ...patch } as RankValue)).toBe(false);
  });

  it('UNRANKED끼리 true, UNRANKED ↔ 랭크 false', () => {
    const u = toRankValue(undefined);
    expect(isSameRank(u, toRankValue(undefined))).toBe(true);
    expect(isSameRank(u, base)).toBe(false);
  });

  it('LP 0 승급(GOLD I 100LP → PLATINUM IV 0LP)은 다르다', () => {
    expect(isSameRank(toRankValue(entry('GOLD', 'I', 100, 10, 5)), toRankValue(entry('PLATINUM', 'IV', 0, 10, 5)))).toBe(false);
  });

  it('apex 같은 값 true', () => {
    expect(isSameRank(toRankValue(entry('MASTER', 'I', 10)), toRankValue(entry('MASTER', 'I', 10)))).toBe(true);
  });
});

describe('isMatchesCacheStale', () => {
  const now = new Date('2026-10-28T12:00:00.000+09:00');
  const before = (ms: number) => new Date(now.getTime() - ms);
  const H = 3_600_000;

  it('null → true', () => {
    expect(isMatchesCacheStale(null, now)).toBe(true);
  });

  it('기본 6시간: 정확히 6h → true, 6h − 1ms → false, 6h + 1ms → true', () => {
    expect(isMatchesCacheStale(before(6 * H), now)).toBe(true);
    expect(isMatchesCacheStale(before(6 * H - 1), now)).toBe(false);
    expect(isMatchesCacheStale(before(6 * H + 1), now)).toBe(true);
  });

  it('방금 동기화 → false', () => {
    expect(isMatchesCacheStale(now, now)).toBe(false);
  });

  it('미래 시각(시계 차이) → false', () => {
    expect(isMatchesCacheStale(new Date(now.getTime() + H), now)).toBe(false);
  });

  it('ttlHours 지정: 1h, 0.5h', () => {
    expect(isMatchesCacheStale(before(H), now, 1)).toBe(true);
    expect(isMatchesCacheStale(before(H - 1), now, 1)).toBe(false);
    expect(isMatchesCacheStale(before(30 * 60_000), now, 0.5)).toBe(true);
  });

  it('ttlHours 0 → 항상 true(같은 시각 포함)', () => {
    expect(isMatchesCacheStale(now, now, 0)).toBe(true);
  });

  it('ttlHours 음수·NaN·Infinity → RangeError', () => {
    expect(() => isMatchesCacheStale(now, now, -1)).toThrow(RangeError);
    expect(() => isMatchesCacheStale(now, now, Number.NaN)).toThrow(RangeError);
    expect(() => isMatchesCacheStale(now, now, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('Invalid Date → RangeError', () => {
    expect(() => isMatchesCacheStale(new Date('x'), now)).toThrow(RangeError);
    expect(() => isMatchesCacheStale(null, new Date('x'))).toThrow(RangeError);
  });
});
