/**
 * S5 API 키 가드(6-1)와 r2에서 없앤 연동 코드 라우트(D237, D238).
 * DB 없이 FakePrisma. (r2: 연동 코드 테스트 `discord-link.e2e.spec.ts`는 기능 제거로 삭제했다)
 */
import { API_KEY_LAST_USED_WRITE_INTERVAL_SEC } from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { login } from './support/s4-helpers';
import { bot, seedApiKey, snowflake } from './support/s5-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-10-31T03:00:00.000Z'; // 토요일 12:00 KST

describe('API 키 가드(6-1)', () => {
  it('헤더 없음·형식 틀림·모르는 키·폐기 키 401, scope 없음 403, JWT만 있는 요청 401', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const ok = seedApiKey(t, { scopes: ['bot:scrims:read'] });
    const revoked = seedApiKey(t, { revokedAt: new Date('2026-10-30T00:00:00.000Z') });
    const unknown = `gcd_${'A'.repeat(43)}`;
    const path = '/bot/scrims/upcoming';
    await expectError(await bot(t, 'GET', path, undefined), 401, 'API_KEY_INVALID');
    await expectError(await bot(t, 'GET', path, 'gcd_short'), 401, 'API_KEY_INVALID');
    await expectError(await bot(t, 'GET', path, `xyz_${'A'.repeat(43)}`), 401, 'API_KEY_INVALID');
    await expectError(await bot(t, 'GET', path, unknown), 401, 'API_KEY_INVALID');
    await expectError(await bot(t, 'GET', path, revoked.raw), 401, 'API_KEY_INVALID');
    expect((await bot(t, 'GET', path, ok.raw)).status).toBe(200);
    // scope 없음
    await expectError(await bot(t, 'GET', '/bot/rankings/activity', ok.raw), 403, 'API_KEY_SCOPE_MISSING');
    const res = await bot(t, 'POST', '/bot/activity', ok.raw, { events: [] });
    const body = await expectError(res, 403, 'API_KEY_SCOPE_MISSING');
    expect(JSON.stringify(body)).not.toContain(ok.raw);
    // JWT 쿠키·Bearer만 있는 요청
    const me = await login(t, 'me');
    await expectError(await call(t, 'GET', path, me.token), 401, 'API_KEY_INVALID');
    await expectError(
      await fetch(`${t.base}${path}`, { headers: { Cookie: 'gcd_refresh=whatever' } }),
      401,
      'API_KEY_INVALID',
    );
  });

  it('웹 경로는 API 키로 접근할 수 없다(401 UNAUTHENTICATED)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    for (const p of ['/me', '/rankings/activity', '/rankings/playtime?app_id=1', '/dashboard/summary']) {
      await expectError(await bot(t, 'GET', p, k.raw), 401, 'UNAUTHENTICATED');
    }
  });

  it('봇 엔드포인트는 OriginGuard 없이 동작한다(다른 Origin 헤더도 200)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const res = await bot(t, 'PUT', '/bot/presence', k.raw, { captured_at: NOW, voice_member_count: 1, playing: [] }, {
      Origin: 'https://evil.example',
    });
    expect(res.status).toBe(200);
  });

  it('last_used_at: 처음 기록, 60초 안 재요청은 쓰지 않음, 60초 뒤 다시 기록', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const spy = vi.spyOn(t.prisma.apiKey, 'updateMany');
    const row = () => t?.prisma.apiKey.rows.find((r) => r.id === k.id);
    await bot(t, 'GET', '/bot/scrims/upcoming', k.raw);
    expect(row()?.lastUsedAt).toEqual(new Date(NOW));
    expect(spy).toHaveBeenCalledTimes(1);
    t.clock.advance(API_KEY_LAST_USED_WRITE_INTERVAL_SEC * 1000 - 1);
    await bot(t, 'GET', '/bot/scrims/upcoming', k.raw);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(row()?.lastUsedAt).toEqual(new Date(NOW));
    t.clock.advance(2);
    await bot(t, 'GET', '/bot/scrims/upcoming', k.raw);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(row()?.lastUsedAt).toEqual(t.clock.now());
  });

  it('last_used_at: 정확히 60초 뒤 요청은 기록된다(사전 판정 ≥ 60초와 조건 lte가 같은 경계, QA s5_backend #1)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const intervalMs = API_KEY_LAST_USED_WRITE_INTERVAL_SEC * 1000;
    const k = seedApiKey(t, { lastUsedAt: new Date(new Date(NOW).getTime() - intervalMs) });
    const spy = vi.spyOn(t.prisma.apiKey, 'updateMany');
    expect((await bot(t, 'GET', '/bot/scrims/upcoming', k.raw)).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    await expect(spy.mock.results[0]?.value).resolves.toEqual({ count: 1 });
    expect(t.prisma.apiKey.rows.find((r) => r.id === k.id)?.lastUsedAt).toEqual(new Date(NOW));
  });

  it('last_used_at 기록 실패는 요청을 막지 않는다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    vi.spyOn(t.prisma.apiKey, 'updateMany').mockRejectedValue(new Error('db down'));
    expect((await bot(t, 'GET', '/bot/scrims/upcoming', k.raw)).status).toBe(200);
  });
});

describe('연동 코드 라우트 없음(r2, D237·D238)', () => {
  it('POST /bot/link, GET /me/discord-link, POST /me/discord-link/code는 404(라우트 없음)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const me = await login(t, 'me');
    expect((await bot(t, 'POST', '/bot/link', k.raw, { code: 'RS-ABCD-EF', discord_id: snowflake() })).status).toBe(404);
    expect((await call(t, 'GET', '/me/discord-link', me.token)).status).toBe(404);
    expect((await call(t, 'POST', '/me/discord-link/code', me.token)).status).toBe(404);
    // 연동 상태는 GET /me의 discord_id·discord_username으로 본다(D238)
    const res = await call(t, 'GET', '/me', me.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('discord_username');
  });
});
