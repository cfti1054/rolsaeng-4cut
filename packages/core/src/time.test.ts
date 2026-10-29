import { describe, expect, it } from 'vitest';
import { SyncQuota } from '@gcd/shared';
import { buildSyncQuota, formatKstMidnight, kstDayWindow } from './index';

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
