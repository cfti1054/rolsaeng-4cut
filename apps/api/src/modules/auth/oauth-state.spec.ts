import { describe, expect, it } from 'vitest';
import { newOAuthState, signOAuthState, statesMatch, verifyOAuthStateCookie } from './oauth-state';
import { loginErrorUrl, postLoginTarget, toSafeRedirect } from './redirect';

const SECRET = 'cookie-secret-0123456789abcdef0123456789';

describe('OAuth state 쿠키 서명·검증', () => {
  const now = Date.UTC(2026, 9, 28, 12, 0, 0);
  const iat = Math.floor(now / 1000);

  it('서명한 값은 검증을 통과한다', () => {
    const state = newOAuthState();
    expect(Buffer.from(state, 'base64url')).toHaveLength(32);
    const cookie = signOAuthState({ state, redirect: '/scrims', iat }, SECRET);
    expect(verifyOAuthStateCookie(cookie, SECRET, now)).toEqual({ state, redirect: '/scrims', iat });
  });

  it('다른 키·변조·형식 오류는 null', () => {
    const cookie = signOAuthState({ state: 's', redirect: '/', iat }, SECRET);
    expect(verifyOAuthStateCookie(cookie, `${SECRET}x`, now)).toBeNull();
    const [body, sig] = cookie.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ state: 's', redirect: '//evil.com', iat })).toString('base64url');
    expect(verifyOAuthStateCookie(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyOAuthStateCookie(`${body}.`, SECRET, now)).toBeNull();
    expect(verifyOAuthStateCookie('garbage', SECRET, now)).toBeNull();
    expect(verifyOAuthStateCookie(undefined, SECRET, now)).toBeNull();
  });

  it('600초 경과하면 만료', () => {
    const cookie = signOAuthState({ state: 's', redirect: '/', iat }, SECRET);
    expect(verifyOAuthStateCookie(cookie, SECRET, now + 600_000)).not.toBeNull();
    expect(verifyOAuthStateCookie(cookie, SECRET, now + 601_000)).toBeNull();
  });

  it('state 비교', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'abcd')).toBe(false);
    expect(statesMatch('abc', undefined)).toBe(false);
    expect(statesMatch('abc', ['abc'])).toBe(false);
  });
});

describe('SafeRedirect 처리', () => {
  it.each([
    ['/scrims', '/scrims'],
    ['/members/1?tab=a#x', '/members/1?tab=a#x'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    ['javascript:alert(1)', '/'],
    ['/a b', '/'],
    ['/a\nb', '/'],
    ['', '/'],
    [undefined, '/'],
    [['/a', '/b'], '/'],
    [`/${'a'.repeat(600)}`, '/'],
    // D31: 인증 화면(하위 경로·쿼리·해시 포함)은 '/'
    ['/login', '/'],
    ['/login?error=OAUTH_DENIED', '/'],
    ['/login/', '/'],
    ['/login/x', '/'],
    ['/login#a', '/'],
    ['/welcome', '/'],
    ['/welcome?redirect=%2Fscrims', '/'],
    ['/welcome/step', '/'],
    // 접두사만 같은 다른 경로는 유지
    ['/loginx', '/loginx'],
    ['/welcomes', '/welcomes'],
    ['/scrims?next=/login', '/scrims?next=/login'],
  ])('%j → %j', (input, expected) => {
    expect(toSafeRedirect(input)).toBe(expected);
  });

  it('로그인 실패 URL', () => {
    expect(loginErrorUrl('http://w', 'OAUTH_DENIED')).toBe('http://w/login?error=OAUTH_DENIED');
    expect(loginErrorUrl('http://w', 'OAUTH_DENIED', '/')).toBe('http://w/login?error=OAUTH_DENIED');
    expect(loginErrorUrl('http://w', 'OAUTH_DENIED', '/scrims?x=1')).toBe(
      'http://w/login?error=OAUTH_DENIED&redirect=%2Fscrims%3Fx%3D1',
    );
  });

  it('로그인 후 이동', () => {
    expect(postLoginTarget('/scrims', true)).toBe('/welcome?redirect=%2Fscrims');
    expect(postLoginTarget('/scrims', false)).toBe('/scrims');
  });
});
