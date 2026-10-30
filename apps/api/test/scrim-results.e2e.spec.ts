/**
 * S3 팀 밸런스·팀 저장·결과 제출·제출 취소·승인·반려·시즌·레이팅 그래프·프로필 내전 블록 HTTP 테스트(DB 없이).
 * Nest 앱 + FakePrisma + 고정 시계(2026-10-28T03:00Z = KST 10-28 12:00). 계약: _workspace/01_architect_contract.md(S3) 4–6·13절.
 * 실제 행 잠금·advisory lock·부분 고유 인덱스 동시성은 test/db/scrim-results.db.e2e.spec.ts(PostgreSQL 필요).
 */
import {
  BalanceScrimResponse,
  GetUserProfileResponse,
  GetUserRatingHistoryResponse,
  ListScrimsResponse,
  ListSeasonsResponse,
  PROFILE_RECENT_SCRIMS_LIMIT,
  PROFILE_RECENT_SCRIMS_SCAN_LIMIT,
  ScrimDetail,
  type UserRole,
} from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Who = { token: string; userId: string };

async function login(app: TestApp, username: string, role?: UserRole): Promise<Who> {
  const res = await fetch(`${app.base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(role ? { username, role } : { username }),
  });
  const body = (await res.json()) as { access_token: string; user: { id: string } };
  return { token: body.access_token, userId: body.user.id };
}

/** 응답 원문 검사(D38): email·discord 없음 + ScrimDetail parse */
async function detailOf(res: Response, status = 200): Promise<ScrimDetail> {
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status });
  expect(text).not.toMatch(/email|discord/i);
  return ScrimDetail.parse(JSON.parse(text));
}

const getScrim = async (app: TestApp, who: Who, id: string) => detailOf(await call(app, 'GET', `/scrims/${id}`, who.token));
const balance = (app: TestApp, who: Who, id: string) => call(app, 'POST', `/scrims/${id}/balance`, who.token);
const saveTeams = (app: TestApp, who: Who, id: string, body: unknown) => call(app, 'PUT', `/scrims/${id}/teams`, who.token, body);
const submit = (app: TestApp, who: Who, id: string, body: unknown) => call(app, 'POST', `/scrims/${id}/result`, who.token, body);
const withdraw = (app: TestApp, who: Who, id: string) => call(app, 'DELETE', `/scrims/${id}/result`, who.token);
const approve = (app: TestApp, who: Who, id: string, resultId: string) =>
  call(app, 'POST', `/scrims/${id}/result/approve`, who.token, { result_id: resultId });
const reject = (app: TestApp, who: Who, id: string, resultId: string, reason = '스코어 확인 필요') =>
  call(app, 'POST', `/scrims/${id}/result/reject`, who.token, { result_id: resultId, reason });
const noShow = (app: TestApp, who: Who, id: string, userId: string, value: boolean) =>
  call(app, 'PUT', `/scrims/${id}/players/${userId}/no-show`, who.token, { no_show: value });

type SeedOpts = {
  game?: 'lol' | 'tft';
  status?: 'recruiting' | 'full' | 'playing';
  rated?: boolean;
  autoBalance?: boolean;
  usePositions?: boolean;
  capacity?: number;
  /** 사용자별 희망 포지션(기본 []) */
  prefs?: Record<string, string[]>;
};

/** 내전 행·참가자 행을 직접 심는다(방장 = 첫 슬롯, 나머지는 1초 간격 joined_at) */
function seedScrim(app: TestApp, host: Who, members: Who[], o: SeedOpts = {}): string {
  const now = app.clock.now().getTime();
  const status = o.status ?? 'playing';
  const s = app.prisma.scrim.insert({
    gameId: app.prisma.gameId(o.game ?? 'lol'),
    hostId: host.userId,
    title: '테스트 내전',
    scheduledAt: new Date(now - HOUR),
    capacity: o.capacity ?? members.length + 1,
    status,
    rated: o.rated ?? true,
    autoBalance: o.autoBalance ?? (o.game ?? 'lol') !== 'tft',
    usePositions: o.usePositions ?? false,
    startedAt: status === 'playing' ? new Date(now - 30 * MIN) : null,
  });
  [host, ...members].forEach((w, i) => {
    app.prisma.scrimPlayer.insert({
      scrimId: s.id,
      userId: w.userId,
      status: 'joined',
      preferredPositions: o.prefs?.[w.userId] ?? [],
      joinedAt: new Date(now - 2 * HOUR + i * 1000),
    });
  });
  return s.id;
}

/** 대표 lol 계정 + 솔로 랭크 스냅샷(티어 시드 D103) */
function seedTier(app: TestApp, userId: string, tier: string, game: 'lol' | 'tft' = 'lol'): void {
  const acc = app.prisma.gameAccount.insert({
    userId,
    gameId: app.prisma.gameId(game),
    externalId: `FAKE-PUUID-${userId}`,
    displayName: `user#KR1`,
    verified: true,
    isPrimary: true,
  });
  app.prisma.rankSnapshot.insert({
    gameAccountId: acc.id,
    queue: game === 'lol' ? 'RANKED_SOLO_5x5' : 'RANKED_TFT',
    tier,
    capturedAt: app.clock.now(),
  });
}

const sortIds = (ids: string[]) => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

async function four(app: TestApp) {
  const host = await login(app, 'host');
  const a = await login(app, 'alice');
  const b = await login(app, 'bob');
  const c = await login(app, 'carol');
  const admin = await login(app, 'boss', 'admin');
  return { host, a, b, c, admin };
}

// -----------------------------------------------------------------------------

describe('POST /scrims/:id/balance', () => {
  it('권한·상태·옵션 검사: 멤버 403, 없는 내전 404, 롤체 409 TEAMS_NOT_EDITABLE, 모집 중 409, auto_balance off 409 BALANCE_UNAVAILABLE', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c } = await four(t);
    const id = seedScrim(t, host, [a, b, c], { status: 'full' });
    await expectError(await balance(t, a, id), 403, 'FORBIDDEN');
    await expectError(await balance(t, host, '00000000-0000-4000-8000-000000000000'), 404, 'NOT_FOUND');
    await expectError(await balance(t, host, 'not-uuid'), 400, 'VALIDATION_FAILED');
    const tft = seedScrim(t, host, [a], { game: 'tft' });
    await expectError(await balance(t, host, tft), 409, 'SCRIM_TEAMS_NOT_EDITABLE');
    const rec = seedScrim(t, host, [a], { status: 'recruiting', capacity: 4 });
    await expectError(await balance(t, host, rec), 409, 'SCRIM_TEAMS_NOT_EDITABLE');
    const off = seedScrim(t, host, [a, b, c], { status: 'full', autoBalance: false });
    await expectError(await balance(t, host, off), 409, 'SCRIM_BALANCE_UNAVAILABLE');
    // auto_balance off여도 직접 구성은 가능(D109)
    const d = await getScrim(t, host, off);
    expect(d.viewer).toMatchObject({ can_edit_teams: true, can_balance: false });
  });

  it('노쇼로 참가 확정자 1명 → 409 BALANCE_UNAVAILABLE. 포지션 사용인데 한 팀 > 포지션 수는 core RangeError → 409', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin } = await four(t);
    const id = seedScrim(t, host, [a]);
    expect((await noShow(t, admin, id, a.userId, true)).status).toBe(200);
    await expectError(await balance(t, host, id), 409, 'SCRIM_BALANCE_UNAVAILABLE');
    expect((await getScrim(t, host, id)).viewer.can_balance).toBe(false);
  });

  it('200: 4명 → 나누기 3가지, 안 1–3개(서로 다른 나누기, 비용 오름차순), 티어 시드 반영, rating_policy = env 값, 저장 안 함', async () => {
    t = await createTestApp({ fixedClock: true, env: { SCRIM_ELO_K_BASE: '24', SCRIM_ELO_K_NEW: '30', SCRIM_ELO_NEW_PLAYER_GAMES: '5' } });
    const { host, a, b, c, admin } = await four(t);
    seedTier(t, b.userId, 'GOLD'); // 1200
    seedTier(t, c.userId, 'DIAMOND'); // 1800
    const id = seedScrim(t, host, [a, b, c], { status: 'full' });
    const res = await balance(t, admin, id);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toMatch(/email|discord|FAKE-PUUID/i);
    const body = BalanceScrimResponse.parse(JSON.parse(text));
    expect(body.player_count).toBe(4);
    expect(body.partitions_evaluated).toBe(3);
    expect(body.used_positions).toBe(false);
    expect(body.rating_policy).toEqual({ k_base: 24, k_new: 30, new_player_games: 5, full_weight_games: 10 });
    expect(body.options.map((o) => o.rank)).toEqual(body.options.map((_, i) => i + 1));
    const costs = body.options.map((o) => o.total_cost);
    expect(costs).toEqual([...costs].sort((x, y) => x - y));
    // 블루 = 슬롯 첫 참가자(방장)가 있는 쪽, 서로 다른 나누기
    for (const o of body.options) expect(o.blue.members.map((m) => m.user.id)).toContain(host.userId);
    const keys = body.options.map((o) => sortIds(o.blue.members.map((m) => m.user.id)).join(','));
    expect(new Set(keys).size).toBe(keys.length);
    // 최선안: (1000 + 1800) vs (1000 + 1200) 보다 방장+다이아 vs 나머지가 아니라 방장+다이아 짝이 전력 차 최소 → 2800 vs 2200은 600, 방장+골드 2200 vs 2800 600, 방장+alice 2000 vs 3000 1000
    expect(body.options[0]?.power_diff).toBe(600);
    const members = body.options.flatMap((o) => [...o.blue.members, ...o.orange.members]);
    expect(members.find((m) => m.user.id === c.userId)).toMatchObject({ skill: 1800, rating: 1800, is_new: true, position: null, preference: null });
    // rated → elo_preview = previewTeamElo(레이팅 평균, K = k_base 24)
    expect(body.options[0]?.blue.elo_preview).not.toBeNull();
    const top = body.options[0];
    if (!top?.blue.elo_preview || !top.orange.elo_preview) throw new Error('elo_preview');
    expect(top.blue.elo_preview.win - top.blue.elo_preview.lose).toBe(24);
    // 저장하지 않는다
    expect(t.prisma.scrimPlayer.rows.filter((p) => p.scrimId === id).every((p) => p.team === null)).toBe(true);
  });

  it('포지션 사용 롤 4명: used_positions true, 팀원 position·preference, rated=false면 elo_preview null', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c } = await four(t);
    const prefs = { [host.userId]: ['mid'], [a.userId]: ['top', 'mid'], [b.userId]: ['bot'], [c.userId]: ['support', 'bot'] };
    const id = seedScrim(t, host, [a, b, c], { status: 'full', usePositions: true, prefs, rated: false });
    const body = BalanceScrimResponse.parse(await (await balance(t, host, id)).json());
    expect(body.used_positions).toBe(true);
    for (const o of body.options) {
      for (const m of [...o.blue.members, ...o.orange.members]) {
        expect(m.position).not.toBeNull();
        expect(m.preference).not.toBeNull();
      }
      expect(o.blue.elo_preview).toBeNull();
    }
    expect(body.options[0]?.position_cost).toBe(0);
  });
});

describe('PUT /scrims/:id/teams', () => {
  it('서버 검사 400(남의 user_id·노쇼·포지션 누락/범위 밖), zod 400(팀 내 포지션 중복), 미배정 허용 → balance.unassigned_user_ids', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const outsider = await login(t, 'outsider');
    const prefs = { [host.userId]: ['mid'], [a.userId]: ['top'], [b.userId]: ['bot'], [c.userId]: ['support'] };
    const id = seedScrim(t, host, [a, b, c], { usePositions: true, prefs });
    await noShow(t, admin, id, c.userId, true);

    let err = await expectError(
      await saveTeams(t, host, id, {
        blue: [{ user_id: host.userId, position: 'mid' }, { user_id: outsider.userId, position: 'top' }],
        orange: [{ user_id: c.userId, position: 'bot' }, { user_id: b.userId }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details?.map((d) => d.path)).toEqual(['blue.1.user_id', 'orange.0.user_id', 'orange.1.position']);
    err = await expectError(
      await saveTeams(t, host, id, { blue: [{ user_id: host.userId, position: 'adc' }], orange: [{ user_id: b.userId, position: 'bot' }] }),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details?.map((d) => d.path)).toEqual(['blue.0.position']);
    err = await expectError(
      await saveTeams(t, host, id, {
        blue: [{ user_id: host.userId, position: 'mid' }, { user_id: a.userId, position: 'mid' }],
        orange: [{ user_id: b.userId, position: 'bot' }],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details?.map((d) => d.path)).toEqual(['blue.1.position']);

    // 미배정(a) 허용, 운영진 저장, 상태 전이 없음
    const d = await detailOf(
      await saveTeams(t, admin, id, { blue: [{ user_id: host.userId, position: 'mid' }], orange: [{ user_id: b.userId, position: 'bot' }] }),
    );
    expect(d.status).toBe('playing');
    const by = new Map(d.players.map((p) => [p.user.id, p]));
    expect(by.get(host.userId)).toMatchObject({ team: 'blue', position: 'mid', position_preference: 'first' });
    expect(by.get(b.userId)).toMatchObject({ team: 'orange', position: 'bot', position_preference: 'first' });
    expect(by.get(a.userId)).toMatchObject({ team: null, position: null, position_preference: null });
    expect(d.balance).toMatchObject({
      blue: { size: 1, skill_sum: 1000, skill_avg: 1000, rating_avg: 1000, position_cost: 0, elo_preview: { win: 16, lose: -16 } },
      orange: { size: 1 },
      blue_win_probability: 0.5,
      power_diff: 0,
      position_cost: 0,
      unassigned_user_ids: [a.userId],
    });
    // 내전 행 잠금
    expect(t.prisma.rawCalls.some((r) => /FOR UPDATE/.test(r.sql) && r.values[0] === id)).toBe(true);
  });

  it('멤버 403, 다시 저장하면 전체 덮어쓰기(이전 배정 해제), 결과 pending 뒤 409, 포지션 미사용 내전에 position → 400', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c } = await four(t);
    const id = seedScrim(t, host, [a, b, c], { autoBalance: false });
    const teams = { blue: [{ user_id: host.userId }, { user_id: a.userId }], orange: [{ user_id: b.userId }, { user_id: c.userId }] };
    await expectError(await saveTeams(t, a, id, teams), 403, 'FORBIDDEN');
    const err = await expectError(
      await saveTeams(t, host, id, { blue: [{ user_id: host.userId, position: 'mid' }], orange: [{ user_id: b.userId }] }),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details?.[0]?.path).toBe('blue.0.position');
    await detailOf(await saveTeams(t, host, id, teams));
    const d2 = await detailOf(await saveTeams(t, host, id, { blue: [{ user_id: c.userId }], orange: [{ user_id: a.userId }] }));
    expect(d2.players.map((p) => p.team)).toEqual([null, 'orange', null, 'blue']);
    expect(d2.balance?.unassigned_user_ids).toEqual([host.userId, b.userId]);
    await detailOf(await submit(t, host, id, { winner_team: 'blue' }));
    await expectError(await saveTeams(t, host, id, teams), 409, 'SCRIM_TEAMS_NOT_EDITABLE');
    await expectError(await balance(t, host, id), 409, 'SCRIM_TEAMS_NOT_EDITABLE');
  });
});

describe('POST·DELETE /scrims/:id/result', () => {
  it('playing 아님 409, 팀 미구성 409 TEAMS_REQUIRED, 모양 불일치 400, 멤버 403, 운영진 대리 제출, 중복 409', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const full = seedScrim(t, host, [a, b, c], { status: 'full' });
    await expectError(await submit(t, host, full, { winner_team: 'blue' }), 409, 'SCRIM_RESULT_NOT_ALLOWED');
    const id = seedScrim(t, host, [a, b, c]);
    await expectError(await submit(t, a, id, { winner_team: 'blue' }), 403, 'FORBIDDEN');
    await expectError(await submit(t, host, id, { winner_team: 'blue' }), 409, 'SCRIM_TEAMS_REQUIRED');
    const shape = await expectError(
      await submit(t, host, id, { placements: [{ user_id: host.userId, placement: 1 }, { user_id: a.userId, placement: 2 }] }),
      400,
      'VALIDATION_FAILED',
    );
    expect(shape.details).toEqual([{ path: 'placements', message: expect.any(String) }]);
    await expectError(await submit(t, host, id, { winner_team: 'red' }), 400, 'VALIDATION_FAILED');
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: b.userId }] });
    expect((await getScrim(t, host, id)).viewer.can_submit_result).toBe(true);

    const d = await detailOf(await submit(t, admin, id, { winner_team: 'orange' }));
    expect(d.status).toBe('playing');
    expect(d.result_status).toBe('pending');
    expect(d.result).toMatchObject({
      status: 'pending',
      winner_team: 'orange',
      placements: [],
      submitted_by: { id: admin.userId, nickname: 'boss' },
      submitted_at: t.clock.now().toISOString(),
      approved_by: null,
      rejected_by: null,
      rating_status: 'waiting',
      season: null,
      rating_changes: [],
    });
    // 운영진 본인 제출: 승인 불가 표시, 방장은 제출 취소 가능
    expect(d.viewer).toMatchObject({ can_review_result: false, can_withdraw_result: true, can_submit_result: false, can_edit_teams: false });
    expect((await getScrim(t, host, id)).viewer).toMatchObject({ can_withdraw_result: true, can_review_result: false });
    await expectError(await submit(t, host, id, { winner_team: 'blue' }), 409, 'SCRIM_RESULT_EXISTS');
    expect(t.prisma.scrimResult.rows.filter((r) => r.scrimId === id)).toHaveLength(1);
  });

  it('개인 순위(롤체): winner_team 모양 400, 비참가자·노쇼 400 path placements.{i}.user_id, 빠진 참가자 허용', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const outsider = await login(t, 'outsider');
    const id = seedScrim(t, host, [a, b, c], { game: 'tft' });
    expect((await getScrim(t, host, id)).viewer).toMatchObject({ can_submit_result: true, can_edit_teams: false, can_balance: false });
    const shape = await expectError(await submit(t, host, id, { winner_team: 'blue' }), 400, 'VALIDATION_FAILED');
    expect(shape.details?.[0]?.path).toBe('winner_team');
    await noShow(t, admin, id, c.userId, true);
    const err = await expectError(
      await submit(t, host, id, {
        placements: [
          { user_id: host.userId, placement: 1 },
          { user_id: outsider.userId, placement: 2 },
          { user_id: c.userId, placement: 3 },
        ],
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(err.details?.map((x) => x.path)).toEqual(['placements.1.user_id', 'placements.2.user_id']);
    // 동순위 → zod 400
    await expectError(
      await submit(t, host, id, { placements: [{ user_id: host.userId, placement: 1 }, { user_id: a.userId, placement: 1 }] }),
      400,
      'VALIDATION_FAILED',
    );
    const d = await detailOf(
      await submit(t, host, id, { placements: [{ user_id: a.userId, placement: 2 }, { user_id: host.userId, placement: 1 }] }),
    );
    expect(d.result?.placements.map((p) => [p.user.id, p.placement])).toEqual([
      [host.userId, 1],
      [a.userId, 2],
    ]);
    expect(d.result?.winner_team).toBeNull();
  });

  it('제출 취소: pending 없음 409, 제출자·방장 아님 403, 방장은 운영진 제출도 취소, 행 삭제 후 재제출 가능', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, admin } = await four(t);
    const other = await login(t, 'boss2', 'admin');
    const id = seedScrim(t, host, [a, b]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    await expectError(await withdraw(t, host, id), 409, 'SCRIM_RESULT_NOT_PENDING');
    await detailOf(await submit(t, admin, id, { winner_team: 'blue' }));
    await expectError(await withdraw(t, a, id), 403, 'FORBIDDEN');
    await expectError(await withdraw(t, other, id), 403, 'FORBIDDEN');
    const d = await detailOf(await withdraw(t, host, id));
    expect(d).toMatchObject({ result: null, result_status: null, status: 'playing' });
    expect(d.viewer.can_edit_teams).toBe(true);
    expect(t.prisma.scrimResult.rows).toHaveLength(0);
    await detailOf(await submit(t, host, id, { winner_team: 'orange' }));
    expect((await detailOf(await withdraw(t, host, id))).result).toBeNull();
  });
});

describe('POST /scrims/:id/result/approve', () => {
  it('비운영진 403(없는 내전이어도 FORBIDDEN 먼저), 자기 제출 403 SELF_REVIEW(방장인 운영진도), result_id 불일치·pending 없음 409', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, admin } = await four(t);
    const id = seedScrim(t, admin, [a, b]);
    await saveTeams(t, admin, id, { blue: [{ user_id: admin.userId }], orange: [{ user_id: a.userId }] });
    await expectError(await approve(t, host, '00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000000'), 403, 'FORBIDDEN');
    const d = await detailOf(await submit(t, admin, id, { winner_team: 'blue' }));
    const rid = d.result?.id as string;
    await expectError(await approve(t, host, id, rid), 403, 'FORBIDDEN');
    await expectError(await approve(t, admin, id, rid), 403, 'SCRIM_RESULT_SELF_REVIEW');
    await expectError(await reject(t, admin, id, rid), 403, 'SCRIM_RESULT_SELF_REVIEW');
    const other = await login(t, 'boss2', 'admin');
    await expectError(await approve(t, other, id, '00000000-0000-4000-8000-000000000000'), 409, 'SCRIM_RESULT_NOT_PENDING');
    await expectError(await approve(t, other, '00000000-0000-4000-8000-000000000000', rid), 404, 'NOT_FOUND');
    await expectError(await call(t, 'POST', `/scrims/${id}/result/approve`, other.token, {}), 400, 'VALIDATION_FAILED');
    expect((await getScrim(t, other, id)).viewer.can_review_result).toBe(true);
    expect((await getScrim(t, admin, id)).viewer.can_review_result).toBe(false);
    expect(t.prisma.scrim.rows.find((s) => s.id === id)?.status).toBe('playing');
  });

  it('rated 팀 게임: 시즌 자동 생성(시즌 1, KST 10월 1일 ~ 3개월), 시드 행(GOLD 1200), ELO·이력·k_factor·wins/losses, finished, 잠금 순서', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    seedTier(t, b.userId, 'GOLD');
    const id = seedScrim(t, host, [a, b, c]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }, { user_id: a.userId }], orange: [{ user_id: b.userId }, { user_id: c.userId }] });
    const pending = await detailOf(await submit(t, host, id, { winner_team: 'blue' }));
    expect(pending.players.find((p) => p.user.id === b.userId)).toMatchObject({ skill: 1200, is_new: true });
    t.prisma.rawCalls = [];

    const d = await detailOf(await approve(t, admin, id, pending.result?.id as string));
    const now = t.clock.now().toISOString();
    // 잠금 순서: 내전 행 → 시즌 생성 advisory → 사용자별(user_id 오름차순)
    const locks = t.prisma.rawCalls.filter((r) => /FOR UPDATE|pg_advisory_xact_lock/.test(r.sql));
    expect(locks[0]?.sql).toMatch(/FOR UPDATE/);
    expect(locks[1]?.values).toEqual(['season-auto-create']);
    const lolId = t.prisma.gameId('lol');
    expect(locks.slice(2).map((r) => r.values)).toEqual(
      sortIds([host.userId, a.userId, b.userId, c.userId]).map((u) => [`rating:${lolId}`, u]),
    );

    const seasons = t.prisma.season.rows;
    expect(seasons).toHaveLength(1);
    expect(seasons[0]).toMatchObject({
      name: '시즌 1',
      startsAt: new Date('2026-09-30T15:00:00.000Z'),
      endsAt: new Date('2026-12-31T15:00:00.000Z'),
    });
    // blue 평균 1000 vs orange 평균 1100, K 40(신규) → E_blue 0.360 → 승 +26 / 패 −26
    expect(d).toMatchObject({ status: 'finished', result_status: 'approved', outcome: { winner_team: 'blue', winner: null } });
    expect(d.result).toMatchObject({
      status: 'approved',
      approved_by: { id: admin.userId },
      approved_at: now,
      rating_status: 'applied',
      season: { name: '시즌 1', starts_at: '2026-09-30T15:00:00.000Z', ends_at: '2026-12-31T15:00:00.000Z' },
    });
    const changes = d.result?.rating_changes ?? [];
    expect(changes.map((x) => x.delta)).toEqual([26, 26, -26, -26]);
    expect(changes.map((x) => x.user.id).slice(0, 2)).toEqual(sortIds([host.userId, a.userId]));
    expect(changes.find((x) => x.user.id === b.userId)).toMatchObject({
      team: 'orange',
      placement: null,
      outcome: 'loss',
      elo_before: 1200,
      elo_after: 1174,
      k_factor: 40,
    });
    expect(changes.find((x) => x.user.id === host.userId)).toMatchObject({ team: 'blue', outcome: 'win', elo_before: 1000, elo_after: 1026 });
    const ratings = t.prisma.rating.rows;
    expect(ratings).toHaveLength(4);
    expect(ratings.find((r) => r.userId === host.userId)).toMatchObject({ elo: 1026, wins: 1, losses: 0 });
    expect(ratings.find((r) => r.userId === b.userId)).toMatchObject({ elo: 1174, wins: 0, losses: 1 });
    const hist = t.prisma.ratingHistory.rows;
    expect(hist).toHaveLength(4);
    expect(hist.every((h) => h.kFactor === 40 && h.createdAt.toISOString() === now && h.scrimResultId === d.result?.id)).toBe(true);
    // 이중 승인 → 409, 이력 그대로
    await expectError(await approve(t, admin, id, d.result?.id as string), 409, 'SCRIM_RESULT_NOT_PENDING');
    expect(t.prisma.ratingHistory.rows).toHaveLength(4);
    // 승인 뒤: 팀·결과 변경 불가, 상세 skill = 시즌 elo 기반
    expect(d.viewer).toMatchObject({ can_edit_teams: false, can_submit_result: false, can_withdraw_result: false, can_review_result: false });
    await expectError(await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: b.userId }] }), 409, 'SCRIM_TEAMS_NOT_EDITABLE');
    await expectError(await withdraw(t, host, id), 409, 'SCRIM_RESULT_NOT_PENDING');
    // 목록 종료 탭 outcome
    const list = ListScrimsResponse.parse(await (await call(t, 'GET', '/scrims?status=ended', host.token)).json());
    expect(list.items[0]).toMatchObject({ id, result_status: 'approved', outcome: { winner_team: 'blue', winner: null } });
  });

  it('같은 결과 동시 승인 2건(FakePrisma 직렬화) → 1건 200, 1건 409, 이력 중복 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin } = await four(t);
    const other = await login(t, 'boss2', 'admin');
    const id = seedScrim(t, host, [a]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'orange' }))).result?.id as string;
    const [r1, r2] = await Promise.all([approve(t, admin, id, rid), approve(t, other, id, rid)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(t.prisma.ratingHistory.rows).toHaveLength(2);
    expect(t.prisma.season.rows).toHaveLength(1);
  });

  it('rated=false → 레이팅·이력·시즌 없음, finished, not_rated', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin } = await four(t);
    const id = seedScrim(t, host, [a], { rated: false });
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
    const d = await detailOf(await approve(t, admin, id, rid));
    expect(d.status).toBe('finished');
    expect(d.result).toMatchObject({ status: 'approved', rating_status: 'not_rated', rating_changes: [], season: null });
    expect(t.prisma.rating.rows).toHaveLength(0);
    expect(t.prisma.ratingHistory.rows).toHaveLength(0);
    expect(t.prisma.season.rows).toHaveLength(0);
  });

  it('노쇼·미배정 제외, 한 팀 전원 노쇼 → skipped·finished(레이팅 불변)', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const id = seedScrim(t, host, [a, b, c]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }, { user_id: a.userId }], orange: [{ user_id: b.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
    // 제출 뒤 노쇼 표시(기한 안): a 제외, c는 미배정
    await noShow(t, admin, id, a.userId, true);
    const d = await detailOf(await approve(t, admin, id, rid));
    expect(d.result?.rating_status).toBe('applied');
    expect(d.result?.rating_changes.map((x) => x.user.id).sort()).toEqual(sortIds([host.userId, b.userId]));
    expect(t.prisma.ratingHistory.rows.map((h) => h.userId)).not.toContain(a.userId);
    expect(t.prisma.ratingHistory.rows.map((h) => h.userId)).not.toContain(c.userId);
    // 1000 vs 1000, K 40 → ±20
    expect(d.result?.rating_changes.map((x) => x.delta)).toEqual([20, -20]);

    const id2 = seedScrim(t, host, [a, b]);
    await saveTeams(t, host, id2, { blue: [{ user_id: host.userId }], orange: [{ user_id: b.userId }] });
    const rid2 = (await detailOf(await submit(t, host, id2, { winner_team: 'blue' }))).result?.id as string;
    await noShow(t, admin, id2, b.userId, true);
    const before = t.prisma.rating.rows.map((r) => ({ ...r }));
    const d2 = await detailOf(await approve(t, admin, id2, rid2));
    expect(d2).toMatchObject({ status: 'finished', result: { rating_status: 'skipped', rating_changes: [], season: null } });
    expect(t.prisma.rating.rows).toEqual(before);
    expect(t.prisma.ratingHistory.rows.filter((h) => h.scrimId === id2)).toHaveLength(0);
  });

  it('개인 순위 4명 동일 1000, K 40 → +20 / +7 / −7 / −20, 상위 절반 win, 목록 outcome winner = 1위', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const id = seedScrim(t, host, [a, b, c], { game: 'tft' });
    const rid = (
      await detailOf(
        await submit(t, host, id, {
          placements: [
            { user_id: b.userId, placement: 1 },
            { user_id: host.userId, placement: 2 },
            { user_id: a.userId, placement: 3 },
            { user_id: c.userId, placement: 4 },
          ],
        }),
      )
    ).result?.id as string;
    const d = await detailOf(await approve(t, admin, id, rid));
    expect(d.result?.rating_changes.map((x) => [x.user.id, x.placement, x.outcome, x.delta, x.team])).toEqual([
      [b.userId, 1, 'win', 20, null],
      [host.userId, 2, 'win', 7, null],
      [a.userId, 3, 'loss', -7, null],
      [c.userId, 4, 'loss', -20, null],
    ]);
    expect(d.outcome).toEqual({ winner_team: null, winner: expect.objectContaining({ id: b.userId, nickname: 'bob' }) });
    expect(t.prisma.rating.rows.find((r) => r.userId === host.userId)).toMatchObject({ elo: 1007, wins: 1, losses: 0 });
  });

  it('개인 순위: 제출 뒤 노쇼 → 반영 대상 3명으로 다시 매김(1..3), 노쇼 제외', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const id = seedScrim(t, host, [a, b, c], { game: 'tft' });
    const rid = (
      await detailOf(
        await submit(t, host, id, {
          placements: [
            { user_id: b.userId, placement: 1 },
            { user_id: host.userId, placement: 2 },
            { user_id: a.userId, placement: 3 },
            { user_id: c.userId, placement: 4 },
          ],
        }),
      )
    ).result?.id as string;
    await noShow(t, admin, id, host.userId, true);
    const d = await detailOf(await approve(t, admin, id, rid));
    expect(d.result?.rating_changes.map((x) => [x.user.id, x.placement, x.outcome])).toEqual([
      [b.userId, 1, 'win'],
      [a.userId, 2, 'loss'],
      [c.userId, 3, 'loss'],
    ]);
    // 결과 placements는 제출 그대로(4명)
    expect(d.result?.placements).toHaveLength(4);
  });

  it('기존 시즌이 있으면 그 시즌에 반영(생성·시즌 잠금 없음), 시즌이 바뀌면 새 시드 행. K는 시즌과 무관한 (user, game) 이력 수로(지난 시즌 1경기 + 신규 기준 1 → 32)', async () => {
    t = await createTestApp({ fixedClock: true, env: { SCRIM_ELO_NEW_PLAYER_GAMES: '1' } });
    const { host, a, admin } = await four(t);
    const s1 = t.prisma.season.insert({ name: '프리시즌', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-11-01T00:00:00Z') });
    const lolId = t.prisma.gameId('lol');
    t.prisma.rating.insert({ userId: host.userId, gameId: lolId, seasonId: s1.id, elo: 1100, wins: 3, losses: 1 });
    // 지난 시즌 이력 1행(경기 수 1 → 신규 기준 1 이상이면 K 32)
    t.prisma.ratingHistory.insert({
      userId: host.userId,
      scrimId: '00000000-0000-4000-8000-000000000001',
      scrimResultId: '00000000-0000-4000-8000-000000000002',
      gameId: lolId,
      seasonId: '00000000-0000-4000-8000-000000000003',
      eloBefore: 1000,
      eloAfter: 1016,
      kFactor: 40,
    });
    const id = seedScrim(t, host, [a]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'orange' }))).result?.id as string;
    t.prisma.rawCalls = [];
    const d = await detailOf(await approve(t, admin, id, rid));
    expect(t.prisma.rawCalls.some((r) => r.values[0] === 'season-auto-create')).toBe(false);
    expect(t.prisma.season.rows).toHaveLength(1);
    expect(d.result?.season?.id).toBe(s1.id);
    const hostChange = d.result?.rating_changes.find((x) => x.user.id === host.userId);
    // 1100 vs 1000(시드), E = 0.640. host K 32 → round(32 × −0.640) = −20, alice K 40 → round(40 × 0.640) = +26
    expect(hostChange).toMatchObject({ elo_before: 1100, elo_after: 1080, k_factor: 32 });
    expect(d.result?.rating_changes.find((x) => x.user.id === a.userId)).toMatchObject({ elo_before: 1000, delta: 26, k_factor: 40 });
    expect(t.prisma.rating.rows.find((r) => r.userId === host.userId)).toMatchObject({ elo: 1080, wins: 3, losses: 2 });
  });
});

describe('POST /scrims/:id/result/reject', () => {
  it('사유 필수(2–200자) 400, 반려 → playing 유지·rejected 표시·팀 수정·재제출 재개, 최근 결과는 새 pending', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin } = await four(t);
    const id = seedScrim(t, host, [a]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
    await expectError(await call(t, 'POST', `/scrims/${id}/result/reject`, admin.token, { result_id: rid }), 400, 'VALIDATION_FAILED');
    await expectError(await reject(t, admin, id, rid, ' a '), 400, 'VALIDATION_FAILED');
    await expectError(await reject(t, host, id, rid), 403, 'FORBIDDEN');
    const d = await detailOf(await reject(t, admin, id, rid, '  스코어가   다릅니다 '));
    expect(d).toMatchObject({ status: 'playing', result_status: 'rejected' });
    expect(d.result).toMatchObject({
      id: rid,
      status: 'rejected',
      rejected_by: { id: admin.userId },
      rejected_at: t.clock.now().toISOString(),
      reject_reason: '스코어가 다릅니다',
      rating_status: 'waiting',
    });
    expect((await getScrim(t, host, id)).viewer).toMatchObject({ can_edit_teams: true, can_submit_result: true, can_withdraw_result: false });
    await expectError(await reject(t, admin, id, rid), 409, 'SCRIM_RESULT_NOT_PENDING');
    await expectError(await approve(t, admin, id, rid), 409, 'SCRIM_RESULT_NOT_PENDING');
    await detailOf(await saveTeams(t, host, id, { blue: [{ user_id: a.userId }], orange: [{ user_id: host.userId }] }));
    t.clock.advance(1000);
    const again = await detailOf(await submit(t, host, id, { winner_team: 'orange' }));
    expect(again.result).toMatchObject({ status: 'pending', winner_team: 'orange' });
    expect(again.result?.id).not.toBe(rid);
    expect(t.prisma.scrimResult.rows).toHaveLength(2);
  });
});

describe('S2 경로 보완(5-1): 명단이 바뀌면 팀 초기화', () => {
  it('참가 확정자 취소(승격 포함) → 전원 team·position null, 대기자 취소는 그대로, 노쇼 표시는 그대로', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const w = await login(t, 'waiter');
    // 시작 시각이 미래인 full 내전 + 대기 1명
    const id = seedScrim(t, host, [a, b, c], { status: 'full', capacity: 4 });
    const row = t.prisma.scrim.rows.find((s) => s.id === id);
    if (row) row.scheduledAt = new Date(t.clock.now().getTime() + DAY);
    expect((await call(t, 'POST', `/scrims/${id}/join`, w.token, { preferred_positions: [] })).status).toBe(200);
    const teams = { blue: [{ user_id: host.userId }, { user_id: a.userId }], orange: [{ user_id: b.userId }, { user_id: c.userId }] };
    await detailOf(await saveTeams(t, host, id, teams));
    // 대기자 취소 → joined 집합 그대로 → 팀 유지
    let d = await detailOf(await call(t, 'DELETE', `/scrims/${id}/join`, w.token));
    expect(d.players.every((p) => p.team !== null)).toBe(true);
    expect(d.balance).not.toBeNull();
    // 다시 대기 → 확정자 취소(대기 승격) → 전원 초기화
    await call(t, 'POST', `/scrims/${id}/join`, w.token, { preferred_positions: [] });
    d = await detailOf(await call(t, 'DELETE', `/scrims/${id}/join`, c.token));
    expect(d.players.map((p) => p.user.id)).toContain(w.userId);
    expect(d.players.every((p) => p.team === null && p.position === null)).toBe(true);
    expect(d.balance).toBeNull();
    expect(t.prisma.scrimPlayer.rows.filter((p) => p.scrimId === id).every((p) => p.team === null)).toBe(true);

    // 노쇼 표시는 팀을 지우지 않는다(playing 내전)
    const p = seedScrim(t, host, [a, b]);
    await saveTeams(t, host, p, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }, { user_id: b.userId }] });
    const n = await detailOf(await noShow(t, admin, p, b.userId, true));
    expect(n.players.find((x) => x.user.id === b.userId)?.team).toBe('orange');
    expect(n.balance?.orange.size).toBe(1);
  });

  it('정원 확대로 대기 승격 → 팀 초기화, 승격 없는 정원 수정은 그대로', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c } = await four(t);
    const w = await login(t, 'waiter');
    const id = seedScrim(t, host, [a, b, c], { status: 'full', capacity: 4 });
    const row = t.prisma.scrim.rows.find((s) => s.id === id);
    if (row) row.scheduledAt = new Date(t.clock.now().getTime() + DAY);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    let d = await detailOf(await call(t, 'PATCH', `/scrims/${id}`, host.token, { title: '제목만 변경' }));
    expect(d.balance).not.toBeNull();
    await call(t, 'POST', `/scrims/${id}/join`, w.token, { preferred_positions: [] });
    d = await detailOf(await call(t, 'PATCH', `/scrims/${id}`, host.token, { capacity: 6 }));
    expect(d.players).toHaveLength(5);
    expect(d.players.every((p) => p.team === null)).toBe(true);
  });
});

describe('GET /seasons, GET /users/:id/rating-history, 프로필 scrim', () => {
  it('/seasons: starts_at DESC, is_current 1개, next_cursor null', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host } = await four(t);
    const old = t.prisma.season.insert({ name: '시즌 1', startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2026-04-01T00:00:00Z') });
    const cur = t.prisma.season.insert({ name: '시즌 2', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z') });
    const body = ListSeasonsResponse.parse(await (await call(t, 'GET', '/seasons', host.token)).json());
    expect(body.next_cursor).toBeNull();
    expect(body.items.map((s) => [s.id, s.is_current])).toEqual([
      [cur.id, true],
      [old.id, false],
    ]);
    await expectError(await call(t, 'GET', '/seasons'), 401, 'UNAUTHENTICATED');
  });

  it('그래프: 시즌 없음 → 빈 응답, 기본 시즌 = 현재 → 없으면 최근 시작 시즌, 없는 season 404, 사용자 404, game 필수 400, 100점 + truncated', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a } = await four(t);
    const url = (uid: string, q: string) => `/users/${uid}/rating-history?${q}`;
    const empty = GetUserRatingHistoryResponse.parse(await (await call(t, 'GET', url(a.userId, 'game=lol'), host.token)).json());
    expect(empty).toEqual({ game: 'lol', season: null, rating: null, points: [], truncated: false });
    await expectError(await call(t, 'GET', url(a.userId, ''), host.token), 400, 'VALIDATION_FAILED');
    await expectError(await call(t, 'GET', url('00000000-0000-4000-8000-000000000000', 'game=lol'), host.token), 404, 'NOT_FOUND');
    await expectError(await call(t, 'GET', url(a.userId, 'game=lol&season=00000000-0000-4000-8000-000000000000'), host.token), 404, 'NOT_FOUND');

    // 끝난 시즌만 있음 → latestStartedSeason
    const past = t.prisma.season.insert({ name: '시즌 1', startsAt: new Date('2026-06-01T00:00:00Z'), endsAt: new Date('2026-09-01T00:00:00Z') });
    const lolId = t.prisma.gameId('lol');
    const scrimId = seedScrim(t, host, [a], { status: 'playing' });
    const base = new Date('2026-07-01T00:00:00Z').getTime();
    for (let i = 0; i < 101; i++) {
      t.prisma.ratingHistory.insert({
        userId: a.userId,
        scrimId: i === 100 ? scrimId : `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        scrimResultId: '00000000-0000-4000-9000-000000000000',
        gameId: lolId,
        seasonId: past.id,
        eloBefore: 1000 + i,
        eloAfter: 1001 + i,
        kFactor: 40,
        createdAt: new Date(base + i * MIN),
      });
    }
    t.prisma.rating.insert({ userId: a.userId, gameId: lolId, seasonId: past.id, elo: 1101, wins: 60, losses: 41 });
    const r = GetUserRatingHistoryResponse.parse(await (await call(t, 'GET', url(a.userId, 'game=lol'), host.token)).json());
    expect(r.season?.id).toBe(past.id);
    expect(r.truncated).toBe(true);
    expect(r.points).toHaveLength(100);
    expect(r.points[0]?.elo_before).toBe(1001);
    expect(r.points.at(-1)).toMatchObject({ scrim_id: scrimId, scrim_title: '테스트 내전', elo_after: 1101, delta: 1 });
    expect(r.rating).toEqual({ elo: 1101, wins: 60, losses: 41, games: 101, win_rate: 0.594 });
    // 다른 게임은 점 없음
    const tft = GetUserRatingHistoryResponse.parse(await (await call(t, 'GET', url(a.userId, 'game=tft'), host.token)).json());
    expect(tft).toMatchObject({ game: 'tft', season: { id: past.id }, rating: null, points: [], truncated: false });
  });

  it('프로필 scrim: 승인 후 현재 시즌 레이팅 카드·최근 내전(win/loss/no_show/unassigned, elo_delta), 비공개 필드 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c, admin } = await four(t);
    const id = seedScrim(t, host, [a, b, c]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }, { user_id: b.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
    await noShow(t, admin, id, b.userId, true);
    await approve(t, admin, id, rid);

    const prof = async (uid: string) => {
      const res = await call(t as TestApp, 'GET', `/users/${uid}/profile`, a.token);
      const text = await res.text();
      expect(text).not.toMatch(/email|discord_id/);
      return GetUserProfileResponse.parse(JSON.parse(text));
    };
    const ph = await prof(host.userId);
    expect(ph.scrim?.season).toMatchObject({ name: '시즌 1' });
    expect(ph.scrim?.ratings).toEqual([{ game: 'lol', elo: 1020, wins: 1, losses: 0, games: 1, win_rate: 1 }]);
    expect(ph.scrim?.recent).toEqual([
      {
        scrim_id: id,
        title: '테스트 내전',
        game: 'lol',
        finished_at: t.clock.now().toISOString(),
        rated: true,
        team: 'blue',
        position: null,
        placement: null,
        outcome: 'win',
        elo_delta: 20,
      },
    ]);
    expect((await prof(a.userId)).scrim?.recent[0]).toMatchObject({ outcome: 'loss', elo_delta: -20, team: 'orange' });
    expect((await prof(b.userId)).scrim?.recent[0]).toMatchObject({ outcome: 'no_show', elo_delta: null });
    expect((await prof(b.userId)).scrim?.ratings).toEqual([]);
    expect((await prof(c.userId)).scrim?.recent[0]).toMatchObject({ outcome: 'unassigned', team: null, elo_delta: null });
  });
});

describe('상세 viewer can_* 조합', () => {
  it('모집 중: 팀·결과 버튼 없음 / full 방장: can_edit_teams·can_balance / 멤버: 모두 false', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c } = await four(t);
    const rec = seedScrim(t, host, [a], { status: 'recruiting', capacity: 4 });
    expect((await getScrim(t, host, rec)).viewer).toMatchObject({
      can_edit_teams: false,
      can_balance: false,
      can_submit_result: false,
      can_withdraw_result: false,
      can_review_result: false,
    });
    const full = seedScrim(t, host, [a, b, c], { status: 'full' });
    expect((await getScrim(t, host, full)).viewer).toMatchObject({ can_edit_teams: true, can_balance: true, can_submit_result: false });
    expect((await getScrim(t, a, full)).viewer).toMatchObject({ can_edit_teams: false, can_balance: false });
    const d = await getScrim(t, a, full);
    expect(d.players.map((p) => [p.skill, p.is_new, p.position_preference])).toEqual(Array(4).fill([1000, true, null]));
    expect(d).toMatchObject({ balance: null, result: null, result_status: null, outcome: null });
  });
});

describe('QA minor 1–3 반영', () => {
  it('(1) now = 사용자 잠금을 모두 얻은 직후: 잠금 대기 중 시즌이 끝나면 그 뒤 시각으로 판정·자동 생성, created_at = approved_at = 그 시각', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin } = await four(t);
    const T = t.clock.now().getTime();
    // 지금 시즌은 10초 뒤 끝난다(트랜잭션 timeout 15초 안) → 시즌 생성 잠금을 미리 잡아야 한다
    const s1 = t.prisma.season.insert({ name: '시즌 1', startsAt: new Date(T - DAY), endsAt: new Date(T + 10_000) });
    const id = seedScrim(t, host, [a]);
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
    t.prisma.rawCalls = [];
    // 사용자 레이팅 잠금을 얻기 전에는 T, 얻은 뒤에는 T + 20초(잠금 대기 동안 시즌 경계를 넘은 상황)
    const clock = t.clock;
    const prisma = t.prisma;
    clock.now = () => new Date(prisma.rawCalls.some((r) => String(r.values[0]).startsWith('rating:')) ? T + 20_000 : T);
    const d = await detailOf(await approve(t, admin, id, rid));
    const after = new Date(T + 20_000).toISOString();
    const lockOrder = t.prisma.rawCalls
      .filter((r) => /FOR UPDATE|pg_advisory_xact_lock/.test(r.sql))
      .map((r) => (/FOR UPDATE/.test(r.sql) ? 'scrim' : String(r.values[0]).startsWith('rating:') ? 'user' : r.values[0]));
    expect(lockOrder).toEqual(['scrim', 'season-auto-create', 'user', 'user']);
    expect(d.result?.approved_at).toBe(after);
    expect(t.prisma.ratingHistory.rows.map((h) => h.createdAt.toISOString())).toEqual([after, after]);
    const created = t.prisma.season.rows.find((s) => s.id !== s1.id);
    expect(created).toMatchObject({ name: '시즌 2', startsAt: new Date(T + 10_000) });
    expect(d.result?.season?.id).toBe(created?.id);
    expect(t.prisma.ratingHistory.rows.every((h) => h.seasonId === created?.id)).toBe(true);
  });

  it('(1) 레이팅 반영 없는 승인(rated=false)도 approved_at = 내전 잠금 뒤 시각', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, admin } = await four(t);
    const id = seedScrim(t, host, [a], { rated: false });
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
    const T = t.clock.now().getTime();
    const prisma = t.prisma;
    prisma.rawCalls = [];
    t.clock.now = () => new Date(prisma.rawCalls.some((r) => /FOR UPDATE/.test(r.sql)) ? T + 5_000 : T);
    const d = await detailOf(await approve(t, admin, id, rid));
    expect(d.result?.approved_at).toBe(new Date(T + 5_000).toISOString());
  });

  it('(2) 내전 쓰기 트랜잭션 timeout 15초·maxWait 5초, 승인은 READ COMMITTED 추가', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, admin } = await four(t);
    const id = seedScrim(t, host, [a, b], { status: 'playing' });
    const seen: unknown[] = [];
    const prisma = t.prisma;
    const orig = prisma.$transaction.bind(prisma);
    (prisma as unknown as { $transaction: (fn: unknown, opts?: unknown) => unknown }).$transaction = (fn, opts) => {
      seen.push(opts);
      return orig(fn as never);
    };
    await saveTeams(t, host, id, { blue: [{ user_id: host.userId }], orange: [{ user_id: a.userId }] });
    const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
    await detailOf(await approve(t, admin, id, rid));
    const base = { timeout: 15_000, maxWait: 5_000 };
    expect(seen).toEqual([base, base, { ...base, isolationLevel: 'ReadCommitted' }]);
  });

  it('(3) 개인 순위 결과 placements JSON이 깨졌으면 승인 500 INTERNAL_ERROR, 결과 pending·내전 playing 유지, 레이팅·시즌 없음', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, admin } = await four(t);
    const id = seedScrim(t, host, [a, b], { game: 'tft' });
    const rid = (
      await detailOf(
        await submit(t, host, id, {
          placements: [
            { user_id: host.userId, placement: 1 },
            { user_id: a.userId, placement: 2 },
          ],
        }),
      )
    ).result?.id as string;
    const row = t.prisma.scrimResult.rows.find((r) => r.id === rid);
    if (!row) throw new Error('결과 행');
    for (const broken of [[{}], null]) {
      row.placements = broken as never;
      await expectError(await approve(t, admin, id, rid), 500, 'INTERNAL_ERROR');
      expect(t.prisma.scrimResult.rows.find((r) => r.id === rid)?.status).toBe('pending');
      expect(t.prisma.scrim.rows.find((s) => s.id === id)?.status).toBe('playing');
      expect(t.prisma.rating.rows).toHaveLength(0);
      expect(t.prisma.ratingHistory.rows).toHaveLength(0);
      expect(t.prisma.season.rows).toHaveLength(0);
    }
  });
});

describe('교차 QA 반영(D136·D131)', () => {
  for (const rated of [true, false]) {
    it(`D136 프로필 개인 순위 승패 = 레이팅 반영 기준: 8명 중 5위, 1·2위 노쇼 → 6명 중 3위 → WIN (rated=${rated})`, async () => {
      t = await createTestApp({ fixedClock: true });
      const { host, admin } = await four(t);
      const others = await Promise.all(Array.from({ length: 7 }, (_, i) => login(t as TestApp, `p${i}`)));
      const id = seedScrim(t, host, others, { game: 'tft', rated });
      const order = [others[0], others[1], others[2], others[3], host, others[4], others[5], others[6]] as Who[];
      const rid = (
        await detailOf(await submit(t, host, id, { placements: order.map((w, i) => ({ user_id: w.userId, placement: i + 1 })) }))
      ).result?.id as string;
      await noShow(t, admin, id, others[0]?.userId as string, true);
      await noShow(t, admin, id, others[1]?.userId as string, true);
      await detailOf(await approve(t, admin, id, rid));
      const res = await call(t, 'GET', `/users/${host.userId}/profile`, host.token);
      const p = GetUserProfileResponse.parse(await res.json());
      expect(p.scrim?.recent[0]).toMatchObject({ outcome: 'win', placement: 5, rated, elo_delta: rated ? expect.any(Number) : null });
      // 6위 제출(재순위 4위 of 6) → LOSS, 노쇼 → no_show
      const six = GetUserProfileResponse.parse(await (await call(t, 'GET', `/users/${others[4]?.userId}/profile`, host.token)).json());
      expect(six.scrim?.recent[0]).toMatchObject({ outcome: 'loss', placement: 6 });
      const ns = GetUserProfileResponse.parse(await (await call(t, 'GET', `/users/${others[0]?.userId}/profile`, host.token)).json());
      expect(ns.scrim?.recent[0]).toMatchObject({ outcome: 'no_show', placement: 1 });
    });
  }

  it('D138 승인 뒤 노쇼 표시가 생겨도 프로필 개인 순위 승패는 승인 때 반영된 참가자 기준: 8명 중 5위(LOSS) → 1·2위 사후 노쇼 → 여전히 LOSS', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, admin } = await four(t);
    const others = await Promise.all(Array.from({ length: 7 }, (_, i) => login(t as TestApp, `q${i}`)));
    const id = seedScrim(t, host, others, { game: 'tft', rated: true });
    const order = [others[0], others[1], others[2], others[3], host, others[4], others[5], others[6]] as Who[];
    const rid = (
      await detailOf(await submit(t, host, id, { placements: order.map((w, i) => ({ user_id: w.userId, placement: i + 1 })) }))
    ).result?.id as string;
    await detailOf(await approve(t, admin, id, rid));
    const before = GetUserProfileResponse.parse(await (await call(t, 'GET', `/users/${host.userId}/profile`, host.token)).json());
    expect(before.scrim?.recent[0]).toMatchObject({ outcome: 'loss', placement: 5 });
    await noShow(t, admin, id, others[0]?.userId as string, true);
    await noShow(t, admin, id, others[1]?.userId as string, true);
    const after = GetUserProfileResponse.parse(await (await call(t, 'GET', `/users/${host.userId}/profile`, host.token)).json());
    expect(after.scrim?.recent[0]).toMatchObject({ outcome: 'loss', placement: 5, elo_delta: before.scrim?.recent[0]?.elo_delta });
  });

  it('D138 프로필 최근 내전 조회는 승인 결과를 최신 10개로 묶고 화면에는 최신 5개만 내린다', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, admin } = await four(t);
    const others = await Promise.all(Array.from({ length: 3 }, (_, i) => login(t as TestApp, `r${i}`)));
    const titles: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = seedScrim(t, host, others, { game: 'lol', rated: false, autoBalance: false });
      const row = t.prisma.scrim.rows.find((sc) => sc.id === id);
      if (row) row.title = `내전 ${i}`;
      titles.push(`내전 ${i}`);
      await detailOf(
        await saveTeams(t, host, id, {
          blue: [{ user_id: host.userId }, { user_id: others[0]?.userId as string }],
          orange: [{ user_id: others[1]?.userId as string }, { user_id: others[2]?.userId as string }],
        }),
      );
      const rid = (await detailOf(await submit(t, host, id, { winner_team: 'blue' }))).result?.id as string;
      await detailOf(await approve(t, admin, id, rid));
      (t as TestApp).clock.advance(MIN);
    }
    const spy = vi.spyOn((t as TestApp).prisma.scrimResult, 'findMany');
    const p = GetUserProfileResponse.parse(await (await call(t, 'GET', `/users/${host.userId}/profile`, host.token)).json());
    expect(spy.mock.calls.some(([a]) => (a as { take?: number } | undefined)?.take === PROFILE_RECENT_SCRIMS_SCAN_LIMIT)).toBe(true);
    expect(p.scrim?.recent).toHaveLength(PROFILE_RECENT_SCRIMS_LIMIT);
    expect(p.scrim?.recent.map((r) => r.title)).toEqual(titles.slice(-PROFILE_RECENT_SCRIMS_LIMIT).reverse());
  });

  it('D131 새 참가 확정 → 팀 초기화: full → 팀 저장 → 승격 없는 정원 확대(팀 유지) → 새 참가 → 전원 team·position null', async () => {
    t = await createTestApp({ fixedClock: true });
    const { host, a, b, c } = await four(t);
    const newbie = await login(t, 'newbie');
    const prefs = { [host.userId]: ['mid'], [a.userId]: ['top'], [b.userId]: ['bot'], [c.userId]: ['support'] };
    const id = seedScrim(t, host, [a, b, c], { status: 'full', capacity: 4, usePositions: true, prefs });
    const row = t.prisma.scrim.rows.find((s) => s.id === id);
    if (row) row.scheduledAt = new Date(t.clock.now().getTime() + DAY);
    await detailOf(
      await saveTeams(t, host, id, {
        blue: [{ user_id: host.userId, position: 'mid' }, { user_id: a.userId, position: 'top' }],
        orange: [{ user_id: b.userId, position: 'bot' }, { user_id: c.userId, position: 'support' }],
      }),
    );
    const widened = await detailOf(await call(t, 'PATCH', `/scrims/${id}`, host.token, { capacity: 6 }));
    expect(widened.status).toBe('recruiting');
    expect(widened.players.every((p) => p.team !== null && p.position !== null)).toBe(true);
    const d = await detailOf(await call(t, 'POST', `/scrims/${id}/join`, newbie.token, { preferred_positions: ['top'] }));
    expect(d.players).toHaveLength(5);
    expect(d.players.every((p) => p.team === null && p.position === null)).toBe(true);
    expect(d.balance).toBeNull();
    expect(t.prisma.scrimPlayer.rows.filter((p) => p.scrimId === id).every((p) => p.team === null && p.position === null)).toBe(true);
  });
});
