import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_KEY_PATTERN, DiscordSnowflake } from '@gcd/shared';
import { z } from 'zod';

export const BotEnv = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: DiscordSnowflake,
  DISCORD_NOTICE_CHANNEL_ID: DiscordSnowflake,
  BOT_API_KEY: z.string().regex(API_KEY_PATTERN),
  /** 끝의 /api/v1 까지. 예: http://localhost:4000/api/v1 */
  API_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
export type BotEnv = z.infer<typeof BotEnv>;

/**
 * 로컬 `.env`를 읽는다. 이미 있는 환경 변수는 덮어쓰지 않는다.
 * 파일이 없어도 된다(Railway는 Variables로 넣는다).
 */
export function loadLocalEnvFile(cwd = process.cwd()): void {
  const path = resolve(cwd, '.env');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** 실패한 필드 이름만 알린다. 값(토큰·키)은 메시지에 넣지 않는다. */
export function readBotEnv(source: NodeJS.ProcessEnv = process.env): BotEnv {
  const parsed = BotEnv.safeParse({
    DISCORD_BOT_TOKEN: source.DISCORD_BOT_TOKEN,
    DISCORD_GUILD_ID: source.DISCORD_GUILD_ID,
    DISCORD_NOTICE_CHANNEL_ID: source.DISCORD_NOTICE_CHANNEL_ID,
    BOT_API_KEY: source.BOT_API_KEY,
    API_BASE_URL: source.API_BASE_URL,
    DATABASE_URL: source.DATABASE_URL,
    NODE_ENV: source.NODE_ENV,
  });
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'env').join(', ');
    throw new Error(`환경 변수가 올바르지 않습니다: ${fields}`);
  }
  return parsed.data;
}
