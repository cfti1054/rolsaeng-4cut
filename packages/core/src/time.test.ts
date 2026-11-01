import { describe, expect, it } from 'vitest';
import { SyncQuota } from '@gcd/shared';
import {
  activityPeriodWindow,
  buildSyncQuota,
  formatKstMidnight,
  kstDateKey,
  kstDayWindow,
  kstMonthWindow,
  kstWeekWindow,
} from './index';

const iso = (s: string) => new Date(s);

describe('kstDayWindow', () => {
  it('KST 낮 시각 → 그날 KST 00:00 ~ 다음날 00:00', () => {
    const w = kstDayWindow(iso('2026-10-28T12:34:56.789+09:00'));
    expect(w.start.toISOString()).toBe('2026-10-27T15:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-28T15:00:00.000Z');
  });

  it('KST 23:59:59.999는 아직 그날', () => {
    const w = kstDayWindow(iso('2026-10-28T23:59:59.999+09:00'));
    expect(w.start.toISOString()).toBe('2026-10-27T15:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-10-28T15:00:00.000Z');
  });

  it('KST 00:00:00.000은 새 날의 시작(start = now)', () => {
    const now = iso('2026-10-29T00:00:00.000+09:00');
    const w = kstDayWindow(now);
    expect(w.start.getTime()).toBe(now.getTime());
    expect(w.end.toISOString()).toBe('2026-10-29T15:00:00.000Z');
  });

  it('UTC 날짜와 KST 날짜가 다른 시각(UTC 15:00 직전·직후)', () => {
    // UTC 14:59:59.999 = KST 23:59:59.999 (같은 UTC 날짜지만 KST 하루의 끝)
    expect(kstDayWindow(iso('2026-10-28T14:59:59.999Z')).start.toISOString()).toBe('2026-10-27T15:00:00.000Z');
    // UTC 15:00 = KST 다음날 00:00
    expect(kstDayWindow(iso('2026-10-28T15:00:00.000Z')).start.toISOString()).toBe('2026-10-28T15:00:00.000Z');
  });

  it('UTC 자정(= KST 09:00)은 KST 하루 중간', () => {
    const w = kstDayWindow(iso('2026-10-28T00:00:00.000Z'));
    expect(w.start.toISOString()).toBe('2026-10-27T15:00:00.000Z');
  });

  it('연말·윤일 경계', () => {
    expect(kstDayWindow(iso('2026-12-31T23:59:59.999+09:00')).end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(kstDayWindow(iso('2027-01-01T00:00:00.000+09:00')).start.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(kstDayWindow(iso('2028-02-29T10:00:00+09:00')).start.toISOString()).toBe('2028-02-28T15:00:00.000Z');
  });

  it('1970년 이전(음수 epoch)도 내림이 맞다', () => {
    expect(kstDayWindow(iso('1969-12-31T12:00:00+09:00')).start.toISOString()).toBe('1969-12-30T15:00:00.000Z');
  });

  it('end − start = 24h, start ≤ now < end', () => {
    for (const s of ['2026-03-08T02:30:00-05:00', '2026-10-25T01:30:00+01:00', '2026-06-01T08:59:59.999Z']) {
      const now = iso(s);
      const w = kstDayWindow(now);
      expect(w.end.getTime() - w.start.getTime()).toBe(86_400_000);
      expect(w.start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime()).toBeLessThan(w.end.getTime());
    }
  });

  it('입력 Date를 바꾸지 않는다', () => {
    const now = iso('2026-10-28T12:00:00+09:00');
    const t = now.getTime();
    kstDayWindow(now);
    expect(now.getTime()).toBe(t);
  });

  it('Invalid Date → RangeError', () => {
    expect(() => kstDayWindow(new Date('nope'))).toThrow(RangeError);
  });
});

describe('kstWeekWindow', () => {
  const MON = '2026-10-25T15:00:00.000Z'; // 2026-10-26(월) 00:00 KST
  const NEXT_MON = '2026-11-01T15:00:00.000Z'; // 2026-11-02(월) 00:00 KST

  it('평일 → 그 주 월요일 00:00 KST ~ 다음 월요일', () => {
    const w = kstWeekWindow(iso('2026-10-30T12:00:00+09:00')); // 금요일
    expect(w.start.toISOString()).toBe(MON);
    expect(w.end.toISOString()).toBe(NEXT_MON);
  });

  it('일요일 23:59:59.999 KST는 아직 지난주, 월요일 00:00 KST(UTC 일요일 15:00)는 새 주', () => {
    expect(kstWeekWindow(iso('2026-11-01T23:59:59.999+09:00')).start.toISOString()).toBe(MON);
    expect(kstWeekWindow(iso('2026-11-01T14:59:59.999Z')).start.toISOString()).toBe(MON);
    const monday = iso('2026-11-01T15:00:00.000Z');
    expect(monday.getUTCDay()).toBe(0); // UTC로는 일요일
    expect(kstWeekWindow(monday).start.toISOString()).toBe(NEXT_MON);
    expect(kstWeekWindow(monday).end.toISOString()).toBe('2026-11-08T15:00:00.000Z');
  });

  it('요일 7개 모두 같은 주', () => {
    for (let d = 26; d <= 31; d++) {
      expect(kstWeekWindow(iso(`2026-10-${d}T09:30:00+09:00`)).start.toISOString()).toBe(MON);
    }
    expect(kstWeekWindow(iso('2026-11-01T09:30:00+09:00')).start.toISOString()).toBe(MON);
  });

  it('월·연 경계를 넘는 주', () => {
    // 2026-12-31(목) → 12-28(월) 시작, 2027-01-03(일)까지
    const w = kstWeekWindow(iso('2027-01-03T23:00:00+09:00'));
    expect(w.start.toISOString()).toBe('2026-12-27T15:00:00.000Z');
    expect(w.end.toISOString()).toBe('2027-01-03T15:00:00.000Z');
  });

  it('1970년 이전(음수 일 번호)도 월요일', () => {
    const w = kstWeekWindow(iso('1969-12-28T12:00:00+09:00')); // 일요일
    expect(w.start.toISOString()).toBe('1969-12-21T15:00:00.000Z');
    expect(new Date(w.start.getTime() + 9 * 3_600_000).getUTCDay()).toBe(1);
  });

  it('start ≤ now < end, 길이 7일, start는 KST 월요일 자정', () => {
    for (let i = 0; i < 400; i++) {
      const now = new Date(iso('2026-01-01T00:00:00Z').getTime() + i * 11 * 3_600_000 + i);
      const w = kstWeekWindow(now);
      expect(w.end.getTime() - w.start.getTime()).toBe(7 * 86_400_000);
      expect(w.start.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime()).toBeLessThan(w.end.getTime());
      expect(new Date(w.start.getTime() + 9 * 3_600_000).getUTCDay()).toBe(1);
      expect(formatKstMidnight(w.start)).toMatch(/T00:00:00\.000\+09:00$/);
    }
  });

  it('Invalid Date → RangeError', () => {
    expect(() => kstWeekWindow(new Date('nope'))).toThrow(RangeError);
  });
});

describe('formatKstMidnight', () => {
  it('KST 자정을 +09:00 표기로', () => {
    expect(formatKstMidnight(iso('2026-10-28T15:00:00.000Z'))).toBe('2026-10-29T00:00:00.000+09:00');
  });
  it('KST 자정이 아니면 RangeError', () => {
    expect(() => formatKstMidnight(iso('2026-10-28T15:00:00.001Z'))).toThrow(RangeError);
    expect(() => formatKstMidnight(iso('2026-10-29T00:00:00.000Z'))).toThrow(RangeError);
  });
});

describe('buildSyncQuota', () => {
  const now = iso('2026-10-28T21:15:00+09:00');

  it('계약 예시: resets_at = 2026-10-29T00:00:00.000+09:00', () => {
    const q = buildSyncQuota(1, 5, now);
    expect(q).toEqual({ limit: 5, used: 1, remaining: 4, resets_at: '2026-10-29T00:00:00.000+09:00' });
    expect(SyncQuota.parse(q)).toEqual(q);
    expect(new Date(q.resets_at).getTime()).toBe(kstDayWindow(now).end.getTime());
  });

  it('used 0 → remaining = limit', () => {
    expect(buildSyncQuota(0, 5, now).remaining).toBe(5);
  });

  it('used = limit → 0, used > limit → 0(음수 아님)', () => {
    expect(buildSyncQuota(5, 5, now).remaining).toBe(0);
    expect(buildSyncQuota(7, 5, now).remaining).toBe(0);
  });

  it('limit 0', () => {
    expect(buildSyncQuota(0, 0, now)).toMatchObject({ limit: 0, used: 0, remaining: 0 });
  });

  it('KST 23:59:59.999 vs 00:00:00.000 → resets_at이 하루 넘어간다', () => {
    expect(buildSyncQuota(0, 5, iso('2026-10-28T23:59:59.999+09:00')).resets_at).toBe('2026-10-29T00:00:00.000+09:00');
    expect(buildSyncQuota(0, 5, iso('2026-10-29T00:00:00.000+09:00')).resets_at).toBe('2026-10-30T00:00:00.000+09:00');
  });

  it('UTC 날짜 기준이 아니다: UTC 2026-10-28T16:00Z(KST 29일 01:00) → 30일 자정', () => {
    expect(buildSyncQuota(0, 5, iso('2026-10-28T16:00:00Z')).resets_at).toBe('2026-10-30T00:00:00.000+09:00');
  });

  it('월말·연말 넘어감', () => {
    expect(buildSyncQuota(0, 5, iso('2026-10-31T12:00:00+09:00')).resets_at).toBe('2026-11-01T00:00:00.000+09:00');
    expect(buildSyncQuota(0, 5, iso('2026-12-31T23:00:00+09:00')).resets_at).toBe('2027-01-01T00:00:00.000+09:00');
  });

  it('음수·정수 아님 → RangeError', () => {
    expect(() => buildSyncQuota(-1, 5, now)).toThrow(RangeError);
    expect(() => buildSyncQuota(1.5, 5, now)).toThrow(RangeError);
    expect(() => buildSyncQuota(0, -5, now)).toThrow(RangeError);
    expect(() => buildSyncQuota(0, Number.NaN, now)).toThrow(RangeError);
  });
});

// -----------------------------------------------------------------------------
// S5 9-1: kstMonthWindow, activityPeriodWindow, kstDateKey
// -----------------------------------------------------------------------------

describe('kstMonthWindow (S5)', () => {
  it('1월 31일 23:59:59.999 KST는 1월, 2월 1일 00:00 KST(= UTC 1월 31일 15:00)는 2월', () => {
    const jan = kstMonthWindow(iso('2027-01-31T23:59:59.999+09:00'));
    expect(jan.start.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(jan.end.toISOString()).toBe('2027-01-31T15:00:00.000Z');
    const feb = kstMonthWindow(iso('2027-01-31T15:00:00.000Z'));
    expect(feb.start.toISOString()).toBe('2027-01-31T15:00:00.000Z');
    expect(feb.end.toISOString()).toBe('2027-02-28T15:00:00.000Z');
    // UTC 1월 31일 14:59:59.999 = KST 1월 31일 23:59:59.999 → 아직 1월
    expect(kstMonthWindow(iso('2027-01-31T14:59:59.999Z')).start.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('12월 → 다음 해 1월 1일 끝', () => {
    const w = kstMonthWindow(iso('2026-12-15T12:00:00+09:00'));
    expect(w.start.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('start ≤ now < end, 입력을 바꾸지 않는다', () => {
    const now = iso('2026-10-31T21:00:00+09:00');
    const before = now.getTime();
    const w = kstMonthWindow(now);
    expect(w.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime()).toBeLessThan(w.end.getTime());
    expect(now.getTime()).toBe(before);
  });

  it('잘못된 Date → RangeError', () => {
    expect(() => kstMonthWindow(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('activityPeriodWindow (S5)', () => {
  it('week = kstWeekWindow, days 7', () => {
    const now = iso('2026-10-28T12:00:00+09:00');
    const w = activityPeriodWindow('week', now);
    expect(w).toEqual({ ...kstWeekWindow(now), days: 7 });
    expect(w.start.toISOString()).toBe('2026-10-25T15:00:00.000Z'); // 월요일 10-26 00:00 KST
  });

  it('주 경계: 일요일 23:59:59.999 KST는 지난주, 월요일 00:00 KST는 새 주', () => {
    const sun = activityPeriodWindow('week', iso('2026-11-01T23:59:59.999+09:00'));
    expect(sun.start.toISOString()).toBe('2026-10-25T15:00:00.000Z');
    expect(sun.end.toISOString()).toBe('2026-11-01T15:00:00.000Z');
    const mon = activityPeriodWindow('week', iso('2026-11-02T00:00:00.000+09:00'));
    expect(mon.start.toISOString()).toBe('2026-11-01T15:00:00.000Z');
    expect(mon.start.getTime()).toBe(sun.end.getTime());
  });

  it('month days = 그 달 날짜 수(31, 30, 평년 2월 28, 윤년 2월 29)', () => {
    expect(activityPeriodWindow('month', iso('2026-10-31T21:00:00+09:00')).days).toBe(31);
    expect(activityPeriodWindow('month', iso('2026-11-01T00:00:00+09:00')).days).toBe(30);
    expect(activityPeriodWindow('month', iso('2027-02-10T00:00:00+09:00')).days).toBe(28);
    const leap = activityPeriodWindow('month', iso('2028-02-29T23:59:59.999+09:00'));
    expect(leap.days).toBe(29);
    expect(leap.start.toISOString()).toBe('2028-01-31T15:00:00.000Z');
    expect(leap.end.toISOString()).toBe('2028-02-29T15:00:00.000Z');
  });

  it('month = kstMonthWindow', () => {
    const now = iso('2027-02-01T00:00:00+09:00');
    const w = activityPeriodWindow('month', now);
    expect({ start: w.start, end: w.end }).toEqual(kstMonthWindow(now));
  });

  it('모르는 period → RangeError', () => {
    expect(() => activityPeriodWindow('year' as never, iso('2026-10-31T00:00:00Z'))).toThrow(RangeError);
  });
});

describe('kstDateKey (S5)', () => {
  it('KST 날짜로 표기(UTC 15:00 경계)', () => {
    expect(kstDateKey(iso('2026-10-27T14:59:59.999Z'))).toBe('2026-10-27');
    expect(kstDateKey(iso('2026-10-27T15:00:00.000Z'))).toBe('2026-10-28');
    expect(kstDateKey(iso('2026-10-27T20:10:00+09:00'))).toBe('2026-10-27');
  });

  it('연말·윤일', () => {
    expect(kstDateKey(iso('2026-12-31T23:59:59.999+09:00'))).toBe('2026-12-31');
    expect(kstDateKey(iso('2027-01-01T00:00:00+09:00'))).toBe('2027-01-01');
    expect(kstDateKey(iso('2028-02-29T00:00:00+09:00'))).toBe('2028-02-29');
  });

  it('잘못된 Date → RangeError', () => {
    expect(() => kstDateKey(new Date('x'))).toThrow(RangeError);
  });
});
