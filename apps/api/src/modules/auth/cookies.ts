import { API_PREFIX, AUTH_COOKIE, OAUTH_STATE_TTL_SEC } from '@gcd/shared';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/env';

/** gcd_oauth 쿠키 경로(계약 5-5): 인증 엔드포인트에만 보낸다. */
export const OAUTH_COOKIE_PATH = `${API_PREFIX}/auth`;

function base(config: AppConfig, path: string): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path };
}

/** gcd_rt: HttpOnly, SameSite=Lax, Path=/, production에서 Secure, Max-Age=남은 수명(계약 5-2) */
export function setRefreshCookie(res: Response, config: AppConfig, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(AUTH_COOKIE.refresh, token, { ...base(config, '/'), maxAge });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(AUTH_COOKIE.refresh, base(config, '/'));
}

export function setOAuthStateCookie(res: Response, config: AppConfig, value: string): void {
  res.cookie(AUTH_COOKIE.oauthState, value, {
    ...base(config, OAUTH_COOKIE_PATH),
    maxAge: OAUTH_STATE_TTL_SEC * 1000,
  });
}

export function clearOAuthStateCookie(res: Response, config: AppConfig): void {
  res.clearCookie(AUTH_COOKIE.oauthState, base(config, OAUTH_COOKIE_PATH));
}
