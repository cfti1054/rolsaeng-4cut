import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_NEWS_EVENT_AHEAD_DAYS,
  DASHBOARD_NEWS_PATCH_RECENT_DAYS,
  DASHBOARD_NEWS_SUBTITLE_MAX,
  NO_SHOW_RESTRICTION_DAYS_DEFAULT,
  NO_SHOW_THRESHOLD_DEFAULT,
  NO_SHOW_WINDOW_DAYS_DEFAULT,
} from '@gcd/shared';
import {
  DAY_MS,
  adminMemberStatus,
  dashboardNewsWindow,
  newsSubtitle,
  planRoleChange,
  previewNoShowRestriction,
  resolveEventsRange,
  type NoShowPolicy,
} from './index';

const FIXED = new Date('2026-11-10T03:00:00.000Z');

// -----------------------------------------------------------------------------
describe('planRoleChange', () => {
  const base = {
    actorId: 'me',
    targetId: 'you',
    currentRole: 'admin' as const,
    nextRole: 'member' as const,
    targetLocked: false,
    adminCount: 2,
  };

  it('같은 역할 → noop(자기 자신이어도, locked·adminCount 무관)', () => {
    expect(planRoleChange({ ...base, nextRole: 'admin' })).toEqual({ kind: 'noop' });
    expect(planRoleChange({ ...base, targetId: 'me', nextRole: 'admin', targetLocked: true, adminCount: 1 })).toEqual({ kind: 'noop' });
    expect(planRoleChange({ ...base, currentRole: 'member', nextRole: 'member', adminCount: 0 })).toEqual({ kind: 'noop' });
  });

  it('자기 자신 변경 → ADMIN_SELF_ROLE_CHANGE(locked·마지막 admin보다 먼저)', () => {
    expect(planRoleChange({ ...base, targetId: 'me', targetLocked: true, adminCount: 1 })).toEqual({
      kind: 'error',
      code: 'ADMIN_SELF_ROLE_CHANGE',
    });
  });

  it('강등 && locked → ADMIN_ROLE_LOCKED(마지막 admin보다 먼저)', () => {
    expect(planRoleChange({ ...base, targetLocked: true, adminCount: 1 })).toEqual({ kind: 'error', code: 'ADMIN_ROLE_LOCKED' });
  });

  it('강등: adminCount 2 → change, 1 → ADMIN_LAST_ADMIN, 0(데이터 이상)도 실패', () => {
    expect(planRoleChange({ ...base, adminCount: 2 })).toEqual({ kind: 'change' });
    expect(planRoleChange({ ...base, adminCount: 1 })).toEqual({ kind: 'error', code: 'ADMIN_LAST_ADMIN' });
    expect(planRoleChange({ ...base, adminCount: 0 })).toEqual({ kind: 'error', code: 'ADMIN_LAST_ADMIN' });
  });

  it('승격은 locked여도, adminCount 1이어도 change', () => {
    expect(planRoleChange({ ...base, currentRole: 'member', nextRole: 'admin', targetLocked: true, adminCount: 1 })).toEqual({
      kind: 'change',
    });
  });

  it('adminCount가 0 이상 정수가 아니면 RangeError', () => {
    expect(() => planRoleChange({ ...base, adminCount: -1 })).toThrow(RangeError);
    expect(() => planRoleChange({ ...base, adminCount: 1.5 })).toThrow(RangeError);
    expect(() => planRoleChange({ ...base, nextRole: 'admin', adminCount: Number.NaN })).toThrow(RangeError);
  });
});

describe('adminMemberStatus', () => {
  const now = new Date('2026-11-10T00:00:00.000Z');
  it('left가 restricted보다 우선', () => {
    expect(adminMemberStatus({ leftAt: now, restrictedUntil: new Date(now.getTime() + DAY_MS), now })).toBe('left');
  });
  it('restrictedUntil > now → restricted, = now → active, 과거·null → active', () => {
    expect(adminMemberStatus({ leftAt: null, restrictedUntil: new Date(now.getTime() + 1), now })).toBe('restricted');
    expect(adminMemberStatus({ leftAt: null, restrictedUntil: now, now })).toBe('active');
    expect(adminMemberStatus({ leftAt: null, restrictedUntil: new Date(now.getTime() - 1), now })).toBe('active');
    expect(adminMemberStatus({ leftAt: null, restrictedUntil: null, now })).toBe('active');
  });
});

// -----------------------------------------------------------------------------
describe('previewNoShowRestriction', () => {
  const policy: NoShowPolicy = {
    threshold: NO_SHOW_THRESHOLD_DEFAULT,
    windowDays: NO_SHOW_WINDOW_DAYS_DEFAULT,
    restrictionDays: NO_SHOW_RESTRICTION_DAYS_DEFAULT,
  };
  const now = new Date('2026-11-10T12:00:00.000Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

  it('2회 + 표시 = 3회 → newlyRestricted(threshold 3), until = now + 제한 일수', () => {
    expect(policy.threshold).toBe(3);
    expect(previewNoShowRestriction([ago(10), ago(20)], now, policy)).toEqual({
      newlyRestricted: true,
      until: new Date(now.getTime() + policy.restrictionDays * DAY_MS),
    });
  });

  it('1회 + 표시 = 2회 → 제한 아님(until null)', () => {
    expect(previewNoShowRestriction([ago(1)], now, policy)).toEqual({ newlyRestricted: false, until: null });
    expect(previewNoShowRestriction([], now, policy)).toEqual({ newlyRestricted: false, until: null });
  });

  it('이미 제한 중이면 false(until은 표시 후 값)', () => {
    const marks = [ago(0.1), ago(0.2), ago(0.3)];
    const r = previewNoShowRestriction(marks, now, policy);
    expect(r.newlyRestricted).toBe(false);
    expect(r.until).toEqual(new Date(now.getTime() + policy.restrictionDays * DAY_MS));
  });

  it('30일 밖 기록은 세지 않음(정확히 30일 전은 구간 밖)', () => {
    expect(previewNoShowRestriction([ago(30), ago(5)], now, policy)).toEqual({ newlyRestricted: false, until: null });
    expect(previewNoShowRestriction([ago(30 - 1 / 86_400_000), ago(5)], now, policy).newlyRestricted).toBe(true);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const marks = [ago(1), ago(2)];
    previewNoShowRestriction(marks, now, policy);
    expect(marks).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------
describe('newsSubtitle', () => {
  const M = DASHBOARD_NEWS_SUBTITLE_MAX;
  it('null·빈 문자열·공백만 → null', () => {
    expect(newsSubtitle(null, M)).toBeNull();
    expect(newsSubtitle('', M)).toBeNull();
    expect(newsSubtitle('  \n\t \r\n ', M)).toBeNull();
  });
  it('여러 줄 → 첫 줄(앞뒤 공백 제거, 앞쪽 빈 줄은 건너뜀)', () => {
    expect(newsSubtitle('  첫 줄 \n둘째 줄', M)).toBe('첫 줄');
    expect(newsSubtitle('a\r\nb', M)).toBe('a');
    expect(newsSubtitle('a\rb', M)).toBe('a');
    expect(newsSubtitle('\n\n  본문 시작\n다음', M)).toBe('본문 시작');
  });
  it('정확히 max자 그대로, max+1자 → max−1자 + …', () => {
    const exact = '가'.repeat(M);
    expect(newsSubtitle(exact, M)).toBe(exact);
    const over = '가'.repeat(M) + '나';
    const r = newsSubtitle(over, M)!;
    expect(r).toBe(`${'가'.repeat(M - 1)}…`);
    expect(Array.from(r)).toHaveLength(M);
  });
  it('이모지(서로게이트)를 자르지 않는다', () => {
    const text = '😀'.repeat(5); // 코드 포인트 5, UTF-16 10
    expect(newsSubtitle(text, 5)).toBe(text);
    expect(newsSubtitle(text, 4)).toBe('😀😀😀…');
    expect(newsSubtitle('ab😀cd', 3)).toBe('ab…');
    expect(newsSubtitle('a😀bcd', 3)).toBe('a😀…');
  });
  it('max 경계: 2는 허용, 1·소수는 RangeError', () => {
    expect(newsSubtitle('abc', 2)).toBe('a…');
    expect(() => newsSubtitle('abc', 1)).toThrow(RangeError);
    expect(() => newsSubtitle('abc', 2.5)).toThrow(RangeError);
    expect(() => newsSubtitle(null, 1)).toThrow(RangeError);
  });
});

describe('resolveEventsRange', () => {
  it('둘 다 없음: KST 자정 경계(10-31T15:00Z = 11-01 KST → 11월)', () => {
    expect(resolveEventsRange({}, new Date('2026-10-31T14:59:59.999Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolveEventsRange({}, new Date('2026-10-31T15:00:00.000Z'))).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });
  it('2월 말일: 윤년 29일, 평년 28일', () => {
    expect(resolveEventsRange({}, new Date('2028-02-10T00:00:00.000Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(resolveEventsRange({ from: '2027-02-15' }, FIXED)).toEqual({ from: '2027-02-15', to: '2027-02-28' });
  });
  it('from만 → 그 달 말일, to만 → 그 달 1일', () => {
    const now = new Date('2026-11-10T00:00:00.000Z');
    expect(resolveEventsRange({ from: '2026-12-20' }, now)).toEqual({ from: '2026-12-20', to: '2026-12-31' });
    expect(resolveEventsRange({ to: '2027-01-05' }, now)).toEqual({ from: '2027-01-01', to: '2027-01-05' });
    expect(resolveEventsRange({ to: '2028-02-29' }, now)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('둘 다 있으면 그대로', () => {
    expect(resolveEventsRange({ from: '2026-11-03', to: '2026-12-09' }, FIXED)).toEqual({ from: '2026-11-03', to: '2026-12-09' });
  });
  it('형식이 틀리면 RangeError', () => {
    expect(() => resolveEventsRange({ from: '2026-02-30' }, FIXED)).toThrow(RangeError);
    expect(() => resolveEventsRange({ to: '2026/11/01' }, FIXED)).toThrow(RangeError);
  });
});

describe('dashboardNewsWindow', () => {
  const P = DASHBOARD_NEWS_PATCH_RECENT_DAYS;
  const E = DASHBOARD_NEWS_EVENT_AHEAD_DAYS;
  it('KST 날짜 경계', () => {
    expect(dashboardNewsWindow(new Date('2026-11-14T14:59:59.999Z'), P, E)).toEqual({
      today: '2026-11-14',
      patchSince: '2026-10-15',
      eventUntil: '2026-12-14',
    });
    expect(dashboardNewsWindow(new Date('2026-11-14T15:00:00.000Z'), P, E)).toEqual({
      today: '2026-11-15',
      patchSince: '2026-10-16',
      eventUntil: '2026-12-15',
    });
  });
  it('월·연 넘김', () => {
    expect(dashboardNewsWindow(new Date('2026-12-31T15:00:00.000Z'), 30, 30)).toEqual({
      today: '2027-01-01',
      patchSince: '2026-12-02',
      eventUntil: '2027-01-31',
    });
    expect(dashboardNewsWindow(new Date('2028-03-01T00:00:00.000Z'), 1, 0)).toEqual({
      today: '2028-03-01',
      patchSince: '2028-02-29',
      eventUntil: '2028-03-01',
    });
  });
  it('일수가 0 이상 정수가 아니면 RangeError', () => {
    expect(() => dashboardNewsWindow(FIXED, -1, 30)).toThrow(RangeError);
    expect(() => dashboardNewsWindow(FIXED, 30, 1.5)).toThrow(RangeError);
  });
});
