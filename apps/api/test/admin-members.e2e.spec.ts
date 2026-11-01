/**
 * S6 멤버 관리·역할 변경 HTTP 테스트(DB 없이, 계약 S6 12-1·12-2, 18절 backend 「멤버」). 고정 시계 2026-10-31T03:00Z.
 * ILIKE 이스케이프의 실제 SQL 동작은 test/db/admin.db.e2e.spec.ts.
 */
import { AdminMemberItem, ListAdminMembersResponse } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { type Who, login, member } from './support/s4-helpers';
import { seedScrimWithResult } from './support/s5-helpers';
import { DAY, HOUR, auditRows, json } from './support/s6-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-31T03:00:00.000Z';
const nowMs = Date.parse(NOW);

const list = async (app: TestApp, who: Who, qs = '') =>
  ListAdminMembersResponse.parse(await json(await call(app, 'GET', `/admin/members${qs}`, who.token)));
const role = (app: TestApp, who: Who, id: string, r: 'member' | 'admin') => call(app, 'PATCH', `/admin/members/${id}/role`, who.token, { role: r });

function patchUser(app: TestApp, id: string, data: Record<string, unknown>) {
  const u = app.prisma.users.find((x) => x.id === id);
  if (!u) throw new Error('user 없음');
  Object.assign(u, data);
}

describe('GET /admin/members', () => {
  it('검색(대소문자 무시, % _ 이스케이프)·role 필터·D38(discord_id 없음)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const a = await member(t, 'Gamer100%');
    const b = await member(t, 'gamer1000');
    const c = await member(t, '새벽감자');
    patchUser(t, c, { discordId: '123456789012345678', discordUsername: 'Night_Potato' });
    const all = await list(t, admin);
    expect(all.items).toHaveLength(4);
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/discord_id|123456789012345678|email/);

    expect((await list(t, admin, '?q=gamer')).items.map((i) => i.user.id).sort()).toEqual([a, b].sort());
    expect((await list(t, admin, `?q=${encodeURIComponent('100%')}`)).items.map((i) => i.user.id)).toEqual([a]);
    // _ 는 글자 그대로(와일드카드면 'er1'이 'e_1'에 걸린다), 대소문자 무시
    expect((await list(t, admin, '?q=e_1')).items).toHaveLength(0);
    expect((await list(t, admin, '?q=T_p')).items.map((i) => i.user.id)).toEqual([c]);
    expect((await list(t, admin, `?q=${encodeURIComponent('r1%')}`)).items).toHaveLength(0);
    expect((await list(t, admin, '?q=NIGHT_POT')).items.map((i) => i.user.id)).toEqual([c]);
    expect((await list(t, admin, '?q=%20%20')).items).toHaveLength(4);
    const admins = await list(t, admin, '?role=admin');
    expect(admins.items.map((i) => i.user.id)).toEqual([admin.userId]);
    expect(admins.items[0]).toMatchObject({ role: 'admin', discord_linked: false, role_locked: false, status: 'active' });
    expect((await list(t, admin, '?q=nobody')).items).toHaveLength(0);
    await expectError(await call(t, 'GET', `/admin/members?q=${'x'.repeat(31)}`, admin.token), 400, 'VALIDATION_FAILED');
  });

  it('scrim_count·no_show_30d·restricted_until·status(left > restricted > active)·role_locked', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const host = await member(t, '방장');
    const p = await member(t, '참가자');
    const ns = await member(t, '노쇼왕');
    const left = await member(t, '나간사람');
    const locked = await member(t, '고정운영진');
    patchUser(t, left, { leftAt: new Date(nowMs - DAY) });
    patchUser(t, locked, { discordId: '900000000000000001', role: 'admin', discordUsername: 'fixed' });
    seedScrimWithResult(t, { hostId: host, players: [{ userId: host }, { userId: p }], scheduledAt: '2026-10-20T10:00:00Z', startedAt: '2026-10-20T10:00:00Z' });
    seedScrimWithResult(t, { hostId: host, players: [{ userId: host }, { userId: p }], scheduledAt: '2026-10-21T10:00:00Z', startedAt: null, results: ['rejected'] });
    seedScrimWithResult(t, { hostId: host, players: [{ userId: p }, { userId: host, status: 'waitlist' }], scheduledAt: '2026-10-22T10:00:00Z', startedAt: null, status: 'cancelled' });
    // 노쇼 3회(최근 30일) → 제한(기본 정책 threshold 3, 1일)
    for (let i = 0; i < 3; i++) {
      const s = t.prisma.scrim.insert({ gameId: t.prisma.gameId('lol'), hostId: host, title: `노쇼 ${i}`, scheduledAt: new Date(nowMs - (i + 1) * HOUR), capacity: 10, status: 'finished' });
      t.prisma.scrimPlayer.insert({ scrimId: s.id, userId: ns, status: 'no_show', noShowMarkedAt: new Date(nowMs - (3 - i) * HOUR), joinedAt: new Date(0) });
    }
    const items = (await list(t, admin)).items;
    const by = (id: string) => items.find((i) => i.user.id === id) as AdminMemberItem;
    expect(by(host).scrim_count).toBe(1);
    expect(by(p).scrim_count).toBe(1);
    expect(by(ns)).toMatchObject({ no_show_30d: 3, status: 'restricted' });
    expect(by(ns).restricted_until).toBe(new Date(nowMs - HOUR + t.config.scrim.noShow.restrictionDays * DAY).toISOString());
    expect(by(left)).toMatchObject({ status: 'left', left_at: new Date(nowMs - DAY).toISOString() });
    expect(by(locked)).toMatchObject({ role_locked: true, discord_linked: true, discord_username: 'fixed' });
    expect(by(admin.userId).role_locked).toBe(false);

    // 정렬 5종 + 커서
    const ids = async (sort: string) => (await list(t as TestApp, admin, `?sort=${sort}`)).items.map((i) => i.user.id);
    expect((await ids('scrims_desc')).slice(0, 2).sort()).toEqual([host, p].sort());
    expect((await ids('no_show_desc'))[0]).toBe(ns);
    const nick = (await list(t, admin, '?sort=nickname_asc')).items.map((i) => i.user.nickname);
    expect(nick).toEqual([...nick].sort());
    patchUser(t, p, { lastLoginAt: new Date(nowMs - HOUR) });
    patchUser(t, host, { lastLoginAt: new Date(nowMs - 2 * HOUR) });
    const ll = await ids('last_login_desc');
    // dev-login 운영진(last_login 있음)·p·host 순 뒤에 null들
    expect(ll.indexOf(p)).toBeLessThan(ll.indexOf(host));
    expect(ll.indexOf(host)).toBeLessThan(ll.indexOf(ns));
    const joined = await ids('joined_desc');
    expect(joined).toHaveLength(6);

    const p1 = await list(t, admin, '?sort=scrims_desc&limit=4');
    expect(p1.items).toHaveLength(4);
    const p2 = await list(t, admin, `?sort=scrims_desc&limit=4&cursor=${p1.next_cursor}`);
    expect(p2.items).toHaveLength(2);
    expect(p2.next_cursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((i) => i.user.id)).size).toBe(6);
    const bad = await expectError(await call(t, 'GET', `/admin/members?sort=no_show_desc&cursor=${p1.next_cursor}`, admin.token), 400, 'VALIDATION_FAILED');
    expect(bad.details?.[0]?.path).toBe('cursor');
  });
});

describe('PATCH /admin/members/:id/role', () => {
  it('승격·강등 change(감사 {from,to}), 같은 역할 noop(감사 없음), 자기 자신 403, ENV 지정 강등 409, 없는 회원 404', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const m = await member(t, '새벽감자');
    const up = AdminMemberItem.parse(await json(await role(t, admin, m, 'admin')));
    expect(up).toMatchObject({ role: 'admin', user: { id: m } });
    expect(auditRows(t, 'member.role_change')[0]).toMatchObject({
      actorId: admin.userId,
      targetType: 'user',
      targetId: m,
      summary: '새벽감자 역할을 운영진으로 변경',
      details: { from: 'member', to: 'admin' },
    });
    expect((await role(t, admin, m, 'admin')).status).toBe(200);
    expect(auditRows(t, 'member.role_change')).toHaveLength(1);
    const down = AdminMemberItem.parse(await json(await role(t, admin, m, 'member')));
    expect(down.role).toBe('member');
    expect(auditRows(t, 'member.role_change')[1]?.summary).toBe('새벽감자 역할을 멤버로 변경');

    await expectError(await role(t, admin, admin.userId, 'member'), 403, 'ADMIN_SELF_ROLE_CHANGE');
    expect((await role(t, admin, admin.userId, 'admin')).status).toBe(200);

    const locked = await member(t, '고정운영진');
    patchUser(t, locked, { discordId: '900000000000000001', role: 'admin' });
    await expectError(await role(t, admin, locked, 'member'), 409, 'ADMIN_ROLE_LOCKED');
    await expectError(await role(t, admin, '00000000-0000-4000-8000-000000000001', 'admin'), 404, 'NOT_FOUND');
    await expectError(await role(t, admin, m, 'owner' as 'admin'), 400, 'VALIDATION_FAILED');
    expect(t.prisma.rawCalls.some((c) => /pg_advisory_xact_lock\(hashtext\(\?\)\)/.test(c.sql) && c.values[0] === 'admin-roles')).toBe(true);
  });

  it('동시 맞강등(A가 B, B가 A) → 하나만 성공, 다른 쪽은 FORBIDDEN, admin ≥ 1', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const a = await login(t, 'admin_a', 'admin');
    const b = await login(t, 'admin_b', 'admin');
    const [r1, r2] = await Promise.all([role(t, a, b.userId, 'member'), role(t, b, a.userId, 'member')]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 403]);
    const admins = t.prisma.users.filter((u) => u.role === 'admin');
    expect(admins).toHaveLength(1);
    expect(auditRows(t, 'member.role_change')).toHaveLength(1);
  });
});
