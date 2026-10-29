import type { RankValue } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from './api/client';
import { errorMessageWithRetry } from './errors';
import { formatAgo, formatClock, formatDuration, formatMonthDay, formatSyncedAt, formatYearMonth } from './format';
import { lolRankSub, tftRankSub, tierLabel, tierMark } from './tiers';

const NOW = Date.parse('2026-10-28T13:41:00.000Z'); // KST 22:41

describe('시각 표기(KST 고정)', () => {
  it('HH:mm, MM.DD, YYYY.MM', () => {
    expect(formatClock('2026-10-28T13:41:00.000Z')).toBe('22:41');
    expect(formatMonthDay('2026-10-19T16:00:00.000Z')).toBe('10.20');
    expect(formatYearMonth('2026-02-28T15:30:00.000Z')).toBe('2026.03');
  });
  it('갱신 시각: 방금 / N분 전 / 같은 날 HH:mm / 다른 날 MM.DD HH:mm', () => {
    expect(formatSyncedAt('2026-10-28T13:40:30.000Z', NOW)).toBe('방금');
    expect(formatSyncedAt('2026-10-28T13:29:00.000Z', NOW)).toBe('12분 전');
    expect(formatSyncedAt('2026-10-28T01:05:00.000Z', NOW)).toBe('10:05');
    expect(formatSyncedAt('2026-10-27T14:59:00.000Z', NOW)).toBe('10.27 23:59');
  });
  it('지난 경기·경기 시간', () => {
    expect(formatAgo('2026-10-28T11:41:00.000Z', NOW)).toBe('2시간 전');
    expect(formatAgo('2026-10-27T10:00:00.000Z', NOW)).toBe('어제');
    expect(formatAgo('2026-10-25T10:00:00.000Z', NOW)).toBe('3일 전');
    expect(formatDuration(1872)).toBe('31:12');
    expect(formatDuration(65)).toBe('1:05');
  });
});

describe('티어 표기(D53)', () => {
  const emerald: RankValue = { tier: 'EMERALD', division: 'III', lp: 12, wins: 48, losses: 41 };
  const master: RankValue = { tier: 'MASTER', division: null, lp: 120, wins: 10, losses: 5 };
  const un: RankValue = { tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0 };
  it('라벨·마크', () => {
    expect([tierLabel(emerald), tierMark(emerald)]).toEqual(['Emerald III', 'E3']);
    expect([tierLabel(master), tierMark(master)]).toEqual(['Master', 'M']);
    expect(tierLabel(un)).toBe('언랭크');
  });
  it('보조 줄: 롤 승패, 롤체는 1위 횟수와 1위 비율(D66)', () => {
    expect(lolRankSub(emerald)).toBe('12 LP · 48승 41패');
    expect(tftRankSub(master)).toBe('120 LP · 1위 10회 (67%)');
    expect(tftRankSub({ tier: 'IRON', division: 'IV', lp: 0, wins: 0, losses: 0 })).toBe('0 LP · 1위 0회');
    expect(lolRankSub(un)).toBe('이번 시즌 기록 없음');
  });
});

describe('Retry-After', () => {
  it('정수 초만 받는다', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter(' 5 ')).toBe(5);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT')).toBeUndefined();
  });
  it('문구에 대기 시간을 덧붙이고, 새로고침 한도는 자정 문구 그대로', () => {
    expect(errorMessageWithRetry('RATE_LIMITED', 3)).toMatch(/\(3초 뒤 가능\)$/);
    expect(errorMessageWithRetry('GAME_PROVIDER_RATE_LIMITED', 90)).toMatch(/\(2분 뒤 가능\)$/);
    expect(errorMessageWithRetry('SYNC_LIMIT_EXCEEDED', 40000)).not.toMatch(/뒤 가능/);
  });
});
