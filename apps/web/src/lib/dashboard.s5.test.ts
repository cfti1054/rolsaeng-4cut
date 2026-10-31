import type { DashboardCommunity } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { HOME_STAT_GRID, homeStatCards, voiceStat } from './dashboard';

const AT = '2026-10-31T12:40:00.000Z';
const live: DashboardCommunity['voice'] = { state: 'live', member_count: 23, captured_at: AT };
const stale: DashboardCommunity['voice'] = { state: 'stale', member_count: null, captured_at: AT };
const nc: DashboardCommunity['voice'] = { state: 'not_connected', member_count: null, captured_at: null };
const ready: DashboardCommunity['active_members'] = { state: 'ready', count: 0 };
const ncA: DashboardCommunity['active_members'] = { state: 'not_connected', count: null };

describe('S5 홈 통계 줄', () => {
  it('목업 순서, 봇 없는 칸은 뺀다', () => {
    expect(homeStatCards({ voice: live, active_members: ready }).map((c) => c.key)).toEqual(['voice', 'recruiting', 'week', 'active']);
    expect(homeStatCards({ voice: stale, active_members: ready }).map((c) => c.key)).toEqual(['voice', 'recruiting', 'week', 'active']);
    expect(homeStatCards({ voice: nc, active_members: ready }).map((c) => c.key)).toEqual(['recruiting', 'week', 'active']);
    expect(homeStatCards({ voice: nc, active_members: ncA }).map((c) => c.key)).toEqual(['recruiting', 'week']);
    expect(homeStatCards({ voice: live, active_members: ncA }).map((c) => c.key)).toEqual(['voice', 'recruiting', 'week']);
  });
  it('모바일 2칸: 음성 있으면 음성 + 모집 중, 없으면 모집 중 + 이번 주', () => {
    const mob = (v: DashboardCommunity['voice']) => homeStatCards({ voice: v, active_members: ready }).filter((c) => c.mobile).map((c) => c.key);
    expect(mob(live)).toEqual(['voice', 'recruiting']);
    expect(mob(stale)).toEqual(['voice', 'recruiting']);
    expect(mob(nc)).toEqual(['recruiting', 'week']);
  });
  it('2–4칸 모두 격자 클래스가 있다', () => {
    for (const n of [2, 3, 4]) expect(HOME_STAT_GRID[n]).toBeTruthy();
  });
  it('음성 카드 값: stale은 숫자 없이 마지막 시각(KST)', () => {
    expect(voiceStat(live)).toEqual({ value: '23', unit: '명', live: true, note: null });
    expect(voiceStat(stale)).toEqual({ value: '—', unit: null, live: false, note: '마지막 21:40' });
    expect(voiceStat(nc)).toBeNull();
  });
});
