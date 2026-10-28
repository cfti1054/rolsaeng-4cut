import { describe, expect, it } from 'vitest';
import { apiRoutes, routes, safeRedirect } from './routes';

describe('safeRedirect (오픈 리다이렉트 방지)', () => {
  it('웹 내부 경로는 그대로', () => {
    expect(safeRedirect('/scrims')).toBe('/scrims');
    expect(safeRedirect('/rankings?tab=elo')).toBe('/rankings?tab=elo');
  });
  it('외부·프로토콜 상대·역슬래시·공백·비문자열은 /', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '/a b', '', undefined, null, 42]) {
      expect(safeRedirect(bad), String(bad)).toBe('/');
    }
  });
  it('인증 화면으로 되돌아가는 값은 / (루프 방지)', () => {
    expect(safeRedirect('/login')).toBe('/');
    expect(safeRedirect('/login?error=OAUTH_DENIED')).toBe('/');
    expect(safeRedirect('/welcome?redirect=%2F')).toBe('/');
    expect(safeRedirect('/loginx')).toBe('/loginx');
  });
});

describe('routes', () => {
  it('쿼리 조립', () => {
    expect(routes.login()).toBe('/login');
    expect(routes.login({ redirect: '/scrims' })).toBe('/login?redirect=%2Fscrims');
    expect(routes.welcome('/rankings?tab=elo')).toBe('/welcome?redirect=%2Frankings%3Ftab%3Delo');
    expect(routes.member('a b')).toBe('/members/a%20b');
  });
  it('디스코드 시작 주소는 웹 오리진의 /api/v1 경로', () => {
    expect(apiRoutes.discordStart()).toBe('/api/v1/auth/discord');
    expect(apiRoutes.discordStart('/scrims')).toBe('/api/v1/auth/discord?redirect=%2Fscrims');
  });
});
