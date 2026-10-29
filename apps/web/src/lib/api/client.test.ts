import { GetMeResponse, type ErrorCode, type Me, type RefreshTokenResponse } from '@gcd/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient, type FetchLike } from './client';

const ME: Me = {
  id: '6f1c2a8e-4b7d-4c1e-9a3f-2d5e8b9c0a11',
  nickname: '새벽감자',
  role: 'member',
  email: null,
  discord_id: '123456789012345678',
  discord_username: 'saebyeok_potato',
  avatar_url: null,
  discord_guild_verified_at: '2026-10-28T00:00:00.000Z',
  needs_nickname_confirmation: false,
  created_at: '2026-10-28T00:00:00.000Z',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const err = (status: number, code: ErrorCode) => json(status, { code, message: code });
const tokenRes = (token: string): RefreshTokenResponse => ({
  access_token: token,
  token_type: 'Bearer',
  expires_in: 900,
  user: ME,
});

interface Call {
  url: string;
  method: string;
  auth: string | null;
  credentials: RequestCredentials | undefined;
}

/** 경로별 응답 큐를 가진 가짜 fetch */
function fakeFetch(handlers: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      auth: new Headers(init?.headers).get('Authorization'),
      credentials: init?.credentials,
    };
    calls.push(call);
    const key = `${call.method} ${url}`;
    const h = handlers[key];
    if (!h) throw new Error(`no handler for ${key}`);
    return h(call);
  };
  return { fetch, calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url}` === key).length };
}

const REFRESH = 'POST /api/v1/auth/refresh';
const ME_GET = 'GET /api/v1/me';

describe('createApiClient', () => {
  it('토큰이 없으면 refresh로 부팅한 뒤 Bearer 헤더와 credentials: include로 호출하고 zod로 파싱한다', async () => {
    const onSession = vi.fn();
    const f = fakeFetch({
      [REFRESH]: () => json(200, tokenRes('t1')),
      [ME_GET]: (c) => (c.auth === 'Bearer t1' ? json(200, ME) : err(401, 'UNAUTHENTICATED')),
    });
    const api = createApiClient({ fetch: f.fetch, onSession });
    await expect(api.request('/me', GetMeResponse)).resolves.toEqual(ME);
    expect(f.count(REFRESH)).toBe(1);
    expect(onSession).toHaveBeenCalledWith(ME);
    expect(f.calls.every((c) => c.credentials === 'include')).toBe(true);
  });

  it('401 ACCESS_TOKEN_EXPIRED → refresh 1회 → 원 요청 1회 재시도', async () => {
    let token = 't1';
    const f = fakeFetch({
      [REFRESH]: () => json(200, tokenRes(token)),
      [ME_GET]: (c) => (c.auth === 'Bearer t2' ? json(200, ME) : err(401, 'ACCESS_TOKEN_EXPIRED')),
    });
    const api = createApiClient({ fetch: f.fetch });
    await api.refresh(); // t1 보유
    token = 't2';
    await expect(api.request('/me', GetMeResponse)).resolves.toEqual(ME);
    expect(f.count(REFRESH)).toBe(2);
    expect(f.calls.filter((c) => c.url.endsWith('/me')).map((c) => c.auth)).toEqual(['Bearer t1', 'Bearer t2']);
  });

  it('재시도도 401이면 더 반복하지 않고 세션을 비운 뒤 onAuthFailure', async () => {
    const onAuthFailure = vi.fn();
    const f = fakeFetch({
      [REFRESH]: () => json(200, tokenRes('t')),
      [ME_GET]: () => err(401, 'ACCESS_TOKEN_EXPIRED'),
    });
    const api = createApiClient({ fetch: f.fetch, onAuthFailure });
    await expect(api.request('/me', GetMeResponse)).rejects.toMatchObject({ code: 'ACCESS_TOKEN_EXPIRED' });
    expect(f.count(ME_GET)).toBe(2);
    expect(f.count(REFRESH)).toBe(2); // 부팅 1 + 재시도 1
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(api.hasAccessToken()).toBe(false);
  });

  it('동시에 만료된 요청 여러 개도 refresh는 1번(single-flight)', async () => {
    let refreshes = 0;
    const f = fakeFetch({
      [REFRESH]: async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, tokenRes(`t${refreshes}`));
      },
      [ME_GET]: (c) => (c.auth === 'Bearer t2' ? json(200, ME) : err(401, 'ACCESS_TOKEN_EXPIRED')),
    });
    const api = createApiClient({ fetch: f.fetch });
    await api.refresh(); // t1
    const results = await Promise.all([1, 2, 3].map(() => api.request('/me', GetMeResponse)));
    expect(results).toHaveLength(3);
    expect(refreshes).toBe(2); // 처음 1 + 만료 처리 1
  });

  it('토큰 없이 동시에 부팅해도 refresh는 1번', async () => {
    const f = fakeFetch({
      [REFRESH]: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return json(200, tokenRes('t1'));
      },
      [ME_GET]: () => json(200, ME),
    });
    const api = createApiClient({ fetch: f.fetch });
    await Promise.all([api.request('/me', GetMeResponse), api.request('/me', GetMeResponse)]);
    expect(f.count(REFRESH)).toBe(1);
  });

  it.each(['REFRESH_TOKEN_INVALID', 'REFRESH_TOKEN_REUSED'] as const)(
    'refresh가 401 %s면 onAuthFailure를 부르고 원 요청은 보내지 않는다',
    async (code) => {
      const onAuthFailure = vi.fn();
      const f = fakeFetch({ [REFRESH]: () => err(401, code), [ME_GET]: () => json(200, ME) });
      const api = createApiClient({ fetch: f.fetch, onAuthFailure });
      await expect(api.request('/me', GetMeResponse)).rejects.toMatchObject({ code, status: 401 });
      expect(onAuthFailure).toHaveBeenCalledTimes(1);
      expect(f.count(ME_GET)).toBe(0);
    },
  );

  it('UNAUTHENTICATED는 재시도하지 않고 onAuthFailure', async () => {
    const onAuthFailure = vi.fn();
    const f = fakeFetch({ [REFRESH]: () => json(200, tokenRes('t1')), [ME_GET]: () => err(401, 'UNAUTHENTICATED') });
    const api = createApiClient({ fetch: f.fetch, onAuthFailure });
    await expect(api.request('/me', GetMeResponse)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(f.count(ME_GET)).toBe(1);
    expect(f.count(REFRESH)).toBe(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('오류 본문은 ErrorBody로 파싱(code·status·details)', async () => {
    const f = fakeFetch({
      [REFRESH]: () => json(200, tokenRes('t1')),
      'PATCH /api/v1/me': () =>
        json(400, { code: 'VALIDATION_FAILED', message: 'x', details: [{ path: 'nickname', message: 'too short' }] }),
    });
    const api = createApiClient({ fetch: f.fetch });
    const e = await api.request('/me', GetMeResponse, { method: 'PATCH', body: { nickname: 'a' } }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: 'VALIDATION_FAILED', status: 400, details: [{ path: 'nickname', message: 'too short' }] });
  });

  it('성공 응답이 계약과 다르면 INVALID_RESPONSE(타입 단언으로 통과시키지 않는다)', async () => {
    const f = fakeFetch({
      [REFRESH]: () => json(200, tokenRes('t1')),
      [ME_GET]: () => json(200, { ...ME, id: 'not-a-uuid' }),
    });
    const api = createApiClient({ fetch: f.fetch });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(api.request('/me', GetMeResponse)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    spy.mockRestore();
  });

  it('refresh 응답이 계약과 다르면 토큰을 저장하지 않는다', async () => {
    const f = fakeFetch({ [REFRESH]: () => json(200, { access_token: 't1' }) });
    const api = createApiClient({ fetch: f.fetch });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(api.refresh()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(api.hasAccessToken()).toBe(false);
    spy.mockRestore();
  });

  it('네트워크 실패·프록시 HTML 5xx는 NETWORK_ERROR', async () => {
    const down = createApiClient({
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(down.refresh()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });

    const proxy = createApiClient({ fetch: async () => new Response('<html>502</html>', { status: 502 }) });
    await expect(proxy.refresh()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 502 });
  });

  it('auth: false 요청은 Authorization 없이 보내고 204는 undefined', async () => {
    const f = fakeFetch({ 'POST /api/v1/auth/logout': () => new Response(null, { status: 204 }) });
    const api = createApiClient({ fetch: f.fetch });
    await expect(api.request('/auth/logout', null, { method: 'POST', auth: false })).resolves.toBeUndefined();
    expect(f.calls[0]?.auth).toBeNull();
    expect(f.count(REFRESH)).toBe(0);
  });

  it('S2 9-1: 회전하지 않은 refresh(200, Set-Cookie 없음)도 정상 세션으로 처리하고 쿠키를 다루지 않는다', async () => {
    const onAuthFailure = vi.fn();
    let n = 0;
    const f = fakeFetch({
      // 같은 리프레시 쿠키로 하루에 여러 번: 서버는 새 액세스 토큰만 주고 Set-Cookie를 붙이지 않는다
      [REFRESH]: () => {
        n += 1;
        const res = json(200, tokenRes(`t${n}`));
        expect(res.headers.has('Set-Cookie')).toBe(false);
        return res;
      },
      [ME_GET]: (c) => (c.auth === `Bearer t${n}` ? json(200, ME) : err(401, 'ACCESS_TOKEN_EXPIRED')),
    });
    const api = createApiClient({ fetch: f.fetch, onAuthFailure });
    await expect(api.request('/me', GetMeResponse)).resolves.toEqual(ME);
    await expect(api.refresh()).resolves.toMatchObject({ access_token: 't2' });
    await expect(api.request('/me', GetMeResponse)).resolves.toEqual(ME);
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(api.hasAccessToken()).toBe(true);
  });
});
