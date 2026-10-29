import { describe, expect, it } from 'vitest';
import { HostRateLimiter } from '../../src/integrations/rate-limiter';
import { fakeClock } from '../support/integration-helpers';

describe('HostRateLimiter', () => {
  it('초당 한도를 넘으면 다음 초까지 기다린다', async () => {
    const clock = fakeClock();
    const l = new HostRateLimiter(2, 100, clock);
    await l.acquire('h');
    await l.acquire('h');
    expect(clock.slept).toEqual([]);
    await l.acquire('h');
    expect(clock.slept).toEqual([1000]);
  });

  it('2분당 한도: 가장 오래된 호출이 윈도를 벗어날 때까지', async () => {
    const clock = fakeClock();
    const l = new HostRateLimiter(1000, 3, clock);
    for (let i = 0; i < 3; i++) await l.acquire('h');
    await l.acquire('h');
    expect(clock.slept).toEqual([120_000]);
  });

  it('호스트마다 따로 센다', async () => {
    const clock = fakeClock();
    const l = new HostRateLimiter(1, 100, clock);
    await l.acquire('a');
    await l.acquire('b');
    expect(clock.slept).toEqual([]);
  });

  it('요청 처리 중(maxWaitMs)에는 3초 넘게 기다려야 하면 rate_limited + 예상 대기 초', async () => {
    const clock = fakeClock();
    const l = new HostRateLimiter(1000, 1, clock);
    await l.acquire('h');
    await expect(l.acquire('h', { maxWaitMs: 3000 })).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSec: 120,
    });
  });

  it('pause 동안 background 는 기다렸다가 진행하고, pause 알림을 보낸다', async () => {
    const clock = fakeClock();
    const l = new HostRateLimiter(20, 100, clock);
    const seen: string[] = [];
    l.onPause((h) => seen.push(h));
    l.pause('h', 5);
    expect(seen).toEqual(['h']);
    await l.acquire('h');
    expect(clock.slept).toEqual([5000]);
  });
});
