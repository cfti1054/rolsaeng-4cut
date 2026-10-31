import { describe, expect, it } from 'vitest';
import { SEASON_AUTO_LENGTH_MONTHS_DEFAULT } from '@gcd/shared';
import {
  addKstMonths,
  computeSeasonBadges,
  computeSeasonStandings,
  kstMonthStart,
  latestStartedSeason,
  pickPreviousRating,
  planAutoSeason,
  resolveSeasonAt,
  seasonDaysLeft,
  seasonProgress,
  seasonStartElo,
  selectSeasonsToClose,
  softResetElo,
  type SeasonLike,
} from './index';

/** KST 표기 → Date */
const kst = (s: string) => new Date(`${s}+09:00`);
const season = (id: string, start: string, end: string): SeasonLike => ({ id, startsAt: kst(start), endsAt: kst(end) });
const LEN = SEASON_AUTO_LENGTH_MONTHS_DEFAULT;

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

describe('kstMonthStart', () => {
  it('KST 달 1일 00:00', () => {
    expect(kstMonthStart(kst('2026-11-03T12:34:56.789'))).toEqual(kst('2026-11-01T00:00:00.000'));
  });
  it('KST 자정 경계 = UTC 15:00', () => {
    // 2026-10-31T15:00Z = 2026-11-01 00:00 KST → 11월
    expect(kstMonthStart(new Date('2026-10-31T15:00:00.000Z')).toISOString()).toBe('2026-10-31T15:00:00.000Z');
    // 1ms 전은 10월
    expect(kstMonthStart(new Date('2026-10-31T14:59:59.999Z')).toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });
});

describe('addKstMonths', () => {
  it('1월 31일 + 1개월 = 2월 28일(평년), 29일(윤년), 시각 유지', () => {
    expect(addKstMonths(kst('2027-01-31T10:00:00.000'), 1)).toEqual(kst('2027-02-28T10:00:00.000'));
    expect(addKstMonths(kst('2028-01-31T23:30:00.000'), 1)).toEqual(kst('2028-02-29T23:30:00.000'));
  });
  it('연도 넘김·음수·0', () => {
    expect(addKstMonths(kst('2026-11-01T00:00:00.000'), 3)).toEqual(kst('2027-02-01T00:00:00.000'));
    expect(addKstMonths(kst('2027-03-31T00:00:00.000'), -1)).toEqual(kst('2027-02-28T00:00:00.000'));
    expect(addKstMonths(kst('2026-05-15T09:00:00.000'), 0)).toEqual(kst('2026-05-15T09:00:00.000'));
    expect(addKstMonths(kst('2026-01-15T00:00:00.000'), -13)).toEqual(kst('2024-12-15T00:00:00.000'));
  });
  it('UTC로는 전날인 KST 시각(KST 00:30)도 KST 달력 기준', () => {
    // 2027-01-31 00:30 KST = 2027-01-30T15:30Z. UTC 기준이면 30일 + 1개월 = 2월 28일 → 같은 결과가 우연히 나오지 않게 3월로 확인
    expect(addKstMonths(kst('2027-03-31T00:30:00.000'), 1)).toEqual(kst('2027-04-30T00:30:00.000'));
    expect(addKstMonths(kst('2027-04-01T00:30:00.000'), 1)).toEqual(kst('2027-05-01T00:30:00.000'));
  });
  it('정수 아닌 months RangeError', () => {
    expect(() => addKstMonths(new Date(), 1.5)).toThrow(RangeError);
  });
});

describe('resolveSeasonAt', () => {
  const s1 = season('s1', '2026-11-01T00:00:00', '2027-02-01T00:00:00');
  it('빈 목록 → null', () => {
    expect(resolveSeasonAt([], new Date())).toBeNull();
  });
  it('반열림 [start, end)', () => {
    expect(resolveSeasonAt([s1], kst('2026-11-01T00:00:00'))).toBe(s1);
    expect(resolveSeasonAt([s1], kst('2027-01-31T23:59:59.999'))).toBe(s1);
    expect(resolveSeasonAt([s1], kst('2027-02-01T00:00:00'))).toBeNull();
    expect(resolveSeasonAt([s1], kst('2026-10-31T23:59:59.999'))).toBeNull();
  });
  it('겹치는 시즌: startsAt 최신, 같으면 id ASC', () => {
    const long = season('long', '2026-01-01T00:00:00', '2027-12-31T00:00:00');
    const b = season('b', '2026-12-01T00:00:00', '2027-01-01T00:00:00');
    const a = season('a', '2026-12-01T00:00:00', '2027-03-01T00:00:00');
    expect(resolveSeasonAt([long, s1], kst('2026-11-15T00:00:00'))).toBe(s1);
    expect(resolveSeasonAt([long, s1, b, a], kst('2026-12-15T00:00:00'))).toBe(a);
    expect(resolveSeasonAt([long, s1, b, a], kst('2027-01-15T00:00:00'))).toBe(a);
    expect(resolveSeasonAt([long, s1, b, a], kst('2027-06-15T00:00:00'))).toBe(long);
  });
});

describe('latestStartedSeason', () => {
  it('시작한 것 중 startsAt 최신(끝났어도), 같으면 id ASC', () => {
    const old = season('old', '2026-01-01T00:00:00', '2026-04-01T00:00:00');
    const y = season('y', '2026-05-01T00:00:00', '2026-06-01T00:00:00');
    const x = season('x', '2026-05-01T00:00:00', '2026-07-01T00:00:00');
    const future = season('f', '2027-01-01T00:00:00', '2027-04-01T00:00:00');
    expect(latestStartedSeason([old, y, x, future], kst('2026-10-01T00:00:00'))).toBe(x);
    expect(latestStartedSeason([future], kst('2026-10-01T00:00:00'))).toBeNull();
    expect(latestStartedSeason([], kst('2026-10-01T00:00:00'))).toBeNull();
  });
});

describe('planAutoSeason (D116)', () => {
  it('시즌 없음, 2026-11-03 KST → 2026-11-01 ~ 2027-02-01 「시즌 1」', () => {
    expect(LEN).toBe(3);
    expect(planAutoSeason({ seasons: [], at: kst('2026-11-03T20:00:00'), lengthMonths: LEN })).toEqual({
      name: '시즌 1',
      startsAt: kst('2026-11-01T00:00:00'),
      endsAt: kst('2027-02-01T00:00:00'),
    });
  });

  it('끝난 시즌 뒤 2027-03-10 → 2027-02-01 ~ 2027-05-01 「시즌 2」(이어 붙임)', () => {
    const s1 = season('s1', '2026-11-01T00:00:00', '2027-02-01T00:00:00');
    expect(planAutoSeason({ seasons: [s1], at: kst('2027-03-10T12:00:00'), lengthMonths: LEN })).toEqual({
      name: '시즌 2',
      startsAt: kst('2027-02-01T00:00:00'),
      endsAt: kst('2027-05-01T00:00:00'),
    });
  });

  it('공백 기간은 빈 시즌을 만들지 않고 건너뛴다', () => {
    const s1 = season('s1', '2026-11-01T00:00:00', '2027-02-01T00:00:00');
    expect(planAutoSeason({ seasons: [s1], at: kst('2027-09-10T00:00:00'), lengthMonths: LEN })).toEqual({
      name: '시즌 2',
      startsAt: kst('2027-08-01T00:00:00'),
      endsAt: kst('2027-11-01T00:00:00'),
    });
    // 경계: at = 다음 구간 시작 시각 정확히
    expect(planAutoSeason({ seasons: [s1], at: kst('2027-05-01T00:00:00'), lengthMonths: LEN }).startsAt).toEqual(
      kst('2027-05-01T00:00:00'),
    );
  });

  describe('직전 시즌이 월말 임의 시각에 끝남(D139)', () => {
    const manual = season('m', '2026-11-01T00:00:00', '2027-01-31T10:00:00');

    it('바로 이은 구간이 at을 포함하면 직전 끝에서 시작', () => {
      expect(planAutoSeason({ seasons: [manual], at: kst('2027-02-15T00:00:00'), lengthMonths: LEN })).toEqual({
        name: '시즌 2',
        startsAt: kst('2027-01-31T10:00:00'),
        endsAt: kst('2027-04-30T10:00:00'),
      });
    });

    it('공백 건너뛰기는 KST 달 1일 00:00에 맞춰 날짜가 밀리지 않는다', () => {
      expect(planAutoSeason({ seasons: [manual], at: kst('2027-08-15T00:00:00'), lengthMonths: LEN })).toEqual({
        name: '시즌 2',
        startsAt: kst('2027-08-01T00:00:00'),
        endsAt: kst('2027-11-01T00:00:00'),
      });
    });

    it('바로 이은 구간 끝 직후: 정렬한 첫 구간이 at을 포함하면 그 구간', () => {
      expect(planAutoSeason({ seasons: [manual], at: kst('2027-04-30T12:00:00'), lengthMonths: LEN })).toMatchObject({
        startsAt: kst('2027-02-01T00:00:00'),
        endsAt: kst('2027-05-01T00:00:00'),
      });
      expect(planAutoSeason({ seasons: [manual], at: kst('2027-05-10T00:00:00'), lengthMonths: LEN })).toMatchObject({
        startsAt: kst('2027-05-01T00:00:00'),
        endsAt: kst('2027-08-01T00:00:00'),
      });
    });
  });

  it('미래 시즌과 겹치지 않게 끝을 자른다', () => {
    const future = season('f', '2026-12-15T00:00:00', '2027-03-15T00:00:00');
    expect(planAutoSeason({ seasons: [future], at: kst('2026-11-03T00:00:00'), lengthMonths: LEN })).toEqual({
      name: '시즌 2',
      startsAt: kst('2026-11-01T00:00:00'),
      endsAt: kst('2026-12-15T00:00:00'),
    });
  });

  it('KST 자정 경계: 2026-10-31T15:00Z는 11월 시즌, 1ms 전은 10월 시즌', () => {
    expect(planAutoSeason({ seasons: [], at: new Date('2026-10-31T15:00:00.000Z'), lengthMonths: 1 }).startsAt).toEqual(
      kst('2026-11-01T00:00:00'),
    );
    expect(
      planAutoSeason({ seasons: [], at: new Date('2026-10-31T14:59:59.999Z'), lengthMonths: 1 }),
    ).toMatchObject({ startsAt: kst('2026-10-01T00:00:00'), endsAt: kst('2026-11-01T00:00:00') });
  });

  it('at이 이미 시즌에 속함·lengthMonths 잘못 → RangeError', () => {
    const s1 = season('s1', '2026-11-01T00:00:00', '2027-02-01T00:00:00');
    expect(() => planAutoSeason({ seasons: [s1], at: kst('2026-12-01T00:00:00'), lengthMonths: LEN })).toThrow(
      RangeError,
    );
    expect(() => planAutoSeason({ seasons: [], at: new Date(), lengthMonths: 0 })).toThrow(RangeError);
    expect(() => planAutoSeason({ seasons: [], at: new Date(), lengthMonths: 1.5 })).toThrow(RangeError);
  });

  it('무작위: 결과는 항상 at을 포함하고 기존 시즌과 겹치지 않으며, 시작은 직전 끝 또는 KST 달 1일', () => {
    const rnd = mulberry32(42);
    const base = kst('2026-01-01T00:00:00').getTime();
    const DAY = 86_400_000;
    let checked = 0;
    for (let t = 0; t < 2000; t++) {
      const seasons: SeasonLike[] = [];
      const count = Math.floor(rnd() * 4);
      for (let i = 0; i < count; i++) {
        const st = base + Math.floor(rnd() * 900) * DAY + Math.floor(rnd() * DAY);
        const en = st + (1 + Math.floor(rnd() * 120)) * DAY;
        seasons.push({ id: `s${i}`, startsAt: new Date(st), endsAt: new Date(en) });
      }
      const at = new Date(base + Math.floor(rnd() * 1100 * DAY));
      if (resolveSeasonAt(seasons, at)) continue;
      const lengthMonths = 1 + Math.floor(rnd() * 6);
      const plan = planAutoSeason({ seasons, at, lengthMonths });
      expect(plan.startsAt.getTime()).toBeLessThanOrEqual(at.getTime());
      expect(at.getTime()).toBeLessThan(plan.endsAt.getTime());
      for (const s of seasons) {
        const overlap = plan.startsAt < s.endsAt && s.startsAt < plan.endsAt;
        expect(overlap).toBe(false);
      }
      const prevEnd = Math.max(
        -Infinity,
        ...seasons.map((s) => s.endsAt.getTime()).filter((e) => e <= at.getTime()),
      );
      const st = plan.startsAt.getTime();
      expect(st === prevEnd || st === kstMonthStart(plan.startsAt).getTime()).toBe(true);
      expect(plan.name).toBe(`시즌 ${seasons.length + 1}`);
      checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });
});

function shuffled<T>(list: readonly T[], rnd: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('softResetElo (6-1)', () => {
  it.each([
    [1421, 1211],
    [1512, 1256],
    [1000, 1000],
    [1001, 1001],
    [999, 999],
    [800, 900],
    [1500, 1250],
  ])('ratio 0.5: %i → %i', (elo, expected) => {
    expect(softResetElo(elo, 0.5)).toBe(expected);
  });

  it('ratio 0 → 1000(−0 없음), ratio 1 → 그대로', () => {
    expect(softResetElo(1421, 0)).toBe(1000);
    expect(softResetElo(777, 0)).toBe(1000);
    expect(softResetElo(1421, 1)).toBe(1421);
    expect(softResetElo(777, 1)).toBe(777);
  });

  it('반올림은 1000 기준 대칭', () => {
    for (let d = 0; d <= 2001; d++) {
      expect(softResetElo(1000 + d, 0.5) - 1000).toBe(1000 - softResetElo(1000 - d, 0.5));
    }
  });

  it('1000 밑으로도 변동분 기준으로 반올림(전체 값 반올림이면 1000이 되는 999)', () => {
    expect(softResetElo(997, 0.5)).toBe(998); // −1.5 → −2
    expect(softResetElo(1003, 0.5)).toBe(1002); // +1.5 → +2
  });

  it('0.5 외 비율의 부동소수 오차에 흔들리지 않는다', () => {
    expect(softResetElo(1005, 0.3)).toBe(1002); // +1.5 → +2
    expect(softResetElo(1025, 0.1)).toBe(1003); // +2.5 → +3
  });

  it('ratio ∉ [0, 1] RangeError', () => {
    for (const ratio of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => softResetElo(1500, ratio)).toThrow(RangeError);
    }
  });
  it('elo가 유한하지 않으면 RangeError', () => {
    expect(() => softResetElo(Number.NaN, 0.5)).toThrow(RangeError);
  });
});

describe('seasonStartElo (6-1)', () => {
  it('이전 값 있음 → 소프트 리셋, 없음 → 시드', () => {
    expect(seasonStartElo({ previousElo: 1421, tierSeed: 1800, ratio: 0.5 })).toBe(1211);
    expect(seasonStartElo({ previousElo: null, tierSeed: 1800, ratio: 0.5 })).toBe(1800);
  });
  it('이전 값 0은 없음이 아니다', () => {
    expect(seasonStartElo({ previousElo: 0, tierSeed: 1800, ratio: 0.5 })).toBe(500);
  });
  it('시드 경로에서도 ratio를 검사한다', () => {
    expect(() => seasonStartElo({ previousElo: null, tierSeed: 1800, ratio: 2 })).toThrow(RangeError);
  });
});

describe('pickPreviousRating (6-1, D142)', () => {
  const s1 = season('s1', '2026-01-01T00:00:00', '2026-04-01T00:00:00');
  const s2 = season('s2', '2026-04-01T00:00:00', '2026-07-01T00:00:00');
  const s3 = season('s3', '2026-07-01T00:00:00', '2026-10-01T00:00:00');
  const s4 = season('s4', '2026-10-01T00:00:00', '2027-01-01T00:00:00');
  const seasons = [s1, s2, s3, s4];
  const row = (seasonId: string, elo: number, games = 10) => ({ seasonId, elo, games });
  const startElo = (rows: readonly ReturnType<typeof row>[], target: SeasonLike) => {
    const prev = pickPreviousRating({ rows, seasons, targetStartsAt: target.startsAt });
    return seasonStartElo({ previousElo: prev?.elo ?? null, tierSeed: 1400, ratio: 0.5 });
  };

  it('표 1: 직전 시즌 행(5경기 이상) → 소프트 리셋', () => {
    expect(startElo([row('s1', 1100), row('s2', 1421)], s3)).toBe(1211);
  });
  it('표 2: 직전 시즌 행(5경기 미만)도 같은 규칙', () => {
    expect(startElo([row('s2', 1421, 1)], s3)).toBe(1211);
    expect(startElo([row('s2', 1421, 0)], s3)).toBe(1211);
  });
  it('표 3: 연속 빈 시즌 → 가장 최근 행에 리셋 1회', () => {
    const rows = [row('s1', 1600)];
    expect(pickPreviousRating({ rows, seasons, targetStartsAt: s4.startsAt })).toBe(rows[0]);
    expect(startElo(rows, s4)).toBe(1300); // 2회 적용했다면 1150
  });
  it('표 4: 시즌 공백은 영향 없음', () => {
    const later = season('later', '2028-01-01T00:00:00', '2028-04-01T00:00:00');
    const rows = [row('s2', 1421)];
    expect(pickPreviousRating({ rows, seasons: [...seasons, later], targetStartsAt: later.startsAt })).toBe(rows[0]);
  });
  it('표 5: 이전 시즌 행 없음 → null, 시드', () => {
    expect(pickPreviousRating({ rows: [], seasons, targetStartsAt: s3.startsAt })).toBeNull();
    expect(startElo([], s3)).toBe(1400);
    // 대상 이후 시즌 행만 있음
    expect(startElo([row('s4', 1900)], s3)).toBe(1400);
  });
  it('대상 시즌 자신과 시작이 같은 시즌은 이전이 아니다(엄격 <)', () => {
    const rows = [row('s3', 1900)];
    expect(pickPreviousRating({ rows, seasons, targetStartsAt: s3.startsAt })).toBeNull();
  });
  it('시작 1ms 앞이면 이전', () => {
    const rows = [row('s3', 1900)];
    const target = new Date(s3.startsAt.getTime() + 1);
    expect(pickPreviousRating({ rows, seasons, targetStartsAt: target })).toBe(rows[0]);
  });
  it('seasons에 없는 행은 무시', () => {
    const rows = [row('ghost', 2000), row('s1', 1100)];
    expect(pickPreviousRating({ rows, seasons, targetStartsAt: s4.startsAt })).toBe(rows[1]);
    expect(pickPreviousRating({ rows: [row('ghost', 2000)], seasons, targetStartsAt: s4.startsAt })).toBeNull();
  });
  it('겹친 시즌: startsAt 최신 → endsAt 최신 → seasonId ASC, 입력 순서 무관', () => {
    const target = kst('2026-12-01T00:00:00');
    const oldLong = season('old', '2026-01-01T00:00:00', '2026-11-30T00:00:00');
    const short = season('short', '2026-06-01T00:00:00', '2026-07-01T00:00:00');
    const longB = season('b', '2026-06-01T00:00:00', '2026-09-01T00:00:00');
    const longA = season('a', '2026-06-01T00:00:00', '2026-09-01T00:00:00');
    const all = [oldLong, short, longB, longA];
    const rows = all.map((s) => ({ seasonId: s.id }));
    const rnd = mulberry32(7);
    for (let i = 0; i < 50; i++) {
      const picked = pickPreviousRating({
        rows: shuffled(rows, rnd),
        seasons: shuffled(all, rnd),
        targetStartsAt: target,
      });
      expect(picked?.seasonId).toBe('a');
    }
    expect(
      pickPreviousRating({ rows: rows.slice(0, 3), seasons: all, targetStartsAt: target })?.seasonId,
    ).toBe('b');
    expect(
      pickPreviousRating({ rows: rows.slice(0, 2), seasons: all, targetStartsAt: target })?.seasonId,
    ).toBe('short');
  });
});

describe('selectSeasonsToClose (6-3)', () => {
  const GRACE = 60_000;
  const open = (id: string, end: string) => ({ ...season(id, '2026-01-01T00:00:00', end), closedAt: null });

  it('유예 경계: endsAt + 유예 − 1ms 제외, 정확히 같으면 대상, +1ms 대상', () => {
    const s = open('s', '2026-04-01T00:00:00');
    const edge = s.endsAt.getTime() + GRACE;
    expect(selectSeasonsToClose([s], new Date(edge - 1), GRACE)).toEqual([]);
    expect(selectSeasonsToClose([s], new Date(edge), GRACE)).toEqual([s]);
    expect(selectSeasonsToClose([s], new Date(edge + 1), GRACE)).toEqual([s]);
  });
  it('이미 닫힌 시즌 제외, 끝나지 않은 시즌 제외', () => {
    const closed = { ...open('c', '2026-02-01T00:00:00'), closedAt: kst('2026-02-01T00:05:00') };
    const running = open('r', '2027-02-01T00:00:00');
    expect(selectSeasonsToClose([closed, running], kst('2026-12-01T00:00:00'), GRACE)).toEqual([]);
  });
  it('endsAt ASC, 같으면 id ASC, 입력 순서 무관, 입력을 바꾸지 않음', () => {
    const b = open('b', '2026-03-01T00:00:00');
    const a = open('a', '2026-03-01T00:00:00');
    const first = open('z', '2026-02-01T00:00:00');
    const input = [b, a, first];
    const now = kst('2026-12-01T00:00:00');
    const rnd = mulberry32(1);
    for (let i = 0; i < 20; i++) {
      expect(selectSeasonsToClose(shuffled(input, rnd), now, GRACE).map((s) => s.id)).toEqual(['z', 'a', 'b']);
    }
    selectSeasonsToClose(input, now, GRACE);
    expect(input).toEqual([b, a, first]);
  });
  it('유예 0 허용, 음수·NaN RangeError, 빈 목록', () => {
    const s = open('s', '2026-04-01T00:00:00');
    expect(selectSeasonsToClose([s], s.endsAt, 0)).toEqual([s]);
    expect(() => selectSeasonsToClose([s], s.endsAt, -1)).toThrow(RangeError);
    expect(() => selectSeasonsToClose([s], s.endsAt, Number.NaN)).toThrow(RangeError);
    expect(selectSeasonsToClose([], s.endsAt, GRACE)).toEqual([]);
  });
});

describe('computeSeasonStandings (D145)', () => {
  it('최소 경기 미만 제외, 순위 1.., 필요한 필드만', () => {
    const rows = [
      { userId: 'u1', elo: 1300, wins: 3, losses: 2, extra: 'x' },
      { userId: 'u2', elo: 1500, wins: 3, losses: 1, extra: 'x' }, // 4경기 제외
      { userId: 'u3', elo: 1400, wins: 5, losses: 5, extra: 'x' },
    ];
    expect(computeSeasonStandings({ rows, minGames: 5 })).toEqual([
      { userId: 'u3', rank: 1, elo: 1400, wins: 5, losses: 5 },
      { userId: 'u1', rank: 2, elo: 1300, wins: 3, losses: 2 },
    ]);
  });
  it('빈 입력 → 빈 결과', () => {
    expect(computeSeasonStandings({ rows: [], minGames: 5 })).toEqual([]);
  });
  it('동점도 입력 순서와 무관하게 같은 순위', () => {
    const rows = ['d', 'b', 'a', 'c'].map((userId) => ({ userId, elo: 1200, wins: 3, losses: 3 }));
    const rnd = mulberry32(3);
    for (let i = 0; i < 20; i++) {
      expect(computeSeasonStandings({ rows: shuffled(rows, rnd), minGames: 5 }).map((s) => s.userId)).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
    }
  });
});

describe('computeSeasonBadges (6-4)', () => {
  it('순위 1·2·3만', () => {
    const standings = [4, 1, 3, 2, 5].map((rank) => ({ userId: `u${rank}`, rank }));
    expect(computeSeasonBadges(standings)).toEqual([
      { userId: 'u1', place: 1 },
      { userId: 'u2', place: 2 },
      { userId: 'u3', place: 3 },
    ]);
  });
  it('rank 0·음수·소수는 3 이하여도 뱃지 대상이 아니다', () => {
    const standings = [0, -1, 1.5, 2.999, 4].map((rank, i) => ({ userId: `u${i}`, rank }));
    expect(computeSeasonBadges(standings)).toEqual([]);
    expect(computeSeasonBadges([...standings, { userId: 'ok', rank: 2 }])).toEqual([{ userId: 'ok', place: 2 }]);
  });
  it('3명 미만이면 있는 만큼, 빈 입력은 빈 결과', () => {
    expect(computeSeasonBadges([{ userId: 'u1', rank: 1 }])).toEqual([{ userId: 'u1', place: 1 }]);
    expect(computeSeasonBadges([])).toEqual([]);
  });
});

describe('seasonDaysLeft', () => {
  const END = kst('2027-02-01T00:00:00'); // 마지막 날 = 1월 31일

  it('마지막 날 전체가 0(D-DAY), 하루 전은 1', () => {
    expect(seasonDaysLeft(END, kst('2027-01-31T00:00:00'))).toBe(0);
    expect(seasonDaysLeft(END, kst('2027-01-31T23:59:59.999'))).toBe(0);
    expect(seasonDaysLeft(END, kst('2027-01-30T23:59:59.999'))).toBe(1);
    expect(seasonDaysLeft(END, kst('2027-01-30T00:00:00'))).toBe(1);
  });
  it('끝난 뒤 0(음수 아님)', () => {
    expect(seasonDaysLeft(END, END)).toBe(0);
    expect(seasonDaysLeft(END, kst('2027-03-01T00:00:00'))).toBe(0);
  });
  it('시즌 시작 시점', () => {
    expect(seasonDaysLeft(END, kst('2026-11-01T00:00:00'))).toBe(91);
  });
  it('자정이 아닌 시각에 끝나는 시즌: 그 날이 마지막 날', () => {
    const end = kst('2027-01-31T10:00:00');
    expect(seasonDaysLeft(end, kst('2027-01-31T09:00:00'))).toBe(0);
    expect(seasonDaysLeft(end, kst('2027-01-30T23:00:00'))).toBe(1);
  });
  it('KST 날짜 기준: UTC 날짜가 같아도 KST 날짜가 다르면 다르다', () => {
    // 둘 다 UTC 2027-01-30. 앞은 KST 30일, 뒤는 KST 31일
    expect(seasonDaysLeft(END, new Date('2027-01-30T14:59:59.999Z'))).toBe(1);
    expect(seasonDaysLeft(END, new Date('2027-01-30T15:00:00.000Z'))).toBe(0);
  });
  it('Invalid Date RangeError', () => {
    expect(() => seasonDaysLeft(new Date('nope'), END)).toThrow(RangeError);
  });
});

describe('seasonProgress', () => {
  const s = { startsAt: kst('2026-11-01T00:00:00'), endsAt: kst('2026-11-11T00:00:00') };

  it('시작 전 0, 시작 0, 끝 1, 끝난 뒤 1', () => {
    expect(seasonProgress(s, kst('2026-10-01T00:00:00'))).toBe(0);
    expect(seasonProgress(s, s.startsAt)).toBe(0);
    expect(seasonProgress(s, s.endsAt)).toBe(1);
    expect(seasonProgress(s, kst('2027-01-01T00:00:00'))).toBe(1);
  });
  it('중간값, 소수 셋째 자리', () => {
    expect(seasonProgress(s, kst('2026-11-06T00:00:00'))).toBe(0.5);
    const third = { startsAt: kst('2026-11-01T00:00:00'), endsAt: kst('2026-11-04T00:00:00') };
    expect(seasonProgress(third, kst('2026-11-02T00:00:00'))).toBe(0.333);
    expect(seasonProgress(third, kst('2026-11-03T00:00:00'))).toBe(0.667);
  });
  it('길이 0 구간도 NaN이 아니다', () => {
    const zero = { startsAt: s.startsAt, endsAt: s.startsAt };
    expect(seasonProgress(zero, s.startsAt)).toBe(0);
    expect(seasonProgress(zero, new Date(s.startsAt.getTime() - 1))).toBe(0);
    expect(seasonProgress(zero, new Date(s.startsAt.getTime() + 1))).toBe(1);
  });
});
