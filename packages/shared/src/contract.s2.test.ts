import { describe, expect, it } from 'vitest';
import {
  ApiPath,
  CreateScrimRequest,
  ERROR_HTTP_STATUS,
  ErrorCode,
  GAME_SEED,
  GetMyScrimRestrictionResponse,
  JoinScrimRequest,
  LinkGameAccountRequest,
  ListGamesResponse,
  ListScrimsQuery,
  ListScrimsResponse,
  REFRESH_ROTATE_AFTER_HOURS_DEFAULT,
  SCRIM_PLAYER_STATUS_TRANSITIONS,
  SCRIM_STATUS_TRANSITIONS,
  STEAM_LINK_COMPLETE_PATH,
  STEAM_LINK_MESSAGE_TYPE,
  ScrimDetail,
  ScrimStatus,
  SearchSteamAppsQuery,
  SetScrimNoShowParams,
  SetScrimNoShowRequest,
  SteamLinkCallbackQuery,
  SteamLinkCompletePageQuery,
  SteamLinkPopupMessage,
  UpdateScrimRequest,
  canTransition,
  fillPath,
  steamAppHeaderImageUrl,
} from './index';

const ID = '7d1f0b5e-4a7a-4c9b-9f5c-2b1a3c4d5e6f';
const ID2 = '0f1e2d3c-4b5a-4968-8776-655443322110';
const T = '2026-10-29T12:00:00.000Z';
const user = { id: ID, nickname: '새벽감자', avatar_url: null };
const lolGame = {
  code: 'lol',
  name: '리그 오브 레전드',
  has_positions: true,
  has_teams: true,
  positions: ['top', 'jungle', 'mid', 'bot', 'support'],
} as const;

const detail = {
  id: ID,
  game: lolGame,
  title: '화요일 저녁 5:5 내전',
  scheduled_at: '2026-10-29T21:00:00.000+09:00',
  capacity: 10,
  status: 'recruiting',
  host: user,
  joined_count: 1,
  waitlist_count: 1,
  options: { rated: true, auto_balance: true, use_positions: true },
  steam_app: null,
  open_positions: [{ position: 'top', count: 1 }],
  join_closed: false,
  my_status: 'joined',
  created_at: T,
  // S3 추가 필드
  result_status: null,
  outcome: null,
  tft_mode: null,
  can_delete: false,
  rules: null,
  started_at: null,
  cancelled_at: null,
  cancel_reason: null,
  updated_at: T,
  players: [
    {
      user,
      status: 'joined',
      is_host: true,
      preferred_positions: ['top', 'jungle'],
      joined_at: T,
      position: null,
      team: null,
      no_show_marked_at: null,
      // S3 추가 필드
      position_preference: null,
      duo_index: null,
      skill: 1000,
      is_new: true,
    },
  ],
  waitlist: [{ order: 1, user: { ...user, id: ID2, nickname: '칼바람러' }, preferred_positions: ['mid'], joined_at: T }],
  viewer: {
    status: 'joined',
    waitlist_order: null,
    preferred_positions: ['top', 'jungle'],
    is_host: true,
    restricted_until: null,
    can_join: false,
    can_leave: false,
    can_edit: true,
    can_cancel: true,
    can_start: false,
    can_mark_no_show: false,
    // S3 추가 필드
    can_edit_teams: false,
    can_balance: false,
    can_submit_result: false,
    can_withdraw_result: false,
    can_review_result: false,
  },
  balance: null,
  result: null,
} as const;

describe('S2 errors', () => {
  it('새 오류 코드 7개와 상태', () => {
    const s2 = [
      'SCRIM_NOT_RECRUITING',
      'SCRIM_JOIN_CLOSED',
      'SCRIM_HOST_CANNOT_LEAVE',
      'SCRIM_BANNED',
      'SCRIM_CAPACITY_BELOW_JOINED',
      'SCRIM_CANNOT_START',
      'SCRIM_NO_SHOW_NOT_ALLOWED',
    ] as const;
    for (const c of s2) expect(ErrorCode.options).toContain(c);
    // 전체 개수는 슬라이스마다 늘어난다(S3: 43, contract.s3.test.ts)
    expect(ErrorCode.options.length).toBeGreaterThanOrEqual(36);
    expect(ERROR_HTTP_STATUS.SCRIM_BANNED).toBe(403);
    expect(ERROR_HTTP_STATUS.SCRIM_JOIN_CLOSED).toBe(409);
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ErrorCode.options].sort());
  });
});

describe('S2 transitions', () => {
  it('scrims: recruiting → playing 추가, finished는 결과 승인으로만', () => {
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'recruiting', 'playing')).toBe(true);
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'full', 'recruiting')).toBe(true);
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'recruiting', 'finished')).toBe(false);
    expect(canTransition(SCRIM_STATUS_TRANSITIONS, 'playing', 'cancelled')).toBe(false);
    for (const s of ScrimStatus.options) expect(SCRIM_STATUS_TRANSITIONS[s]).toBeDefined();
  });
  it('scrim_players: joined → waitlist 삭제, 승격·취소·재참가·노쇼', () => {
    const t = SCRIM_PLAYER_STATUS_TRANSITIONS;
    expect(canTransition(t, 'joined', 'waitlist')).toBe(false);
    expect(canTransition(t, 'waitlist', 'joined')).toBe(true);
    expect(canTransition(t, 'cancelled', 'waitlist')).toBe(true);
    expect(canTransition(t, 'joined', 'no_show')).toBe(true);
    expect(canTransition(t, 'no_show', 'joined')).toBe(true);
    expect(canTransition(t, 'waitlist', 'no_show')).toBe(false);
  });
});

describe('games', () => {
  it('정원 범위: min ≤ default ≤ max, default·max는 step 간격 위, 롤 2–10 짝수·꽉 차야 시작', () => {
    for (const g of GAME_SEED) {
      expect(g.capacity_min).toBeLessThanOrEqual(g.capacity_default);
      expect(g.capacity_default).toBeLessThanOrEqual(g.capacity_max);
      expect(g.capacity_min).toBeGreaterThanOrEqual(2);
      expect((g.capacity_default - g.capacity_min) % g.capacity_step).toBe(0);
      expect((g.capacity_max - g.capacity_min) % g.capacity_step).toBe(0);
    }
    const lol = GAME_SEED.find((g) => g.code === 'lol');
    expect([lol?.capacity_min, lol?.capacity_max, lol?.capacity_step, lol?.start_requires_full]).toEqual([2, 10, 2, true]);
    // 포지션 게임은 정원이 포지션 수 × 2(팀)로 나뉘어야 open_positions 계산이 맞다
    for (const g of GAME_SEED.filter((x) => x.has_positions)) {
      expect(g.capacity_max % (g.positions.length * 2)).toBe(0);
    }
  });
  it('ListGamesResponse', () => {
    const r = ListGamesResponse.parse({
      items: [
        {
          ...lolGame,
          sort_order: 1,
          capacity: { min: 2, max: 10, default: 10, step: 2, start_requires_full: true },
          requires_steam_app: false,
        },
      ],
      next_cursor: null,
    });
    expect(r.items[0]?.capacity.default).toBe(10);
  });
  it('스팀만 게임 선택 필수(D98)', () => {
    expect(GAME_SEED.filter((g) => g.requires_steam_app).map((g) => g.code)).toEqual(['steam']);
  });
  it('스팀은 인원 모집: 팀 배정과 승패 입력이 없다', () => {
    const steam = GAME_SEED.find((g) => g.code === 'steam');
    expect(steam).toMatchObject({ has_teams: false, has_results: false });
    expect(GAME_SEED.filter((g) => g.code !== 'steam').every((g) => g.has_results)).toBe(true);
  });
});

describe('steam apps (D98)', () => {
  it('SearchSteamAppsQuery: 공백 정리, 기본 빈 문자열, 50자 초과 거부', () => {
    expect(SearchSteamAppsQuery.parse({}).q).toBe('');
    expect(SearchSteamAppsQuery.parse({ q: '  counter   strike ' }).q).toBe('counter strike');
    expect(SearchSteamAppsQuery.safeParse({ q: 'a'.repeat(51) }).success).toBe(false);
  });
  it('CreateScrimRequest.steam_app_id: 양의 정수·null·생략, UpdateScrimRequest는 null 불가', () => {
    const base = { game: 'steam', title: '스팀', scheduled_at: '2026-11-01T12:00:00.000Z', capacity: 4 };
    expect(CreateScrimRequest.parse({ ...base, steam_app_id: 730 }).steam_app_id).toBe(730);
    expect(CreateScrimRequest.parse({ ...base, steam_app_id: null }).steam_app_id).toBeNull();
    expect(CreateScrimRequest.safeParse({ ...base, steam_app_id: 0 }).success).toBe(false);
    expect(UpdateScrimRequest.parse({ steam_app_id: 570 }).steam_app_id).toBe(570);
    expect(UpdateScrimRequest.safeParse({ steam_app_id: null }).success).toBe(false);
  });
  it('헤더 이미지 주소', () => {
    expect(steamAppHeaderImageUrl(730)).toBe('https://cdn.cloudflare.steamstatic.com/steam/apps/730/header.jpg');
  });
});

describe('scrim requests', () => {
  it('CreateScrimRequest: 제목 정규화, 기본값, strict', () => {
    const r = CreateScrimRequest.parse({
      game: 'lol',
      title: '  화요일   저녁 내전 ',
      scheduled_at: '2026-10-30T21:00:00+09:00',
      capacity: 10,
      host_preferred_positions: ['mid', 'top'],
    });
    expect(r.title).toBe('화요일 저녁 내전');
    expect([r.rated, r.auto_balance, r.use_positions]).toEqual([true, true, true]);
    expect(r.rules).toBeUndefined();
    expect(CreateScrimRequest.safeParse({ ...r, host_id: ID }).success).toBe(false);
    expect(CreateScrimRequest.safeParse({ ...r, title: 'a' }).success).toBe(false);
    expect(CreateScrimRequest.safeParse({ ...r, scheduled_at: '2026-10-30T21:00:00' }).success).toBe(false);
  });
  it('rules: 빈 문자열 → null, 1000자 초과 거부', () => {
    const base = { game: 'tft', title: '롤체 로비', scheduled_at: T, capacity: 8, tft_mode: 'normal' as const };
    expect(CreateScrimRequest.parse({ ...base, rules: '   ' }).rules).toBeNull();
    expect(CreateScrimRequest.parse({ ...base, rules: null }).rules).toBeNull();
    expect(CreateScrimRequest.safeParse({ ...base, rules: 'x'.repeat(1001) }).success).toBe(false);
  });
  it('희망 포지션: 최대 2개, 중복 금지, 형식', () => {
    expect(JoinScrimRequest.parse({}).preferred_positions).toEqual([]);
    expect(JoinScrimRequest.safeParse({ preferred_positions: ['mid', 'mid'] }).success).toBe(false);
    expect(JoinScrimRequest.safeParse({ preferred_positions: ['top', 'mid', 'bot'] }).success).toBe(false);
    expect(JoinScrimRequest.safeParse({ preferred_positions: ['TOP'] }).success).toBe(false);
  });
  it('UpdateScrimRequest: 1개 이상, game 변경 불가', () => {
    expect(UpdateScrimRequest.safeParse({}).success).toBe(false);
    expect(UpdateScrimRequest.safeParse({ rules: null }).success).toBe(true);
    expect(UpdateScrimRequest.safeParse({ game: 'tft' }).success).toBe(false);
    expect(UpdateScrimRequest.safeParse({ use_positions: false }).success).toBe(false);
  });
  it('ListScrimsQuery: status 기본 open, limit 규칙', () => {
    expect(ListScrimsQuery.parse({})).toEqual({ status: 'open', limit: 20 });
    expect(ListScrimsQuery.safeParse({ status: 'recruiting' }).success).toBe(false);
    expect(ListScrimsQuery.safeParse({ limit: '101' }).success).toBe(false);
  });
  it('노쇼 표시 요청·경로 파라미터', () => {
    expect(SetScrimNoShowRequest.safeParse({ no_show: true }).success).toBe(true);
    expect(SetScrimNoShowRequest.safeParse({}).success).toBe(false);
    expect(SetScrimNoShowParams.safeParse({ id: ID, userId: 'x' }).success).toBe(false);
  });
});

describe('scrim responses', () => {
  it('ScrimDetail parse, balance·result 자리는 null 허용(S3에서 객체로 넓힘)', () => {
    expect(ScrimDetail.parse(detail).waitlist[0]?.order).toBe(1);
    expect(ScrimDetail.safeParse({ ...detail, balance: {} }).success).toBe(false);
    expect(ScrimDetail.safeParse({ ...detail, my_status: 'cancelled' }).success).toBe(false);
  });
  it('ListScrimsResponse: 상세 전용 필드는 제거', () => {
    const r = ListScrimsResponse.parse({ items: [detail], next_cursor: null });
    expect(r.items[0]).not.toHaveProperty('players');
    expect(r.items[0]).not.toHaveProperty('viewer');
  });
  it('ScrimRestriction: 노쇼 정책 + 모집 정책(D101)', () => {
    const body = {
      restricted: true,
      until: '2026-11-05T12:00:00.000Z',
      recent_no_show_count: 1,
      last_no_show_at: T,
      policy: { threshold: 3, window_days: 30, restriction_days: 1, mark_window_days: 7 },
      scrim_policy: { schedule_max_days_ahead: 30, auto_close_after_min: 60 },
    };
    const r = GetMyScrimRestrictionResponse.parse(body);
    expect(r.restricted).toBe(true);
    expect(r.policy.mark_window_days).toBe(7);
    expect(r.scrim_policy).toEqual({ schedule_max_days_ahead: 30, auto_close_after_min: 60 });
    // 새 필드는 필수(웹이 기본값 상수로 대신 채우지 않게)
    expect(GetMyScrimRestrictionResponse.safeParse({ ...body, scrim_policy: undefined }).success).toBe(false);
    const { mark_window_days: _omit, ...oldPolicy } = body.policy;
    expect(GetMyScrimRestrictionResponse.safeParse({ ...body, policy: oldPolicy }).success).toBe(false);
    // 양의 정수만
    expect(
      GetMyScrimRestrictionResponse.safeParse({ ...body, scrim_policy: { schedule_max_days_ahead: 0, auto_close_after_min: 60 } }).success,
    ).toBe(false);
    expect(
      GetMyScrimRestrictionResponse.safeParse({ ...body, scrim_policy: { schedule_max_days_ahead: 30, auto_close_after_min: 1.5 } }).success,
    ).toBe(false);
  });
});

describe('S2 paths', () => {
  it('경로', () => {
    expect(fillPath(ApiPath.scrimPlayerNoShow, { id: ID, userId: ID2 })).toBe(`/scrims/${ID}/players/${ID2}/no-show`);
    expect(fillPath(ApiPath.scrimJoin, { id: ID })).toBe(`/scrims/${ID}/join`);
    expect(ApiPath.myScrimRestriction).toBe('/me/scrim-restriction');
    expect(new Set(Object.values(ApiPath)).size).toBe(Object.values(ApiPath).length);
  });
});

describe('인증 보완', () => {
  it('리프레시 회전 주기 기본 24시간', () => {
    expect(REFRESH_ROTATE_AFTER_HOURS_DEFAULT).toBe(24);
  });
  it('스팀 연동 display: 기본 redirect, popup 허용', () => {
    expect(LinkGameAccountRequest.parse({ provider: 'steam' })).toEqual({ provider: 'steam', display: 'redirect' });
    expect(LinkGameAccountRequest.parse({ provider: 'steam', display: 'popup' })).toEqual({
      provider: 'steam',
      display: 'popup',
    });
    expect(LinkGameAccountRequest.safeParse({ provider: 'steam', display: 'tab' }).success).toBe(false);
    expect(LinkGameAccountRequest.safeParse({ provider: 'riot', riot_id: 'a#KR1', display: 'popup' }).success).toBe(
      false,
    );
  });
  it('콜백 쿼리 display는 자유 문자열(검증은 쿠키 기준)', () => {
    expect(SteamLinkCallbackQuery.parse({ state: 's', display: 'popup', 'openid.mode': 'id_res' }).display).toBe('popup');
  });
  it('팝업 메시지·완료 페이지', () => {
    expect(STEAM_LINK_COMPLETE_PATH).toBe('/steam-link/complete');
    expect(SteamLinkPopupMessage.parse({ type: STEAM_LINK_MESSAGE_TYPE, status: 'linked' }).status).toBe('linked');
    expect(
      SteamLinkPopupMessage.safeParse({ type: STEAM_LINK_MESSAGE_TYPE, status: 'error', code: 'STEAM_LINK_CANCELLED' })
        .success,
    ).toBe(true);
    expect(
      SteamLinkPopupMessage.safeParse({ type: STEAM_LINK_MESSAGE_TYPE, status: 'error', code: 'NICKNAME_TAKEN' }).success,
    ).toBe(false);
    expect(SteamLinkPopupMessage.safeParse({ type: 'other', status: 'linked' }).success).toBe(false);
    expect(SteamLinkCompletePageQuery.parse({ steam: 'linked' })).toEqual({ steam: 'linked' });
  });
});
