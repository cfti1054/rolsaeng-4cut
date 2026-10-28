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
});
