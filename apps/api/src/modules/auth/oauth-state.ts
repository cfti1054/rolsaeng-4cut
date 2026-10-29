import { randomBytes } from 'node:crypto';
import { OAUTH_STATE_TTL_SEC, SafeRedirectPath } from '@gcd/shared';
import { z } from 'zod';
import { constantTimeEquals, signCookiePayload, verifySignedCookie } from '../../common/signed-cookie';

/**
 * OAuth state 쿠키(gcd_oauth) 값: base64url(JSON {state, redirect, iat}) + '.' + HMAC-SHA256(COOKIE_SECRET).
 * 계약 5-5 시작 3번 / 콜백 3번. 서명 형식은 common/signed-cookie(S1 gcd_steam과 공유).
 */
const StatePayload = z.object({
  state: z.string().min(1),
  redirect: SafeRedirectPath,
  iat: z.number().int(),
});
export type OAuthStatePayload = z.infer<typeof StatePayload>;

export function newOAuthState(): string {
  return randomBytes(32).toString('base64url');
}

export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  return signCookiePayload(payload, secret);
}

/** 서명·형식·만료(iat + 600초)를 검사한다. 실패하면 null. */
export function verifyOAuthStateCookie(
  cookie: unknown,
  secret: string,
  nowMs: number = Date.now(),
): OAuthStatePayload | null {
  return verifySignedCookie(cookie, secret, StatePayload, OAUTH_STATE_TTL_SEC, nowMs);
}

/** 쿼리 state와 쿠키 state를 상수 시간으로 비교한다. */
export function statesMatch(expected: string, given: unknown): boolean {
  return constantTimeEquals(expected, given);
}
