import {
  RIOT_ACCOUNTS_MAX_DEFAULT,
  RIOT_VERIFICATION_TTL_SEC_DEFAULT,
  SYNC_DAILY_LIMIT_DEFAULT,
} from '@gcd/shared';
import { z } from 'zod';

/**
 * API 환경 변수(S0 계약 10절 + S1 계약 11절). 기동 시 한 번 검증하고, 필수값이 없으면 시작하지 않는다.
 * 빈 문자열은 "설정 안 함"으로 본다(.env.example의 `KEY=` 형태).
 */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());
const posInt = (def: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(def));
/** 라이엇 라우팅 값: 소문자 영문·숫자 */
const routing = (def: string) =>
  z.preprocess(
    emptyToUndefined,
    z.string().trim().toLowerCase().regex(/^[a-z0-9]+$/, '소문자 영문·숫자').default(def),
  );

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),
  API_PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(4000)),
  WEB_ORIGIN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .url()
      .default('http://localhost:3000')
      .transform((v) => new URL(v).origin),
  ),
  DATABASE_URL: z.string({ required_error: 'DATABASE_URL 필수' }).min(1, 'DATABASE_URL 필수'),
  REDIS_URL: optionalString,
  JWT_ACCESS_SECRET: z
    .string({ required_error: 'JWT_ACCESS_SECRET 필수' })
    .min(32, 'JWT_ACCESS_SECRET은 32자 이상'),
  JWT_ACCESS_TTL_SEC: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(900)),
  REFRESH_TOKEN_TTL_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(30),
  ),
  COOKIE_SECRET: z.string({ required_error: 'COOKIE_SECRET 필수' }).min(32, 'COOKIE_SECRET은 32자 이상'),
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  DISCORD_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  DISCORD_GUILD_ID: optionalString,
  ADMIN_DISCORD_IDS: z.preprocess(
    (v) => (v === undefined || v === null ? '' : v),
    z.string().transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ),
  AUTH_DEV_LOGIN: z.preprocess(emptyToUndefined, z.string().optional()),
  // ---- S1 외부 API·동기화(계약 S1 11절). 키가 없어도 서버는 시작한다 ----
  RIOT_API_KEY: optionalString,
  STEAM_API_KEY: optionalString,
  RIOT_REGIONAL_ROUTING: routing('asia'),
  RIOT_PLATFORM_ROUTING: routing('kr'),
  RIOT_RATE_LIMIT_PER_SEC: posInt(20),
  RIOT_RATE_LIMIT_PER_2MIN: posInt(100),
  EXTERNAL_API_TIMEOUT_MS: posInt(5000),
  RIOT_VERIFICATION_TTL_SEC: posInt(RIOT_VERIFICATION_TTL_SEC_DEFAULT),
  RIOT_ACCOUNTS_MAX: posInt(RIOT_ACCOUNTS_MAX_DEFAULT),
  RIOT_DDRAGON_VERSION: optionalString,
  SYNC_DAILY_LIMIT: posInt(SYNC_DAILY_LIMIT_DEFAULT),
  SYNC_JOBS_ENABLED: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim().toLowerCase()) : v),
    z
      .enum(['true', 'false'], { errorMap: () => ({ message: 'true 또는 false' }) })
      .default('true')
      .transform((v) => v === 'true'),
  ),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  webOrigin: string;
  databaseUrl: string;
  redisUrl: string | undefined;
  jwtAccessSecret: string;
  jwtAccessTtlSec: number;
  refreshTokenTtlDays: number;
  cookieSecret: string;
  discord: {
    clientId: string | undefined;
    clientSecret: string | undefined;
    redirectUri: string | undefined;
    guildId: string | undefined;
  };
  adminDiscordIds: ReadonlySet<string>;
  /** AUTH_DEV_LOGIN === 'true' 그리고 NODE_ENV !== 'production' */
  devLoginEnabled: boolean;
  /** S1 라이엇. apiKey가 없으면 연동·동기화 GAME_PROVIDER_NOT_CONFIGURED */
  riot: {
    apiKey: string | undefined;
    regionalRouting: string;
    platformRouting: string;
    rateLimitPerSec: number;
    rateLimitPer2Min: number;
    verificationTtlSec: number;
    /** 사용자당 라이엇 ID 최대 개수(D37, D56) */
    accountsMax: number;
    ddragonVersion: string | undefined;
  };
  steam: { apiKey: string | undefined };
  externalApiTimeoutMs: number;
  /** 수동 새로고침 하루 한도(라이엇·스팀 합산, D41) */
  syncDailyLimit: number;
  syncJobsEnabled: boolean;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export class EnvValidationError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  // API_PORT가 없거나 비어 있으면 PaaS(Railway 등)가 주입하는 PORT를 쓴다
  const parsed = EnvSchema.safeParse({ ...env, API_PORT: env.API_PORT || env.PORT });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`);
    throw new EnvValidationError(`환경 변수 검증 실패\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  return {
    nodeEnv: e.NODE_ENV,
    isProduction,
    port: e.API_PORT,
    webOrigin: e.WEB_ORIGIN,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    jwtAccessSecret: e.JWT_ACCESS_SECRET,
    jwtAccessTtlSec: e.JWT_ACCESS_TTL_SEC,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    cookieSecret: e.COOKIE_SECRET,
    discord: {
      clientId: e.DISCORD_CLIENT_ID,
      clientSecret: e.DISCORD_CLIENT_SECRET,
      redirectUri: e.DISCORD_REDIRECT_URI,
      guildId: e.DISCORD_GUILD_ID,
    },
    adminDiscordIds: new Set(e.ADMIN_DISCORD_IDS),
    devLoginEnabled: e.AUTH_DEV_LOGIN === 'true' && !isProduction,
    riot: {
      apiKey: e.RIOT_API_KEY,
      regionalRouting: e.RIOT_REGIONAL_ROUTING,
      platformRouting: e.RIOT_PLATFORM_ROUTING,
      rateLimitPerSec: e.RIOT_RATE_LIMIT_PER_SEC,
      rateLimitPer2Min: e.RIOT_RATE_LIMIT_PER_2MIN,
      verificationTtlSec: e.RIOT_VERIFICATION_TTL_SEC,
      accountsMax: e.RIOT_ACCOUNTS_MAX,
      ddragonVersion: e.RIOT_DDRAGON_VERSION,
    },
    steam: { apiKey: e.STEAM_API_KEY },
    externalApiTimeoutMs: e.EXTERNAL_API_TIMEOUT_MS,
    syncDailyLimit: e.SYNC_DAILY_LIMIT,
    syncJobsEnabled: e.SYNC_JOBS_ENABLED,
  };
}

/** OAuth에 필요한 세 값이 모두 있는지 */
export function isDiscordConfigured(config: AppConfig): boolean {
  const d = config.discord;
  return Boolean(d.clientId && d.clientSecret && d.redirectUri);
}
