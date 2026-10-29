import { randomBytes } from 'node:crypto';
import { API_PREFIX, ApiPath, STEAM_LINK_COOKIE, STEAM_LINK_STATE_TTL_SEC } from '@gcd/shared';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import { signCookiePayload, verifySignedCookie } from '../../common/signed-cookie';
import type { AppConfig } from '../../config/env';

/**
 * 스팀 연동 state 쿠키 `gcd_steam`(계약 S1 5-2 시작 2번).
 * 값 = COOKIE_SECRET 서명 JSON { state, user_id, iat }. HttpOnly, SameSite=Lax, Max-Age=600,
 * Path=/api/v1/me/game-accounts/steam(콜백에만 실린다), production에서 Secure.
 */
export const STEAM_COOKIE_PATH = `${API_PREFIX}/me/game-accounts/steam`;

const SteamCookiePayload = z.object({
  state: z.string().min(1),
  user_id: z.string().uuid(),
  iat: z.number().int(),
});
export type SteamCookiePayload = z.infer<typeof SteamCookiePayload>;

export function newSteamState(): string {
  return randomBytes(32).toString('base64url');
}

export function signSteamCookie(payload: SteamCookiePayload, secret: string): string {
  return signCookiePayload(payload, secret);
}

export function verifySteamCookie(cookie: unknown, secret: string, nowMs: number): SteamCookiePayload | null {
  return verifySignedCookie(cookie, secret, SteamCookiePayload, STEAM_LINK_STATE_TTL_SEC, nowMs);
}

/** OpenID return_to: 웹 오리진 프록시 경유 콜백 + 우리 state(5-2 시작 3번) */
export function steamReturnTo(config: AppConfig, state: string): string {
  return `${config.webOrigin}${API_PREFIX}${ApiPath.steamLinkCallback}?state=${encodeURIComponent(state)}`;
}

function cookieOptions(config: AppConfig): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: STEAM_COOKIE_PATH };
}

export function setSteamCookie(res: Response, config: AppConfig, value: string): void {
  res.cookie(STEAM_LINK_COOKIE, value, { ...cookieOptions(config), maxAge: STEAM_LINK_STATE_TTL_SEC * 1000 });
}

export function clearSteamCookie(res: Response, config: AppConfig): void {
  res.clearCookie(STEAM_LINK_COOKIE, cookieOptions(config));
}
