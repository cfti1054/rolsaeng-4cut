import { z } from 'zod';

/**
 * API 환경 변수(계약 10절). 기동 시 한 번 검증하고, 필수값이 없으면 시작하지 않는다.
 * 빈 문자열은 "설정 안 함"으로 본다(.env.example의 `KEY=` 형태).
 */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

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
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export class EnvValidationError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
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
  };
}

/** OAuth에 필요한 세 값이 모두 있는지 */
export function isDiscordConfigured(config: AppConfig): boolean {
  const d = config.discord;
  return Boolean(d.clientId && d.clientSecret && d.redirectUri);
}
