/**
 * users 모듈(GET/PATCH /me) HTTP 테스트(DB 없이): Nest 앱 + FakePrisma.
 */
import { AUTH_COOKIE, ErrorBody, GetMeResponse, UpdateMeResponse } from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken } from '../src/common/jwt';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await t?.close();
  t = undefined;
});

async function devLogin(app: TestApp, username: string, role?: 'admin' | 'member') {
  const res = await fetch(`${app.base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, ...(role ? { role } : {}) }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

const get = (app: TestApp, token?: string, raw?: string) =>
  fetch(`${app.base}/me`, { headers: raw !== undefined ? { Authorization: raw } : token ? { Authorization: `Bearer ${token}` } : {} });

const patch = (app: TestApp, token: string, body: unknown) =>
  fetch(`${app.base}/me`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /me', () => {
  it('200 GetMeResponse', async () => {
    t = await createTestApp();
    const { token, userId } = await devLogin(t, 'alice');
    const res = await get(t, token);
    expect(res.status).toBe(200);
    const me = GetMeResponse.strict().parse(await res.json());
    expect(me.id).toBe(userId);
    expect(me.needs_nickname_confirmation).toBe(true);
  });

  it('디스코드 사용자: avatar_url 조립, verified_at ISO', async () => {
    t = await createTestApp();
    const { token, userId } = await devLogin(t, 'bob');
    const row = t.prisma.users.find((u) => u.id === userId);
    Object.assign(row as object, {
      discordId: '123456789012345678',
      discordAvatar: 'a_hash',
      discordGuildVerifiedAt: new Date('2026-10-28T00:00:00.000Z'),
      email: 'bob@example.com',
    });
    const me = GetMeResponse.parse(await (await get(t, token)).json());
    expect(me.avatar_url).toBe('https://cdn.discordapp.com/avatars/123456789012345678/a_hash.png?size=128');
    expect(me.discord_guild_verified_at).toBe('2026-10-28T00:00:00.000Z');
    expect(me.email).toBe('bob@example.com');
  });

  it.each([
    ['헤더 없음', undefined],
    ['Bearer 아님', 'Basic abc'],
    ['빈 토큰', 'Bearer '],
    ['형식 오류', 'Bearer not.a.jwt'],
  ])('%s → 401 UNAUTHENTICATED', async (_n, raw) => {
    t = await createTestApp();
    const res = await get(t, undefined, raw);
    expect(res.status).toBe(401);
    expect(ErrorBody.parse(await res.json()).code).toBe('UNAUTHENTICATED');
  });

  it('다른 키로 서명 → UNAUTHENTICATED, 사용자 없음 → UNAUTHENTICATED', async () => {
    t = await createTestApp();
    const { userId } = await devLogin(t, 'carol');
    const forged = signAccessToken({ sub: userId, role: 'admin' }, 'z'.repeat(40), 900).token;
    expect(ErrorBody.parse(await (await get(t, forged)).json()).code).toBe('UNAUTHENTICATED');
    const ghost = signAccessToken(
      { sub: '00000000-0000-4000-8000-000000000000', role: 'member' },
      t.config.jwtAccessSecret,
      900,
    ).token;
    expect(ErrorBody.parse(await (await get(t, ghost)).json()).code).toBe('UNAUTHENTICATED');
  });

  it('만료 → 401 ACCESS_TOKEN_EXPIRED', async () => {
    t = await createTestApp();
    const { token } = await devLogin(t, 'dave');
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 901_000 });
    const res = await get(t, token);
    expect(res.status).toBe(401);
    expect(ErrorBody.parse(await res.json()).code).toBe('ACCESS_TOKEN_EXPIRED');
  });

  it('리프레시 쿠키만으로는 /me 불가', async () => {
    t = await createTestApp();
    await devLogin(t, 'erin');
    const res = await fetch(`${t.base}/me`, { headers: { Cookie: `${AUTH_COOKIE.refresh}=x` } });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /me', () => {
  it('닉네임 저장 + 첫 확인 완료(needs_nickname_confirmation=false), 정규화 값 저장', async () => {
    t = await createTestApp();
    const { token, userId } = await devLogin(t, 'frank');
    const res = await patch(t, token, { nickname: '  롤생   네컷\t왕 ' });
    expect(res.status).toBe(200);
    const me = UpdateMeResponse.strict().parse(await res.json());
    expect(me.nickname).toBe('롤생 네컷 왕');
    expect(me.needs_nickname_confirmation).toBe(false);
    const row = t.prisma.users.find((u) => u.id === userId);
    expect(row?.nickname).toBe('롤생 네컷 왕');
    const confirmedAt = row?.nicknameConfirmedAt;
    expect(confirmedAt).toBeInstanceOf(Date);

    // 두 번째 변경은 확인 시각을 바꾸지 않는다
    await patch(t, token, { nickname: '새닉' });
    expect(t.prisma.users.find((u) => u.id === userId)?.nicknameConfirmedAt).toEqual(confirmedAt);
  });

  it('현재 닉네임 그대로 보내도 확인 처리', async () => {
    t = await createTestApp();
    const { token } = await devLogin(t, 'gina');
    const me = UpdateMeResponse.parse(await (await patch(t, token, { nickname: 'gina' })).json());
    expect(me.needs_nickname_confirmation).toBe(false);
  });

  it('다른 사용자 닉네임(정규화 후 같음) → 409 NICKNAME_TAKEN', async () => {
    t = await createTestApp();
    const a = await devLogin(t, 'henry');
    const b = await devLogin(t, 'ivan');
    expect((await patch(t, a.token, { nickname: '롤 생' })).status).toBe(200);
    const res = await patch(t, b.token, { nickname: '  롤   생 ' });
    expect(res.status).toBe(409);
    expect(ErrorBody.parse(await res.json())).toEqual({ code: 'NICKNAME_TAKEN', message: '이미 사용 중인 닉네임입니다.' });
    // 대소문자는 구분(다른 닉네임)
    expect((await patch(t, a.token, { nickname: 'Abc' })).status).toBe(200);
    expect((await patch(t, b.token, { nickname: 'abc' })).status).toBe(200);
  });

  it.each([
    [{ nickname: 'a' }],
    [{ nickname: 'abcdefghijklm' }],
    [{ nickname: '닉네임!' }],
    [{ nickname: '   ' }],
    [{ nickname: 'ok_name', role: 'admin' }],
    [{}],
  ])('%j → 400 VALIDATION_FAILED', async (body) => {
    t = await createTestApp();
    const { token } = await devLogin(t, 'jack');
    const res = await patch(t, token, body);
    expect(res.status).toBe(400);
    const err = ErrorBody.parse(await res.json());
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details?.length).toBeGreaterThan(0);
  });

  it('인증 없음 → 401 (본문 검증보다 먼저)', async () => {
    t = await createTestApp();
    const res = await fetch(`${t.base}/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});
