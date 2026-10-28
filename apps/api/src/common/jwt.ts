import { createHmac, timingSafeEqual } from 'node:crypto';
import { AccessTokenClaims, type UserRole } from '@gcd/shared';

/**
 * 액세스 토큰(JWT HS256) 발급·검증. 외부 라이브러리 없이 node:crypto로 구현한다(계약 5-2).
 */
const HEADER_B64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

export function signAccessToken(
  input: { sub: string; role: UserRole },
  secret: string,
  ttlSec: number,
  nowMs: number = Date.now(),
): { token: string; claims: AccessTokenClaims } {
  const iat = Math.floor(nowMs / 1000);
  const claims: AccessTokenClaims = { sub: input.sub, role: input.role, typ: 'access', iat, exp: iat + ttlSec };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${HEADER_B64}.${payload}`;
  const sig = hmac(secret, signingInput).toString('base64url');
  return { token: `${signingInput}.${sig}`, claims };
}

export type VerifyResult =
  | { ok: true; claims: AccessTokenClaims }
  | { ok: false; reason: 'invalid' | 'expired' };

export function verifyAccessToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'invalid' };
  const [h, p, s] = parts as [string, string, string];
  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== 'HS256'
  ) {
    return { ok: false, reason: 'invalid' };
  }
  const expected = hmac(secret, `${h}.${p}`);
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'invalid' };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const parsed = AccessTokenClaims.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  if (parsed.data.exp <= Math.floor(nowMs / 1000)) return { ok: false, reason: 'expired' };
  return { ok: true, claims: parsed.data };
}
