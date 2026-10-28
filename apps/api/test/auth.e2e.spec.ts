/**
 * auth 모듈 HTTP 테스트(DB 없이): Nest 앱 전체 + 인메모리 Prisma(FakePrisma) + 디스코드 목.
 * 실제 PostgreSQL에서의 같은 흐름은 test/db/*.db.e2e.spec.ts(TEST_DATABASE_URL 필요).
 */
import {
  AUTH_COOKIE,
  ErrorBody,
  OAuthLoginErrorCode,
  RefreshTokenResponse,
  DevLoginResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashRefreshToken } from '../src/modules/auth/refresh-token.service';
import { signOAuthState } from '../src/modules/auth/oauth-state';
import {
  DEFAULT_DISCORD_USER,
  TEST_WEB_ORIGIN,
  type TestApp,
  cookieValue,
  createTestApp,
  findSetCookie,
  mockDiscord,
} from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await t?.close();
  t = undefined;
});

/** Set-Cookie의 `name=value`(인코딩 유지) 부분 */
function pair(setCookie: string | undefined): string {
  if (!setCookie) throw new Error('쿠키 없음');
  return setCookie.split(';')[0] as string;
}

function attrs(setCookie: string): string[] {
  return setCookie.split(';').slice(1).map((s) => s.trim().toLowerCase());
}

async function startOAuth(app: TestApp, redirect?: string) {
  const qs = redirect === undefined ? '' : `?redirect=${encodeURIComponent(redirect)}`;
  const res = await fetch(`${app.base}/auth/discord${qs}`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  const stateCookie = findSetCookie(res, AUTH_COOKIE.oauthState);
  const state = location.startsWith('https://discord.com') ? new URL(location).searchParams.get('state') : null;
  return { res, location, stateCookie, state };
}

async function callback(app: TestApp, query: Record<string, string>, cookie?: string) {
  const res = await fetch(`${app.base}/auth/discord/callback?${new URLSearchParams(query).toString()}`, {
    redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { res, location: res.headers.get('location') ?? '' };
}

/** 시작 → 콜백 성공까지. gcd_rt 원문 반환 */
async function fullLogin(app: TestApp, redirect = '/scrims') {
  const s = await startOAuth(app, redirect);
  const cb = await callback(app, { code: 'c', state: s.state as string }, pair(s.stateCookie));
  return { ...cb, rt: cookieValue(findSetCookie(cb.res, AUTH_COOKIE.refresh)) };
}

async function postRefresh(app: TestApp, rt?: string, headers: Record<string, string> = {}) {
  return fetch(`${app.base}/auth/refresh`, {
    method: 'POST',
    headers: { ...(rt ? { Cookie: `${AUTH_COOKIE.refresh}=${encodeURIComponent(rt)}` } : {}), ...headers },
  });
}

function expectLoginError(location: string, code: OAuthLoginErrorCode, redirect?: string) {
  const url = new URL(location);
  expect(url.origin).toBe(TEST_WEB_ORIGIN);
  expect(url.pathname).toBe('/login');
  expect(url.searchParams.get('error')).toBe(code);
  expect(url.searchParams.get('redirect')).toBe(redirect ?? null);
}

// ---------------------------------------------------------------------------

describe('GET /auth/discord (시작)', () => {
  it('302 디스코드 authorize + gcd_oauth 쿠키(HttpOnly, Lax, Path=/api/v1/auth, Max-Age=600)', async () => {
    t = await createTestApp();
    const s = await startOAuth(t, '/scrims');
    expect(s.res.status).toBe(302);
    const url = new URL(s.location);
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('identify email guilds.members.read');
    expect(s.location).toContain('scope=identify%20email%20guilds.members.read');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(t.config.discord.redirectUri);
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(Buffer.from(s.state as string, 'base64url')).toHaveLength(32);
    const a = attrs(s.stateCookie as string);
    expect(a).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/api/v1/auth', 'max-age=600']));
    expect(a).not.toContain('secure');
  });

  it('미설정이면 302 /login?error=OAUTH_NOT_CONFIGURED, 쿠키 없음', async () => {
    t = await createTestApp({ env: { DISCORD_CLIENT_SECRET: '' } });
    const s = await startOAuth(t, '/scrims');
    expect(s.res.status).toBe(302);
    expectLoginError(s.location, 'OAUTH_NOT_CONFIGURED', '/scrims');
    expect(s.stateCookie).toBeUndefined();
  });

  it('오픈 리다이렉트 시도(//evil.com)는 / 로 간주', async () => {
    t = await createTestApp();
    const s = await startOAuth(t, '//evil.com');
    const fin = await callback(t, { code: 'c', state: s.state as string }, pair(s.stateCookie));
    expect(fin.location).toBe(`${TEST_WEB_ORIGIN}/welcome?redirect=%2F`);
  });

  it('D31: redirect가 /login·/welcome이면 / 로 간주(첫 로그인 /welcome 이동은 유지)', async () => {
    t = await createTestApp();
    const s = await startOAuth(t, '/welcome?redirect=%2Fscrims');
    const fin = await callback(t, { code: 'c', state: s.state as string }, pair(s.stateCookie));
    expect(fin.location).toBe(`${TEST_WEB_ORIGIN}/welcome?redirect=%2F`);

    // 미설정 실패 URL에도 /login redirect를 붙이지 않는다
    await t.close();
    t = await createTestApp({ env: { DISCORD_CLIENT_ID: '' } });
    expectLoginError((await startOAuth(t, '/login?error=X')).location, 'OAUTH_NOT_CONFIGURED');
  });

  it('D31: 기존(확인 완료) 사용자는 /login 대신 / 로 이동', async () => {
    t = await createTestApp();
    await t.prisma.user.create({
      data: { nickname: '확정닉', discordId: DEFAULT_DISCORD_USER.id, nicknameConfirmedAt: new Date() },
    });
    const fin = await fullLogin(t, '/login/');
    expect(fin.location).toBe(`${TEST_WEB_ORIGIN}/`);
  });

  it('D31: 규칙 이전에 발급된 state 쿠키의 /login redirect도 콜백에서 / 로 바꾼다', async () => {
    t = await createTestApp();
    const cookie = signOAuthState(
      { state: 'st', redirect: '/login', iat: Math.floor(Date.now() / 1000) },
      t.config.cookieSecret,
    );
    const cb = await callback(t, { code: 'c', state: 'st' }, `${AUTH_COOKIE.oauthState}=${encodeURIComponent(cookie)}`);
    expect(cb.location).toBe(`${TEST_WEB_ORIGIN}/welcome?redirect=%2F`);
    const denied = await callback(t, { error: 'access_denied', state: 'st' }, `${AUTH_COOKIE.oauthState}=${encodeURIComponent(cookie)}`);
    expectLoginError(denied.location, 'OAUTH_DENIED');
  });

  it('production이면 쿠키에 Secure', async () => {
    t = await createTestApp({ env: { NODE_ENV: 'production' } });
    const s = await startOAuth(t);
    expect(attrs(s.stateCookie as string)).toContain('secure');
  });
});

describe('GET /auth/discord/callback', () => {
  it('신규 사용자: 생성 → gcd_rt 발급 → /welcome?redirect= 이동, state 쿠키 삭제', async () => {
    t = await createTestApp();
    const s = await startOAuth(t, '/scrims');
    const cb = await callback(t, { code: 'the-code', state: s.state as string }, pair(s.stateCookie));
    expect(cb.res.status).toBe(302);
    expect(cb.location).toBe(`${TEST_WEB_ORIGIN}/welcome?redirect=%2Fscrims`);

    const cleared = findSetCookie(cb.res, AUTH_COOKIE.oauthState) as string;
    expect(attrs(cleared)).toEqual(expect.arrayContaining(['path=/api/v1/auth']));
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

    const rtCookie = findSetCookie(cb.res, AUTH_COOKIE.refresh) as string;
    expect(attrs(rtCookie)).toEqual(expect.arrayContaining(['httponly', 'samesite=lax', 'path=/']));
    const maxAge = Number(attrs(rtCookie).find((a) => a.startsWith('max-age='))?.split('=')[1]);
    expect(maxAge).toBeGreaterThan(30 * 86400 - 10);
    expect(maxAge).toBeLessThanOrEqual(30 * 86400);

    expect(t.discord.exchangeCode).toHaveBeenCalledWith('the-code');
    expect(t.discord.getGuildMember).toHaveBeenCalledWith('discord-access-token', '111111111111111111');

    const [user] = t.prisma.users;
    expect(user).toMatchObject({
      discordId: DEFAULT_DISCORD_USER.id,
      nickname: '서버닉', // 길드 nick 우선
      role: 'member',
      email: 'kim@example.com',
      discordUsername: 'gamer_kim',
      discordGlobalName: '김게이머',
      discordAvatar: 'abc123hash',
      nicknameConfirmedAt: null,
    });
    expect(user?.discordGuildVerifiedAt).toBeInstanceOf(Date);
    expect(user?.lastLoginAt).toBeInstanceOf(Date);

    // 리프레시 원문은 저장하지 않고 SHA-256 hex만
    const rt = cookieValue(rtCookie) as string;
    expect(t.prisma.refreshTokens).toHaveLength(1);
    expect(t.prisma.refreshTokens[0]?.tokenHash).toBe(hashRefreshToken(rt));
    expect(t.prisma.refreshTokens[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(t.prisma.refreshTokens)).not.toContain(rt);
  });

  it('기존 사용자(닉네임 확인 완료): 닉네임 유지, 디스코드 정보 갱신, redirect로 바로 이동', async () => {
    const discord = mockDiscord({
      user: { ...DEFAULT_DISCORD_USER, username: 'new_name', avatar: null, email: 'unverified@x.com', verified: false },
    });
    t = await createTestApp({ discord });
    await t.prisma.user.create({
      data: {
        nickname: '확정닉',
        discordId: DEFAULT_DISCORD_USER.id,
        email: 'old@example.com',
        nicknameConfirmedAt: new Date(),
      },
    });
    const fin = await fullLogin(t, '/rankings');
    expect(fin.location).toBe(`${TEST_WEB_ORIGIN}/rankings`);
    expect(t.prisma.users[0]).toMatchObject({
      nickname: '확정닉',
      discordUsername: 'new_name',
      discordAvatar: null,
      email: 'old@example.com', // 미인증 이메일은 덮어쓰지 않음
      role: 'member',
    });
  });

  it('m1 회귀: Me.email 규칙을 통과하지 못하는 인증 이메일은 null로 저장(로그인·refresh·/me 정상)', async () => {
    const weird = 'user@xn--hxajbheg2az3al.xn--jxalpdlp';
    t = await createTestApp({
      discord: mockDiscord({ user: { ...DEFAULT_DISCORD_USER, email: weird, verified: true } }),
    });
    // 기존 사용자에게 저장돼 있던 값도 비운다
    await t.prisma.user.create({
      data: { nickname: '기존', discordId: DEFAULT_DISCORD_USER.id, email: 'old@example.com', nicknameConfirmedAt: new Date() },
    });
    const fin = await fullLogin(t, '/scrims');
    expect(fin.location).toBe(`${TEST_WEB_ORIGIN}/scrims`);
    expect(t.prisma.users[0]?.email).toBeNull();
    const ref = await postRefresh(t, fin.rt);
    expect(ref.status).toBe(200);
    const body = RefreshTokenResponse.parse(await ref.json());
    expect(body.user.email).toBeNull();
    const me = await fetch(`${t.base}/me`, { headers: { Authorization: `Bearer ${body.access_token}` } });
    expect(me.status).toBe(200);

    // 신규 사용자도 null
    await t.close();
    t = await createTestApp({
      discord: mockDiscord({ user: { ...DEFAULT_DISCORD_USER, email: 'user@localhost', verified: true } }),
    });
    const fresh = await fullLogin(t);
    expect(fresh.location).toContain('/welcome');
    expect(t.prisma.users[0]?.email).toBeNull();
  });

  it('ADMIN_DISCORD_IDS: 신규는 admin, 기존 member는 승격, 목록에 없으면 강등하지 않음', async () => {
    const adminId = '900000000000000001';
    t = await createTestApp({ discord: mockDiscord({ user: { ...DEFAULT_DISCORD_USER, id: adminId } }) });
    await fullLogin(t);
    expect(t.prisma.users[0]?.role).toBe('admin');
    await t.close();

    t = await createTestApp({ discord: mockDiscord({ user: { ...DEFAULT_DISCORD_USER, id: adminId } }) });
    await t.prisma.user.create({ data: { nickname: '기존', discordId: adminId, role: 'member' } });
    await fullLogin(t);
    expect(t.prisma.users[0]?.role).toBe('admin');
    await t.close();

    t = await createTestApp();
    await t.prisma.user.create({ data: { nickname: '운영', discordId: DEFAULT_DISCORD_USER.id, role: 'admin' } });
    await fullLogin(t);
    expect(t.prisma.users[0]?.role).toBe('admin');
  });

  it('DISCORD_GUILD_ID 비어 있으면 멤버 검사 생략, verified_at 갱신 안 함, 닉네임은 global_name', async () => {
    t = await createTestApp({ env: { DISCORD_GUILD_ID: '' } });
    const fin = await fullLogin(t);
    expect(fin.location).toContain('/welcome');
    expect(t.discord.getGuildMember).not.toHaveBeenCalled();
    expect(t.prisma.users[0]?.discordGuildVerifiedAt).toBeNull();
    expect(t.prisma.users[0]?.nickname).toBe('김게이머');
  });

  it('기본 닉네임이 겹치면 숫자 접미사', async () => {
    t = await createTestApp();
    await t.prisma.user.create({ data: { nickname: '서버닉', discordId: 'other' } });
    await fullLogin(t);
    expect(t.prisma.users[1]?.nickname).toBe('서버닉2');
  });

  it('사용자 취소(error=access_denied) → OAUTH_DENIED, 쿠키의 redirect 유지', async () => {
    t = await createTestApp();
    const s = await startOAuth(t, '/scrims');
    const cb = await callback(t, { error: 'access_denied', state: s.state as string }, pair(s.stateCookie));
    expectLoginError(cb.location, 'OAUTH_DENIED', '/scrims');
    expect(findSetCookie(cb.res, AUTH_COOKIE.oauthState)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(findSetCookie(cb.res, AUTH_COOKIE.refresh)).toBeUndefined();
    expect(t.discord.exchangeCode).not.toHaveBeenCalled();
  });

  it('그 밖의 error → OAUTH_PROVIDER_ERROR', async () => {
    t = await createTestApp();
    const s = await startOAuth(t);
    const cb = await callback(t, { error: 'server_error', state: s.state as string }, pair(s.stateCookie));
    expectLoginError(cb.location, 'OAUTH_PROVIDER_ERROR');
  });

  it('state 불일치·쿠키 없음·위조·만료 → OAUTH_STATE_INVALID', async () => {
    t = await createTestApp();
    const s = await startOAuth(t, '/scrims');
    expectLoginError((await callback(t, { code: 'c', state: 'wrong' }, pair(s.stateCookie))).location, 'OAUTH_STATE_INVALID', '/scrims');
    expectLoginError((await callback(t, { code: 'c', state: s.state as string })).location, 'OAUTH_STATE_INVALID');
    const forged = signOAuthState({ state: s.state as string, redirect: '/', iat: Math.floor(Date.now() / 1000) }, 'x'.repeat(40));
    expectLoginError(
      (await callback(t, { code: 'c', state: s.state as string }, `${AUTH_COOKIE.oauthState}=${encodeURIComponent(forged)}`)).location,
      'OAUTH_STATE_INVALID',
    );
    const expired = signOAuthState(
      { state: 'st', redirect: '/', iat: Math.floor(Date.now() / 1000) - 601 },
      t.config.cookieSecret,
    );
    expectLoginError(
      (await callback(t, { code: 'c', state: 'st' }, `${AUTH_COOKIE.oauthState}=${encodeURIComponent(expired)}`)).location,
      'OAUTH_STATE_INVALID',
    );
    expect(t.discord.exchangeCode).not.toHaveBeenCalled();
    expect(t.prisma.users).toHaveLength(0);
  });

  it('길드 404 → DISCORD_NOT_GUILD_MEMBER(기존 사용자도 거절)', async () => {
    t = await createTestApp({ discord: mockDiscord({ member: null }) });
    await t.prisma.user.create({ data: { nickname: '기존', discordId: DEFAULT_DISCORD_USER.id } });
    const fin = await fullLogin(t, '/scrims');
    expectLoginError(fin.location, 'DISCORD_NOT_GUILD_MEMBER', '/scrims');
    expect(fin.rt).toBeUndefined();
    expect(t.prisma.refreshTokens).toHaveLength(0);
  });

  it('길드 pending=true → DISCORD_NOT_GUILD_MEMBER, 사용자 생성 안 함', async () => {
    t = await createTestApp({ discord: mockDiscord({ member: { nick: null, pending: true } }) });
    const fin = await fullLogin(t);
    expectLoginError(fin.location, 'DISCORD_NOT_GUILD_MEMBER', '/scrims');
    expect(t.prisma.users).toHaveLength(0);
  });

  it('디스코드 5xx(클라이언트가 OAUTH_PROVIDER_ERROR를 던짐) → OAUTH_PROVIDER_ERROR', async () => {
    const discord = mockDiscord();
    const { AppError } = await import('../src/common/app-error');
    discord.exchangeCode.mockRejectedValueOnce(new AppError('OAUTH_PROVIDER_ERROR'));
    t = await createTestApp({ discord });
    expectLoginError((await fullLogin(t)).location, 'OAUTH_PROVIDER_ERROR', '/scrims');

    discord.getGuildMember.mockRejectedValueOnce(new AppError('OAUTH_PROVIDER_ERROR'));
    expectLoginError((await fullLogin(t)).location, 'OAUTH_PROVIDER_ERROR', '/scrims');
  });

  it('예상 못한 예외 → INTERNAL_ERROR', async () => {
    const discord = mockDiscord();
    discord.getCurrentUser.mockRejectedValueOnce(new Error('boom'));
    t = await createTestApp({ discord });
    expectLoginError((await fullLogin(t)).location, 'INTERNAL_ERROR', '/scrims');
  });

  it('미설정 상태의 콜백 → OAUTH_NOT_CONFIGURED', async () => {
    t = await createTestApp({ env: { DISCORD_CLIENT_ID: '' } });
    expectLoginError((await callback(t, { code: 'c', state: 's' })).location, 'OAUTH_NOT_CONFIGURED');
  });
});

describe('POST /auth/refresh', () => {
  it('정상 회전: 200 RefreshTokenResponse + 새 쿠키, 같은 family·같은 expires_at, 이전 토큰 폐기', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    const res = await postRefresh(t, rt, { Origin: TEST_WEB_ORIGIN });
    expect(res.status).toBe(200);
    const body = RefreshTokenResponse.parse(await res.json());
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(900);
    expect(body.user.needs_nickname_confirmation).toBe(true);
    expect(body.user.avatar_url).toBe(
      `https://cdn.discordapp.com/avatars/${DEFAULT_DISCORD_USER.id}/abc123hash.png?size=128`,
    );
    const next = cookieValue(findSetCookie(res, AUTH_COOKIE.refresh));
    expect(next).toBeTruthy();
    expect(next).not.toBe(rt);
    const [old, fresh] = t.prisma.refreshTokens;
    expect(old?.revokedAt).toBeInstanceOf(Date);
    expect(old?.replacedById).toBe(fresh?.id);
    expect(fresh?.familyId).toBe(old?.familyId);
    expect(fresh?.expiresAt.getTime()).toBe(old?.expiresAt.getTime());
    expect(fresh?.tokenHash).toBe(hashRefreshToken(next as string));
  });

  it('role은 DB 최신값', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    (t.prisma.users[0] as { role: string }).role = 'admin';
    const body = RefreshTokenResponse.parse(await (await postRefresh(t, rt)).json());
    expect(body.user.role).toBe('admin');
  });

  it('쿠키 없음 → 401 REFRESH_TOKEN_INVALID', async () => {
    t = await createTestApp();
    const res = await postRefresh(t);
    expect(res.status).toBe(401);
    expect(ErrorBody.parse(await res.json()).code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('모르는 토큰 → 401 REFRESH_TOKEN_INVALID + 쿠키 삭제', async () => {
    t = await createTestApp();
    const res = await postRefresh(t, 'unknown');
    expect(res.status).toBe(401);
    expect(ErrorBody.parse(await res.json()).code).toBe('REFRESH_TOKEN_INVALID');
    expect(findSetCookie(res, AUTH_COOKIE.refresh)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('만료된 토큰 → REFRESH_TOKEN_INVALID', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    (t.prisma.refreshTokens[0] as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1);
    const res = await postRefresh(t, rt);
    expect(ErrorBody.parse(await res.json()).code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('Origin 불일치 → 403 FORBIDDEN(회전하지 않음)', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    const res = await postRefresh(t, rt, { Origin: 'https://evil.example.com' });
    expect(res.status).toBe(403);
    expect(ErrorBody.parse(await res.json()).code).toBe('FORBIDDEN');
    expect(t.prisma.refreshTokens[0]?.revokedAt).toBeNull();
  });

  it('회전된 토큰을 10초 안에 다시 쓰면 회전 없이 액세스 토큰만(Set-Cookie 없음)', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    expect((await postRefresh(t, rt)).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 9_000 });
    const again = await postRefresh(t, rt);
    expect(again.status).toBe(200);
    RefreshTokenResponse.parse(await again.json());
    expect(findSetCookie(again, AUTH_COOKIE.refresh)).toBeUndefined();
    expect(t.prisma.refreshTokens).toHaveLength(2);
  });

  it('10초 지난 재사용 → 401 REFRESH_TOKEN_REUSED + family 전체 폐기 + 쿠키 삭제', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    const r1 = await postRefresh(t, rt);
    const rt2 = cookieValue(findSetCookie(r1, AUTH_COOKIE.refresh));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11_000 });
    const reuse = await postRefresh(t, rt);
    expect(reuse.status).toBe(401);
    expect(ErrorBody.parse(await reuse.json()).code).toBe('REFRESH_TOKEN_REUSED');
    expect(findSetCookie(reuse, AUTH_COOKIE.refresh)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(t.prisma.refreshTokens.every((x) => x.revokedAt !== null)).toBe(true);
    // 정상 사용자 쪽 최신 토큰도 폐기됨(로그아웃으로 폐기된 것과 같은 취급)
    const victim = await postRefresh(t, rt2);
    expect(ErrorBody.parse(await victim.json()).code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('동시 refresh(Promise.all): 둘 다 200, 회전은 1번(새 쿠키 1개), 재사용으로 오탐하지 않음', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    const results = await Promise.all([postRefresh(t, rt), postRefresh(t, rt), postRefresh(t, rt)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const cookies = results.map((r) => findSetCookie(r, AUTH_COOKIE.refresh)).filter(Boolean);
    expect(cookies).toHaveLength(1);
    expect(t.prisma.refreshTokens).toHaveLength(2);
    expect(t.prisma.refreshTokens.filter((x) => x.revokedAt === null)).toHaveLength(1);
  });

  it('로그아웃 뒤에는 유예 중인 이전 토큰도 거절', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    const r1 = await postRefresh(t, rt);
    const rt2 = cookieValue(findSetCookie(r1, AUTH_COOKIE.refresh)) as string;
    await fetch(`${t.base}/auth/logout`, { method: 'POST', headers: { Cookie: `${AUTH_COOKIE.refresh}=${encodeURIComponent(rt2)}` } });
    const res = await postRefresh(t, rt);
    expect(ErrorBody.parse(await res.json()).code).toBe('REFRESH_TOKEN_INVALID');
  });
});

describe('POST /auth/logout', () => {
  it('204, family 폐기, 쿠키 삭제(Path=/)', async () => {
    t = await createTestApp();
    const { rt } = await fullLogin(t);
    const res = await fetch(`${t.base}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: `${AUTH_COOKIE.refresh}=${encodeURIComponent(rt as string)}`, Origin: TEST_WEB_ORIGIN },
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const cleared = findSetCookie(res, AUTH_COOKIE.refresh) as string;
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(attrs(cleared)).toEqual(expect.arrayContaining(['path=/', 'httponly', 'samesite=lax']));
    expect(t.prisma.refreshTokens[0]?.revokedAt).toBeInstanceOf(Date);
    const after = await postRefresh(t, rt);
    expect(ErrorBody.parse(await after.json()).code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('쿠키 없음·모르는 토큰이어도 204', async () => {
    t = await createTestApp();
    expect((await fetch(`${t.base}/auth/logout`, { method: 'POST' })).status).toBe(204);
    expect(
      (await fetch(`${t.base}/auth/logout`, { method: 'POST', headers: { Cookie: `${AUTH_COOKIE.refresh}=nope` } })).status,
    ).toBe(204);
  });

  it('Origin 불일치 → 403', async () => {
    t = await createTestApp();
    const res = await fetch(`${t.base}/auth/logout`, { method: 'POST', headers: { Origin: 'http://evil' } });
    expect(res.status).toBe(403);
    expect(ErrorBody.parse(await res.json()).code).toBe('FORBIDDEN');
  });
});

describe('POST /auth/dev-login', () => {
  const post = (app: TestApp, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('열림: 신규 사용자 생성(dev-{username}, 닉네임 확인 필요) + 쿠키', async () => {
    t = await createTestApp();
    const res = await post(t, { username: 'tester_1' }, { Origin: TEST_WEB_ORIGIN });
    expect(res.status).toBe(200);
    const body = DevLoginResponse.parse(await res.json());
    expect(body.user).toMatchObject({
      nickname: 'tester_1',
      role: 'member',
      discord_id: 'dev-tester_1',
      discord_username: 'tester_1',
      avatar_url: null,
      email: null,
      discord_guild_verified_at: null,
      needs_nickname_confirmation: true,
    });
    expect(findSetCookie(res, AUTH_COOKIE.refresh)).toBeTruthy();
    expect(t.discord.getGuildMember).not.toHaveBeenCalled();
  });

  it('role은 신규·기존 모두 적용, 생략하면 기존 유지. 로그인마다 새 family', async () => {
    t = await createTestApp();
    const a = DevLoginResponse.parse(await (await post(t, { username: 'boss', role: 'admin' })).json());
    expect(a.user.role).toBe('admin');
    const b = DevLoginResponse.parse(await (await post(t, { username: 'boss' })).json());
    expect(b.user.role).toBe('admin');
    expect(b.user.id).toBe(a.user.id);
    const c = DevLoginResponse.parse(await (await post(t, { username: 'boss', role: 'member' })).json());
    expect(c.user.role).toBe('member');
    const families = new Set(t.prisma.refreshTokens.map((x) => x.familyId));
    expect(families.size).toBe(3);
  });

  it('검증 실패 → 400 VALIDATION_FAILED + details', async () => {
    t = await createTestApp();
    for (const body of [{ username: 'A' }, { username: 'ok_name', extra: 1 }, { username: 'ok', role: 'owner' }, {}]) {
      const res = await post(t, body);
      expect(res.status).toBe(400);
      const err = ErrorBody.parse(await res.json());
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.details?.length).toBeGreaterThan(0);
    }
  });

  it('잘못된 JSON → 400 VALIDATION_FAILED', async () => {
    t = await createTestApp();
    const res = await post(t, '{"username":');
    expect(res.status).toBe(400);
    expect(ErrorBody.parse(await res.json()).code).toBe('VALIDATION_FAILED');
  });

  it('Origin 불일치 → 403', async () => {
    t = await createTestApp();
    const res = await post(t, { username: 'tester' }, { Origin: 'http://localhost:3001' });
    expect(res.status).toBe(403);
  });

  it.each([
    ['AUTH_DEV_LOGIN=false', { AUTH_DEV_LOGIN: 'false' }],
    ['AUTH_DEV_LOGIN 없음', { AUTH_DEV_LOGIN: '' }],
    ['NODE_ENV=production', { AUTH_DEV_LOGIN: 'true', NODE_ENV: 'production' }],
  ])('닫힘(%s) → 404 NOT_FOUND (검증·Origin보다 먼저)', async (_name, env) => {
    t = await createTestApp({ env });
    for (const [body, headers] of [
      [{ username: 'tester' }, {}],
      [{ bad: true }, { Origin: 'http://evil' }],
    ] as const) {
      const res = await post(t, body, headers);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: 'NOT_FOUND', message: '찾을 수 없습니다.' });
    }
    expect(t.prisma.users).toHaveLength(0);
  });
});

describe('공통', () => {
  it('없는 라우트 → 404 {code:NOT_FOUND}', async () => {
    t = await createTestApp();
    const res = await fetch(`${t.base}/nope`);
    expect(res.status).toBe(404);
    expect(ErrorBody.strict().parse(await res.json()).code).toBe('NOT_FOUND');
    const outside = await fetch(`${t.base.replace('/api/v1', '')}/me`);
    expect(outside.status).toBe(404);
  });
});
