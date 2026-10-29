import { describe, expect, it } from 'vitest';
import { EnvValidationError, isDiscordConfigured, loadConfig } from './env';

const REQUIRED = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
};

describe('환경 변수', () => {
  it('필수값이 없으면 시작하지 않는다', () => {
    expect(() => loadConfig({})).toThrow(EnvValidationError);
    expect(() => loadConfig({ ...REQUIRED, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ ...REQUIRED, COOKIE_SECRET: '' })).toThrow(/COOKIE_SECRET/);
  });

  it('기본값과 빈 문자열 처리', () => {
    const c = loadConfig({ ...REQUIRED, DISCORD_CLIENT_ID: '', ADMIN_DISCORD_IDS: ' 1, 2 ,,' });
    expect(c.port).toBe(4000);
    expect(c.webOrigin).toBe('http://localhost:3000');
    expect(c.jwtAccessTtlSec).toBe(900);
    expect(c.refreshTokenTtlDays).toBe(30);
    expect(c.discord.clientId).toBeUndefined();
    expect(isDiscordConfigured(c)).toBe(false);
    expect([...c.adminDiscordIds]).toEqual(['1', '2']);
    expect(c.devLoginEnabled).toBe(false);
  });

  it('포트: API_PORT 우선, 없거나 비어 있으면 PaaS의 PORT', () => {
    expect(loadConfig({ ...REQUIRED, API_PORT: '5000', PORT: '8080' }).port).toBe(5000);
    expect(loadConfig({ ...REQUIRED, PORT: '8080' }).port).toBe(8080);
    expect(loadConfig({ ...REQUIRED, API_PORT: '', PORT: '8080' }).port).toBe(8080);
    expect(loadConfig({ ...REQUIRED }).port).toBe(4000);
    expect(() => loadConfig({ ...REQUIRED, PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('WEB_ORIGIN은 오리진으로 정규화(끝 슬래시 제거)', () => {
    expect(loadConfig({ ...REQUIRED, WEB_ORIGIN: 'https://club.example.com/' }).webOrigin).toBe(
      'https://club.example.com',
    );
  });

  it('dev-login: AUTH_DEV_LOGIN=true 이고 production 아님일 때만', () => {
    expect(loadConfig({ ...REQUIRED, AUTH_DEV_LOGIN: 'true' }).devLoginEnabled).toBe(true);
    expect(loadConfig({ ...REQUIRED, AUTH_DEV_LOGIN: 'TRUE' }).devLoginEnabled).toBe(false);
    expect(loadConfig({ ...REQUIRED, AUTH_DEV_LOGIN: '1' }).devLoginEnabled).toBe(false);
    expect(
      loadConfig({ ...REQUIRED, AUTH_DEV_LOGIN: 'true', NODE_ENV: 'production' }).devLoginEnabled,
    ).toBe(false);
  });

  it('S1 외부 API·동기화 기본값(계약 S1 11절)', () => {
    const c = loadConfig({ ...REQUIRED, RIOT_API_KEY: '', STEAM_API_KEY: ' ' });
    expect(c.riot).toEqual({
      apiKey: undefined,
      regionalRouting: 'asia',
      platformRouting: 'kr',
      rateLimitPerSec: 20,
      rateLimitPer2Min: 100,
      verificationTtlSec: 600,
      accountsMax: 3,
      ddragonVersion: undefined,
    });
    expect(c.steam.apiKey).toBeUndefined();
    expect(c.externalApiTimeoutMs).toBe(5000);
    expect(c.syncDailyLimit).toBe(5);
    expect(c.syncJobsEnabled).toBe(true);
    expect(c.redisUrl).toBeUndefined();
  });

  it('S1 값 검증: 양의 정수, 라우팅 소문자 정규화, SYNC_JOBS_ENABLED', () => {
    const c = loadConfig({ ...REQUIRED, RIOT_ACCOUNTS_MAX: '2', RIOT_REGIONAL_ROUTING: 'ASIA', SYNC_JOBS_ENABLED: 'false', RIOT_API_KEY: 'k' });
    expect(c.riot.accountsMax).toBe(2);
    expect(c.riot.regionalRouting).toBe('asia');
    expect(c.riot.apiKey).toBe('k');
    expect(c.syncJobsEnabled).toBe(false);
    expect(() => loadConfig({ ...REQUIRED, RIOT_ACCOUNTS_MAX: '0' })).toThrow(/RIOT_ACCOUNTS_MAX/);
    expect(() => loadConfig({ ...REQUIRED, SYNC_DAILY_LIMIT: '1.5' })).toThrow(/SYNC_DAILY_LIMIT/);
    expect(() => loadConfig({ ...REQUIRED, RIOT_PLATFORM_ROUTING: 'k r' })).toThrow(/RIOT_PLATFORM_ROUTING/);
    expect(() => loadConfig({ ...REQUIRED, SYNC_JOBS_ENABLED: 'yes' })).toThrow(/SYNC_JOBS_ENABLED/);
  });
});
