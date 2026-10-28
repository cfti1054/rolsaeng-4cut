import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { OAUTH_STATE_TTL_SEC, SafeRedirectPath } from '@gcd/shared';
import { z } from 'zod';

/**
 * OAuth state 쿠키(gcd_oauth) 값: base64url(JSON {state, redirect, iat}) + '.' + HMAC-SHA256(COOKIE_SECRET).
 * 계약 5-5 시작 3번 / 콜백 3번.
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

function mac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signOAuthState(payload: OAuthStatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(secret, body).toString('base64url')}`;
}

/** 서명·형식·만료(iat + 600초)를 검사한다. 실패하면 null. */
export function verifyOAuthStateCookie(
  cookie: unknown,
  secret: string,
  nowMs: number = Date.now(),
): OAuthStatePayload | null {
  if (typeof cookie !== 'string') return null;
  const dot = cookie.indexOf('.');
  if (dot <= 0 || dot !== cookie.lastIndexOf('.')) return null;
  const body = cookie.slice(0, dot);
  const sig = Buffer.from(cookie.slice(dot + 1), 'base64url');
  const expected = mac(secret, body);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = StatePayload.safeParse(json);
  if (!parsed.success) return null;
  const nowSec = Math.floor(nowMs / 1000);
  if (nowSec - parsed.data.iat > OAUTH_STATE_TTL_SEC || parsed.data.iat > nowSec + 60) return null;
  return parsed.data;
}

/** 쿼리 state와 쿠키 state를 상수 시간으로 비교한다. */
export function statesMatch(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
