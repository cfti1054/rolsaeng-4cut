/**
 * S6 API 키 웹 발급·폐기(12-4)와 시즌 관리(11절) HTTP 테스트(DB 없이). 고정 시계 2026-10-31T03:00Z.
 * 시즌 FOR NO KEY UPDATE vs 승인 FOR SHARE 실제 경합은 test/db/admin.db.e2e.spec.ts.
 */
import { createHash } from 'node:crypto';
import {
  AdminApiKeyItem,
  AdminSeasonItem,
  API_KEY_PATTERN,
  CreateApiKeyResponse,
  ListAdminApiKeysResponse,
  ListAdminSeasonsResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { SCRIM_TX_TIMEOUT_MS } from '../src/common/scrim-tx';
import { SEASON_WRITE_TX_OPTIONS } from '../src/modules/admin/admin-seasons.service';
import { call, expectError } from './support/s1-helpers';
import { type Who, login, seedSeason } from './support/s4-helpers';
import { bot } from './support/s5-helpers';
import { DAY, HOUR, auditRows, json } from './support/s6-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const NOW = '2026-10-31T03:00:00.000Z';
const nowMs = Date.parse(NOW);
const iso = (ms: number) => new Date(ms).toISOString();

describe('API 키', () => {
  it('발급: 원문 형식·해시 저장·원문 미저장·감사에 원문 없음 → 그 키로 봇 엔드포인트 통과 → 폐기 → 401, 폐기 멱등', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const res = CreateApiKeyResponse.parse(
      await json(await call(t, 'POST', '/admin/api-keys', admin.token, { name: '  공지   봇 ', scopes: ['bot:notices', 'bot:patch-notes'] }), 201),
    );
    expect(res.key).toMatch(API_KEY_PATTERN);
    expect(res.api_key).toMatchObject({ name: '공지 봇', scopes: ['bot:notices', 'bot:patch-notes'], revoked_at: null, created_by: { id: admin.userId } });
    expect(res.key.startsWith(`gcd_${res.api_key.key_prefix}`)).toBe(true);
    const row = t.prisma.apiKey.rows[0];
    expect(row?.keyHash).toBe(createHash('sha256').update(res.key, 'utf8').digest('hex'));
    expect(JSON.stringify(t.prisma.apiKey.rows)).not.toContain(res.key);
    const audit = auditRows(t, 'api_key.create')[0];
    expect(audit?.details).toEqual({ name: '공지 봇', key_prefix: res.api_key.key_prefix, scopes: ['bot:notices', 'bot:patch-notes'] });
    expect(JSON.stringify(t.prisma.adminAuditLog.rows)).not.toContain(res.key);
    expect(JSON.stringify(t.prisma.adminAuditLog.rows)).not.toContain(row?.keyHash as string);
    // 목록 응답에도 원문·해시 없음
    const listText = await (await call(t, 'GET', '/admin/api-keys', admin.token)).text();
    expect(listText).not.toContain(res.key);
    expect(listText).not.toContain(row?.keyHash as string);

    expect((await bot(t, 'GET', '/bot/notices/pending', res.key)).status).toBe(200);
    await expectError(await bot(t, 'GET', '/bot/scrims/upcoming', res.key), 403, 'API_KEY_SCOPE_MISSING');

    const revoked = AdminApiKeyItem.parse(await json(await call(t, 'POST', `/admin/api-keys/${res.api_key.id}/revoke`, admin.token)));
    expect(revoked.revoked_at).toBe(NOW);
    await expectError(await bot(t, 'GET', '/bot/notices/pending', res.key), 401, 'API_KEY_INVALID');
    t.clock.advance(HOUR);
    const again = AdminApiKeyItem.parse(await json(await call(t, 'POST', `/admin/api-keys/${res.api_key.id}/revoke`, admin.token)));
    expect(again.revoked_at).toBe(NOW);
    expect(auditRows(t, 'api_key.revoke')).toHaveLength(1);
    expect(auditRows(t, 'api_key.revoke')[0]?.details).toEqual({ name: '공지 봇', key_prefix: res.api_key.key_prefix });
    expect(t.prisma.apiKey.rows).toHaveLength(1);
    await expectError(await call(t, 'POST', '/admin/api-keys/00000000-0000-4000-8000-000000000001/revoke', admin.token), 404, 'NOT_FOUND');
  });

  it('목록: 폐기 안 된 것 먼저 → created_at DESC, 모르는 scope 제외(CLI 발급 created_by null), 검증 400', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const old = t.prisma.apiKey.insert({ name: 'CLI', keyHash: 'h1', keyPrefix: 'AAAA1111', scopes: ['bot:link', 'bot:activity'], createdAt: new Date(nowMs - 2 * DAY) });
    const dead = t.prisma.apiKey.insert({ name: '폐기됨', keyHash: 'h2', keyPrefix: 'BBBB2222', scopes: ['bot:activity'], createdAt: new Date(nowMs - HOUR), revokedAt: new Date(nowMs - 1) });
    const fresh = t.prisma.apiKey.insert({ name: '새 키', keyHash: 'h3', keyPrefix: 'CCCC3333', scopes: ['bot:presence'], createdAt: new Date(nowMs - DAY) });
    const l = ListAdminApiKeysResponse.parse(await json(await call(t, 'GET', '/admin/api-keys', admin.token)));
    expect(l.items.map((i) => i.id)).toEqual([fresh.id, old.id, dead.id]);
    expect(l.items[1]).toMatchObject({ scopes: ['bot:activity'], created_by: null });
    expect(l.next_cursor).toBeNull();
    await expectError(await call(t, 'POST', '/admin/api-keys', admin.token, { name: '봇', scopes: [] }), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'POST', '/admin/api-keys', admin.token, { name: '봇', scopes: ['bot:link'] }), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'POST', '/admin/api-keys', admin.token, { name: '봇', scopes: ['bot:notices', 'bot:notices'] }), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'POST', '/admin/api-keys', admin.token, { name: ' ', scopes: ['bot:notices'] }), 400, 'VALIDATION_FAILED');
  });
});

describe('시즌 관리', () => {
  async function setup() {
    t = await createTestApp({ fixedClock: NOW });
    const admin = await login(t, 'admin_a', 'admin');
    const closed = seedSeason(t, '지난 시즌', iso(nowMs - 120 * DAY), iso(nowMs - 60 * DAY), iso(nowMs - 59 * DAY));
    const ended = seedSeason(t, '끝난 시즌', iso(nowMs - 60 * DAY), iso(nowMs - 30 * DAY));
    const current = seedSeason(t, '지금 시즌', iso(nowMs - 30 * DAY), iso(nowMs + 30 * DAY));
    const upcoming = seedSeason(t, '다음 시즌', iso(nowMs + 30 * DAY), iso(nowMs + 90 * DAY));
    return { app: t, admin, closed, ended, current, upcoming };
  }
  const patch = (app: TestApp, who: Who, id: string, body: unknown) => call(app, 'PATCH', `/admin/seasons/${id}`, who.token, body);

  it('목록: 단계·editable·rated_games·is_current', async () => {
    const { app, admin, closed, ended, current, upcoming } = await setup();
    const s = app.prisma.scrim.insert({ gameId: app.prisma.gameId('lol'), hostId: admin.userId, title: 'x', scheduledAt: new Date(nowMs), capacity: 10 });
    for (const u of ['a', 'b']) {
      app.prisma.ratingHistory.insert({ userId: `${u}0000000-0000-4000-8000-000000000000`, scrimId: s.id, scrimResultId: s.id, gameId: s.gameId, seasonId: current.id, eloBefore: 1000, eloAfter: 1010, kFactor: 32 });
    }
    const l = ListAdminSeasonsResponse.parse(await json(await call(app, 'GET', '/admin/seasons', admin.token)));
    expect(l.items.map((i) => [i.id, i.phase])).toEqual([
      [upcoming.id, 'upcoming'],
      [current.id, 'current'],
      [ended.id, 'ended'],
      [closed.id, 'closed'],
    ]);
    expect(l.items[0]?.editable).toEqual({ name: true, starts_at: true, ends_at: true, delete: true });
    expect(l.items[1]).toMatchObject({ is_current: true, rated_games: 1, editable: { name: true, starts_at: false, ends_at: true, delete: false } });
    expect(l.items[2]?.editable).toEqual({ name: true, starts_at: false, ends_at: false, delete: false });
    expect(l.items[3]?.closed_at).not.toBeNull();
  });

  it('생성: 정상 201 + 감사 + season-auto-create 잠금, lead 부족 400(starts_at), 길이 400(ends_at), 겹침 409', async () => {
    const { app, admin } = await setup();
    const startOk = nowMs + 90 * DAY;
    app.prisma.rawCalls = [];
    const created = AdminSeasonItem.parse(
      await json(await call(app, 'POST', '/admin/seasons', admin.token, { name: ' 2027  겨울 ', starts_at: iso(startOk), ends_at: iso(startOk + 7 * DAY) }), 201),
    );
    expect(created).toMatchObject({ name: '2027 겨울', phase: 'upcoming', rated_games: 0, is_current: false });
    expect(app.prisma.rawCalls.some((c) => /pg_advisory_xact_lock/.test(c.sql) && c.values[0] === 'season-auto-create')).toBe(true);
    expect(auditRows(app, 'season.create')[0]?.details).toEqual({ name: '2027 겨울', starts_at: iso(startOk), ends_at: iso(startOk + 7 * DAY) });

    // 판정 순서 invalid → overlap: 지금 시즌과 겹치지만 lead 부족이 먼저(400)
    const first = await expectError(
      await call(app, 'POST', '/admin/seasons', admin.token, { name: '급함', starts_at: iso(nowMs + HOUR - 1), ends_at: iso(nowMs + 10 * DAY) }),
      400,
      'VALIDATION_FAILED',
    );
    expect(first.details?.map((d) => d.path)).toEqual(['starts_at']);
    // 길이 7일 정확 허용(위 생성), 6일 실패, 366일 허용, 367일 실패
    const far = nowMs + 400 * DAY;
    const short = await expectError(
      await call(app, 'POST', '/admin/seasons', admin.token, { name: '짧음', starts_at: iso(far), ends_at: iso(far + 6 * DAY) }),
      400,
      'VALIDATION_FAILED',
    );
    expect(short.details?.map((d) => d.path)).toEqual(['ends_at']);
    await expectError(
      await call(app, 'POST', '/admin/seasons', admin.token, { name: '김', starts_at: iso(far), ends_at: iso(far + 367 * DAY) }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await call(app, 'POST', '/admin/seasons', admin.token, { name: '1년', starts_at: iso(far), ends_at: iso(far + 366 * DAY) })).status).toBe(201);
    // lead 경계(겹치는 시즌 없이): now + 1시간 정확 허용, 1ms 모자라면 400
    app.prisma.season.rows = [];
    await expectError(
      await call(app, 'POST', '/admin/seasons', admin.token, { name: '급함', starts_at: iso(nowMs + HOUR - 1), ends_at: iso(nowMs + 10 * DAY) }),
      400,
      'VALIDATION_FAILED',
    );
    expect((await call(app, 'POST', '/admin/seasons', admin.token, { name: '딱 맞음', starts_at: iso(nowMs + HOUR), ends_at: iso(nowMs + 10 * DAY) })).status).toBe(201);
  });

  it('겹침: 끝 = 다음 시작이면 허용, 1ms 겹치면 409', async () => {
    const { app, admin, upcoming } = await setup();
    const s = upcoming.endsAt.getTime();
    await expectError(
      await call(app, 'POST', '/admin/seasons', admin.token, { name: '겹침', starts_at: iso(s - 1), ends_at: iso(s + 30 * DAY) }),
      409,
      'SEASON_OVERLAP',
    );
    expect((await call(app, 'POST', '/admin/seasons', admin.token, { name: '이어짐', starts_at: iso(s), ends_at: iso(s + 30 * DAY) })).status).toBe(201);
  });

  it('수정: upcoming 전부, current 시작 409·끝 ≥ now+1h 허용·그보다 이르면 400, ended·closed 기간 409·이름은 허용, 같은 값은 감사 없음', async () => {
    const { app, admin, closed, ended, current, upcoming } = await setup();
    const u = AdminSeasonItem.parse(
      await json(await patch(app, admin, upcoming.id, { name: '다음 시즌 수정', starts_at: iso(nowMs + 31 * DAY), ends_at: iso(nowMs + 91 * DAY) })),
    );
    expect(u).toMatchObject({ name: '다음 시즌 수정', starts_at: iso(nowMs + 31 * DAY) });
    expect(auditRows(app, 'season.update')[0]?.details).toEqual({
      before: { name: '다음 시즌', starts_at: iso(nowMs + 30 * DAY), ends_at: iso(nowMs + 90 * DAY) },
      after: { name: '다음 시즌 수정', starts_at: iso(nowMs + 31 * DAY), ends_at: iso(nowMs + 91 * DAY) },
    });

    await expectError(await patch(app, admin, current.id, { starts_at: iso(nowMs - 29 * DAY) }), 409, 'SEASON_NOT_EDITABLE');
    expect((await patch(app, admin, current.id, { starts_at: current.startsAt.toISOString(), name: '지금 시즌' })).status).toBe(200);
    expect(auditRows(app, 'season.update')).toHaveLength(1);
    const early = await expectError(await patch(app, admin, current.id, { ends_at: iso(nowMs + HOUR - 1) }), 400, 'VALIDATION_FAILED');
    expect(early.details?.map((d) => d.path)).toContain('ends_at');
    const cur = AdminSeasonItem.parse(await json(await patch(app, admin, current.id, { ends_at: iso(nowMs + HOUR) })));
    expect(cur).toMatchObject({ ends_at: iso(nowMs + HOUR), phase: 'current' });

    await expectError(await patch(app, admin, ended.id, { ends_at: iso(nowMs - 29 * DAY) }), 409, 'SEASON_NOT_EDITABLE');
    await expectError(await patch(app, admin, closed.id, { starts_at: iso(nowMs - 121 * DAY) }), 409, 'SEASON_NOT_EDITABLE');
    expect(AdminSeasonItem.parse(await json(await patch(app, admin, closed.id, { name: '지난 시즌(정정)' }))).name).toBe('지난 시즌(정정)');
    await expectError(await patch(app, admin, '00000000-0000-4000-8000-000000000001', { name: '없음' }), 404, 'NOT_FOUND');
    await expectError(await patch(app, admin, upcoming.id, {}), 400, 'VALIDATION_FAILED');
    // 잠금 순서: season-auto-create → 대상 행 FOR NO KEY UPDATE
    app.prisma.rawCalls = [];
    await patch(app, admin, upcoming.id, { name: '다시' });
    const kinds = app.prisma.rawCalls.map((c) =>
      /pg_advisory_xact_lock/.test(c.sql) ? 'auto' : /FROM\s+seasons\s+WHERE\s+id.*FOR\s+NO\s+KEY\s+UPDATE/s.test(c.sql) ? 'row' : 'other',
    );
    expect(kinds.filter((k) => k !== 'other')).toEqual(['auto', 'row']);
  });

  it('쓰기 트랜잭션 3종 모두 timeout·maxWait 명시(승인·되돌리기 FOR SHARE 상한 15초보다 김, QA minor 1)', async () => {
    const { app, admin, upcoming } = await setup();
    expect(SEASON_WRITE_TX_OPTIONS.timeout).toBeGreaterThan(SCRIM_TX_TIMEOUT_MS);
    const seen: unknown[] = [];
    const orig = app.prisma.$transaction.bind(app.prisma);
    (app.prisma as unknown as { $transaction: unknown }).$transaction = (fn: never, opts?: unknown) => {
      seen.push(opts);
      return orig(fn);
    };
    const s = nowMs + 200 * DAY;
    expect((await call(app, 'POST', '/admin/seasons', admin.token, { name: '옵션', starts_at: iso(s), ends_at: iso(s + 10 * DAY) })).status).toBe(201);
    expect((await patch(app, admin, upcoming.id, { name: '옵션 수정' })).status).toBe(200);
    expect((await call(app, 'DELETE', `/admin/seasons/${upcoming.id}`, admin.token)).status).toBe(204);
    expect(seen).toEqual([SEASON_WRITE_TX_OPTIONS, SEASON_WRITE_TX_OPTIONS, SEASON_WRITE_TX_OPTIONS]);
    expect(SEASON_WRITE_TX_OPTIONS).toMatchObject({ isolationLevel: 'ReadCommitted', maxWait: expect.any(Number) });
  });

  it('삭제: upcoming만 204 + 감사, 그 외 409, 없음 404', async () => {
    const { app, admin, closed, ended, current, upcoming } = await setup();
    for (const s of [closed, ended, current]) {
      await expectError(await call(app, 'DELETE', `/admin/seasons/${s.id}`, admin.token), 409, 'SEASON_NOT_EDITABLE');
    }
    expect((await call(app, 'DELETE', `/admin/seasons/${upcoming.id}`, admin.token)).status).toBe(204);
    expect(app.prisma.season.rows.find((s) => s.id === upcoming.id)).toBeUndefined();
    expect(auditRows(app, 'season.delete')[0]).toMatchObject({ targetId: upcoming.id, details: { name: '다음 시즌', closed_at: null } });
    await expectError(await call(app, 'DELETE', `/admin/seasons/${upcoming.id}`, admin.token), 404, 'NOT_FOUND');
  });
});
