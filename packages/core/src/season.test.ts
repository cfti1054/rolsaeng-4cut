import { describe, expect, it } from 'vitest';
import { SEASON_AUTO_LENGTH_MONTHS_DEFAULT } from '@gcd/shared';
import {
  addKstMonths,
  kstMonthStart,
  latestStartedSeason,
  planAutoSeason,
  resolveSeasonAt,
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
