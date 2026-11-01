import { RANKING_CACHE_INTERVAL_MIN } from '@gcd/shared';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardSummaryOptions } from './rankings';

// TanStack Query는 window가 없으면 서버로 보고 재조회 타이머를 만들지 않는다. import보다 먼저 둔다
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window = {};
});

describe('요약 재조회 주기', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('화면을 열어 두면 캐시 주기마다 다시 받는다', async () => {
    const qc = new QueryClient();
    const queryFn = vi.fn(async () => 'summary');
    const screen = new QueryObserver(qc, { ...dashboardSummaryOptions(true), queryFn });
    const off = screen.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1);
    expect(queryFn).toHaveBeenCalledTimes(1);

    const interval = RANKING_CACHE_INTERVAL_MIN * 60_000;
    await vi.advanceTimersByTimeAsync(interval - 2);
    expect(queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(queryFn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(interval);
    expect(queryFn).toHaveBeenCalledTimes(3);
    off();
    qc.clear();
  });
});
