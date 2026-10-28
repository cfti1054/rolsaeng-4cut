import { GetMeResponse, UpdateMeResponse } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { createMockBackend, type MockDb } from './backend';

/** 목이 계약 스키마를 지키는지: 실제 클라이언트(zod 파싱 포함)로 목을 호출해 본다 */
function setup(opts: { accessTtlSec?: number } = {}) {
  let db: MockDb | null = null;
  let cookie = false;
  let now = Date.parse('2026-10-28T00:00:00Z');
  const mock = createMockBackend({
    storage: { get: () => db, set: (d) => (db = d) },
    cookies: { hasRefresh: () => cookie, setRefresh: () => (cookie = true), clearRefresh: () => (cookie = false) },
    now: () => now,
    accessTtlSec: opts.accessTtlSec,
  });
  const api = createApiClient({ fetch: mock.fetch });
  return { mock, api, advance: (ms: number) => (now += ms), hasCookie: () => cookie };
}

describe('목 백엔드(계약 준수)', () => {
  it('쿠키가 없으면 refresh 401 REFRESH_TOKEN_INVALID', async () => {
    const { api } = setup();
    await expect(api.refresh()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_INVALID', status: 401 });
  });

  it('디스코드 로그인 → refresh → GET /me → PATCH /me 흐름', async () => {
    const { mock, api } = setup();
    const user = mock.discordSignIn();
    expect(user.needs_nickname_confirmation).toBe(true);
    const me = await api.request('/me', GetMeResponse);
    expect(me.nickname).toBe('새벽감자');

    const updated = await api.request('/me', UpdateMeResponse, { method: 'PATCH', body: { nickname: '새벽 감자' } });
    expect(updated).toMatchObject({ nickname: '새벽 감자', needs_nickname_confirmation: false });
  });

  it('PATCH /me: 중복 닉네임 409, 규칙 위반 400 + details', async () => {
    const { mock, api } = setup();
    mock.discordSignIn();
    await expect(
      api.request('/me', UpdateMeResponse, { method: 'PATCH', body: { nickname: '미드고정' } }),
    ).rejects.toMatchObject({ code: 'NICKNAME_TAKEN', status: 409 });
    await expect(
      api.request('/me', UpdateMeResponse, { method: 'PATCH', body: { nickname: 'a' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400, details: [{ path: 'nickname' }] });
  });

  it('액세스 토큰이 만료되면 ACCESS_TOKEN_EXPIRED → 클라이언트가 refresh 후 재시도해 성공', async () => {
    const { mock, api, advance } = setup({ accessTtlSec: 60 });
    mock.discordSignIn();
    await api.request('/me', GetMeResponse);
    advance(61_000);
    await expect(api.request('/me', GetMeResponse)).resolves.toMatchObject({ nickname: '새벽감자' });
  });

  it('로그아웃하면 쿠키가 지워지고 이후 refresh는 실패', async () => {
    const { mock, api, hasCookie } = setup();
    mock.discordSignIn();
    await api.request('/auth/logout', null, { method: 'POST', auth: false });
    expect(hasCookie()).toBe(false);
    await expect(api.refresh()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_INVALID' });
  });
});
