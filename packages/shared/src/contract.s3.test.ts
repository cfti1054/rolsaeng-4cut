import { describe, expect, it } from 'vitest';
import {
  ApiPath,
  ApproveScrimResultRequest,
  BalanceScrimRequest,
  BalanceScrimResponse,
  ERROR_HTTP_STATUS,
  ErrorCode,
  GetUserProfileResponse,
  GetUserRatingHistoryQuery,
  GetUserRatingHistoryResponse,
  ListScrimsResponse,
  ListSeasonsResponse,
  RejectScrimResultRequest,
  SCRIM_RESULT_STATUS_TRANSITIONS,
  SCRIM_STATUS_TRANSITIONS,
  SaveScrimTeamsRequest,
  ScrimDetail,
  ScrimResultPlacementsJson,
  SubmitScrimResultRequest,
  autoSeasonName,
  canTransition,
  fillPath,
} from './index';

const ID = '7d1f0b5e-4a7a-4c9b-9f5c-2b1a3c4d5e6f';
const ID2 = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ID3 = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const T = '2026-10-30T12:00:00.000Z';
const user = { id: ID, nickname: '새벽감자', avatar_url: null };
const user2 = { id: ID2, nickname: '칼바람러', avatar_url: null };
const season = { id: ID3, name: '시즌 1', starts_at: '2026-10-01T00:00:00.000+09:00', ends_at: '2027-01-01T00:00:00.000+09:00' };

const side = { size: 1, skill_sum: 1400, skill_avg: 1400, rating_avg: 1400, position_cost: 0, elo_preview: { win: 16, lose: -16 } };
const player = (u: typeof user, team: 'blue' | 'orange') => ({
  user: u,
  status: 'joined',
  is_host: u.id === ID,
  preferred_positions: [],
  joined_at: T,
  position: null,
  team,
  no_show_marked_at: null,
  position_preference: null,
  skill: 1400,
  is_new: false,
});

const finishedDetail = {
  id: ID,
  game: { code: 'steam', name: '스팀 게임', has_positions: false, has_teams: true, positions: [] },
  title: '스팀 1:1',
  scheduled_at: T,
  capacity: 2,
  status: 'finished',
  host: user,
  joined_count: 2,
  waitlist_count: 0,
  options: { rated: true, auto_balance: true, use_positions: false },
  steam_app: { app_id: 730, name: 'Counter-Strike 2' },
  open_positions: [],
  join_closed: true,
  my_status: 'joined',
  created_at: T,
  result_status: 'approved',
  outcome: { winner_team: 'blue', winner: null },
  rules: null,
  started_at: T,
  cancelled_at: null,
  cancel_reason: null,
  updated_at: T,
  players: [player(user, 'blue'), player(user2, 'orange')],
  waitlist: [],
  viewer: {
    status: 'joined',
    waitlist_order: null,
    preferred_positions: [],
    is_host: true,
    restricted_until: null,
    can_join: false,
    can_leave: false,
    can_edit: false,
    can_cancel: false,
    can_start: false,
    can_mark_no_show: false,
    can_edit_teams: false,
    can_balance: false,
    can_submit_result: false,
    can_withdraw_result: false,
    can_review_result: false,
  },
  balance: { blue: side, orange: side, blue_win_probability: 0.5, power_diff: 0, position_cost: 0, unassigned_user_ids: [] },
  result: {
    id: ID3,
    status: 'approved',
    winner_team: 'blue',
    placements: [],
    submitted_by: user,
    submitted_at: T,
    approved_by: user2,
    approved_at: T,
    rejected_by: null,
    rejected_at: null,
    reject_reason: null,
    rating_status: 'applied',
    season,
    rating_changes: [
      { user, team: 'blue', placement: null, outcome: 'win', elo_before: 1400, elo_after: 1416, delta: 16, k_factor: 32 },
      { user: user2, team: 'orange', placement: null, outcome: 'loss', elo_before: 1400, elo_after: 1380, delta: -20, k_factor: 40 },
    ],
  },
} as const;

describe('S3 errors', () => {
  it('새 오류 코드 7개(전체 43개)와 상태', () => {
    const s3 = [
      'SCRIM_TEAMS_NOT_EDITABLE',
      'SCRIM_BALANCE_UNAVAILABLE',
      'SCRIM_RESULT_NOT_ALLOWED',
      'SCRIM_RESULT_EXISTS',
      'SCRIM_TEAMS_REQUIRED',
      'SCRIM_RESULT_NOT_PENDING',
      'SCRIM_RESULT_SELF_REVIEW',
    ] as const;
    for (const c of s3) expect(ErrorCode.options).toContain(c);
    expect(ErrorCode.options).toHaveLength(43);
    expect(ERROR_HTTP_STATUS.SCRIM_RESULT_SELF_REVIEW).toBe(403);
    for (const c of s3.filter((x) => x !== 'SCRIM_RESULT_SELF_REVIEW')) expect(ERROR_HTTP_STATUS[c]).toBe(409);
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ErrorCode.options].sort());
  });
});

describe('S3 transitions', () => {
  it('playing → finished만 결과 승인으로, 결과 행은 pending에서만', () => {
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'playing', 'finished')).toBe(true);
    expect(SCRIM_STATUS_TRANSITIONS.finished).toEqual([]);
    expect(canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, 'pending', 'approved')).toBe(true);
    expect(canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, 'rejected', 'pending')).toBe(false);
    expect(canTransition(SCRIM_RESULT_STATUS_TRANSITIONS, 'approved', 'rejected')).toBe(false);
  });
});

describe('S3 paths', () => {
  it('경로', () => {
    expect(fillPath(ApiPath.scrimBalance, { id: ID })).toBe(`/scrims/${ID}/balance`);
    expect(fillPath(ApiPath.scrimResultApprove, { id: ID })).toBe(`/scrims/${ID}/result/approve`);
    expect(fillPath(ApiPath.userRatingHistory, { id: ID })).toBe(`/users/${ID}/rating-history`);
    expect(ApiPath.seasons).toBe('/seasons');
    expect(new Set(Object.values(ApiPath)).size).toBe(Object.values(ApiPath).length);
  });
});

describe('S3 requests', () => {
  it('BalanceScrimRequest: 빈 객체만', () => {
    expect(BalanceScrimRequest.safeParse({}).success).toBe(true);
    expect(BalanceScrimRequest.safeParse({ k: 1 }).success).toBe(false);
  });
  it('SaveScrimTeamsRequest: 팀당 1명 이상, 참가자 중복·팀 안 포지션 중복 금지, position 기본 null', () => {
    const ok = SaveScrimTeamsRequest.parse({ blue: [{ user_id: ID }], orange: [{ user_id: ID2, position: 'mid' }] });
    expect(ok.blue[0]?.position).toBeNull();
    expect(SaveScrimTeamsRequest.safeParse({ blue: [], orange: [{ user_id: ID2 }] }).success).toBe(false);
    expect(SaveScrimTeamsRequest.safeParse({ blue: [{ user_id: ID }], orange: [{ user_id: ID }] }).success).toBe(false);
    expect(
      SaveScrimTeamsRequest.safeParse({
        blue: [
          { user_id: ID, position: 'top' },
          { user_id: ID3, position: 'top' },
        ],
        orange: [{ user_id: ID2, position: 'top' }],
      }).success,
    ).toBe(false);
    // 다른 팀끼리는 같은 포지션 가능
    expect(
      SaveScrimTeamsRequest.safeParse({ blue: [{ user_id: ID, position: 'top' }], orange: [{ user_id: ID2, position: 'top' }] }).success,
    ).toBe(true);
    expect(SaveScrimTeamsRequest.safeParse({ blue: [{ user_id: ID, team: 'blue' }], orange: [{ user_id: ID2 }] }).success).toBe(false);
  });
  it('SubmitScrimResultRequest: 승리 팀 또는 1..n 순위(동순위 없음)', () => {
    expect(SubmitScrimResultRequest.parse({ winner_team: 'orange' })).toEqual({ winner_team: 'orange' });
    expect(SubmitScrimResultRequest.safeParse({ winner_team: 'draw' }).success).toBe(false);
    const placements = [
      { user_id: ID, placement: 2 },
      { user_id: ID2, placement: 1 },
    ];
    expect(SubmitScrimResultRequest.safeParse({ placements }).success).toBe(true);
    expect(SubmitScrimResultRequest.safeParse({ placements: [{ user_id: ID, placement: 1 }] }).success).toBe(false);
    expect(
      SubmitScrimResultRequest.safeParse({
        placements: [
          { user_id: ID, placement: 1 },
          { user_id: ID2, placement: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      SubmitScrimResultRequest.safeParse({
        placements: [
          { user_id: ID, placement: 1 },
          { user_id: ID2, placement: 3 },
        ],
      }).success,
    ).toBe(false);
    expect(
      SubmitScrimResultRequest.safeParse({
        placements: [
          { user_id: ID, placement: 1 },
          { user_id: ID, placement: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(SubmitScrimResultRequest.safeParse({ winner_team: 'blue', placements }).success).toBe(false);
    expect(SubmitScrimResultRequest.safeParse({}).success).toBe(false);
  });
  it('승인·반려: result_id 필수, 반려 사유 정규화 2–200자', () => {
    expect(ApproveScrimResultRequest.safeParse({}).success).toBe(false);
    expect(ApproveScrimResultRequest.safeParse({ result_id: ID }).success).toBe(true);
    expect(RejectScrimResultRequest.parse({ result_id: ID, reason: '  스크린샷이\n 없어요 ' }).reason).toBe('스크린샷이 없어요');
    expect(RejectScrimResultRequest.safeParse({ result_id: ID, reason: ' a ' }).success).toBe(false);
    expect(RejectScrimResultRequest.safeParse({ result_id: ID, reason: 'x'.repeat(201) }).success).toBe(false);
    expect(RejectScrimResultRequest.safeParse({ result_id: ID }).success).toBe(false);
  });
  it('GetUserRatingHistoryQuery: game 필수, season은 UUID', () => {
    expect(GetUserRatingHistoryQuery.safeParse({}).success).toBe(false);
    expect(GetUserRatingHistoryQuery.parse({ game: 'lol' })).toEqual({ game: 'lol' });
    expect(GetUserRatingHistoryQuery.safeParse({ game: 'lol', season: 'current' }).success).toBe(false);
  });
});

describe('S3 responses', () => {
  it('ScrimDetail: 팀 구성·결과·레이팅 변동', () => {
    const d = ScrimDetail.parse(finishedDetail);
    expect(d.result?.rating_changes).toHaveLength(2);
    expect(d.balance?.power_diff).toBe(0);
    expect(ScrimDetail.safeParse({ ...finishedDetail, result: { ...finishedDetail.result, rating_status: 'done' } }).success).toBe(false);
  });
  it('ListScrimsResponse: result_status·outcome은 목록에도, balance·result는 상세만', () => {
    const r = ListScrimsResponse.parse({ items: [finishedDetail], next_cursor: null });
    expect(r.items[0]?.outcome).toEqual({ winner_team: 'blue', winner: null });
    expect(r.items[0]?.result_status).toBe('approved');
    expect(r.items[0]).not.toHaveProperty('balance');
    expect(r.items[0]).not.toHaveProperty('result');
  });
  it('BalanceScrimResponse', () => {
    const member = { user, position: 'top', preference: 'first', skill: 1400, rating: 1400, is_new: false };
    const option = {
      rank: 1,
      blue: { ...side, members: [member] },
      orange: { ...side, members: [{ ...member, user: user2, preference: 'other' }] },
      blue_win_probability: 0.5,
      power_diff: 0,
      position_cost: 3,
      total_cost: 150,
    };
    const r = BalanceScrimResponse.parse({
      options: [option],
      player_count: 2,
      partitions_evaluated: 1,
      used_positions: true,
      rating_policy: { k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5, full_weight_games: 10 },
    });
    expect(r.options[0]?.total_cost).toBe(150);
    expect(BalanceScrimResponse.safeParse({ ...r, options: [] }).success).toBe(false);
    expect(BalanceScrimResponse.safeParse({ ...r, options: [option, option, option, option] }).success).toBe(false);
    expect(BalanceScrimResponse.safeParse({ ...r, options: [{ ...option, blue: { ...side, members: [] } }] }).success).toBe(false);
  });
  it('프로필 내전 블록', () => {
    const base = {
      user: { id: ID, nickname: '새벽감자', role: 'member', avatar_url: null, discord_linked: true, joined_at: T },
      is_self: false,
      game_accounts: [],
      tiers: [],
      main_position: null,
      recent_matches: null,
      sync_quota: null,
      badges: null,
    };
    const scrim = {
      season,
      ratings: [{ game: 'lol', elo: 1421, wins: 17, losses: 11, games: 28, win_rate: 0.607, rank: 3 }],
      recent: [
        {
          scrim_id: ID,
          title: '일요일 협곡 내전',
          game: 'lol',
          finished_at: T,
          rated: true,
          team: 'blue',
          position: 'top',
          placement: null,
          outcome: 'win',
          elo_delta: 16,
        },
      ],
    };
    expect(GetUserProfileResponse.parse({ ...base, scrim }).scrim?.ratings[0]?.elo).toBe(1421);
    expect(GetUserProfileResponse.parse({ ...base, scrim: null }).scrim).toBeNull();
    expect(GetUserProfileResponse.parse({ ...base, scrim: { season: null, ratings: [], recent: [] } }).scrim?.season).toBeNull();
  });
  it('레이팅 그래프·시즌 목록', () => {
    const h = GetUserRatingHistoryResponse.parse({
      game: 'lol',
      season,
      rating: { elo: 1416, wins: 1, losses: 0, games: 1, win_rate: 1 },
      points: [{ scrim_id: ID, scrim_title: '내전', at: T, elo_before: 1400, elo_after: 1416, delta: 16 }],
      truncated: false,
    });
    expect(h.points).toHaveLength(1);
    expect(ListSeasonsResponse.parse({ items: [{ ...season, is_current: true }], next_cursor: null }).items[0]?.is_current).toBe(true);
    expect(autoSeasonName(2)).toBe('시즌 2');
  });
  it('scrim_results.placements 저장 형식', () => {
    expect(
      ScrimResultPlacementsJson.safeParse([
        { user_id: ID, placement: 1 },
        { user_id: ID2, placement: 2 },
      ]).success,
    ).toBe(true);
    expect(ScrimResultPlacementsJson.safeParse([{ user_id: ID, placement: 1 }]).success).toBe(false);
  });
});
