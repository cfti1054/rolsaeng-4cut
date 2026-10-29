import { z } from 'zod';

/**
 * 외부 연동 설정. config/env.ts(backend 담당)와 별개로 환경 변수에서 직접 읽어
 * 두 담당자의 파일이 겹치지 않게 한다. 키는 환경 변수로만 받고 로그·오류에 싣지 않는다.
 * 개발 키 → production 키 교체는 RIOT_API_KEY 값만 바꾸면 된다.
 */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const posInt = (def: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(def));
const routing = (def: string) =>
  z.preprocess(emptyToUndefined, z.string().trim().toLowerCase().regex(/^[a-z0-9]+$/).default(def));

const Schema = z.object({
  RIOT_API_KEY: optionalString,
  STEAM_API_KEY: optionalString,
  RIOT_REGIONAL_ROUTING: routing('asia'),
  RIOT_PLATFORM_ROUTING: routing('kr'),
  RIOT_RATE_LIMIT_PER_SEC: posInt(20),
  RIOT_RATE_LIMIT_PER_2MIN: posInt(100),
  EXTERNAL_API_TIMEOUT_MS: posInt(5000),
  RIOT_DDRAGON_VERSION: optionalString,
  REDIS_URL: optionalString,
  SYNC_JOBS_ENABLED: z.preprocess(emptyToUndefined, z.string().optional()),
});

export interface IntegrationOptions {
  riotApiKey: string | undefined;
  steamApiKey: string | undefined;
  regionalRouting: string;
  platformRouting: string;
  ratePerSec: number;
  ratePer2Min: number;
  timeoutMs: number;
  ddragonVersion: string | undefined;
  redisUrl: string | undefined;
  jobsEnabled: boolean;
  /** 요청 처리 중 호출이 토큰을 기다릴 수 있는 최대 시간(계약 6-4: 3초) */
  interactiveMaxWaitMs: number;
}

export const INTEGRATION_OPTIONS = Symbol('INTEGRATION_OPTIONS');

export function loadIntegrationOptions(
  env: Record<string, string | undefined> = process.env,
): IntegrationOptions {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`);
    throw new Error(`외부 연동 환경 변수 검증 실패\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    riotApiKey: e.RIOT_API_KEY,
    steamApiKey: e.STEAM_API_KEY,
    regionalRouting: e.RIOT_REGIONAL_ROUTING,
    platformRouting: e.RIOT_PLATFORM_ROUTING,
    ratePerSec: e.RIOT_RATE_LIMIT_PER_SEC,
    ratePer2Min: e.RIOT_RATE_LIMIT_PER_2MIN,
    timeoutMs: e.EXTERNAL_API_TIMEOUT_MS,
    ddragonVersion: e.RIOT_DDRAGON_VERSION,
    redisUrl: e.REDIS_URL,
    jobsEnabled: e.SYNC_JOBS_ENABLED?.trim().toLowerCase() !== 'false',
    interactiveMaxWaitMs: 3000,
  };
}
