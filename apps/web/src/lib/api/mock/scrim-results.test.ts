import {
  ApiPath,
  ApproveScrimResultResponse,
  BalanceScrimResponse,
  DevLoginResponse,
  GetScrimResponse,
  GetUserProfileResponse,
  GetUserRatingHistoryResponse,
  JoinScrimResponse,
  ListScrimsResponse,
  ListSeasonsResponse,
  RATING_START_ELO,
  RejectScrimResultResponse,
  SaveScrimTeamsResponse,
  SubmitScrimResultResponse,
  WithdrawScrimResultResponse,
  fillPath,
  type ScrimListStatus,
  type UserRole,
} from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { createMockBackend, type MockDb } from './backend';
import { mockEloPolicy, skillInfo } from './ratings';

const uid = (n: number) => `5c0f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** S3 목(밸런스·팀·결과·승인·시즌·그래프·프로필)이 계약을 지키는지: 실제 클라이언트(zod parse)로 호출 */
function setup(login: { username: string; role?: UserRole } = { username: 'host_kim' }) {
  let db: MockDb | null = null;
  let now = Date.parse('2026-10-28T03:00:00.000Z');
  const mock = createMockBackend({
    storage: { get: () => db, set: (d) => (db = d) },
    cookies: { hasRefresh: () => true, setRefresh: () => {}, clearRefresh: () => {} },
    now: () => now,
    s1: { origin: () => 'http://localhost:3000' },
  });
  const api = createApiClient({ fetch: mock.fetch });
  const ready = (async () => {
    const res = await api.request(ApiPath.authDevLogin, DevLoginResponse, { method: 'POST', body: login, auth: false });
    api.setSession(res);
    return res.user;
  })();
  const find = async (status: ScrimListStatus, title: string) => {
    const page = await api.request(`${ApiPath.scrims}?status=${status}&limit=100`, ListScrimsResponse);
    const s = page.items.find((x) => x.title === title);
    if (!s) throw new Error(`no scrim ${title}`);
    return s;
  };
  const get = (id: string) => api.request(fillPath(ApiPath.scrim, { id }), GetScrimResponse);
  const balance = (id: string) => api.request(fillPath(ApiPath.scrimBalance, { id }), BalanceScrimResponse, { method: 'POST', body: {} });
  const saveTeams = (id: string, body: unknown) => api.request(fillPath(ApiPath.scrimTeams, { id }), SaveScrimTeamsResponse, { method: 'PUT', body });
  const submit = (id: string, body: unknown) => api.request(fillPath(ApiPath.scrimResult, { id }), SubmitScrimResultResponse, { method: 'POST', body });
  const withdraw = (id: string) => api.request(fillPath(ApiPath.scrimResult, { id }), WithdrawScrimResultResponse, { method: 'DELETE' });
  const approve = (id: string, result_id: string) =>
    api.request(fillPath(ApiPath.scrimResultApprove, { id }), ApproveScrimResultResponse, { method: 'POST', body: { result_id } });
  const reject = (id: string, result_id: string, reason: string) =>
    api.request(fillPath(ApiPath.scrimResultReject, { id }), RejectScrimResultResponse, { method: 'POST', body: { result_id, reason } });
  return { api, ready, find, get, balance, saveTeams, submit, withdraw, approve, reject, db: () => db!, advance: (ms: number) => (now += ms) };
}

describe('S3 목: 상세 확장 필드·밸런스·팀 저장', () => {
  it('상세 players에 skill·is_new, viewer can_* 5개, 목록 result_status·outcome', async () => {
    const t = setup();
    await t.ready;
    const s = await t.find('open', '주말 협곡 2판 연속');
    const d = await t.get(s.id);
    expect(d.players.every((p) => Number.isInteger(p.skill))).toBe(true);
    expect(d.viewer).toMatchObject({ can_edit_teams: true, can_balance: true, can_submit_result: false, can_review_result: false });
    expect(d.balance).toBeNull();
    const ended = await t.api.request(`${ApiPath.scrims}?status=ended&limit=100`, ListScrimsResponse);
    const tft = ended.items.find((x) => x.title === '지난주 롤체 로비')!;
    expect(tft.outcome).toMatchObject({ winner_team: null, winner: { nickname: '용용이' } });
    expect(ended.items.find((x) => x.title === '일요일 협곡 내전')!.outcome?.winner_team).not.toBeNull();
    const pending = await t.find('playing', '승인 대기 협곡 내전');
    expect(pending.result_status).toBe('pending');
  });

  it('밸런스: 10명 126가지, 서로 다른 3안 비용 오름차순, rating_policy, 저장 후 상세 balance', async () => {
    const t = setup();
    await t.ready;
    const s = await t.find('open', '주말 협곡 2판 연속');
    const r = await t.balance(s.id);
    expect(r.partitions_evaluated).toBe(126);
    expect(r.options).toHaveLength(3);
    expect(r.used_positions).toBe(true);
    expect(r.rating_policy).toEqual({ k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5, full_weight_games: 10, elo_weight_max: 0.2 });
    const costs = r.options.map((o) => o.total_cost);
    expect([...costs].sort((a, b) => a - b)).toEqual(costs);
    const o = r.options[0]!;
    const saved = await t.saveTeams(s.id, {
      blue: o.blue.members.map((m) => ({ user_id: m.user.id, position: m.position })),
      orange: o.orange.members.map((m) => ({ user_id: m.user.id, position: m.position })),
    });
    expect(saved.balance).not.toBeNull();
    expect(saved.balance!.power_diff).toBe(o.power_diff);
    expect(saved.players.filter((p) => p.team === 'blue')).toHaveLength(5);
  });

  it('목은 패배 배율을 반영한다: 미리보기 패배가 승리 몫의 절반, 승인하면 진 쪽이 덜 잃어 합이 양수', async () => {
    const t = setup({ username: 'admin_kim', role: 'admin' });
    await t.ready;
    const open = await t.find('open', '주말 협곡 2판 연속');
    const o = (await t.balance(open.id).catch(() => null))?.options[0];
    if (o) expect(Math.abs(Math.abs(o.blue.elo_preview!.lose) - o.orange.elo_preview!.win / 2)).toBeLessThanOrEqual(1);
    const s = await t.find('playing', '승인 대기 협곡 내전');
    const d = await t.get(s.id);
    const done = await t.approve(s.id, d.result!.id);
    const changes = done.result!.rating_changes;
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.delta < 0)).toBe(true);
    expect(changes.reduce((sum, c) => sum + c.delta, 0)).toBeGreaterThan(0);
  });

  it('팀 저장 검증: 포지션 누락 VALIDATION_FAILED, 남의 내전 FORBIDDEN, 개인 순위 게임 TEAMS_NOT_EDITABLE', async () => {
    const t = setup();
    await t.ready;
    const s = await t.find('open', '주말 협곡 2판 연속');
    const d = await t.get(s.id);
    const ids = d.players.map((p) => p.user.id);
    await expect(t.saveTeams(s.id, { blue: [{ user_id: ids[0] }], orange: [{ user_id: ids[1] }] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    const other = await t.find('playing', '오늘 밤 협곡 내전');
    await expect(t.balance(other.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const solo = await t.find('playing', '롤체 순위전 로비');
    await expect(t.balance(solo.id)).rejects.toMatchObject({ code: 'SCRIM_TEAMS_NOT_EDITABLE' });
  });

  it('참가 취소·승격으로 joined 집합이 바뀌면 팀 초기화(5-1)', async () => {
    const t = setup();
    const me = await t.ready;
    const s = await t.find('open', '주말 협곡 2판 연속');
    const r = await t.balance(s.id);
    const o = r.options[0]!;
    await t.saveTeams(s.id, {
      blue: o.blue.members.map((m) => ({ user_id: m.user.id, position: m.position })),
      orange: o.orange.members.map((m) => ({ user_id: m.user.id, position: m.position })),
    });
    // 방장을 바꾸고 내가 나갔다가 다시 참가 → joined 변화마다 초기화
    t.db().s2!.scrims.find((x) => x.id === s.id)!.host_id = '5c0f0000-0000-4000-8000-000000000001';
    await t.api.request(fillPath(ApiPath.scrimJoin, { id: s.id }), JoinScrimResponse, { method: 'DELETE' });
    const after = await t.get(s.id);
    expect(after.players.every((p) => p.team === null)).toBe(true);
    expect(after.players.some((p) => p.user.id === me.id)).toBe(false);
  });
});

describe('S3 목: 새 참가 확정 시 팀 초기화(5-1, backend 요청 1 수용)', () => {
  it('full → 팀 저장 → 정원 확대(승격 없음, recruiting) → 새 참가 → 팀 null', async () => {
    const t = setup({ username: 'admin_join', role: 'admin' });
    const me = await t.ready;
    const created = await t.api.request(ApiPath.scrims, GetScrimResponse, {
      method: 'POST',
      body: { game: 'lol', title: '4인 협곡', scheduled_at: '2026-10-28T20:00:00+09:00', capacity: 4, host_preferred_positions: ['mid'] },
    });
    const s2 = t.db().s2!;
    const scrim = s2.scrims.find((x) => x.id === created.id)!;
    // 방장을 다른 멤버로 바꾸고 나는 빠진 상태에서 4명이 정원을 채운다
    scrim.host_id = uid(1);
    s2.players.find((p) => p.scrim_id === scrim.id && p.user_id === me.id)!.status = 'cancelled';
    [1, 3, 4, 5].forEach((n, i) =>
      s2.players.push({
        id: crypto.randomUUID(),
        scrim_id: scrim.id,
        user_id: uid(n),
        status: 'joined',
        preferred_positions: ['top', 'jungle'],
        joined_at: new Date(Date.parse('2026-10-28T01:00:00.000Z') + i * 60_000).toISOString(),
        no_show_marked_at: null,
        no_show_marked_by: null,
        team: null,
        position: null,
      }),
    );
    scrim.status = 'full';
    const saved = await t.saveTeams(scrim.id, {
      blue: [{ user_id: uid(1), position: 'top' }, { user_id: uid(3), position: 'jungle' }],
      orange: [{ user_id: uid(4), position: 'top' }, { user_id: uid(5), position: 'jungle' }],
    });
    expect(saved.balance).not.toBeNull();
    // 정원 확대(대기자 없음 → 승격 없음): 목 저장소에서 직접(방장만 PATCH 가능)
    Object.assign(scrim, { capacity: 6, status: 'recruiting' });
    expect((await t.get(scrim.id)).balance).not.toBeNull();
    const joined = await t.api.request(fillPath(ApiPath.scrimJoin, { id: scrim.id }), JoinScrimResponse, {
      method: 'POST',
      body: { preferred_positions: ['mid'] },
    });
    expect(joined.viewer.status).toBe('joined');
    expect(joined.players.every((p) => p.team === null && p.position === null)).toBe(true);
    expect(joined.balance).toBeNull();
  });
});

describe('S3 목: 결과 제출·취소·승인·반려', () => {
  it('방장 제출 → 제출 취소 → 재제출, 자기 제출 승인은 SELF_REVIEW', async () => {
    const t = setup({ username: 'admin_host', role: 'admin' });
    await t.ready;
    const s = await t.find('playing', '내가 연 협곡 내전');
    const d0 = await t.get(s.id);
    expect(d0.viewer.can_submit_result).toBe(true);
    await expect(t.submit(s.id, { placements: [] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const d1 = await t.submit(s.id, { winner_team: 'blue' });
    expect(d1.result).toMatchObject({ status: 'pending', winner_team: 'blue', rating_status: 'waiting' });
    expect(d1.viewer).toMatchObject({ can_withdraw_result: true, can_review_result: false, can_edit_teams: false });
    await expect(t.submit(s.id, { winner_team: 'orange' })).rejects.toMatchObject({ code: 'SCRIM_RESULT_EXISTS' });
    await expect(t.approve(s.id, d1.result!.id)).rejects.toMatchObject({ code: 'SCRIM_RESULT_SELF_REVIEW', status: 403 });
    const d2 = await t.withdraw(s.id);
    expect(d2.result).toBeNull();
    await expect(t.withdraw(s.id)).rejects.toMatchObject({ code: 'SCRIM_RESULT_NOT_PENDING' });
  });

  it('운영진 승인 → finished, ELO 반영(+/− 대칭 근처, k_factor), 프로필·그래프 갱신', async () => {
    const t = setup({ username: 'admin_kim', role: 'admin' });
    const me = await t.ready;
    const s = await t.find('playing', '승인 대기 협곡 내전');
    const d = await t.get(s.id);
    expect(d.viewer.can_review_result).toBe(true);
    await expect(t.approve(s.id, '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ code: 'SCRIM_RESULT_NOT_PENDING' });
    const before = await t.api.request(fillPath(ApiPath.userProfile, { id: me.id }), GetUserProfileResponse);
    const lolBefore = before.scrim!.ratings.find((r) => r.game === 'lol')!;
    const a = await t.approve(s.id, d.result!.id);
    expect(a.status).toBe('finished');
    expect(a.result).toMatchObject({ status: 'approved', rating_status: 'applied' });
    expect(a.result!.rating_changes).toHaveLength(10);
    for (const c of a.result!.rating_changes) {
      expect(c.delta).toBe(c.elo_after - c.elo_before);
      expect(c.outcome === 'win').toBe(c.team === 'orange');
      expect([32, 40]).toContain(c.k_factor);
    }
    const after = await t.api.request(fillPath(ApiPath.userProfile, { id: me.id }), GetUserProfileResponse);
    const lolAfter = after.scrim!.ratings.find((r) => r.game === 'lol')!;
    expect(lolAfter.games).toBe(lolBefore.games + 1);
    expect(after.scrim!.recent[0]!.title).toBe('승인 대기 협곡 내전');
    const hist = await t.api.request(`${fillPath(ApiPath.userRatingHistory, { id: me.id })}?game=lol`, GetUserRatingHistoryResponse);
    expect(hist.points[hist.points.length - 1]!.scrim_title).toBe('승인 대기 협곡 내전');
    expect(hist.season?.name).toBe('시즌 2');
    const ended = await t.find('ended', '승인 대기 협곡 내전');
    expect(ended.outcome).toEqual({ winner_team: 'orange', winner: null });
  });

  it('멤버는 승인·반려 FORBIDDEN, 반려 사유 필수, 반려 후 재입력 가능', async () => {
    const member = setup();
    await member.ready;
    const p = await member.find('playing', '승인 대기 협곡 내전');
    const rid = (await member.get(p.id)).result!.id;
    await expect(member.approve(p.id, rid)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const admin = setup({ username: 'admin_lee', role: 'admin' });
    await admin.ready;
    const s = await admin.find('playing', '승인 대기 협곡 내전');
    const r = (await admin.get(s.id)).result!;
    await expect(admin.reject(s.id, r.id, ' ')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const d = await admin.reject(s.id, r.id, '승리 팀이 반대예요');
    expect(d.status).toBe('playing');
    expect(d.result).toMatchObject({ status: 'rejected', reject_reason: '승리 팀이 반대예요' });
    expect(d.result_status).toBe('rejected');
    expect(d.viewer).toMatchObject({ can_submit_result: true, can_edit_teams: true });
  });

  it('롤체 순위 제출: 비참가자 VALIDATION_FAILED, 상위 절반 승, 시즌 목록', async () => {
    const admin = setup({ username: 'admin_tft', role: 'admin' });
    await admin.ready;
    const s = await admin.find('playing', '롤체 순위전 로비');
    const d = await admin.get(s.id);
    expect(d.result).toMatchObject({ status: 'rejected' });
    const ids = d.players.map((p) => p.user.id);
    await expect(
      admin.submit(s.id, { placements: [{ user_id: ids[0], placement: 1 }, { user_id: '5c0f0000-0000-4000-8000-000000000002', placement: 2 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'placements.1.user_id' }] });
    const sub = await admin.submit(s.id, { placements: ids.map((user_id, i) => ({ user_id, placement: i + 1 })) });
    expect(sub.result!.placements.map((p) => p.placement)).toEqual([1, 2, 3, 4, 5, 6]);
    // 다른 운영진이 승인(목 저장소에서 제출자를 바꿔 흉내)
    admin.db().s2!.results.find((r) => r.id === sub.result!.id)!.submitted_by = '5c0f0000-0000-4000-8000-000000000001';
    const a = await admin.approve(s.id, sub.result!.id);
    const wins = a.result!.rating_changes.filter((c) => c.outcome === 'win').map((c) => c.placement);
    expect(wins.sort()).toEqual([1, 2, 3]);
    const seasons = await admin.api.request(ApiPath.seasons, ListSeasonsResponse);
    expect(seasons.items.map((x) => [x.name, x.is_current])).toEqual([
      ['시즌 2', true],
      ['시즌 1', false],
    ]);
  });
});

describe('S3 교차 QA 반영', () => {
  it('결과 모양이 게임과 다르면 path = 잘못 보낸 필드(API와 같음)', async () => {
    const t = setup({ username: 'admin_shape', role: 'admin' });
    await t.ready;
    const team = await t.find('playing', '내가 연 협곡 내전');
    const ids = (await t.get(team.id)).players.map((p) => p.user.id);
    await expect(
      t.submit(team.id, { placements: [{ user_id: ids[0], placement: 1 }, { user_id: ids[1], placement: 2 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'placements' }] });
    const solo = await t.find('playing', '롤체 순위전 로비');
    await expect(t.submit(solo.id, { winner_team: 'blue' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'winner_team' }] });
  });

  it('D136: 프로필 최근 내전 개인 순위 승패는 노쇼 제외 재순위 기준 — 8명 중 5위, 1·2위 노쇼 → WIN', async () => {
    const t = setup();
    const me = await t.ready;
    await t.find('open', '롤체 8인 친선 로비'); // 시드 생성
    const s2 = t.db().s2!;
    const scrimId = '5c1a0000-0000-4000-8000-0000000d1360';
    const at = '2026-10-28T02:30:00.000Z';
    s2.scrims.push({
      id: scrimId,
      game: 'tft',
      title: 'D136 확인 로비',
      scheduled_at: '2026-10-28T01:00:00.000Z',
      capacity: 8,
      status: 'finished',
      host_id: uid(12),
      rules: null,
      rated: false,
      auto_balance: false,
      use_positions: false,
      steam_app: null,
      started_at: '2026-10-28T01:00:00.000Z',
      cancelled_at: null,
      cancel_reason: null,
      created_at: '2026-10-27T01:00:00.000Z',
      updated_at: at,
    });
    // 순위: uid(1) 1위·uid(3) 2위(둘 다 노쇼), uid(4)·uid(5)·uid(6)·나(5위)·uid(7)·uid(8)
    const order = [uid(1), uid(3), uid(4), uid(5), me.id, uid(6), uid(7), uid(8)];
    order.forEach((user_id, i) =>
      s2.players.push({
        id: crypto.randomUUID(),
        scrim_id: scrimId,
        user_id,
        status: i < 2 ? 'no_show' : 'joined',
        preferred_positions: [],
        joined_at: '2026-10-27T02:00:00.000Z',
        no_show_marked_at: i < 2 ? at : null,
        no_show_marked_by: i < 2 ? uid(1) : null,
        team: null,
        position: null,
      }),
    );
    s2.results.push({
      id: '5c1a0000-0000-4000-8000-0000000d1361',
      scrim_id: scrimId,
      status: 'approved',
      winner_team: null,
      placements: order.map((user_id, i) => ({ user_id, placement: i + 1 })),
      submitted_by: uid(12),
      created_at: at,
      approved_by: uid(1),
      approved_at: at,
      rejected_by: null,
      rejected_at: null,
      reject_reason: null,
    });
    const p = await t.api.request(fillPath(ApiPath.userProfile, { id: me.id }), GetUserProfileResponse);
    const row = p.scrim!.recent.find((r) => r.scrim_id === scrimId)!;
    // 반영 인원 6명 중 3위 → 2 × 3 ≤ 6 → 승. 표시 순위는 제출 그대로 5위
    expect(row).toMatchObject({ outcome: 'win', placement: 5, rated: false, elo_delta: null });
  });
});

describe('D136 경계: 개인 순위 반영 대상 2명 미만(skip)', () => {
  /** 끝난 롤체 내전 1개를 목 저장소에 직접 넣는다(order 순서가 제출 순위) */
  const insertSolo = (t: ReturnType<typeof setup>, n: number, order: string[], noShow: Set<string>) => {
    const s2 = t.db().s2!;
    const scrimId = `5c1a0000-0000-4000-8000-0000000d${String(n).padStart(4, '0')}`;
    const at = `2026-10-28T02:${String(40 + n).padStart(2, '0')}:00.000Z`;
    s2.scrims.push({
      id: scrimId,
      game: 'tft',
      title: `D136 경계 ${n}`,
      scheduled_at: '2026-10-28T01:00:00.000Z',
      capacity: 8,
      status: 'finished',
      host_id: uid(12),
      rules: null,
      rated: true,
      auto_balance: false,
      use_positions: false,
      steam_app: null,
      started_at: '2026-10-28T01:00:00.000Z',
      cancelled_at: null,
      cancel_reason: null,
      created_at: '2026-10-27T01:00:00.000Z',
      updated_at: at,
    });
    for (const user_id of order) {
      s2.players.push({
        id: crypto.randomUUID(),
        scrim_id: scrimId,
        user_id,
        status: noShow.has(user_id) ? 'no_show' : 'joined',
        preferred_positions: [],
        joined_at: '2026-10-27T02:00:00.000Z',
        no_show_marked_at: noShow.has(user_id) ? at : null,
        no_show_marked_by: noShow.has(user_id) ? uid(1) : null,
        team: null,
        position: null,
      });
    }
    s2.results.push({
      id: `5c1a0000-0000-4000-8000-0000000e${String(n).padStart(4, '0')}`,
      scrim_id: scrimId,
      status: 'approved',
      winner_team: null,
      placements: order.map((user_id, i) => ({ user_id, placement: i + 1 })),
      submitted_by: uid(12),
      created_at: at,
      approved_by: uid(1),
      approved_at: at,
      rejected_by: null,
      rejected_at: null,
      reject_reason: null,
    });
    return scrimId;
  };

  it('나 혼자 남으면 unassigned(제출 순위 그대로), 내가 노쇼면 no_show', async () => {
    const t = setup();
    const me = await t.ready;
    await t.find('open', '롤체 8인 친선 로비'); // 시드 생성
    const skipId = insertSolo(t, 1, [uid(1), me.id, uid(3)], new Set([uid(1), uid(3)]));
    const mineNoShow = insertSolo(t, 2, [uid(1), uid(3), me.id], new Set([me.id]));
    const p = await t.api.request(fillPath(ApiPath.userProfile, { id: me.id }), GetUserProfileResponse);
    expect(p.scrim!.recent.find((r) => r.scrim_id === skipId)).toMatchObject({ outcome: 'unassigned', placement: 2 });
    expect(p.scrim!.recent.find((r) => r.scrim_id === mineNoShow)).toMatchObject({ outcome: 'no_show', placement: 3 });
  });

  it('D138 승인 때 반영된 참가자(rating_history)가 있으면 승인 뒤 노쇼 표시가 생겨도 승패 기준이 바뀌지 않는다: 8명 중 5위 → LOSS', async () => {
    const t = setup();
    const me = await t.ready;
    await t.find('open', '롤체 8인 친선 로비'); // 시드 생성
    const order = [uid(1), uid(3), uid(4), uid(5), me.id, uid(6), uid(7), uid(8)];
    // 승인 뒤 1·2위가 노쇼로 바뀐 상태. 이력이 없으면(D136) 6명 중 3위라 WIN이지만, 이력이 있으면 8명 기준 5위라 LOSS
    const withHistory = insertSolo(t, 3, order, new Set([uid(1), uid(3)]));
    const withoutHistory = insertSolo(t, 4, order, new Set([uid(1), uid(3)]));
    const s2 = t.db().s2!;
    const result = s2.results.find((r) => r.scrim_id === withHistory)!;
    for (const user_id of order) {
      s2.history.push({
        id: crypto.randomUUID(),
        user_id,
        game: 'tft',
        season_id: crypto.randomUUID(),
        scrim_id: withHistory,
        result_id: result.id,
        elo_before: 1000,
        elo_after: 1000,
        delta: 0,
        outcome: 'loss',
        k_factor: 40,
        created_at: result.approved_at!,
      });
    }
    const p = await t.api.request(fillPath(ApiPath.userProfile, { id: me.id }), GetUserProfileResponse);
    expect(p.scrim!.recent.find((r) => r.scrim_id === withHistory)).toMatchObject({ outcome: 'loss', placement: 5 });
    expect(p.scrim!.recent.find((r) => r.scrim_id === withoutHistory)).toMatchObject({ outcome: 'win', placement: 5 });
  });
});

describe('S4 20절 목: 시작 점수 1000·실력값 비중', () => {
  it('(사용자, 게임, 시즌) 첫 이력의 elo_before는 모두 RATING_START_ELO(티어 무관, 시즌마다 새로)', async () => {
    const t = setup();
    await t.ready;
    await t.find('open', '주말 협곡 2판 연속'); // 시드 생성
    const history = [...t.db().s2!.history].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const firsts = new Map<string, number>();
    for (const h of history) {
      const k = `${h.user_id}|${h.game}|${h.season_id}`;
      if (!firsts.has(k)) firsts.set(k, h.elo_before);
    }
    expect(firsts.size).toBeGreaterThan(0);
    expect(new Set(t.db().s2!.history.map((h) => h.season_id)).size).toBeGreaterThan(1);
    expect([...firsts.values()].every((v) => v === RATING_START_ELO)).toBe(true);
  });

  it('skillInfo: 현재 시즌 wins + losses로 w, 행이 없으면 rating 1000·skill = 티어 환산값', () => {
    const season = { id: uid(900), name: '시즌 2', starts_at: '2026-10-01T00:00:00.000Z', ends_at: '2027-01-01T00:00:00.000Z' };
    const old = { id: uid(901), name: '시즌 1', starts_at: '2026-07-01T00:00:00.000Z', ends_at: '2026-10-01T00:00:00.000Z' };
    const now = Date.parse('2026-10-28T03:00:00.000Z');
    const policy = mockEloPolicy();
    const st = {
      results: [],
      seasons: [old, season],
      ratings: [
        { user_id: uid(1), game: 'lol' as const, season_id: season.id, elo: 1000, wins: 3, losses: 2 },
        { user_id: uid(2), game: 'lol' as const, season_id: old.id, elo: 1400, wins: 20, losses: 5 },
        { user_id: uid(3), game: 'lol' as const, season_id: season.id, elo: 1400, wins: 8, losses: 7 },
      ],
      history: [],
    };
    expect(skillInfo(st, { userId: uid(1), game: 'lol', tierSeed: 1800, now, policy })).toMatchObject({ skill: 1720, rating: 1000 });
    // 지난 시즌만 많이 뛰었으면 이번 시즌 0경기 → w = 0
    expect(skillInfo(st, { userId: uid(2), game: 'lol', tierSeed: 1800, now, policy })).toMatchObject({ skill: 1800, rating: RATING_START_ELO });
    expect(skillInfo(st, { userId: uid(3), game: 'lol', tierSeed: 600, now, policy }).skill).toBe(760);
  });
});
