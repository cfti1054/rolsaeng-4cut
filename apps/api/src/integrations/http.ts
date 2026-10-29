import { ExternalApiError } from './contracts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 시간 의존을 한 곳에 모아 테스트에서 바꿀 수 있게 한다 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type RawResponse = { status: number; retryAfterSec: number | undefined; text: string };

/** Retry-After(초 정수 또는 HTTP 날짜) → 초. 없거나 해석 불가면 undefined */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(value);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

/**
 * 타임아웃이 걸린 단일 HTTP 호출. 네트워크 실패·타임아웃은 'unavailable'.
 * 상태 코드 해석은 하지 않는다(classify가 한다). URL·키는 오류 메시지에 싣지 않는다.
 */
export async function rawRequest(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  clock: Clock = systemClock,
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return {
      status: res.status,
      retryAfterSec: parseRetryAfter(res.headers.get('retry-after'), clock.now()),
      text,
    };
  } catch (err) {
    const aborted = controller.signal.aborted;
    throw new ExternalApiError('unavailable', aborted ? 'timeout' : 'network error', { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_RETRY_AFTER_SEC = 60;

/**
 * 상태 코드 → 오류 분류(계약 6-4). 2xx면 null.
 * 429 → rate_limited(Retry-After, 없으면 60초), 401/403 → auth, 404 → not_found,
 * 5xx → unavailable, 그 밖 → bad_response.
 */
export function classifyStatus(res: RawResponse): ExternalApiError | null {
  const s = res.status;
  if (s >= 200 && s < 300) return null;
  if (s === 429) {
    return new ExternalApiError('rate_limited', 'HTTP 429', {
      retryAfterSec: res.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC,
    });
  }
  if (s === 401 || s === 403) return new ExternalApiError('auth', `HTTP ${s}`);
  if (s === 404) return new ExternalApiError('not_found', 'HTTP 404');
  if (s >= 500) return new ExternalApiError('unavailable', `HTTP ${s}`);
  return new ExternalApiError('bad_response', `HTTP ${s}`);
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ExternalApiError('bad_response', 'invalid JSON', { cause: err });
  }
}

/** 지수 백오프(1·2·4초) 재시도 지연 */
export const BACKOFF_MS = [1000, 2000, 4000] as const;
