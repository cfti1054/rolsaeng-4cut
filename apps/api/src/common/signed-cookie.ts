import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * 서명 쿠키 값: base64url(JSON) + '.' + base64url(HMAC-SHA256(COOKIE_SECRET, body)).
 * S0 `gcd_oauth`(oauth-state.ts)와 S1 `gcd_steam`이 같은 형식을 쓴다.
 */
function mac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signCookiePayload(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(secret, body).toString('base64url')}`;
}

/**
 * 서명·형식·만료(iat + ttlSec)를 검사한다. 실패하면 null.
 * payload에는 정수 `iat`(초)가 있어야 하고, 미래 시각은 60초까지만 허용한다(시계 차이).
 */
export function verifySignedCookie<T extends { iat: number }>(
  cookie: unknown,
  secret: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  ttlSec: number,
  nowMs: number = Date.now(),
): T | null {
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
  const parsed = schema.safeParse(json);
  if (!parsed.success) return null;
  const nowSec = Math.floor(nowMs / 1000);
  if (nowSec - parsed.data.iat > ttlSec || parsed.data.iat > nowSec + 60) return null;
  return parsed.data;
}

/** 두 문자열을 상수 시간으로 비교한다(길이가 다르면 false). */
export function constantTimeEquals(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
