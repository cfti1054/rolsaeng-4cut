import { STEAM_LINK_COMPLETE_PATH } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { config } from './middleware';

/** matcher 문자열(path-to-regexp)을 같은 의미의 JS 정규식으로 읽어 어떤 경로가 미들웨어를 거치는지 확인 */
const guarded = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

describe('middleware matcher', () => {
  it('스팀 팝업 완료 페이지는 쿠키 검사를 거치지 않는다(S2 9-2)', () => {
    expect(guarded(STEAM_LINK_COMPLETE_PATH)).toBe(false);
  });
  it('내전 화면·설정은 거친다, 로그인·API 프록시는 제외', () => {
    for (const p of ['/', '/scrims', '/scrims/new', '/scrims/abc', '/settings']) expect(guarded(p), p).toBe(true);
    for (const p of ['/login', '/api/v1/auth/refresh', '/_next/static/x.js', '/favicon.ico']) expect(guarded(p), p).toBe(false);
  });
});
