import { DISCORD_OAUTH_SCOPES } from '@gcd/shared';
import { z } from 'zod';
import type { AppConfig } from '../../config/env';
import { AppError } from '../../common/app-error';

/**
 * 디스코드 OAuth2 HTTP 호출 경계(계약 5-5 마지막 문단).
 * 실패(4xx/5xx/타임아웃/형식 오류)는 AppError('OAUTH_PROVIDER_ERROR')로 던진다.
 * 멤버 조회 404만 예외로 null을 돌려준다(→ DISCORD_NOT_GUILD_MEMBER 판단은 서비스가 한다).
 */
export const DISCORD_OAUTH_CLIENT = Symbol('DISCORD_OAUTH_CLIENT');

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  email: string | null;
  verified: boolean;
}

export interface DiscordGuildMember {
  nick: string | null;
  pending: boolean;
}

export interface DiscordOAuthClient {
  /** authorization code → 디스코드 액세스 토큰 */
  exchangeCode(code: string): Promise<string>;
  /** GET /users/@me */
  getCurrentUser(accessToken: string): Promise<DiscordUser>;
  /** GET /users/@me/guilds/{guildId}/member. 404면 null */
  getGuildMember(accessToken: string, guildId: string): Promise<DiscordGuildMember | null>;
}

export const DISCORD_API_BASE = 'https://discord.com/api/v10';
export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_TIMEOUT_MS = 5000;

/** 계약 5-5 시작 4번의 authorize URL(scope는 %20 구분) */
export function buildDiscordAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = [
    ['response_type', 'code'],
    ['client_id', clientId],
    ['scope', DISCORD_OAUTH_SCOPES.join(' ')],
    ['redirect_uri', redirectUri],
    ['state', state],
    ['prompt', 'none'],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join('&');
  return `${DISCORD_AUTHORIZE_URL}?${q}`;
}

const TokenResponse = z.object({ access_token: z.string().min(1) });
const UserResponse = z.object({
  id: z.string().min(1),
  username: z.string(),
  global_name: z.string().nullish(),
  avatar: z.string().nullish(),
  email: z.string().nullish(),
  verified: z.boolean().nullish(),
});
const MemberResponse = z.object({
  nick: z.string().nullish(),
  pending: z.boolean().nullish(),
});

type FetchFn = typeof fetch;

export class FetchDiscordOAuthClient implements DiscordOAuthClient {
  constructor(
    private readonly config: AppConfig,
    private readonly fetchFn: FetchFn = globalThis.fetch,
    private readonly timeoutMs: number = DISCORD_TIMEOUT_MS,
  ) {}

  private providerError(what: string, cause?: unknown): AppError {
    return new AppError('OAUTH_PROVIDER_ERROR', undefined, {
      message: `디스코드 ${what} 실패`,
      cause,
    });
  }

  private async call(what: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (err) {
      throw this.providerError(what, err);
    }
  }

  private async json<T extends z.ZodTypeAny>(what: string, res: Response, schema: T): Promise<z.output<T>> {
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw this.providerError(what, err);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw this.providerError(what, parsed.error);
    return parsed.data as z.output<T>;
  }

  async exchangeCode(code: string): Promise<string> {
    const { clientId, clientSecret, redirectUri } = this.config.discord;
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri ?? '',
      client_id: clientId ?? '',
      client_secret: clientSecret ?? '',
    });
    const res = await this.call('토큰 교환', `${DISCORD_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
    if (!res.ok) throw this.providerError(`토큰 교환(HTTP ${res.status})`);
    return (await this.json('토큰 교환', res, TokenResponse)).access_token;
  }

  async getCurrentUser(accessToken: string): Promise<DiscordUser> {
    const res = await this.call('사용자 조회', `${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!res.ok) throw this.providerError(`사용자 조회(HTTP ${res.status})`);
    const u = await this.json('사용자 조회', res, UserResponse);
    return {
      id: u.id,
      username: u.username,
      global_name: u.global_name ?? null,
      avatar: u.avatar ?? null,
      email: u.email ?? null,
      verified: u.verified === true,
    };
  }

  async getGuildMember(accessToken: string, guildId: string): Promise<DiscordGuildMember | null> {
    const res = await this.call(
      '멤버 조회',
      `${DISCORD_API_BASE}/users/@me/guilds/${encodeURIComponent(guildId)}/member`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw this.providerError(`멤버 조회(HTTP ${res.status})`);
    const m = await this.json('멤버 조회', res, MemberResponse);
    return { nick: m.nick ?? null, pending: m.pending === true };
  }
}
