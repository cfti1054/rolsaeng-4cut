import { describe, expect, it } from 'vitest';
import { EnvValidationError, isDiscordConfigured, loadConfig, rankingJobsEnabledFromEnv, scrimJobsEnabledFromEnv } from './env';

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

  it('S2 기본값(계약 S2 11절): 값을 안 넣어도 기본값으로 동작', () => {
    const c = loadConfig({ ...REQUIRED, REFRESH_ROTATE_AFTER_HOURS: '', SCRIM_JOBS_ENABLED: ' ' });
    expect(c.refreshRotateAfterHours).toBe(24);
    expect(c.scrim).toEqual({
      scheduleMaxDaysAhead: 30,
      autoCloseAfterMin: 60,
      jobsEnabled: true,
      noShow: { threshold: 3, windowDays: 30, restrictionDays: 1 },
      noShowMarkWindowDays: 7,
    });
  });

  it('S2 값 검증: 회전 주기 0 허용·음수 거부, 양의 정수, SCRIM_JOBS_ENABLED 엄격 파싱', () => {
    const c = loadConfig({
      ...REQUIRED,
      REFRESH_ROTATE_AFTER_HOURS: '0',
      SCRIM_SCHEDULE_MAX_DAYS_AHEAD: '14',
      SCRIM_AUTO_CLOSE_AFTER_MIN: '30',
      SCRIM_JOBS_ENABLED: 'FALSE',
      SCRIM_NO_SHOW_THRESHOLD: '2',
      SCRIM_NO_SHOW_WINDOW_DAYS: '10',
      SCRIM_NO_SHOW_RESTRICTION_DAYS: '3',
      SCRIM_NO_SHOW_MARK_WINDOW_DAYS: '1',
    });
    expect(c.refreshRotateAfterHours).toBe(0);
    expect(c.scrim).toEqual({
      scheduleMaxDaysAhead: 14,
      autoCloseAfterMin: 30,
      jobsEnabled: false,
      noShow: { threshold: 2, windowDays: 10, restrictionDays: 3 },
      noShowMarkWindowDays: 1,
    });
    expect(() => loadConfig({ ...REQUIRED, REFRESH_ROTATE_AFTER_HOURS: '-1' })).toThrow(/REFRESH_ROTATE_AFTER_HOURS/);
    expect(() => loadConfig({ ...REQUIRED, REFRESH_ROTATE_AFTER_HOURS: '1.5' })).toThrow(/REFRESH_ROTATE_AFTER_HOURS/);
    for (const k of [
      'SCRIM_SCHEDULE_MAX_DAYS_AHEAD',
      'SCRIM_AUTO_CLOSE_AFTER_MIN',
      'SCRIM_NO_SHOW_THRESHOLD',
      'SCRIM_NO_SHOW_WINDOW_DAYS',
      'SCRIM_NO_SHOW_RESTRICTION_DAYS',
      'SCRIM_NO_SHOW_MARK_WINDOW_DAYS',
    ]) {
      expect(() => loadConfig({ ...REQUIRED, [k]: '0' })).toThrow(new RegExp(k));
    }
    expect(() => loadConfig({ ...REQUIRED, SCRIM_JOBS_ENABLED: '1' })).toThrow(/SCRIM_JOBS_ENABLED/);
  });

  it('S3 기본값·검증(계약 S3 12절): K 32/40, 신규 기준 10, 자동 시즌 3개월(1–24)', () => {
    const d = loadConfig({ ...REQUIRED, SCRIM_ELO_K_BASE: '' });
    expect(d.rating).toEqual({ kBase: 32, kNew: 40, newPlayerGames: 10, lossRatio: 0.5 });
    expect(d.seasonAutoLengthMonths).toBe(3);
    const c = loadConfig({
      ...REQUIRED,
      SCRIM_ELO_K_BASE: '24',
      SCRIM_ELO_K_NEW: '48',
      SCRIM_ELO_NEW_PLAYER_GAMES: '5',
      SEASON_AUTO_LENGTH_MONTHS: '24',
    });
    expect(c.rating).toEqual({ kBase: 24, kNew: 48, newPlayerGames: 5, lossRatio: 0.5 });
    expect(c.seasonAutoLengthMonths).toBe(24);
    for (const k of ['SCRIM_ELO_K_BASE', 'SCRIM_ELO_K_NEW', 'SCRIM_ELO_NEW_PLAYER_GAMES', 'SEASON_AUTO_LENGTH_MONTHS']) {
      expect(() => loadConfig({ ...REQUIRED, [k]: '0' })).toThrow(new RegExp(k));
      expect(() => loadConfig({ ...REQUIRED, [k]: '1.5' })).toThrow(new RegExp(k));
    }
    expect(() => loadConfig({ ...REQUIRED, SEASON_AUTO_LENGTH_MONTHS: '25' })).toThrow(/SEASON_AUTO_LENGTH_MONTHS/);
  });

  it('SCRIM_ELO_LOSS_RATIO(계약 19-1): 기본 0.5, 0–1 실수, 빈 값은 기본값, 범위 밖 기동 실패', () => {
    expect(loadConfig({ ...REQUIRED }).rating.lossRatio).toBe(0.5);
    expect(loadConfig({ ...REQUIRED, SCRIM_ELO_LOSS_RATIO: '' }).rating.lossRatio).toBe(0.5);
    for (const [v, want] of [['0', 0], ['0.25', 0.25], ['1', 1]] as const) {
      expect(loadConfig({ ...REQUIRED, SCRIM_ELO_LOSS_RATIO: v }).rating.lossRatio).toBe(want);
    }
    for (const v of ['-0.1', '1.1', 'half']) {
      expect(() => loadConfig({ ...REQUIRED, SCRIM_ELO_LOSS_RATIO: v })).toThrow(/SCRIM_ELO_LOSS_RATIO/);
    }
  });

  it('S4 기본값·검증(계약 S4 13절): 최소 경기 5, 작업 켜짐', () => {
    const d = loadConfig({ ...REQUIRED, RANKING_ELO_MIN_GAMES: '' });
    expect(d.ranking).toEqual({ eloMinGames: 5, jobsEnabled: true });
    const c = loadConfig({ ...REQUIRED, RANKING_ELO_MIN_GAMES: '3', RANKING_JOBS_ENABLED: 'false' });
    expect(c.ranking).toEqual({ eloMinGames: 3, jobsEnabled: false });
    for (const v of ['0', '1.5']) {
      expect(() => loadConfig({ ...REQUIRED, RANKING_ELO_MIN_GAMES: v })).toThrow(/RANKING_ELO_MIN_GAMES/);
    }
    expect(() => loadConfig({ ...REQUIRED, RANKING_JOBS_ENABLED: '1' })).toThrow(/RANKING_JOBS_ENABLED/);
  });

  it('없어진 SEASON_SOFT_RESET_RATIO(계약 20-2)가 env에 남아 있어도 기동 성공하고 설정에 나타나지 않는다', () => {
    const base = loadConfig({ ...REQUIRED });
    for (const v of ['0.5', '0.25', 'half', '-1']) {
      expect(loadConfig({ ...REQUIRED, SEASON_SOFT_RESET_RATIO: v })).toEqual(base);
    }
  });

  it('rankingJobsEnabledFromEnv: 모듈 구성용(잘못된 값은 true, 기동은 loadConfig가 막는다)', () => {
    expect(rankingJobsEnabledFromEnv({})).toBe(true);
    expect(rankingJobsEnabledFromEnv({ RANKING_JOBS_ENABLED: 'false' })).toBe(false);
    expect(rankingJobsEnabledFromEnv({ RANKING_JOBS_ENABLED: 'nope' })).toBe(true);
  });

  it('scrimJobsEnabledFromEnv: 모듈 구성용(잘못된 값은 true, 기동은 loadConfig가 막는다)', () => {
    expect(scrimJobsEnabledFromEnv({})).toBe(true);
    expect(scrimJobsEnabledFromEnv({ SCRIM_JOBS_ENABLED: ' False ' })).toBe(false);
    expect(scrimJobsEnabledFromEnv({ SCRIM_JOBS_ENABLED: 'yes' })).toBe(true);
  });
});
