import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from './jwt';

const SECRET = 'jwt-secret-0123456789abcdef0123456789ab';
const SUB = '6f1c1a8e-8a3a-4b8e-9a59-0b5e0a0c0d01';

describe('액세스 토큰(HS256)', () => {
  const now = Date.UTC(2026, 9, 28);

  it('발급 → 검증, 클레임 형식', () => {
    const { token, claims } = signAccessToken({ sub: SUB, role: 'admin' }, SECRET, 900, now);
    expect(claims).toEqual({ sub: SUB, role: 'admin', typ: 'access', iat: now / 1000, exp: now / 1000 + 900 });
    expect(verifyAccessToken(token, SECRET, now)).toEqual({ ok: true, claims });
  });

  it('exp 경과 → expired', () => {
    const { token } = signAccessToken({ sub: SUB, role: 'member' }, SECRET, 900, now);
    expect(verifyAccessToken(token, SECRET, now + 899_000).ok).toBe(true);
    expect(verifyAccessToken(token, SECRET, now + 900_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('서명 불일치·변조·형식 오류 → invalid', () => {
    const { token } = signAccessToken({ sub: SUB, role: 'member' }, SECRET, 900, now);
    expect(verifyAccessToken(token, `${SECRET}x`, now)).toEqual({ ok: false, reason: 'invalid' });
    const [h, , s] = token.split('.');
    const p = Buffer.from(JSON.stringify({ sub: SUB, role: 'admin', typ: 'access', iat: 0, exp: 9e9 })).toString('base64url');
    expect(verifyAccessToken(`${h}.${p}.${s}`, SECRET, now).ok).toBe(false);
    expect(verifyAccessToken('a.b', SECRET, now).ok).toBe(false);
    expect(verifyAccessToken('', SECRET, now).ok).toBe(false);
  });

  it('typ≠access 또는 alg none → invalid', () => {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ sub: SUB, role: 'member', typ: 'refresh', iat: 0, exp: 9e9 })).toString('base64url');
    const sig = createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
    expect(verifyAccessToken(`${h}.${p}.${sig}`, SECRET, now)).toEqual({ ok: false, reason: 'invalid' });

    const hNone = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const pOk = Buffer.from(JSON.stringify({ sub: SUB, role: 'member', typ: 'access', iat: 0, exp: 9e9 })).toString('base64url');
    expect(verifyAccessToken(`${hNone}.${pOk}.`, SECRET, now).ok).toBe(false);
  });
});
