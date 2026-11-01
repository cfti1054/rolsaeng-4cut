/**
 * S6 권한 매트릭스(계약 S6 5절) + JwtGuard DB role(D263) HTTP 테스트(DB 없이).
 * 계약 4-2 운영진 엔드포인트 23개(D281 이후, 되돌리기 1 + /admin/* 22, 공지·패치노트·이벤트 쓰기 9개 포함): 비운영진 403(없는 id도 403이 먼저), 비로그인 401,
 * 봇 키로 401. 강등 직후 같은 액세스 토큰으로 403, 토큰 claim이 admin이어도 DB가 member면 403.
 */
import { BOT_API_KEY_HEADER, GetAdminOverviewResponse } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { login } from './support/s4-helpers';
import { seedApiKey } from './support/s5-helpers';
import { json, setRole } from './support/s6-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const X = '00000000-0000-4000-8000-00000000abcd';

/** 운영진 엔드포인트 23개(계약 4-2, D281 이후, 되돌리기 포함). 본문은 형식만 맞춘 값(가드가 먼저 막아야 한다) */
const ADMIN_ENDPOINTS: [string, string, unknown?][] = [
  ['POST', `/scrims/${X}/result/revert`, { result_id: X, reason: '되돌림' }],
  ['GET', '/admin/overview'],
  ['GET', '/admin/results'],
  ['GET', '/admin/no-show/scrims'],
  ['GET', '/admin/members'],
  ['PATCH', `/admin/members/${X}/role`, { role: 'admin' }],
  ['POST', '/admin/notices', { title: '공지 제목', body: '본문' }],
  ['PATCH', `/admin/notices/${X}`, { title: '공지 제목' }],
  ['DELETE', `/admin/notices/${X}`],
  ['POST', '/admin/patch-notes', { game: 'lol', title: '패치 제목', summary: '요약', published_on: '2026-11-01' }],
  ['PATCH', `/admin/patch-notes/${X}`, { title: '패치 제목' }],
  ['DELETE', `/admin/patch-notes/${X}`],
  ['POST', '/admin/events', { title: '이벤트', starts_on: '2026-11-01' }],
  ['PATCH', `/admin/events/${X}`, { title: '이벤트' }],
  ['DELETE', `/admin/events/${X}`],
  ['GET', '/admin/api-keys'],
  ['POST', '/admin/api-keys', { name: '봇', scopes: ['bot:notices'] }],
  ['POST', `/admin/api-keys/${X}/revoke`],
  ['GET', '/admin/seasons'],
  ['POST', '/admin/seasons', { name: '시즌', starts_at: '2027-01-01T00:00:00.000Z', ends_at: '2027-03-01T00:00:00.000Z' }],
  ['PATCH', `/admin/seasons/${X}`, { name: '시즌' }],
  ['DELETE', `/admin/seasons/${X}`],
  ['GET', '/admin/audit-logs'],
];

describe('권한 매트릭스', () => {
  it('운영진 엔드포인트 23개: 멤버 403(없는 id도), 비로그인 401, 봇 키 401', async () => {
    t = await createTestApp({ fixedClock: '2026-10-31T03:00:00.000Z' });
    expect(ADMIN_ENDPOINTS).toHaveLength(23);
    const user = await login(t, 'member_u');
    const key = seedApiKey(t);
    for (const [method, path, body] of ADMIN_ENDPOINTS) {
      await expectError(await call(t, method, path, user.token, body), 403, 'FORBIDDEN');
      await expectError(await call(t, method, path, undefined, body), 401, 'UNAUTHENTICATED');
      await expectError(await call(t, method, path, undefined, body, { headers: { [BOT_API_KEY_HEADER]: key.raw, 'Content-Type': 'application/json' } }), 401, 'UNAUTHENTICATED');
    }
    // 아무 쓰기도 일어나지 않았다
    expect(t.prisma.adminAuditLog.rows).toHaveLength(0);
    expect(t.prisma.notice.rows).toHaveLength(0);
  });

  it('운영진은 같은 목록 GET이 200', async () => {
    t = await createTestApp({ fixedClock: '2026-10-31T03:00:00.000Z' });
    const admin = await login(t, 'admin_a', 'admin');
    for (const [method, path] of ADMIN_ENDPOINTS.filter(([m]) => m === 'GET')) {
      expect((await call(t, method, path, admin.token)).status).toBe(200);
    }
  });
});

describe('JwtGuard DB role(D263)', () => {
  it('강등 직후 같은 액세스 토큰으로 /admin/overview 403, 다시 승격되면 200(토큰 재발급 없이)', async () => {
    t = await createTestApp({ fixedClock: '2026-10-31T03:00:00.000Z' });
    const a = await login(t, 'admin_a', 'admin');
    const b = await login(t, 'admin_b', 'admin');
    GetAdminOverviewResponse.parse(await json(await call(t, 'GET', '/admin/overview', b.token)));
    // 웹 강등(A가 B를)
    expect((await call(t, 'PATCH', `/admin/members/${b.userId}/role`, a.token, { role: 'member' })).status).toBe(200);
    await expectError(await call(t, 'GET', '/admin/overview', b.token), 403, 'FORBIDDEN');
    // 로그인은 유지(일반 API는 그대로)
    expect((await call(t, 'GET', '/me', b.token)).status).toBe(200);
    // 승격은 다음 요청부터
    setRole(t, b.userId, 'admin');
    expect((await call(t, 'GET', '/admin/overview', b.token)).status).toBe(200);
  });

  it('토큰 claim이 admin이어도 DB가 member면 403, claim이 member여도 DB가 admin이면 200', async () => {
    t = await createTestApp({ fixedClock: '2026-10-31T03:00:00.000Z' });
    const a = await login(t, 'admin_a', 'admin');
    const m = await login(t, 'member_u');
    setRole(t, a.userId, 'member');
    await expectError(await call(t, 'GET', '/admin/members', a.token), 403, 'FORBIDDEN');
    await expectError(await call(t, 'POST', '/scrims/00000000-0000-4000-8000-000000000001/result/approve', a.token, { result_id: X }), 403, 'FORBIDDEN');
    setRole(t, m.userId, 'admin');
    expect((await call(t, 'GET', '/admin/members', m.token)).status).toBe(200);
  });
});
