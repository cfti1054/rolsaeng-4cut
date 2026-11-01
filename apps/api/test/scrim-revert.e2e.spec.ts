/**
 * S6 승인 되돌리기 HTTP 테스트(DB 없이, 계약 S6 6절·18절 backend 「되돌리기」). 고정 시계 2026-10-28T03:00Z.
 * 실제 행 잠금 경합(같은 사용자 다른 내전 동시 승인)은 test/db/admin.db.e2e.spec.ts(PostgreSQL 필요).
 */
import { GetDashboardSummaryResponse, ListAdminMembersResponse, ListAdminResultsResponse } from '@gcd/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { type Who, approve, login, member, ratingOf, seedPendingTeamResult, seedRating, seedSeason } from './support/s4-helpers';
import { DAY, HOUR, MIN, auditRows, detailOf, getScrim, json, revert, seedDispute } from './support/s6-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const START = '2026-10-28T03:00:00.000Z';

async function setup() {
  t = await createTestApp({ fixedClock: START });
  const season = seedSeason(t, '2026 가을', '2026-10-01T00:00:00.000+09:00', '2026-12-01T00:00:00.000+09:00');
  const adminA = await login(t, 'admin_a', 'admin');
  const adminB = await login(t, 'admin_b', 'admin');
  const host = await login(t, 'host_u');
  const u2 = await member(t, '멤버둘');
  const u3 = await member(t, '멤버셋');
  const u4 = await member(t, '멤버넷');
  return { app: t, season, adminA, adminB, host, u2, u3, u4 };
}

/** 개인 순위(롤체) pending 결과. placements 순서대로 1..N위, noShow 사용자는 status no_show */
function seedPendingPlacementResult(app: TestApp, hostId: string, ranked: string[], noShow: string[] = []) {
  const now = app.clock.now();
  const s = app.prisma.scrim.insert({
    gameId: app.prisma.gameId('tft'),
    hostId,
    title: '롤체 내전',
    scheduledAt: new Date(now.getTime() - HOUR),
    capacity: 8,
    status: 'playing',
    rated: true,
    tftMode: 'normal',
    startedAt: new Date(now.getTime() - 30 * MIN),
  });
  ranked.forEach((u, i) =>
    app.prisma.scrimPlayer.insert({
      scrimId: s.id,
      userId: u,
      status: noShow.includes(u) ? 'no_show' : 'joined',
      noShowMarkedAt: noShow.includes(u) ? now : null,
      joinedAt: new Date(now.getTime() - 2 * HOUR + i),
    }),
  );
  const r = app.prisma.scrimResult.insert({
    scrimId: s.id,
    status: 'pending',
    placements: ranked.map((u, i) => ({ user_id: u, placement: i + 1 })),
    submittedById: hostId,
    createdAt: now,
  });
  return { scrimId: s.id, resultId: r.id };
}

describe('POST /scrims/:id/result/revert — 정상', () => {
  it('팀: ratings 역반영·wins/losses·이력 삭제·결과 reverted·내전 playing·감사 스냅샷(승인자 본인 가능)', async () => {
    const { app, season, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    expect((await approve(app, adminA, ids)).status).toBe(200);
    const winner = ratingOf(app, host.userId, season.id);
    expect(winner?.elo).not.toBe(1000);
    expect(winner?.wins).toBe(1);

    const before = await getScrim(app, adminA, ids.scrimId);
    expect(before.viewer.can_revert_result).toBe(true);
    expect(before.viewer.revert_blocked_reason).toBeNull();

    const d = await detailOf(await revert(app, adminA, ids.scrimId, ids.resultId, '  승패   반대로 입력  '));
    expect(d.status).toBe('playing');
    expect(d.result).toMatchObject({
      id: ids.resultId,
      status: 'reverted',
      reverted_by: { id: adminA.userId },
      reverted_at: START,
      revert_reason: '승패 반대로 입력',
      rating_status: 'waiting',
      rating_changes: [],
      season: null,
    });
    expect(d.result_status).toBe('reverted');
    expect(d.viewer.can_revert_result).toBe(false);
    expect(d.viewer.revert_blocked_reason).toBeNull();
    expect(d.viewer.can_submit_result).toBe(true);
    expect(d.viewer.can_edit_teams).toBe(true);

    for (const u of [host.userId, u2, u3, u4]) {
      expect(ratingOf(app, u, season.id)).toMatchObject({ elo: 1000, wins: 0, losses: 0 });
    }
    expect(app.prisma.ratingHistory.rows.filter((h) => h.scrimResultId === ids.resultId)).toHaveLength(0);
    const scrim = app.prisma.scrim.rows.find((s) => s.id === ids.scrimId);
    expect(scrim?.startedAt).not.toBeNull();

    const audits = auditRows(app, 'result.revert');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: adminA.userId, targetType: 'scrim_result', targetId: ids.resultId });
    const details = audits[0]?.details as { scrim_id: string; reason: string; season_id: string; history: { user_id: string; outcome: string; elo_before: number; elo_after: number; k_factor: number }[] };
    expect(details).toMatchObject({ scrim_id: ids.scrimId, reason: '승패 반대로 입력', season_id: season.id });
    expect(details.history).toHaveLength(4);
    expect(details.history.find((h) => h.user_id === host.userId)).toMatchObject({ outcome: 'win', elo_before: 1000 });
    expect(details.history.find((h) => h.user_id === u3)).toMatchObject({ outcome: 'loss', elo_before: 1000 });
    expect(details.history.every((h) => typeof h.k_factor === 'number' && typeof h.elo_after === 'number')).toBe(true);
  });

  it('개인 순위: 1위 노쇼 제외 재순위(3명 반영)도 승인 전 값으로', async () => {
    const { app, season, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingPlacementResult(app, host.userId, [u4, host.userId, u2, u3], [u4]);
    expect((await approve(app, adminA, ids)).status).toBe(200);
    const hist = app.prisma.ratingHistory.rows.filter((h) => h.scrimResultId === ids.resultId);
    expect(hist).toHaveLength(3);
    expect(ratingOf(app, host.userId, season.id, 'tft')?.wins).toBe(1);

    const d = await detailOf(await revert(app, adminA, ids.scrimId, ids.resultId));
    expect(d.result?.status).toBe('reverted');
    for (const u of [host.userId, u2, u3]) expect(ratingOf(app, u, season.id, 'tft')).toMatchObject({ elo: 1000, wins: 0, losses: 0 });
    const details = auditRows(app, 'result.revert')[0]?.details as { history: { user_id: string; outcome: string }[] };
    expect(Object.fromEntries(details.history.map((h) => [h.user_id, h.outcome]))).toEqual({
      [host.userId]: 'win',
      [u2]: 'loss',
      [u3]: 'loss',
    });
  });

  it('rated=false: 레이팅 무관하게 reverted·playing, 감사 history []', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4], { rated: false });
    expect((await approve(app, adminA, ids)).status).toBe(200);
    expect(app.prisma.rating.rows).toHaveLength(0);
    app.prisma.rawCalls = [];
    const d = await detailOf(await revert(app, adminA, ids.scrimId, ids.resultId));
    expect(d.status).toBe('playing');
    expect(d.result).toMatchObject({ status: 'reverted', rating_status: 'not_rated' });
    expect(auditRows(app, 'result.revert')[0]?.details).toMatchObject({ season_id: null, history: [] });
    // 이력이 없으면 사용자·시즌 잠금 없음
    expect(app.prisma.rawCalls.some((c) => /hashtext\(\?\),\s*hashtext/.test(c.sql) || /FROM\s+seasons.*FOR\s+SHARE/s.test(c.sql))).toBe(false);
  });

  it('되돌린 뒤 재제출·재승인하면 첫 승인과 같은 값(왕복), 되돌린 뒤 내전 삭제 가능', async () => {
    const { app, season, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, ids);
    const first = Object.fromEntries([host.userId, u2, u3, u4].map((u) => [u, { ...ratingOf(app, u, season.id) }]));
    const firstHist = app.prisma.ratingHistory.rows.map((h) => ({ u: h.userId, b: h.eloBefore, a: h.eloAfter, k: h.kFactor }));
    expect((await revert(app, adminA, ids.scrimId, ids.resultId)).status).toBe(200);

    const sub = await detailOf(await call(app, 'POST', `/scrims/${ids.scrimId}/result`, host.token, { winner_team: 'blue' }));
    const newId = sub.result?.id as string;
    expect(newId).not.toBe(ids.resultId);
    expect(sub.result?.status).toBe('pending');
    expect((await approve(app, adminA, { scrimId: ids.scrimId, resultId: newId })).status).toBe(200);
    for (const u of [host.userId, u2, u3, u4]) {
      expect(ratingOf(app, u, season.id)).toMatchObject({ elo: first[u]?.elo, wins: first[u]?.wins, losses: first[u]?.losses });
    }
    const again = app.prisma.ratingHistory.rows.map((h) => ({ u: h.userId, b: h.eloBefore, a: h.eloAfter, k: h.kFactor }));
    expect(again.sort((x, y) => (x.u < y.u ? -1 : 1))).toEqual(firstHist.sort((x, y) => (x.u < y.u ? -1 : 1)));

    // 두 번째 승인을 되돌리고 삭제
    expect((await revert(app, adminA, ids.scrimId, newId)).status).toBe(200);
    expect((await call(app, 'DELETE', `/scrims/${ids.scrimId}`, adminA.token)).status).toBe(204);
    expect(app.prisma.scrim.rows.find((s) => s.id === ids.scrimId)).toBeUndefined();
  });

  it('잠금 순서: 내전 행 FOR UPDATE → 사용자 advisory(오름차순) → 시즌 FOR SHARE', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, ids);
    app.prisma.rawCalls = [];
    expect((await revert(app, adminA, ids.scrimId, ids.resultId)).status).toBe(200);
    const kinds = app.prisma.rawCalls.map((c) =>
      /FROM\s+scrims\s+WHERE\s+id.*FOR\s+UPDATE/s.test(c.sql)
        ? 'scrim'
        : /pg_advisory_xact_lock\(hashtext\(\?\),\s*hashtext\(\?\)\)/.test(c.sql)
          ? 'user'
          : /FROM\s+seasons\s+WHERE\s+id.*FOR\s+SHARE/s.test(c.sql)
            ? 'season'
            : 'other',
    );
    const locks = kinds.filter((k) => k !== 'other');
    expect(locks).toEqual(['scrim', 'user', 'user', 'user', 'user', 'season']);
    const userIds = app.prisma.rawCalls.filter((c) => /hashtext\(\?\),\s*hashtext/.test(c.sql)).map((c) => c.values[1] as string);
    expect(userIds).toEqual([...userIds].sort());
  });

  it('랭킹·홈·scrim_count에서 빠진다(approved만 센다)', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, ids);
    const homeBefore = GetDashboardSummaryResponse.parse(await json(await call(app, 'GET', '/dashboard/summary', host.token)));
    expect(homeBefore.recent_results).toHaveLength(1);
    await revert(app, adminA, ids.scrimId, ids.resultId);
    const home = GetDashboardSummaryResponse.parse(await json(await call(app, 'GET', '/dashboard/summary', host.token)));
    expect(home.recent_results).toHaveLength(0);
    const members = ListAdminMembersResponse.parse(await json(await call(app, 'GET', '/admin/members', adminA.token)));
    expect(members.items.find((m) => m.user.id === host.userId)?.scrim_count).toBe(0);
  });
});

describe('POST /scrims/:id/result/revert — 거부', () => {
  it('이후 경기(같은 시즌·다른 시즌 모두)가 있으면 409 later_games, 상세·큐도 같은 이유', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const x = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, x);
    app.clock.advance(MIN);
    const u5 = await member(app, '멤버다섯');
    const y = seedPendingTeamResult(app, [u3, u5], [await member(app, '멤버여섯'), await member(app, '멤버일곱')]);
    await approve(app, adminA, y);

    const res = await revert(app, adminA, x.scrimId, x.resultId);
    const body = await expectError(res, 409, 'SCRIM_RESULT_REVERT_NOT_ALLOWED');
    expect(body.message).toContain('다음 경기');
    const d = await getScrim(app, adminA, x.scrimId);
    expect(d.viewer).toMatchObject({ can_revert_result: false, revert_blocked_reason: 'later_games' });
    const q = ListAdminResultsResponse.parse(await json(await call(app, 'GET', '/admin/results?view=approved', adminA.token)));
    expect(q.items.find((i) => i.result_id === x.resultId)).toMatchObject({ can_revert: false, revert_blocked_reason: 'later_games' });
    expect(q.items.find((i) => i.result_id === y.resultId)).toMatchObject({ can_revert: true, revert_blocked_reason: null });
    // 나중 경기는 되돌릴 수 있다
    expect((await revert(app, adminA, y.scrimId, y.resultId)).status).toBe(200);
    expect((await revert(app, adminA, x.scrimId, x.resultId)).status).toBe(200);
  });

  it('다음 시즌 경기도 막는다(K 판정은 모든 시즌)', async () => {
    t = await createTestApp({ fixedClock: START });
    const app = t;
    seedSeason(app, 'A', '2026-10-01T00:00:00.000Z', '2026-10-28T04:00:00.000Z');
    seedSeason(app, 'B', '2026-10-28T04:00:00.000Z', '2026-12-28T04:00:00.000Z');
    const adminA = await login(app, 'admin_a', 'admin');
    const [a, b, c, d] = [await member(app, '가'), await member(app, '나'), await member(app, '다'), await member(app, '라')];
    const x = seedPendingTeamResult(app, [a, b], [c, d]);
    await approve(app, adminA, x);
    app.clock.advance(2 * HOUR);
    const y = seedPendingTeamResult(app, [a, await member(app, '마')], [await member(app, '바'), await member(app, '사')]);
    await approve(app, adminA, y);
    const ys = app.prisma.ratingHistory.rows.find((h) => h.scrimResultId === y.resultId)?.seasonId;
    const xs = app.prisma.ratingHistory.rows.find((h) => h.scrimResultId === x.resultId)?.seasonId;
    expect(ys).not.toBe(xs);
    await expectError(await revert(app, adminA, x.scrimId, x.resultId), 409, 'SCRIM_RESULT_REVERT_NOT_ALLOWED');
  });

  it('같은 created_at의 다른 결과도 막는다(D247)', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const x = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, x);
    const y = seedPendingTeamResult(app, [u4, await member(app, 'p5')], [await member(app, 'p6'), await member(app, 'p7')]);
    await approve(app, adminA, y);
    const hx = app.prisma.ratingHistory.rows.find((h) => h.scrimResultId === x.resultId);
    const hy = app.prisma.ratingHistory.rows.find((h) => h.scrimResultId === y.resultId);
    expect(hx?.createdAt.getTime()).toBe(hy?.createdAt.getTime());
    await expectError(await revert(app, adminA, x.scrimId, x.resultId), 409, 'SCRIM_RESULT_REVERT_NOT_ALLOWED');
    await expectError(await revert(app, adminA, y.scrimId, y.resultId), 409, 'SCRIM_RESULT_REVERT_NOT_ALLOWED');
  });

  it('반영 시즌이 닫혔으면 409 season_closed', async () => {
    const { app, season, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, ids);
    const row = app.prisma.season.rows.find((s) => s.id === season.id);
    if (row) row.closedAt = app.clock.now();
    expect((await getScrim(app, adminA, ids.scrimId)).viewer.revert_blocked_reason).toBe('season_closed');
    const body = await expectError(await revert(app, adminA, ids.scrimId, ids.resultId), 409, 'SCRIM_RESULT_REVERT_NOT_ALLOWED');
    expect(body.message).toContain('시즌 종료');
  });

  it('기한: 승인 + 7일 − 1ms는 허용, 정확히 7일이면 409 window_passed', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const a = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, a);
    app.clock.advance(7 * DAY);
    expect((await getScrim(app, adminA, a.scrimId)).viewer.revert_blocked_reason).toBe('window_passed');
    await expectError(await revert(app, adminA, a.scrimId, a.resultId), 409, 'SCRIM_RESULT_REVERT_NOT_ALLOWED');
    app.clock.advance(-1);
    expect((await revert(app, adminA, a.scrimId, a.resultId)).status).toBe(200);
  });

  it('제출자 본인은 403 SCRIM_RESULT_SELF_REVIEW(승인은 다른 운영진)', async () => {
    const { app, adminA, adminB, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [adminB.userId, u2], [u3, u4]);
    await approve(app, adminA, ids);
    expect((await getScrim(app, adminB, ids.scrimId)).viewer).toMatchObject({
      can_revert_result: false,
      revert_blocked_reason: 'self_submitted',
    });
    await expectError(await revert(app, adminB, ids.scrimId, ids.resultId), 403, 'SCRIM_RESULT_SELF_REVIEW');
    expect((await revert(app, adminA, ids.scrimId, ids.resultId)).status).toBe(200);
  });

  it('result_id 불일치·pending 결과 → 409 SCRIM_RESULT_NOT_APPROVED, 없는 내전 404, 형식 오류 400', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await expectError(await revert(app, adminA, ids.scrimId, ids.resultId), 409, 'SCRIM_RESULT_NOT_APPROVED');
    await approve(app, adminA, ids);
    await expectError(await revert(app, adminA, ids.scrimId, '00000000-0000-4000-8000-000000000000'), 409, 'SCRIM_RESULT_NOT_APPROVED');
    await expectError(await revert(app, adminA, '00000000-0000-4000-8000-000000000001', ids.resultId), 404, 'NOT_FOUND');
    await expectError(await revert(app, adminA, ids.scrimId, ids.resultId, 'x'), 400, 'VALIDATION_FAILED');
    // 되돌린 뒤 같은 result_id로 다시 → NOT_APPROVED
    expect((await revert(app, adminA, ids.scrimId, ids.resultId)).status).toBe(200);
    await expectError(await revert(app, adminA, ids.scrimId, ids.resultId), 409, 'SCRIM_RESULT_NOT_APPROVED');
  });

  it('ratings elo가 이력 elo_after와 다르면 409 + 아무것도 바뀌지 않음(롤백)', async () => {
    const { app, season, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, ids);
    const r3 = ratingOf(app, u3, season.id);
    if (r3) r3.elo += 1;
    const snapshot = JSON.stringify(app.prisma.rating.rows.map((r) => [r.userId, r.elo, r.wins, r.losses]));
    const body = await expectError(await revert(app, adminA, ids.scrimId, ids.resultId), 409, 'SCRIM_RESULT_REVERT_NOT_ALLOWED');
    expect(body.message).toContain('레이팅 기록');
    expect(JSON.stringify(app.prisma.rating.rows.map((r) => [r.userId, r.elo, r.wins, r.losses]))).toBe(snapshot);
    expect(app.prisma.ratingHistory.rows.filter((h) => h.scrimResultId === ids.resultId)).toHaveLength(4);
    expect(app.prisma.scrimResult.rows.find((r) => r.id === ids.resultId)?.status).toBe('approved');
    expect(app.prisma.scrim.rows.find((s) => s.id === ids.scrimId)?.status).toBe('finished');
    expect(auditRows(app)).toHaveLength(0);
    // 상세는 시도 때만 판정하는 rating_mismatch를 보이지 않는다
    expect((await getScrim(app, adminA, ids.scrimId)).viewer.revert_blocked_reason).toBeNull();
  });

  it('비운영진 403(없는 내전도 403이 먼저), 비로그인 401, 멤버 상세의 되돌리기 필드는 false/null', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    await approve(app, adminA, ids);
    await expectError(await revert(app, host, ids.scrimId, ids.resultId), 403, 'FORBIDDEN');
    await expectError(await revert(app, host, '00000000-0000-4000-8000-000000000001', ids.resultId), 403, 'FORBIDDEN');
    await expectError(await revert(app, { token: '', userId: '' } as Who, ids.scrimId, ids.resultId), 401, 'UNAUTHENTICATED');
    expect((await getScrim(app, host, ids.scrimId)).viewer).toMatchObject({ can_revert_result: false, revert_blocked_reason: null });
  });
});

describe('이의 제기 제거 회귀(D281)', () => {
  it('삭제된 경로 3개는 404(운영진·멤버 모두, 라우트 없음)', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const ids = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    for (const who of [adminA, host]) {
      await expectError(
        await call(app, 'POST', `/scrims/${ids.scrimId}/result/disputes`, who.token, { result_id: ids.resultId, reason: '이의 있음' }),
        404,
        'NOT_FOUND',
      );
      await expectError(await call(app, 'GET', '/admin/disputes', who.token), 404, 'NOT_FOUND');
      await expectError(
        await call(app, 'POST', '/admin/disputes/00000000-0000-4000-8000-000000000001/resolve', who.token, { resolution: '처리함' }),
        404,
        'NOT_FOUND',
      );
    }
    const d = await getScrim(app, host, ids.scrimId);
    expect(d.viewer).not.toHaveProperty('can_dispute_result');
    expect(d.viewer).not.toHaveProperty('has_open_dispute');
    expect(d.result).not.toHaveProperty('open_dispute_count');
  });

  it('DB에 남은 open 이의 제기 행은 반려·되돌리기 뒤에도 open 그대로(앱이 표를 건드리지 않음)', async () => {
    const { app, adminA, host, u2, u3, u4 } = await setup();
    const rejected = seedPendingTeamResult(app, [host.userId, u2], [u3, u4]);
    const r1 = seedDispute(app, { resultId: rejected.resultId, userId: u2 });
    expect(
      (await call(app, 'POST', `/scrims/${rejected.scrimId}/result/reject`, adminA.token, { result_id: rejected.resultId, reason: '스코어 확인' }))
        .status,
    ).toBe(200);
    const reverted = seedPendingTeamResult(app, [await member(app, 'q1'), await member(app, 'q2')], [await member(app, 'q3'), await member(app, 'q4')]);
    const r2 = seedDispute(app, { resultId: reverted.resultId, userId: u3 });
    await approve(app, adminA, reverted);
    expect((await revert(app, adminA, reverted.scrimId, reverted.resultId)).status).toBe(200);
    for (const id of [r1.id, r2.id]) {
      expect(app.prisma.scrimResultDispute.rows.find((x) => x.id === id)).toMatchObject({ status: 'open', resolvedById: null, resolution: null });
    }
  });
});
