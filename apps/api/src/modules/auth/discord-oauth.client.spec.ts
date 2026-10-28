import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../config/env';
import { AppError } from '../../common/app-error';
import { FetchDiscordOAuthClient, buildDiscordAuthorizeUrl } from './discord-oauth.client';

const config = loadConfig({
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
  DISCORD_CLIENT_ID: 'cid',
  DISCORD_CLIENT_SECRET: 'csecret',
  DISCORD_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/discord/callback',
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function expectProviderError(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe('OAUTH_PROVIDER_ERROR');
}

describe('authorize URL', () => {
  it('계약 5-5 형식', () => {
    expect(buildDiscordAuthorizeUrl('cid', 'http://localhost:3000/api/v1/auth/discord/callback', 'st')).toBe(
      'https://discord.com/oauth2/authorize?response_type=code&client_id=cid&scope=identify%20email%20guilds.members.read&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fv1%2Fauth%2Fdiscord%2Fcallback&state=st&prompt=none',
    );
  });
});

describe('FetchDiscordOAuthClient (fetch 목)', () => {
  it('토큰 교환: form 본문과 응답 파싱', async () => {
    const fetchFn = vi.fn(async () => json(200, { access_token: 'dtok', token_type: 'Bearer' }));
    const c = new FetchDiscordOAuthClient(config, fetchFn as unknown as typeof fetch);
    await expect(c.exchangeCode('the-code')).resolves.toBe('dtok');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://discord.com/api/v10/oauth2/token');
    expect(init.method).toBe('POST');
    const form = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'http://localhost:3000/api/v1/auth/discord/callback',
      client_id: 'cid',
      client_secret: 'csecret',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('토큰 교환 4xx/5xx/형식 오류 → OAUTH_PROVIDER_ERROR', async () => {
    await expectProviderError(new FetchDiscordOAuthClient(config, (async () => json(400, { error: 'invalid_grant' })) as unknown as typeof fetch).exchangeCode('x'));
    await expectProviderError(new FetchDiscordOAuthClient(config, (async () => json(503, {})) as unknown as typeof fetch).exchangeCode('x'));
    await expectProviderError(new FetchDiscordOAuthClient(config, (async () => json(200, { nope: 1 })) as unknown as typeof fetch).exchangeCode('x'));
  });

  it('사용자 조회: 선택 필드 정규화', async () => {
    const c = new FetchDiscordOAuthClient(config, (async () => json(200, { id: '1', username: 'u' })) as unknown as typeof fetch);
    await expect(c.getCurrentUser('t')).resolves.toEqual({
      id: '1',
      username: 'u',
      global_name: null,
      avatar: null,
      email: null,
      verified: false,
    });
  });

  it('멤버 조회: 200 / 404 → null / 401·429·5xx → 오류', async () => {
    const ok = new FetchDiscordOAuthClient(config, (async () => json(200, { nick: 'n', pending: true, roles: [] })) as unknown as typeof fetch);
    await expect(ok.getGuildMember('t', 'g')).resolves.toEqual({ nick: 'n', pending: true });
    const nf = new FetchDiscordOAuthClient(config, (async () => json(404, { code: 10004 })) as unknown as typeof fetch);
    await expect(nf.getGuildMember('t', 'g')).resolves.toBeNull();
    for (const status of [401, 403, 429, 500]) {
      await expectProviderError(
        new FetchDiscordOAuthClient(config, (async () => json(status, {})) as unknown as typeof fetch).getGuildMember('t', 'g'),
      );
    }
  });

  it('타임아웃 → OAUTH_PROVIDER_ERROR', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const c = new FetchDiscordOAuthClient(config, hang, 20);
    await expectProviderError(c.getCurrentUser('t'));
  });

  it('네트워크 오류 → OAUTH_PROVIDER_ERROR', async () => {
    const c = new FetchDiscordOAuthClient(config, (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expectProviderError(c.getGuildMember('t', 'g'));
  });
});
