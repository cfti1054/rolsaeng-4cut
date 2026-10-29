import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock, FetchLike } from '../../src/integrations/http';
import type { IntegrationOptions } from '../../src/integrations/options';

export function fixture(rel: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', rel), 'utf8');
}

export const FAKE_PUUID = 'FAKE-PUUID-0001-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export function testOptions(over: Partial<IntegrationOptions> = {}): IntegrationOptions {
  return {
    riotApiKey: 'test-riot-key',
    steamApiKey: 'test-steam-key',
    regionalRouting: 'asia',
    platformRouting: 'kr',
    ratePerSec: 20,
    ratePer2Min: 100,
    timeoutMs: 50,
    ddragonVersion: undefined,
    redisUrl: undefined,
    jobsEnabled: true,
    interactiveMaxWaitMs: 3000,
    ...over,
  };
}

/** 가짜 시계: sleep은 시간을 앞당기기만 한다 */
export function fakeClock(): Clock & { slept: number[]; t: number } {
  const c = {
    t: 1_000_000,
    slept: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

export type Reply = { status?: number; body?: string; headers?: Record<string, string> } | 'hang' | 'network-error';

/** 요청 URL(쿼리 포함)을 접두 일치로 찾는 가짜 fetch. 응답은 배열이면 호출 순서대로 소비한다 */
export function fakeFetch(routes: Record<string, Reply | Reply[]>): FetchLike & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`fakeFetch: 라우트 없음 ${url}`);
    const r = routes[key] as Reply | Reply[];
    const reply = Array.isArray(r) ? (r.length > 1 ? (r.shift() as Reply) : (r[0] as Reply)) : r;
    if (reply === 'network-error') throw new TypeError('fetch failed');
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    return new Response(reply.body ?? '', { status: reply.status ?? 200, headers: reply.headers });
  }) as FetchLike & { calls: typeof calls };
  fn.calls = calls;
  return fn;
}
