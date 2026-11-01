import { describe, expect, it } from 'vitest';
import {
  NO_SHOW_RESTRICTION_DAYS_DEFAULT,
  NO_SHOW_THRESHOLD_DEFAULT,
  NO_SHOW_WINDOW_DAYS_DEFAULT,
} from '@gcd/shared';
import {
  computeScrimRestriction,
  isNoShowMarkWindowOpen,
  noShowLookbackStart,
  type NoShowPolicy,
} from './index';

const DAY = 24 * 60 * 60 * 1000;
const policy: NoShowPolicy = {
  threshold: NO_SHOW_THRESHOLD_DEFAULT,
  windowDays: NO_SHOW_WINDOW_DAYS_DEFAULT,
  restrictionDays: NO_SHOW_RESTRICTION_DAYS_DEFAULT,
};
const NOW = new Date('2026-10-29T12:00:00.000Z');
/** NOW 기준 d일 전(소수 허용) */
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);
const plus = (base: Date, ms: number) => new Date(base.getTime() + ms);

describe('computeScrimRestriction', () => {
  it('정책 기본값은 3회 / 30일 / 1일', () => {
    expect(policy).toEqual({ threshold: 3, windowDays: 30, restrictionDays: 1 });
  });

  it('빈 입력 → 제한 없음, 0회, last null', () => {
    expect(computeScrimRestriction([], NOW, policy)).toEqual({
      restricted: false,
      until: null,
      recentCount: 0,
      lastNoShowAt: null,
    });
  });

  it('2회 → 제한 없음(recentCount 2)', () => {
    const r = computeScrimRestriction([ago(3), ago(1)], NOW, policy);
    expect(r.restricted).toBe(false);
    expect(r.until).toBeNull();
    expect(r.recentCount).toBe(2);
    expect(r.lastNoShowAt).toEqual(ago(1));
  });

  it('정확히 3회째 노쇼 → 제한, until = 3회째 + 제한 일수', () => {
    const third = ago(0.5);
    const r = computeScrimRestriction([ago(20), ago(10), third], NOW, policy);
    expect(r.restricted).toBe(true);
    expect(r.until).toEqual(plus(third, policy.restrictionDays * DAY));
    expect(r.recentCount).toBe(3);
  });

  it('3회째가 now와 같은 시각이어도 포함(구간 끝 포함)', () => {
    const r = computeScrimRestriction([ago(5), ago(2), NOW], NOW, policy);
    expect(r.restricted).toBe(true);
    expect(r.until).toEqual(plus(NOW, policy.restrictionDays * DAY));
  });

  it('30일 창 경계: 첫 노쇼가 정확히 30일 전이면 구간 시작 배제 → 발동 안 함', () => {
    const m = ago(0.5);
    const r = computeScrimRestriction([plus(m, -30 * DAY), ago(10), m], NOW, policy);
    expect(r.restricted).toBe(false);
  });

  it('30일 창 경계: 30일 − 1ms 전이면 포함 → 발동', () => {
    const m = ago(0.5);
    const r = computeScrimRestriction([plus(m, -30 * DAY + 1), ago(10), m], NOW, policy);
    expect(r.restricted).toBe(true);
    expect(r.until).toEqual(plus(m, policy.restrictionDays * DAY));
  });

  it('recentCount 경계: (now − 30일, now] — 정확히 30일 전은 제외, 1ms 뒤는 포함', () => {
    expect(computeScrimRestriction([ago(30)], NOW, policy).recentCount).toBe(0);
    expect(computeScrimRestriction([plus(ago(30), 1)], NOW, policy).recentCount).toBe(1);
  });

  it('제한 해제 시각: now = until이면 해제, until − 1ms면 제한', () => {
    const third = new Date('2026-10-20T10:00:00.000Z');
    const marks = [plus(third, -2 * DAY), plus(third, -DAY), third];
    const until = plus(third, policy.restrictionDays * DAY);
    const before = computeScrimRestriction(marks, plus(until, -1), policy);
    expect(before.restricted).toBe(true);
    expect(before.until).toEqual(until);
    const at = computeScrimRestriction(marks, until, policy);
    expect(at.restricted).toBe(false);
    expect(at.until).toBeNull();
    expect(at.recentCount).toBe(3);
  });

  it('발동 후 4번째 노쇼 → 해제 시각이 4번째 + 제한 일수로 연장', () => {
    const fourth = ago(0.25);
    const r = computeScrimRestriction([ago(6), ago(5), ago(4), fourth], NOW, policy);
    expect(r.until).toEqual(plus(fourth, policy.restrictionDays * DAY));
    expect(r.recentCount).toBe(4);
  });

  it('오래된 발동 + 최근 1회: 최근 노쇼 L 기준 30일 안 개수만 보면 틀림 → 발동 제한은 이미 만료', () => {
    // 35·34·33일 전 3회(33일 전에 발동, 26일 전 해제), 그리고 어제 1회.
    // L(어제) 기준 (L−30일, L]에는 33일 전이 없어 1회 → 발동 아님. 제한 없음이 정답.
    const r = computeScrimRestriction([ago(35), ago(34), ago(33), ago(1)], NOW, policy);
    expect(r.restricted).toBe(false);
    expect(r.recentCount).toBe(1);
    expect(r.lastNoShowAt).toEqual(ago(1));
  });

  it('now 기준 30일 개수(2회)만 보면 놓치는 경우: 12시간 전 표시 시점에는 30일 안 3회였으므로 제한 중', () => {
    // 12시간 전 m의 구간 (m − 30일, m]에 30.4일·1일·12시간 전 3회 → 발동.
    // now 기준 30일 창에는 30.4일 전이 빠져 2회지만, 1일 제한은 아직 남아 있다.
    const marks = [ago(30.4), ago(1), ago(0.5)];
    const r = computeScrimRestriction(marks, NOW, policy);
    expect(r.restricted).toBe(true);
    expect(r.until).toEqual(plus(ago(0.5), policy.restrictionDays * DAY));
    expect(r.recentCount).toBe(2);
  });

  it('미래 시각(시계 오차)은 무시: 판정·recentCount·last 모두', () => {
    const r = computeScrimRestriction([ago(3), ago(2), plus(NOW, 1)], NOW, policy);
    expect(r.restricted).toBe(false);
    expect(r.recentCount).toBe(2);
    expect(r.lastNoShowAt).toEqual(ago(2));
  });

  it('입력 순서 무관', () => {
    const a = [ago(20), ago(10), ago(1), ago(40)];
    const b = [ago(1), ago(40), ago(10), ago(20)];
    expect(computeScrimRestriction(a, NOW, policy)).toEqual(computeScrimRestriction(b, NOW, policy));
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const marks = [ago(1), ago(3), ago(2)];
    const copy = marks.map((d) => d.getTime());
    computeScrimRestriction(marks, NOW, policy);
    expect(marks.map((d) => d.getTime())).toEqual(copy);
  });

  it('같은 시각 노쇼 3건(한 번에 표시)도 3회로 센다', () => {
    const m = ago(0.5);
    const r = computeScrimRestriction([m, new Date(m), new Date(m)], NOW, policy);
    expect(r.restricted).toBe(true);
    expect(r.until).toEqual(plus(m, policy.restrictionDays * DAY));
  });

  it('정책 값 변경(threshold 2, window 10, restriction 3)', () => {
    const p = { threshold: 2, windowDays: 10, restrictionDays: 3 };
    expect(computeScrimRestriction([ago(9), ago(1)], NOW, p).until).toEqual(plus(ago(1), 3 * DAY));
    expect(computeScrimRestriction([ago(12), ago(1)], NOW, p).restricted).toBe(false);
  });

  it('잘못된 정책·Date → RangeError', () => {
    expect(() => computeScrimRestriction([], NOW, { ...policy, threshold: 0 })).toThrow(RangeError);
    expect(() => computeScrimRestriction([], NOW, { ...policy, windowDays: 1.5 })).toThrow(RangeError);
    expect(() => computeScrimRestriction([new Date('x')], NOW, policy)).toThrow(RangeError);
    expect(() => computeScrimRestriction([], new Date('x'), policy)).toThrow(RangeError);
  });
});

describe('noShowLookbackStart', () => {
  it('now − (windowDays + restrictionDays)일', () => {
    expect(noShowLookbackStart(NOW, policy)).toEqual(ago(policy.windowDays + policy.restrictionDays));
  });

  // 결정적 의사 난수(LCG)로 여러 노쇼 이력을 만들어 하한으로 자른 입력과 전체 입력의 판정을 비교
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('하한 초과만 넘겨도 restricted·until·recentCount가 전체 입력과 같다(200개 이력)', () => {
    const rand = lcg(42);
    for (let k = 0; k < 200; k++) {
      const n = Math.floor(rand() * 8);
      const marks = Array.from({ length: n }, () => ago(rand() * 80 - 2)); // 일부는 미래
      const lb = noShowLookbackStart(NOW, policy).getTime();
      const cut = marks.filter((d) => d.getTime() > lb);
      const full = computeScrimRestriction(marks, NOW, policy);
      const part = computeScrimRestriction(cut, NOW, policy);
      expect(part.restricted).toBe(full.restricted);
      expect(part.until).toEqual(full.until);
      expect(part.recentCount).toBe(full.recentCount);
      if (cut.some((d) => d.getTime() <= NOW.getTime())) {
        expect(part.lastNoShowAt).toEqual(full.lastNoShowAt);
      }
    }
  });

  it('하한 경계 사례: 정확히 하한 시각의 노쇼를 빼도 판정 같음', () => {
    // 하한·하한−0.5일·하한−6.5일. 발동은 이미 만료되어 빼기 전후 모두 제한 없음
    const lookbackDays = policy.windowDays + policy.restrictionDays;
    const marks = [ago(lookbackDays), ago(lookbackDays - 0.5), ago(lookbackDays - 6.5)];
    const lb = noShowLookbackStart(NOW, policy).getTime();
    const cut = marks.filter((d) => d.getTime() > lb);
    expect(cut).toHaveLength(2);
    expect(computeScrimRestriction(cut, NOW, policy).restricted).toBe(
      computeScrimRestriction(marks, NOW, policy).restricted,
    );
  });

  it('창 바로 밖 2건은 발동 아님, 창 안이면 발동하고 해제는 now 뒤', () => {
    const marks = [ago(30.4), ago(30.39), ago(0.4)];
    expect(computeScrimRestriction(marks, NOW, policy).restricted).toBe(false);
    const marks2 = [ago(30.3), ago(30), ago(0.4)];
    const r = computeScrimRestriction(marks2, NOW, policy);
    expect(r.restricted).toBe(true);
    expect(r.until).toEqual(plus(ago(0.4), policy.restrictionDays * DAY));
  });
});

describe('isNoShowMarkWindowOpen', () => {
  const scheduled = new Date('2026-10-20T12:00:00.000Z');
  it('시작 시각부터 7일까지 포함, 1ms 넘으면 닫힘', () => {
    expect(isNoShowMarkWindowOpen(scheduled, scheduled, 7)).toBe(true);
    expect(isNoShowMarkWindowOpen(scheduled, plus(scheduled, 7 * DAY), 7)).toBe(true);
    expect(isNoShowMarkWindowOpen(scheduled, plus(scheduled, 7 * DAY + 1), 7)).toBe(false);
  });
  it('시작 시각 전(일찍 시작한 내전)도 열림', () => {
    expect(isNoShowMarkWindowOpen(scheduled, plus(scheduled, -DAY), 7)).toBe(true);
  });
});
