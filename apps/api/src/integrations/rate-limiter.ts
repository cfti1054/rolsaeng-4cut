import { ExternalApiError } from './contracts';
import { type Clock, systemClock } from './http';

type HostState = { perSec: number[]; per2Min: number[]; pausedUntil: number };

/**
 * 호스트별 토큰 버킷 2개(초당·2분당, 슬라이딩 윈도) + 429 일시정지(계약 6-4).
 * - acquire: 빌 때까지 대기. maxWaitMs를 주면(요청 처리 중) 그보다 오래 기다려야 할 때 rate_limited로 던진다.
 * - pause: 429의 Retry-After만큼 그 호스트를 멈춘다. 멈춘 동안 acquire는 대기(또는 rate_limited).
 */
export class HostRateLimiter {
  private readonly hosts = new Map<string, HostState>();
  private readonly pauseListeners: ((host: string, untilMs: number) => void)[] = [];

  constructor(
    private readonly perSec: number,
    private readonly per2Min: number,
    private readonly clock: Clock = systemClock,
  ) {}

  onPause(listener: (host: string, untilMs: number) => void): void {
    this.pauseListeners.push(listener);
  }

  pause(host: string, seconds: number): void {
    const st = this.state(host);
    const until = this.clock.now() + seconds * 1000;
    if (until > st.pausedUntil) st.pausedUntil = until;
    for (const l of this.pauseListeners) l(host, st.pausedUntil);
  }

  /** 호스트가 멈춰 있으면 남은 ms, 아니면 0 */
  pausedForMs(host: string): number {
    return Math.max(0, this.state(host).pausedUntil - this.clock.now());
  }

  async acquire(host: string, opts: { maxWaitMs?: number } = {}): Promise<void> {
    for (;;) {
      const wait = this.waitMs(host);
      if (wait <= 0) {
        const st = this.state(host);
        const now = this.clock.now();
        st.perSec.push(now);
        st.per2Min.push(now);
        return;
      }
      if (opts.maxWaitMs !== undefined && wait > opts.maxWaitMs) {
        throw new ExternalApiError('rate_limited', 'local rate limit', {
          retryAfterSec: Math.max(1, Math.ceil(wait / 1000)),
        });
      }
      await this.clock.sleep(wait);
    }
  }

  private waitMs(host: string): number {
    const st = this.state(host);
    const now = this.clock.now();
    st.perSec = st.perSec.filter((t) => now - t < 1000);
    st.per2Min = st.per2Min.filter((t) => now - t < 120_000);
    let wait = Math.max(0, st.pausedUntil - now);
    if (st.perSec.length >= this.perSec) {
      wait = Math.max(wait, (st.perSec[st.perSec.length - this.perSec] as number) + 1000 - now);
    }
    if (st.per2Min.length >= this.per2Min) {
      wait = Math.max(wait, (st.per2Min[st.per2Min.length - this.per2Min] as number) + 120_000 - now);
    }
    return wait;
  }

  private state(host: string): HostState {
    let st = this.hosts.get(host);
    if (!st) {
      st = { perSec: [], per2Min: [], pausedUntil: 0 };
      this.hosts.set(host, st);
    }
    return st;
  }
}
