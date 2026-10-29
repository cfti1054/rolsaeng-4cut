import { type CallMode, ExternalApiError } from './contracts';
import { BACKOFF_MS, type Clock } from './http';

/**
 * 5xx·타임아웃('unavailable') 재시도(계약 6-4).
 * - interactive: 1회 재시도(짧은 대기 후)
 * - background: 지수 백오프 1·2·4초, 3회 재시도 후 포기
 * 그 밖의 오류(429·401·404 등)는 재시도하지 않고 그대로 던진다. 429는 호출부가 호스트를 멈추고 던진다.
 */
export async function withRetry<T>(clock: Clock, mode: CallMode, fn: () => Promise<T>): Promise<T> {
  const delays = mode === 'interactive' ? [300] : BACKOFF_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retriable = err instanceof ExternalApiError && err.kind === 'unavailable';
      const delay = delays[attempt];
      if (!retriable || delay === undefined) throw err;
      await clock.sleep(delay);
    }
  }
}
