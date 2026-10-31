import {
  addKstMonths,
  canStartScrim,
  computeScrimRestriction,
  orderWaitlist as coreOrderWaitlist,
  validatePreferredPositions,
  computeOpenPositions as coreComputeOpenPositions,
  kstMonthStart,
  positionPreferenceOf,
  validatePlacementUsers,
  validateTeamAssignment,
} from '@gcd/core';
import {
  ApiPath,
  ApproveScrimResultRequest,
  BALANCE_PLAYERS_MAX,
  BALANCE_PLAYERS_MIN,
  BalanceScrimRequest,
  GetUserRatingHistoryQuery,
  RejectScrimResultRequest,
  SaveScrimTeamsRequest,
  ScrimTeam,
  SubmitScrimResultRequest,
  type ProfileScrim,
  CreateScrimRequest,
  GAME_SEED,
  GameCode,
  IsoDateTime,
  JoinScrimRequest,
  ListScrimsQuery,
  NO_SHOW_MARK_WINDOW_DAYS_DEFAULT,
  NO_SHOW_RESTRICTION_DAYS_DEFAULT,
  NO_SHOW_THRESHOLD_DEFAULT,
  NO_SHOW_WINDOW_DAYS_DEFAULT,
  SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT,
  SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT,
  ScrimCancelReason,
  ScrimDetail,
  ScrimPlayerStatus,
  ScrimRestriction,
  ScrimStatus,
  ScrimSummary,
  SearchSteamAppsQuery,
  SetScrimNoShowRequest,
  STEAM_APP_SEARCH_LIMIT,
  SteamAppRef,
  UpdateScrimRequest,
  Uuid,
  type ErrorCode,
  type ProfileBadge,
  type SearchSteamAppsResponse,
  type SteamAppOption,
  type GameSeed,
  type GameView,
  type ListGamesResponse,
  type ListScrimsResponse,
  type Me,
  type OpenPosition,
  type ScrimUserRef,
} from '@gcd/shared';
import { z } from 'zod';
import { MOCK_OTHER_MEMBER_ID } from './game-accounts';
import { handleRankings, isRankingPath, mockProfileBadges as rankingProfileBadges, scenarioState, type MockRankingOptions } from './rankings';
import {
  MockS3Fields,
  activeResult,
  applyApproval,
  balanceResponse,
  latestResult,
  mockEloPolicy,
  profileScrim,
  ratingHistory,
  resultView,
  seasonsResponse,
  skillInfo,
  teamsView,
  tierSeedOf,
  type MockRatingOptions,
  type MockResult,
} from './ratings';

/**
 * [목] S2 내전 엔드포인트 11개(계약 4·5절) + S3 팀 밸런스·결과·시즌·레이팅 그래프 8개(S3 계약 4절).
 * backend.ts가 인증을 끝낸 뒤 이 핸들러를 부른다.
 * 서버 흐름을 같은 순서로 흉내 낸다: 상태 → join_closed → 포지션 검증 → 이미 참가(포지션 변경) → 노쇼 제한 → 배치.
 * 규칙 계산(남은 포지션, 밸런스, ELO, 시즌)은 @gcd/core를 import한다(리더 결정: 목에 공식 복사본을 두지 않는다).
 *
 * S3 시드: 시즌 2개(지난 시즌·현재 시즌), 지난 협곡 내전 14개를 core 승인 흐름으로 차례로 반영(레이팅·이력·최근 내전),
 * 진행 중 내전 4개(팀 미구성 · 내가 방장·팀 구성 완료 · 승인 대기 · 롤체 반려 후 재입력), 지난주 롤체 로비 승인(순위).
 *
 * 시드(요청한 사용자 기준으로 처음 한 번): 모집 중 13개(마지막 페이지 「더 보기」 확인용), 시작 대기 1개, 진행 중·종료·취소 각 1개.
 * - 「주말 협곡 2판 연속」은 내가 방장(정원 마감 + 대기 2명) → 방장 메뉴·시작 확인
 * - 「골드 이하 초보 환영 내전」은 내가 참가 중 → 참가 취소·포지션 변경 확인
 * - 진행 중 내전에 내가 참가 → 운영진(dev-login role admin)이면 노쇼 표시 확인
 * - 닉네임이 `noshow`로 시작하면 최근 노쇼 3회를 심어 제한 상태를 만든다(dev-login username noshow…)
 */

const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

const MockScrim = z.object({
  id: Uuid,
  game: GameCode,
  title: z.string(),
  scheduled_at: IsoDateTime,
  capacity: z.number().int(),
  status: ScrimStatus,
  host_id: Uuid,
  rules: z.string().nullable(),
  rated: z.boolean(),
  auto_balance: z.boolean(),
  use_positions: z.boolean(),
  /** 이 필드 전에 저장된 목 DB도 읽히도록 기본 null */
  steam_app: SteamAppRef.nullable().default(null),
  started_at: IsoDateTime.nullable(),
  cancelled_at: IsoDateTime.nullable(),
  cancel_reason: ScrimCancelReason.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
type MockScrim = z.infer<typeof MockScrim>;

/**
 * 스팀 게임 목(D98). owner_count > 0 = 멤버 보유 게임(검색어 없을 때 목록), 나머지는 상점에만 있는 게임.
 * 검색어에 「상점오류」가 들어가면 상점 검색 실패(store_unavailable)를 흉내 낸다.
 */
export const MOCK_STEAM_APPS: readonly SteamAppOption[] = [
  { app_id: 578080, name: 'PUBG: BATTLEGROUNDS', owner_count: 9 },
  { app_id: 730, name: 'Counter-Strike 2', owner_count: 7 },
  { app_id: 1966720, name: 'Lethal Company', owner_count: 6 },
  { app_id: 945360, name: 'Among Us', owner_count: 5 },
  { app_id: 1172470, name: 'Apex Legends', owner_count: 4 },
  { app_id: 553850, name: 'HELLDIVERS 2', owner_count: 4 },
  { app_id: 892970, name: 'Valheim', owner_count: 3 },
  { app_id: 739630, name: 'Phasmophobia', owner_count: 3 },
  { app_id: 548430, name: 'Deep Rock Galactic', owner_count: 2 },
  { app_id: 1426210, name: 'It Takes Two', owner_count: 2 },
  { app_id: 570, name: 'Dota 2', owner_count: 1 },
  { app_id: 550, name: 'Left 4 Dead 2', owner_count: 1 },
  { app_id: 1623730, name: 'Palworld', owner_count: 0 },
  { app_id: 728880, name: 'Overcooked! 2', owner_count: 0 },
  { app_id: 413150, name: 'Stardew Valley', owner_count: 0 },
  { app_id: 105600, name: 'Terraria', owner_count: 0 },
  { app_id: 2881650, name: 'Content Warning', owner_count: 0 },
  { app_id: 1172620, name: 'Sea of Thieves', owner_count: 0 },
];
const steamApp = (id: number): SteamAppRef | null => {
  const a = MOCK_STEAM_APPS.find((x) => x.app_id === id);
  return a ? { app_id: a.app_id, name: a.name } : null;
};

const MockPlayer = z.object({
  id: Uuid,
  scrim_id: Uuid,
  user_id: Uuid,
  status: ScrimPlayerStatus,
  preferred_positions: z.array(z.string()),
  joined_at: IsoDateTime,
  no_show_marked_at: IsoDateTime.nullable(),
  no_show_marked_by: Uuid.nullable(),
  /** S3 팀 구성(PUT /teams). joined·no_show 행에만 의미 */
  team: ScrimTeam.nullable().default(null),
  position: z.string().nullable().default(null),
});
type MockPlayer = z.infer<typeof MockPlayer>;

/** 시드 형식 버전. 바뀌면 저장된 목 DB를 버리고 다시 만든다(S3 필드·시나리오 추가) */
const SEED_VERSION = 7;

export const MockS2State = z.object({
  /** 시드를 만든 사용자 id. 다른 사용자로 로그인하면 다시 만든다 */
  owner: z.string(),
  seed_version: z.number().int().default(0),
  scrims: z.array(MockScrim),
  players: z.array(MockPlayer),
  ...MockS3Fields,
});
export type MockS2State = z.infer<typeof MockS2State>;

export const emptyS2State = (): MockS2State => ({
  owner: '',
  seed_version: SEED_VERSION,
  scrims: [],
  players: [],
  results: [],
  seasons: [],
  ratings: [],
  history: [],
});

export interface MockS2Options {
  noShowPolicy?: { threshold: number; windowDays: number; restrictionDays: number };
  /** S3 목 env(K 값·시즌 길이) */
  ratings?: MockRatingOptions;
  /** S4 랭킹·요약 화면 상태 확인용 */
  rankings?: MockRankingOptions;
}

export interface MockS2Context {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
  me: Me;
  now: number;
  state: MockS2State;
  save: (s: MockS2State) => void;
  json: (status: number, body: unknown) => Response;
  error: (code: ErrorCode, message: string, opts?: { retryAfterSec?: number; details?: { path: string; message: string }[] }) => Response;
  opts?: MockS2Options;
}

// -----------------------------------------------------------------------------
// 고정 데이터
// -----------------------------------------------------------------------------

const uid = (n: number) => `5c0f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** 다른 멤버(공개 정보만). 정글차이는 S1 목 프로필과 같은 id라 프로필 링크가 열린다 */
export const MOCK_SCRIM_USERS: readonly ScrimUserRef[] = [
  { id: uid(1), nickname: '미드고정', avatar_url: null },
  { id: MOCK_OTHER_MEMBER_ID, nickname: '정글차이', avatar_url: null },
  { id: uid(3), nickname: '원딜장인', avatar_url: null },
  { id: uid(4), nickname: '서폿요정', avatar_url: null },
  { id: uid(5), nickname: '한타각', avatar_url: null },
  { id: uid(6), nickname: '바론스틸', avatar_url: null },
  { id: uid(7), nickname: '별빛미드', avatar_url: null },
  { id: uid(8), nickname: '무한점멸', avatar_url: null },
  { id: uid(9), nickname: '와드지기', avatar_url: null },
  { id: uid(10), nickname: '칼바람러', avatar_url: null },
  { id: uid(11), nickname: '용용이', avatar_url: null },
  { id: uid(12), nickname: '체스왕', avatar_url: null },
];
const U = Object.fromEntries(MOCK_SCRIM_USERS.map((u) => [u.nickname, u.id])) as Record<string, string>;

export function mockGames(): GameView[] {
  return [...GAME_SEED]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((g) => ({
      code: g.code,
      name: g.name,
      has_positions: g.has_positions,
      has_teams: g.has_teams,
      positions: [...g.positions],
      sort_order: g.sort_order,
      capacity: {
        min: g.capacity_min,
        max: g.capacity_max,
        default: g.capacity_default,
        step: g.capacity_step,
        start_requires_full: g.start_requires_full,
      },
      requires_steam_app: g.requires_steam_app,
    }));
}

const gameOf = (code: GameCode): GameSeed => GAME_SEED.find((g) => g.code === code)!;

// -----------------------------------------------------------------------------
// 규칙(core와 같은 규칙의 작은 복사본, 계약 7절)
// -----------------------------------------------------------------------------

const iso = (t: number) => new Date(t).toISOString();
const isOpen = (s: { status: string }) => s.status === 'recruiting' || s.status === 'full';
const isClosed = (s: MockScrim, now: number) => now >= Date.parse(s.scheduled_at);

/** core `orderWaitlist`(joinedAt 오름차순, 같으면 id) — 목 행(joined_at 문자열)을 Date로 바꿔 넘긴다 */
function orderWaitlist<T extends { id: string; joined_at: string }>(rows: readonly T[]): T[] {
  return coreOrderWaitlist(rows.map((row) => ({ id: row.id, joinedAt: new Date(row.joined_at), row }))).map((x) => x.row);
}

/** core `validatePreferredPositions`. 문제가 있으면 메시지, 없으면 null */
function validatePositions(input: readonly string[], positions: readonly string[], use: boolean): string | null {
  const r = validatePreferredPositions(input, positions, use);
  return r.ok ? null : r.message;
}

/**
 * core `computeOpenPositions`(D100: 포지션별 남은 수 합계가 빈 자리를 넘으면 [] → 카드는 「N자리 남음」).
 * S2 때 두었던 복사본을 core import로 바꿨다(리더 결정). 테스트가 이 이름으로 부르므로 다시 내보낸다.
 */
export function computeOpenPositions(positions: readonly string[], capacity: number, firstChoices: readonly (string | null)[]): OpenPosition[] {
  return coreComputeOpenPositions(positions, capacity, firstChoices);
}

/** core `computeScrimRestriction` — 시각(ms)으로 바꿔 돌려준다 */
function computeRestriction(marks: readonly number[], now: number, policy: Required<MockS2Options>['noShowPolicy']) {
  const r = computeScrimRestriction(marks.map((m) => new Date(m)), new Date(now), policy);
  return {
    restricted: r.restricted,
    until: r.until ? r.until.getTime() : null,
    recentCount: r.recentCount,
    last: r.lastNoShowAt ? r.lastNoShowAt.getTime() : null,
  };
}

// -----------------------------------------------------------------------------
// 시드
// -----------------------------------------------------------------------------

function seed(me: Me, now: number, opts?: MockS2Options): MockS2State {
  const state: MockS2State = { ...emptyS2State(), owner: me.id };
  let n = 0;
  const id = () => {
    n += 1;
    return `5c1a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };
  const steamPicks = [578080, 1966720, 730, 945360, 553850, 739630];
  let steamPick = 0;
  const add = (
    s: Partial<MockScrim> & Pick<MockScrim, 'game' | 'title' | 'scheduled_at' | 'capacity' | 'host_id'>,
    joined: [string, string[]][],
    waitlist: [string, string[]][] = [],
  ) => {
    const game = gameOf(s.game);
    const scrimId = id();
    const created = Date.parse(s.scheduled_at) - 2 * DAY_MS;
    const scrim: MockScrim = {
      id: scrimId,
      status: 'recruiting',
      rules: null,
      rated: true,
      auto_balance: game.has_teams,
      use_positions: game.has_positions,
      steam_app: game.requires_steam_app ? steamApp(steamPicks[steamPick++ % steamPicks.length]!) : null,
      started_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: iso(Math.min(created, now)),
      updated_at: iso(Math.min(created, now)),
      ...s,
    };
    let t = Date.parse(scrim.created_at);
    for (const [userId, pos] of [...joined, ...waitlist]) {
      t += 7 * MIN_MS;
      const isWait = waitlist.some(([u]) => u === userId);
      state.players.push({
        id: id(),
        scrim_id: scrimId,
        user_id: userId,
        status: isWait ? 'waitlist' : 'joined',
        preferred_positions: scrim.use_positions ? pos : [],
        joined_at: iso(Math.min(t, now - MIN_MS)),
        no_show_marked_at: null,
        no_show_marked_by: null,
        team: null,
        position: null,
      });
    }
    if (isOpen(scrim)) scrim.status = joined.length >= scrim.capacity ? 'full' : 'recruiting';
    state.scrims.push(scrim);
    return scrim;
  };
  const h = (hours: number) => iso(Math.ceil((now + hours * 3_600_000) / (30 * MIN_MS)) * 30 * MIN_MS);

  add(
    { game: 'lol', title: '화요일 저녁 5:5 내전', scheduled_at: h(3), capacity: 10, host_id: U['미드고정']!, rules: '토너먼트 드래프트, 피어리스 없음.\n시작 10분 전까지 음성 채널 입장.\n노쇼 3회(30일) 시 1일간 참가 제한.' },
    [
      [U['미드고정']!, ['mid', 'top']],
      [U['한타각']!, ['top', 'jungle']],
      [U['원딜장인']!, ['bot', 'support']],
      [U['별빛미드']!, ['mid', 'bot']],
      [U['무한점멸']!, ['bot', 'mid']],
      [U['칼바람러']!, ['top']],
      [MOCK_OTHER_MEMBER_ID, ['jungle', 'mid']],
      [U['서폿요정']!, ['support', 'bot']],
    ],
  );
  add({ game: 'tft', title: '롤체 8인 친선 로비', scheduled_at: h(4.5), capacity: 8, host_id: U['체스왕']! }, [
    [U['체스왕']!, []],
    [U['용용이']!, []],
    [U['와드지기']!, []],
    [U['별빛미드']!, []],
    [U['바론스틸']!, []],
  ]);
  add(
    { game: 'lol', title: '주말 협곡 2판 연속', scheduled_at: h(50), capacity: 10, host_id: me.id, rules: '2판 연속 진행, 2판째는 진영 교체.' },
    [
      [me.id, ['top', 'jungle']],
      [MOCK_OTHER_MEMBER_ID, ['jungle', 'mid']],
      [U['미드고정']!, ['mid', 'top']],
      [U['원딜장인']!, ['bot', 'support']],
      [U['서폿요정']!, ['support', 'bot']],
      [U['한타각']!, ['top', 'jungle']],
      [U['바론스틸']!, ['jungle', 'top']],
      [U['별빛미드']!, ['mid', 'bot']],
      [U['무한점멸']!, ['bot', 'mid']],
      [U['와드지기']!, ['support', 'jungle']],
    ],
    [
      [U['칼바람러']!, ['mid', 'support']],
      [U['용용이']!, ['bot', 'top']],
    ],
  );
  add(
    { game: 'lol', title: '골드 이하 초보 환영 내전', scheduled_at: h(26), capacity: 10, host_id: U['서폿요정']!, rated: false },
    [
      [U['서폿요정']!, ['support']],
      [me.id, ['mid', 'top']],
      [U['바론스틸']!, ['jungle']],
      [U['와드지기']!, ['support', 'jungle']],
      [U['무한점멸']!, ['bot']],
      [U['칼바람러']!, ['jungle', 'mid']],
    ],
  );
  add({ game: 'steam', title: '배틀그라운드 스쿼드 2팀', scheduled_at: h(74), capacity: 8, host_id: U['바론스틸']!, rated: false }, [
    [U['바론스틸']!, []],
    [U['한타각']!, []],
    [U['용용이']!, []],
    [U['원딜장인']!, []],
    [U['체스왕']!, []],
  ]);
  add({ game: 'tft', title: '롤체 더블업 4팀', scheduled_at: h(98), capacity: 8, host_id: U['별빛미드']! }, [
    [U['별빛미드']!, []],
    [U['체스왕']!, []],
    [U['칼바람러']!, []],
    [U['용용이']!, []],
  ]);
  for (let i = 0; i < 7; i += 1) {
    const host = MOCK_SCRIM_USERS[(i * 5) % MOCK_SCRIM_USERS.length]!;
    add(
      { game: i % 2 ? 'tft' : 'steam', title: i % 2 ? `롤체 연습 로비 ${i + 1}` : `스팀 파티 ${i + 1}`, scheduled_at: h(120 + i * 24), capacity: 6, host_id: host.id },
      [[host.id, []]],
    );
  }
  // 시작 시각이 지났지만 아직 시작·자동 마감 전(join_closed)
  add({ game: 'lol', title: '퇴근 후 칼바람 대신 협곡', scheduled_at: iso(now - 10 * MIN_MS), capacity: 10, host_id: U['한타각']! }, [
    [U['한타각']!, ['top']],
    [U['정글차이'] ?? MOCK_OTHER_MEMBER_ID, ['jungle']],
    [U['미드고정']!, ['mid']],
    [U['무한점멸']!, ['bot']],
    [U['와드지기']!, ['support']],
    [U['바론스틸']!, ['jungle', 'top']],
    [U['별빛미드']!, ['mid', 'bot']],
  ]);
  // 진행 중(내가 참가) — 운영진이면 노쇼 표시 가능
  const playing = add(
    { game: 'lol', title: '오늘 밤 협곡 내전', scheduled_at: iso(now - 40 * MIN_MS), capacity: 10, host_id: U['미드고정']!, status: 'playing', started_at: iso(now - 35 * MIN_MS) },
    [
      [U['미드고정']!, ['mid']],
      [me.id, ['top', 'jungle']],
      [MOCK_OTHER_MEMBER_ID, ['jungle']],
      [U['원딜장인']!, ['bot']],
      [U['서폿요정']!, ['support']],
      [U['한타각']!, ['top']],
      [U['바론스틸']!, ['jungle']],
      [U['별빛미드']!, ['mid']],
      [U['무한점멸']!, ['bot']],
      [U['와드지기']!, ['support']],
    ],
  );
  playing.status = 'playing';
  const lastTft = add(
    { game: 'tft', title: '지난주 롤체 로비', scheduled_at: iso(now - 3 * DAY_MS), capacity: 8, host_id: U['체스왕']!, status: 'finished', started_at: iso(now - 3 * DAY_MS) },
    [
      [U['체스왕']!, []],
      [me.id, []],
      [U['용용이']!, []],
      [U['칼바람러']!, []],
    ],
  );
  lastTft.status = 'finished';
  add(
    { game: 'steam', title: '주말 스팀 파티', scheduled_at: iso(now - DAY_MS), capacity: 8, host_id: U['바론스틸']!, status: 'cancelled', cancelled_at: iso(now - DAY_MS + 60 * MIN_MS), cancel_reason: 'not_started' },
    [[U['바론스틸']!, []]],
  ).status = 'cancelled';

  // ---------------------------------------------------------------------------
  // S3: 시즌 2개 + 지난 협곡 내전 14개(core 승인 흐름으로 차례로 반영) + 진행 중 시나리오
  // ---------------------------------------------------------------------------
  const policy = mockEloPolicy(opts?.ratings);
  const curStart = kstMonthStart(new Date(now - 45 * DAY_MS));
  const prevStart = kstMonthStart(new Date(curStart.getTime() - 80 * DAY_MS));
  state.seasons.push(
    { id: id(), name: '시즌 1', starts_at: prevStart.toISOString(), ends_at: curStart.toISOString() },
    { id: id(), name: '시즌 2', starts_at: curStart.toISOString(), ends_at: addKstMonths(curStart, 3).toISOString() },
  );
  const rowsIn = (scrimId: string) => state.players.filter((p) => p.scrim_id === scrimId);
  const lolPositions = gameOf('lol').positions;
  /** 팀·포지션 저장(슬롯 순서대로 블루 5 · 레드 5, 포지션은 1지망) */
  const assignTeams = (scrimId: string) => {
    const rows = rowsIn(scrimId).filter((p) => p.status === 'joined' || p.status === 'no_show');
    const half = Math.ceil(rows.length / 2);
    rows.forEach((p, i) => {
      p.team = i < half ? 'blue' : 'orange';
      p.position = p.preferred_positions[0] ?? lolPositions[i % half] ?? null;
    });
  };
  const pushResult = (r: Partial<MockResult> & Pick<MockResult, 'scrim_id' | 'submitted_by' | 'created_at'>): MockResult => {
    const row: MockResult = {
      id: id(),
      status: 'pending',
      winner_team: null,
      placements: null,
      approved_by: null,
      approved_at: null,
      rejected_by: null,
      rejected_at: null,
      reject_reason: null,
      ...r,
    };
    state.results.push(row);
    return row;
  };
  const approveSeed = (s: MockScrim, result: MockResult, at: number, approver: string) =>
    applyApproval(state, {
      scrimId: s.id,
      game: s.game,
      hasTeams: gameOf(s.game).has_teams,
      rated: s.rated,
      players: rowsIn(s.id).map((p) => ({ userId: p.user_id, status: p.status, team: p.team })),
      result,
      now: at,
      approverId: approver,
      policy,
      newId: id,
    });

  const pastTitles = [
    '지난 시즌 개막전',
    '지난 시즌 협곡 2판',
    '지난 시즌 마무리 내전',
    '일요일 협곡 내전',
    '금요일 협곡 내전',
    '수요일 초보 환영 내전',
    '주말 협곡 2판 연속 1경기',
    '주말 협곡 2판 연속 2경기',
    '평일 저녁 협곡',
    '월요일 칼퇴 내전',
    '시즌 중간 점검 내전',
    '목요일 협곡 내전',
    '불금 협곡 내전',
    '어제 밤 협곡 내전',
    // S4: 지난 시즌 최종 순위(5경기 이상)가 보이도록 지난 시즌 경기를 더한다
    '지난 시즌 초반 내전',
    '지난 시즌 주말 협곡',
    '지난 시즌 평일 협곡',
    '지난 시즌 일요 내전',
    '지난 시즌 금요 내전',
    '지난 시즌 막판 내전',
  ];
  const pastDaysAgo = [70, 64, 58, 40, 36, 33, 29, 29, 24, 19, 14, 9, 5, 1, 100, 96, 92, 88, 84, 80];
  const pool = MOCK_SCRIM_USERS.filter((u) => u.nickname !== '체스왕').map((u) => u.id);
  const pastAt = (k: number) => now - pastDaysAgo[k]! * DAY_MS - (k % 2) * 3 * 3_600_000;
  // 승인 흐름이 이력을 쌓으므로 시간순으로 반영한다(k는 경기별 고정 조건이라 그대로 둔다)
  const pastOrder = pastTitles.map((_, k) => k).sort((a, b) => pastAt(a) - pastAt(b));
  pastOrder.forEach((k) => {
    const title = pastTitles[k]!;
    const meIn = k !== 4 && k !== 9;
    const excluded = new Set([pool[k % pool.length], meIn ? pool[(k + 5) % pool.length] : undefined]);
    const others = pool.filter((u) => !excluded.has(u)).slice(0, meIn ? 9 : 10);
    const roster = meIn ? [others[0]!, me.id, ...others.slice(1)] : others;
    const at = pastAt(k);
    const s = add(
      { game: 'lol', title, scheduled_at: iso(at - 2 * 3_600_000), capacity: 10, host_id: roster[0]!, status: 'finished', started_at: iso(at - 2 * 3_600_000), rated: k !== 5 },
      roster.map((u, i) => [u, [lolPositions[i % 5]!, lolPositions[(i + 1) % 5]!]] as [string, string[]]),
    );
    s.status = 'finished';
    assignTeams(s.id);
    if (k === 7) {
      // 노쇼 1명(팀 배정은 남아 있지만 반영에서 빠진다)
      const ns = rowsIn(s.id).find((p) => p.user_id !== me.id && p.user_id !== s.host_id)!;
      Object.assign(ns, { status: 'no_show', no_show_marked_at: iso(at - 3_600_000), no_show_marked_by: U['미드고정']! });
    }
    const winner: ScrimTeam = (k * 7 + 3) % 5 < 3 ? 'blue' : 'orange';
    const result = pushResult({ scrim_id: s.id, submitted_by: s.host_id, created_at: iso(at - 30 * MIN_MS), winner_team: winner });
    approveSeed(s, result, at, s.host_id === U['미드고정'] ? MOCK_OTHER_MEMBER_ID : U['미드고정']!);
  });

  // 지난주 롤체 로비: 순위 결과 승인
  const tftResult = pushResult({
    scrim_id: lastTft.id,
    submitted_by: lastTft.host_id,
    created_at: iso(now - 3 * DAY_MS + 2 * 3_600_000),
    placements: [
      { user_id: U['용용이']!, placement: 1 },
      { user_id: me.id, placement: 2 },
      { user_id: U['체스왕']!, placement: 3 },
      { user_id: U['칼바람러']!, placement: 4 },
    ],
  });
  approveSeed(lastTft, tftResult, now - 3 * DAY_MS + 3 * 3_600_000, U['미드고정']!);

  const lolRoster = (first: string[]) => {
    const rest = pool.filter((u) => !first.includes(u)).slice(0, 10 - first.length);
    return [...first, ...rest].map((u, i) => [u, [lolPositions[i % 5]!, lolPositions[(i + 2) % 5]!]] as [string, string[]]);
  };
  // 진행 중 B: 내가 방장, 팀 구성 완료 → 결과 입력
  const mine = add(
    { game: 'lol', title: '내가 연 협곡 내전', scheduled_at: iso(now - 70 * MIN_MS), capacity: 10, host_id: me.id, status: 'playing', started_at: iso(now - 65 * MIN_MS) },
    lolRoster([me.id]),
  );
  mine.status = 'playing';
  assignTeams(mine.id);
  // 진행 중 C: 승인 대기(미드고정 제출) → 운영진이면 승인·반려
  const pending = add(
    { game: 'lol', title: '승인 대기 협곡 내전', scheduled_at: iso(now - 100 * MIN_MS), capacity: 10, host_id: U['미드고정']!, status: 'playing', started_at: iso(now - 95 * MIN_MS) },
    lolRoster([U['미드고정']!, me.id]),
  );
  pending.status = 'playing';
  assignTeams(pending.id);
  pushResult({ scrim_id: pending.id, submitted_by: U['미드고정']!, created_at: iso(now - 20 * MIN_MS), winner_team: 'orange' });
  // 진행 중 D: 롤체, 내가 방장, 반려됨 → 순위 다시 입력
  const solo = add(
    { game: 'tft', title: '롤체 순위전 로비', scheduled_at: iso(now - 55 * MIN_MS), capacity: 8, host_id: me.id, status: 'playing', started_at: iso(now - 50 * MIN_MS) },
    [
      [me.id, []],
      [U['체스왕']!, []],
      [U['용용이']!, []],
      [U['별빛미드']!, []],
      [U['와드지기']!, []],
      [U['칼바람러']!, []],
    ],
  );
  solo.status = 'playing';
  pushResult({
    scrim_id: solo.id,
    submitted_by: me.id,
    created_at: iso(now - 25 * MIN_MS),
    placements: [
      { user_id: me.id, placement: 1 },
      { user_id: U['체스왕']!, placement: 2 },
    ],
    status: 'rejected',
    rejected_by: U['미드고정']!,
    rejected_at: iso(now - 15 * MIN_MS),
    reject_reason: '순위가 실제와 달라요. 6명 모두 다시 입력해 주세요.',
  });

  // 노쇼 제한 흉내: 최근 30일 안에 노쇼 3회. 마지막 표시는 6시간 전이라 1일 제한이 아직 남아 있다.
  if (me.nickname.toLowerCase().startsWith('noshow')) {
    for (const hoursAgo of [20 * 24, 9 * 24, 6]) {
      const s = add(
        { game: 'tft', title: `노쇼 기록용 로비 (${hoursAgo}시간 전)`, scheduled_at: iso(now - hoursAgo * 3_600_000), capacity: 8, host_id: U['체스왕']!, status: 'finished', started_at: iso(now - hoursAgo * 3_600_000) },
        [
          [U['체스왕']!, []],
          [me.id, []],
        ],
      );
      s.status = 'finished';
      const row = state.players.find((p) => p.scrim_id === s.id && p.user_id === me.id)!;
      row.status = 'no_show';
      row.no_show_marked_at = iso(now - hoursAgo * 3_600_000);
      row.no_show_marked_by = U['미드고정']!;
    }
  }
  return state;
}

// -----------------------------------------------------------------------------
// 직렬화
// -----------------------------------------------------------------------------

function userRef(id: string, me: Me): ScrimUserRef {
  if (id === me.id) return { id: me.id, nickname: me.nickname, avatar_url: me.avatar_url };
  return MOCK_SCRIM_USERS.find((u) => u.id === id) ?? { id, nickname: '알 수 없음', avatar_url: null };
}

/** 목록 커서 = base64url(JSON {t, s, id}) — 서버와 같은 모양(내용은 웹이 해석하지 않는다) */
function encodeCursor(c: { t: string; s: string; id: string }): string {
  return btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(raw: string): { t: string; s: string; id: string } | null {
  try {
    const b = raw.replace(/-/g, '+').replace(/_/g, '/');
    const v = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4))) as unknown;
    const p = z.object({ t: z.string(), s: z.string(), id: z.string() }).safeParse(v);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// 라우터
// -----------------------------------------------------------------------------

function matchTemplate(template: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp(
    `^${template.replace(/:([A-Za-z_]+)/g, (_, name: string) => {
      names.push(name);
      return '([^/]+)';
    })}$`,
  );
  const m = re.exec(path);
  if (!m) return null;
  return Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(m[i + 1] ?? '')]));
}

const issues = (e: z.ZodError) => e.issues.map((i) => ({ path: i.path.join('.') || 'body', message: i.message }));

/** 로그인 사용자 기준 시드가 없거나 형식 버전이 다르면 다시 만든다 */
function ensureSeeded(ctx: Pick<MockS2Context, 'state' | 'me' | 'now' | 'save' | 'opts'>): MockS2State {
  if (ctx.state.owner === ctx.me.id && ctx.state.seed_version === SEED_VERSION) return ctx.state;
  const s = seed(ctx.me, ctx.now, ctx.opts);
  ctx.save(s);
  return s;
}

/** 이 목이 처리하는 경로인가(backend.ts 라우팅용). /users/:id/rating-history, /seasons, S4 랭킹·요약 포함 */
export function isS2Path(path: string): boolean {
  return (
    isRankingPath(path) ||
    path === ApiPath.games ||
    path === ApiPath.steamApps ||
    path === ApiPath.myScrimRestriction ||
    path === ApiPath.scrims ||
    path === ApiPath.seasons ||
    path.startsWith('/scrims/') ||
    matchTemplate(ApiPath.userRatingHistory, path) !== null
  );
}

/**
 * 프로필 `scrim` 블록(S1 목 프로필이 부른다). 내전 시드가 없으면 만든 뒤 계산한다.
 * 모르는 사용자(목 멤버·나 아님)는 null.
 */
export function mockProfileScrim(ctx: Pick<MockS2Context, 'state' | 'me' | 'now' | 'save' | 'opts'>, userId: string): ProfileScrim | null {
  const state = ensureSeeded(ctx);
  if (userId !== ctx.me.id && !MOCK_SCRIM_USERS.some((u) => u.id === userId)) return null;
  const order = [...GAME_SEED].sort((a, b) => a.sort_order - b.sort_order).map((g) => g.code);
  return profileScrim(scenarioState(state, ctx.opts?.rankings?.scenario?.() ?? null, ctx.now), {
    userId,
    now: ctx.now,
    gameOrder: order,
    finished: state.scrims
      .filter((s) => s.status === 'finished')
      .flatMap((s) => {
        const row = state.players.find((p) => p.scrim_id === s.id && p.user_id === userId);
        return row
          ? [
              {
                scrimId: s.id,
                title: s.title,
                game: s.game,
                rated: s.rated,
                hasTeams: gameOf(s.game).has_teams,
                row,
                players: state.players.filter((p) => p.scrim_id === s.id).map((p) => ({ userId: p.user_id, status: p.status, team: p.team })),
              },
            ]
          : [];
      }),
  });
}

/** 프로필 `badges`(시즌 최종 순위에서 계산). 모르는 사용자는 [] */
export function mockProfileBadges(ctx: Pick<MockS2Context, 'state' | 'me' | 'now' | 'save' | 'opts'>, userId: string): ProfileBadge[] {
  return rankingProfileBadges(ensureSeeded(ctx), { userId, now: ctx.now, games: GAME_SEED, scenario: ctx.opts?.rankings?.scenario?.() ?? null });
}

/** S2·S3·S4 내전·랭킹 경로가 아니면 null */
export function handleS2(ctx: MockS2Context): Response | null {
  const { method, path, me, now, json, error } = ctx;
  if (!isS2Path(path)) return null;

  const state = ensureSeeded(ctx);
  const eloPolicy = mockEloPolicy(ctx.opts?.ratings);
  const policy = ctx.opts?.noShowPolicy ?? {
    threshold: NO_SHOW_THRESHOLD_DEFAULT,
    windowDays: NO_SHOW_WINDOW_DAYS_DEFAULT,
    restrictionDays: NO_SHOW_RESTRICTION_DAYS_DEFAULT,
  };
  const isAdmin = me.role === 'admin';
  const persist = () => ctx.save(state);

  const rowsOf = (scrimId: string) => state.players.filter((p) => p.scrim_id === scrimId);
  const joinedRows = (scrimId: string) => rowsOf(scrimId).filter((p) => p.status === 'joined');
  const waitRows = (scrimId: string) => orderWaitlist(rowsOf(scrimId).filter((p) => p.status === 'waitlist'));
  const canStart = (s: MockScrim) => {
    const g = gameOf(s.game);
    const joined = joinedRows(s.id).length;
    return canStartScrim({ requiresFull: g.start_requires_full, capacity: s.capacity, joinedCount: joined });
  };
  const restrictionOf = (userId: string) =>
    computeRestriction(
      state.players
        .filter((p) => p.user_id === userId && p.status === 'no_show' && p.no_show_marked_at)
        .map((p) => Date.parse(p.no_show_marked_at!)),
      now,
      policy,
    );

  // 자동 마감(5-5): 요청마다 밀린 것 처리
  let changed = false;
  for (const s of state.scrims) {
    if (!isOpen(s) || now < Date.parse(s.scheduled_at) + SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT * MIN_MS) continue;
    if (canStart(s)) Object.assign(s, { status: 'playing', started_at: iso(now), updated_at: iso(now) });
    else Object.assign(s, { status: 'cancelled', cancelled_at: iso(now), cancel_reason: 'not_started', updated_at: iso(now) });
    changed = true;
  }
  if (changed) persist();

  /** 서버 흐름 4단계 뒤: 대기열 승격 + recruiting ↔ full */
  const settleRoster = (s: MockScrim) => {
    let joined = joinedRows(s.id).length;
    for (const w of waitRows(s.id)) {
      if (joined >= s.capacity) break;
      w.status = 'joined'; // preferred_positions·joined_at 그대로(메인 기본값 7)
      joined += 1;
    }
    if (isOpen(s)) s.status = joined >= s.capacity ? 'full' : 'recruiting';
  };

  // ---- S3 공통 ----
  const tierSeed = (game: GameCode) => (userId: string) => tierSeedOf(game, userRef(userId, me), userId === me.id);
  const skillOf = (game: GameCode, userId: string) =>
    skillInfo(state, { userId, game, tierSeed: tierSeed(game)(userId), now, policy: eloPolicy });
  const resetTeams = (scrimId: string) => {
    for (const p of rowsOf(scrimId)) Object.assign(p, { team: null, position: null });
  };
  const joinedSet = (scrimId: string) => joinedRows(scrimId).map((p) => p.user_id).sort().join(',');
  const outcomeOf = (s: MockScrim): ScrimSummary['outcome'] => {
    if (s.status !== 'finished') return null;
    const r = state.results.find((x) => x.scrim_id === s.id && x.status === 'approved');
    if (!r) return null;
    if (r.winner_team) return { winner_team: r.winner_team, winner: null };
    const first = r.placements?.find((p) => p.placement === 1);
    return { winner_team: null, winner: first ? userRef(first.user_id, me) : null };
  };
  /** 상세 슬롯 순서(방장 → joined_at → user id) */
  const slotRows = (s: MockScrim) =>
    rowsOf(s.id)
      .filter((p) => p.status === 'joined' || p.status === 'no_show')
      .sort((a, b) => {
        const ha = a.user_id === s.host_id ? 0 : 1;
        const hb = b.user_id === s.host_id ? 0 : 1;
        return ha - hb || Date.parse(a.joined_at) - Date.parse(b.joined_at) || (a.user_id < b.user_id ? -1 : 1);
      });
  const balancePlayers = (s: MockScrim) =>
    slotRows(s)
      .filter((p) => p.status === 'joined')
      .map((p) => {
        const k = skillOf(s.game, p.user_id);
        return {
          userId: p.user_id,
          user: userRef(p.user_id, me),
          skill: k.skill,
          rating: k.rating,
          isNew: k.isNew,
          preferredPositions: p.preferred_positions,
          position: s.use_positions ? p.position : null,
          team: p.team,
        };
      });

  const summary = (s: MockScrim): ScrimSummary => {
    const rows = rowsOf(s.id);
    const joined = rows.filter((p) => p.status === 'joined');
    const noShow = rows.filter((p) => p.status === 'no_show').length;
    const mine = rows.find((p) => p.user_id === me.id && p.status !== 'cancelled');
    const g = gameOf(s.game);
    return ScrimSummary.parse({
      id: s.id,
      game: { code: g.code, name: g.name, has_positions: g.has_positions, has_teams: g.has_teams, positions: [...g.positions] },
      title: s.title,
      scheduled_at: s.scheduled_at,
      capacity: s.capacity,
      status: s.status,
      host: userRef(s.host_id, me),
      joined_count: isOpen(s) ? joined.length : joined.length + noShow,
      waitlist_count: rows.filter((p) => p.status === 'waitlist').length,
      options: { rated: s.rated, auto_balance: s.auto_balance, use_positions: s.use_positions },
      steam_app: s.steam_app,
      open_positions:
        isOpen(s) && s.use_positions
          ? computeOpenPositions(g.positions, s.capacity, joined.map((p) => p.preferred_positions[0] ?? null))
          : [],
      join_closed: isClosed(s, now),
      my_status: mine?.status ?? null,
      created_at: s.created_at,
      result_status: latestResult(state, s.id)?.status ?? null,
      outcome: outcomeOf(s),
    });
  };

  const detail = (s: MockScrim): ScrimDetail => {
    const rows = rowsOf(s.id);
    const players = slotRows(s);
    const waitlist = waitRows(s.id);
    const g = gameOf(s.game);
    const isManager = s.host_id === me.id || isAdmin;
    const active = activeResult(state, s.id);
    const latest = latestResult(state, s.id);
    const joinedPlayers = balancePlayers(s);
    const eligible = joinedPlayers.length;
    const canEditTeams = isManager && g.has_teams && (s.status === 'full' || s.status === 'playing') && !active;
    const teamsReady = joinedPlayers.some((p) => p.team === 'blue') && joinedPlayers.some((p) => p.team === 'orange');
    const pendingRow = latest?.status === 'pending' ? latest : null;
    const mine = rows.find((p) => p.user_id === me.id && p.status !== 'cancelled');
    const r = restrictionOf(me.id);
    const open = isOpen(s);
    const closed = isClosed(s, now);
    const isHost = s.host_id === me.id;
    const inRoster = mine?.status === 'joined' || mine?.status === 'waitlist';
    return ScrimDetail.parse({
      ...summary(s),
      rules: s.rules,
      started_at: s.started_at,
      cancelled_at: s.cancelled_at,
      cancel_reason: s.cancel_reason,
      updated_at: s.updated_at,
      players: players.map((p) => {
        const k = skillOf(s.game, p.user_id);
        return {
          user: userRef(p.user_id, me),
          status: p.status,
          is_host: p.user_id === s.host_id,
          preferred_positions: p.preferred_positions,
          joined_at: p.joined_at,
          position: p.position,
          team: p.team,
          no_show_marked_at: p.status === 'no_show' ? p.no_show_marked_at : null,
          position_preference: p.team && p.position && s.use_positions ? positionPreferenceOf(p.preferred_positions, p.position) : null,
          skill: k.skill,
          is_new: k.isNew,
        };
      }),
      waitlist: waitlist.map((p, i) => ({
        order: i + 1,
        user: userRef(p.user_id, me),
        preferred_positions: p.preferred_positions,
        joined_at: p.joined_at,
      })),
      viewer: {
        status: mine?.status ?? null,
        waitlist_order: mine?.status === 'waitlist' ? waitlist.findIndex((w) => w.id === mine.id) + 1 : null,
        preferred_positions: inRoster ? mine.preferred_positions : [],
        is_host: isHost,
        restricted_until: r.until !== null ? iso(r.until) : null,
        can_join: open && !closed && !inRoster && !r.restricted,
        can_leave: open && !closed && inRoster && !isHost,
        can_edit: isHost && open,
        can_cancel: (isHost || isAdmin) && open,
        can_start: (isHost || isAdmin) && open && canStart(s),
        can_mark_no_show:
          isAdmin &&
          (s.status === 'playing' || s.status === 'finished') &&
          now <= Date.parse(s.scheduled_at) + NO_SHOW_MARK_WINDOW_DAYS_DEFAULT * DAY_MS,
        can_edit_teams: canEditTeams,
        can_balance: canEditTeams && s.auto_balance && eligible >= BALANCE_PLAYERS_MIN && eligible <= BALANCE_PLAYERS_MAX,
        can_submit_result:
          isManager && s.status === 'playing' && !active && (g.has_teams ? teamsReady : eligible >= BALANCE_PLAYERS_MIN),
        can_withdraw_result: !!pendingRow && (pendingRow.submitted_by === me.id || isHost),
        can_review_result: isAdmin && !!pendingRow && pendingRow.submitted_by !== me.id,
      },
      balance: g.has_teams
        ? teamsView({ joined: joinedPlayers, usePositions: s.use_positions, rated: s.rated, policy: eloPolicy })
        : null,
      result: latest
        ? resultView(state, latest, {
            rated: s.rated,
            hasTeams: g.has_teams,
            userRef: (uid2) => userRef(uid2, me),
            teamOf: (uid2) => rows.find((p) => p.user_id === uid2)?.team ?? null,
          })
        : null,
    });
  };

  const banned = (r: ReturnType<typeof restrictionOf>) =>
    error('SCRIM_BANNED', '노쇼 누적으로 참가·작성이 제한되었습니다.', {
      retryAfterSec: Math.ceil(((r.until ?? now) - now) / 1000),
    });
  const invalidId = (name: string, v: string) =>
    Uuid.safeParse(v).success ? null : error('VALIDATION_FAILED', `${name} 형식이 올바르지 않습니다.`, { details: [{ path: name, message: 'uuid' }] });
  const scheduleIssue = (at: string): string | null => {
    const t = Date.parse(at);
    if (t <= now) return '시작 시각은 지금보다 뒤여야 해요';
    if (t > now + SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT * DAY_MS) return `시작 시각은 ${SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT}일 안이어야 해요`;
    return null;
  };
  const notInStore = { path: 'steam_app_id', message: '스팀 상점에서 찾을 수 없는 게임입니다.' };
  const capacityIssue = (game: GameSeed, cap: number): string | null =>
    cap < game.capacity_min || cap > game.capacity_max || (cap - game.capacity_min) % game.capacity_step !== 0
      ? `정원은 ${game.capacity_min}–${game.capacity_max}명${game.capacity_step > 1 ? ` ${game.capacity_step}명 단위` : ''}이에요`
      : null;

  // S4 GET /rankings/tier·elo, /dashboard/summary
  if (isRankingPath(path)) {
    return handleRankings({
      policy: eloPolicy,
      method,
      path,
      search: ctx.search,
      me,
      now,
      state,
      scrims: state.scrims,
      members: MOCK_SCRIM_USERS,
      userRef: (uid2) => userRef(uid2, me),
      summary: (s) => summary(s as MockScrim),
      joinedUsers: (s) => slotRows(s as MockScrim).filter((p) => p.status === 'joined').map((p) => userRef(p.user_id, me)),
      games: [...GAME_SEED].sort((a, b) => a.sort_order - b.sort_order),
      json,
      error,
      scenario: ctx.opts?.rankings?.scenario?.() ?? null,
    });
  }

  // GET /games
  if (path === ApiPath.games && method === 'GET') {
    const res: ListGamesResponse = { items: mockGames(), next_cursor: null };
    return json(200, res);
  }

  // GET /steam-apps?q=
  if (path === ApiPath.steamApps && method === 'GET') {
    const parsed = SearchSteamAppsQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!parsed.success) return error('VALIDATION_FAILED', '검색어가 올바르지 않습니다.', { details: issues(parsed.error) });
    const q = parsed.data.q.toLowerCase();
    const owned = MOCK_STEAM_APPS.filter((a) => a.owner_count > 0);
    let res: SearchSteamAppsResponse;
    if (q === '') res = { items: owned.slice(0, STEAM_APP_SEARCH_LIMIT), store_unavailable: false };
    else {
      const storeDown = q.includes('상점오류');
      const hit = (a: SteamAppOption) => a.name.toLowerCase().includes(q);
      const mine = owned.filter(hit).slice(0, 10);
      const store = storeDown ? [] : MOCK_STEAM_APPS.filter((a) => hit(a) && !mine.includes(a));
      res = { items: [...mine, ...store].slice(0, STEAM_APP_SEARCH_LIMIT), store_unavailable: storeDown };
    }
    return json(200, res);
  }

  // GET /me/scrim-restriction
  if (path === ApiPath.myScrimRestriction && method === 'GET') {
    const r = restrictionOf(me.id);
    return json(
      200,
      ScrimRestriction.parse({
        restricted: r.restricted,
        until: r.until !== null ? iso(r.until) : null,
        recent_no_show_count: r.recentCount,
        last_no_show_at: r.last !== null ? iso(r.last) : null,
        policy: {
          threshold: policy.threshold,
          window_days: policy.windowDays,
          restriction_days: policy.restrictionDays,
          mark_window_days: NO_SHOW_MARK_WINDOW_DAYS_DEFAULT,
        },
        scrim_policy: {
          schedule_max_days_ahead: SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT,
          auto_close_after_min: SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT,
        },
      }),
    );
  }

  // GET /scrims
  if (path === ApiPath.scrims && method === 'GET') {
    const parsed = ListScrimsQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!parsed.success) return error('VALIDATION_FAILED', '쿼리가 올바르지 않습니다.', { details: issues(parsed.error) });
    const q = parsed.data;
    const statuses = { open: ['recruiting', 'full'], playing: ['playing'], ended: ['finished', 'cancelled'] }[q.status];
    const asc = q.status === 'open';
    const cmp = (a: MockScrim, b: MockScrim) => {
      const d = Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return asc ? d : -d;
    };
    let list = state.scrims.filter((s) => statuses.includes(s.status) && (!q.game || s.game === q.game)).sort(cmp);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c || c.t !== q.status) {
        return error('VALIDATION_FAILED', '커서가 올바르지 않습니다.', { details: [{ path: 'cursor', message: 'invalid cursor' }] });
      }
      const key = { scheduled_at: c.s, id: c.id } as MockScrim;
      list = list.filter((s) => cmp(s, key) > 0);
    }
    const page = list.slice(0, q.limit);
    const last = page[page.length - 1];
    const res: ListScrimsResponse = {
      items: page.map(summary),
      next_cursor: list.length > q.limit && last ? encodeCursor({ t: q.status, s: last.scheduled_at, id: last.id }) : null,
    };
    return json(200, res);
  }

  // POST /scrims
  if (path === ApiPath.scrims && method === 'POST') {
    const parsed = CreateScrimRequest.safeParse(ctx.body);
    if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
    const b = parsed.data;
    const game = gameOf(b.game);
    const usePositions = b.use_positions && game.has_positions;
    const details: { path: string; message: string }[] = [];
    const si = scheduleIssue(b.scheduled_at);
    if (si) details.push({ path: 'scheduled_at', message: si });
    const ci = capacityIssue(game, b.capacity);
    if (ci) details.push({ path: 'capacity', message: ci });
    const pi = validatePositions(b.host_preferred_positions, game.positions, usePositions);
    if (pi) details.push({ path: 'host_preferred_positions', message: pi });
    const appId = b.steam_app_id ?? null;
    if (game.requires_steam_app && appId === null) details.push({ path: 'steam_app_id', message: '스팀 게임을 골라 주세요.' });
    if (!game.requires_steam_app && appId !== null) details.push({ path: 'steam_app_id', message: '이 게임은 스팀 게임을 고를 수 없습니다.' });
    if (details.length) return error('VALIDATION_FAILED', '입력값을 확인해 주세요.', { details });
    const r = restrictionOf(me.id);
    if (r.restricted) return banned(r);
    const app = appId === null ? null : steamApp(appId);
    if (appId !== null && !app) return error('VALIDATION_FAILED', '입력값을 확인해 주세요.', { details: [notInStore] });
    const s: MockScrim = {
      id: crypto.randomUUID(),
      game: b.game,
      title: b.title,
      scheduled_at: iso(Date.parse(b.scheduled_at)),
      capacity: b.capacity,
      status: 'recruiting',
      host_id: me.id,
      rules: b.rules ?? null,
      rated: b.rated,
      auto_balance: b.auto_balance && game.has_teams,
      use_positions: usePositions,
      steam_app: app,
      started_at: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: iso(now),
      updated_at: iso(now),
    };
    state.scrims.push(s);
    state.players.push({
      id: crypto.randomUUID(),
      scrim_id: s.id,
      user_id: me.id,
      status: 'joined',
      preferred_positions: usePositions ? b.host_preferred_positions : [],
      joined_at: iso(now),
      no_show_marked_at: null,
      no_show_marked_by: null,
      team: null,
      position: null,
    });
    persist();
    return json(201, detail(s));
  }

  // ---------------------------------------------------------------------------
  // S3 (계약 S3 4·5절)
  // ---------------------------------------------------------------------------

  // GET /seasons
  if (path === ApiPath.seasons && method === 'GET') {
    return json(200, seasonsResponse(scenarioState(state, ctx.opts?.rankings?.scenario?.() ?? null, now), now));
  }

  // GET /users/:id/rating-history?game&season
  let m = matchTemplate(ApiPath.userRatingHistory, path);
  if (m && method === 'GET') {
    const bad = invalidId('id', m.id!);
    if (bad) return bad;
    const parsed = GetUserRatingHistoryQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!parsed.success) return error('VALIDATION_FAILED', '쿼리가 올바르지 않습니다.', { details: issues(parsed.error) });
    if (m.id !== me.id && !MOCK_SCRIM_USERS.some((u) => u.id === m!.id)) return error('NOT_FOUND', '사용자 없음');
    const res = ratingHistory(state, {
      userId: m.id!,
      game: parsed.data.game,
      seasonId: parsed.data.season,
      now,
      scrimTitle: (sid) => state.scrims.find((x) => x.id === sid)?.title ?? '',
    });
    if (!res) return error('NOT_FOUND', '시즌 없음');
    return json(200, res);
  }

  // POST /scrims/:id/result/approve · /reject — 역할 검사가 먼저(@Roles('admin'))
  for (const [template, action] of [
    [ApiPath.scrimResultApprove, 'approve'],
    [ApiPath.scrimResultReject, 'reject'],
  ] as const) {
    m = matchTemplate(template, path);
    if (!m || method !== 'POST') continue;
    if (!isAdmin) return error('FORBIDDEN', '운영진만 승인·반려할 수 있습니다.');
    const bad = invalidId('id', m.id!);
    if (bad) return bad;
    const parsed = (action === 'approve' ? ApproveScrimResultRequest : RejectScrimResultRequest).safeParse(ctx.body);
    if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
    const s = state.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    const pendingRow = state.results.find((r) => r.scrim_id === s.id && r.status === 'pending');
    if (!pendingRow || pendingRow.id !== parsed.data.result_id) return error('SCRIM_RESULT_NOT_PENDING', '대기 중인 결과 없음');
    if (pendingRow.submitted_by === me.id) return error('SCRIM_RESULT_SELF_REVIEW', '자기 제출');
    if (action === 'reject') {
      const reason = 'reason' in parsed.data ? (parsed.data.reason as string) : '';
      Object.assign(pendingRow, { status: 'rejected', rejected_by: me.id, rejected_at: iso(now), reject_reason: reason });
    } else {
      if (s.status !== 'playing') return error('INTERNAL_ERROR', '진행 중이 아닌 내전의 pending 결과');
      applyApproval(state, {
        scrimId: s.id,
        game: s.game,
        hasTeams: gameOf(s.game).has_teams,
        rated: s.rated,
        players: rowsOf(s.id).map((p) => ({ userId: p.user_id, status: p.status, team: p.team })),
        result: pendingRow,
        now,
        approverId: me.id,
        policy: eloPolicy,
        seasonLengthMonths: ctx.opts?.ratings?.seasonLengthMonths,
        newId: () => crypto.randomUUID(),
      });
      s.status = 'finished';
    }
    s.updated_at = iso(now);
    persist();
    return json(200, detail(s));
  }

  // POST /scrims/:id/balance · PUT /teams · POST·DELETE /result
  for (const [template, action] of [
    [ApiPath.scrimBalance, 'balance'],
    [ApiPath.scrimTeams, 'teams'],
    [ApiPath.scrimResult, 'result'],
  ] as const) {
    m = matchTemplate(template, path);
    if (!m) continue;
    const bad = invalidId('id', m.id!);
    if (bad) return bad;
    const s = state.scrims.find((x) => x.id === m!.id);
    const g = s ? gameOf(s.game) : null;
    const isManager = !!s && (s.host_id === me.id || isAdmin);
    const teamsLocked = (x: MockScrim) =>
      !gameOf(x.game).has_teams || (x.status !== 'full' && x.status !== 'playing') || activeResult(state, x.id) !== null;

    if (action === 'balance' && method === 'POST') {
      const parsed = BalanceScrimRequest.safeParse(ctx.body ?? {});
      if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
      if (!s || !g) return error('NOT_FOUND', '내전 없음');
      if (!isManager) return error('FORBIDDEN', '방장·운영진만');
      if (teamsLocked(s)) return error('SCRIM_TEAMS_NOT_EDITABLE', '팀 수정 불가');
      const players = balancePlayers(s);
      if (!s.auto_balance || players.length < BALANCE_PLAYERS_MIN || players.length > BALANCE_PLAYERS_MAX) {
        return error('SCRIM_BALANCE_UNAVAILABLE', '밸런스 불가');
      }
      try {
        return json(
          200,
          balanceResponse({ players, usePositions: s.use_positions && g.has_positions, positions: g.positions, rated: s.rated, policy: eloPolicy }),
        );
      } catch (e) {
        if (e instanceof RangeError) return error('SCRIM_BALANCE_UNAVAILABLE', e.message);
        throw e;
      }
    }

    if (action === 'teams' && method === 'PUT') {
      const parsed = SaveScrimTeamsRequest.safeParse(ctx.body);
      if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
      if (!s || !g) return error('NOT_FOUND', '내전 없음');
      if (!isManager) return error('FORBIDDEN', '방장·운영진만');
      if (teamsLocked(s)) return error('SCRIM_TEAMS_NOT_EDITABLE', '팀 수정 불가');
      const usePositions = s.use_positions && g.has_positions;
      const toCore = (slots: { user_id: string; position: string | null }[]) => slots.map((x) => ({ userId: x.user_id, position: x.position }));
      const problems = validateTeamAssignment({
        eligibleUserIds: joinedRows(s.id).map((p) => p.user_id),
        blue: toCore(parsed.data.blue),
        orange: toCore(parsed.data.orange),
        usePositions,
        positions: g.positions,
      });
      if (problems.length) return error('VALIDATION_FAILED', '팀 구성을 확인해 주세요.', { details: problems });
      resetTeams(s.id);
      for (const team of ['blue', 'orange'] as const) {
        for (const slot of parsed.data[team]) {
          const row = rowsOf(s.id).find((p) => p.user_id === slot.user_id)!;
          Object.assign(row, { team, position: usePositions ? slot.position : null });
        }
      }
      s.updated_at = iso(now);
      persist();
      return json(200, detail(s));
    }

    if (action === 'result' && method === 'POST') {
      const parsed = SubmitScrimResultRequest.safeParse(ctx.body);
      if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
      if (!s || !g) return error('NOT_FOUND', '내전 없음');
      if (!isManager) return error('FORBIDDEN', '방장·운영진만');
      if (s.status !== 'playing') return error('SCRIM_RESULT_NOT_ALLOWED', '진행 중 아님');
      if (activeResult(state, s.id)) return error('SCRIM_RESULT_EXISTS', '이미 결과 있음');
      const body = parsed.data;
      const isTeam = 'winner_team' in body;
      if (g.has_teams !== isTeam) {
        // API와 같게 path = 잘못 보낸 필드(팀 게임에 placements → 'placements', 개인 순위 게임에 winner_team → 'winner_team')
        const p = g.has_teams ? 'placements' : 'winner_team';
        return error('VALIDATION_FAILED', '게임에 맞지 않는 결과 형식입니다.', { details: [{ path: p, message: '이 게임의 결과 형식이 아님' }] });
      }
      const joined = joinedRows(s.id);
      if ('winner_team' in body) {
        if (!joined.some((p) => p.team === 'blue') || !joined.some((p) => p.team === 'orange')) {
          return error('SCRIM_TEAMS_REQUIRED', '팀 미구성');
        }
      } else {
        const problems = validatePlacementUsers({
          eligibleUserIds: joined.map((p) => p.user_id),
          placements: body.placements.map((p) => ({ userId: p.user_id })),
        });
        if (problems.length) return error('VALIDATION_FAILED', '순위를 확인해 주세요.', { details: problems });
      }
      state.results.push({
        id: crypto.randomUUID(),
        scrim_id: s.id,
        status: 'pending',
        winner_team: 'winner_team' in body ? body.winner_team : null,
        placements: 'placements' in body ? body.placements : null,
        submitted_by: me.id,
        created_at: iso(now),
        approved_by: null,
        approved_at: null,
        rejected_by: null,
        rejected_at: null,
        reject_reason: null,
      });
      s.updated_at = iso(now);
      persist();
      return json(200, detail(s));
    }

    if (action === 'result' && method === 'DELETE') {
      if (!s) return error('NOT_FOUND', '내전 없음');
      const pendingRow = state.results.find((r) => r.scrim_id === s.id && r.status === 'pending');
      if (!pendingRow) return error('SCRIM_RESULT_NOT_PENDING', '대기 중인 결과 없음');
      if (pendingRow.submitted_by !== me.id && s.host_id !== me.id) return error('FORBIDDEN', '제출자·방장만');
      state.results = state.results.filter((r) => r.id !== pendingRow.id);
      s.updated_at = iso(now);
      persist();
      return json(200, detail(s));
    }
  }

  // PUT /scrims/:id/players/:userId/no-show — 역할 검사가 먼저(@Roles('admin'))
  m = matchTemplate(ApiPath.scrimPlayerNoShow, path);
  if (m && method === 'PUT') {
    if (!isAdmin) return error('FORBIDDEN', '운영진만 노쇼를 표시할 수 있습니다.');
    const bad = invalidId('id', m.id!) ?? invalidId('userId', m.userId!);
    if (bad) return bad;
    const parsed = SetScrimNoShowRequest.safeParse(ctx.body);
    if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
    const s = state.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    if (s.status !== 'playing' && s.status !== 'finished') return error('SCRIM_NO_SHOW_NOT_ALLOWED', '시작 전');
    const row = rowsOf(s.id).find((p) => p.user_id === m!.userId);
    if (!row) return error('NOT_FOUND', '참가 기록 없음');
    if (row.status !== 'joined' && row.status !== 'no_show') return error('SCRIM_NO_SHOW_NOT_ALLOWED', '대상 아님');
    if (parsed.data.no_show && row.status === 'joined') {
      if (now > Date.parse(s.scheduled_at) + NO_SHOW_MARK_WINDOW_DAYS_DEFAULT * DAY_MS) {
        return error('SCRIM_NO_SHOW_NOT_ALLOWED', '표시 기한 경과');
      }
      Object.assign(row, { status: 'no_show', no_show_marked_at: iso(now), no_show_marked_by: me.id });
      s.updated_at = iso(now);
      persist();
    } else if (!parsed.data.no_show && row.status === 'no_show') {
      Object.assign(row, { status: 'joined', no_show_marked_at: null, no_show_marked_by: null });
      s.updated_at = iso(now);
      persist();
    }
    return json(200, detail(s));
  }

  // /scrims/:id/join | start | cancel
  for (const [template, action] of [
    [ApiPath.scrimJoin, 'join'],
    [ApiPath.scrimStart, 'start'],
    [ApiPath.scrimCancel, 'cancel'],
  ] as const) {
    m = matchTemplate(template, path);
    if (!m) continue;
    const bad = invalidId('id', m.id!);
    if (bad) return bad;
    const s = state.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    const isHost = s.host_id === me.id;
    const game = gameOf(s.game);

    if (action === 'join' && method === 'POST') {
      // 본문 필수(서버와 같게): 포지션 없는 게임도 {}를 보낸다. 본문이 없으면 VALIDATION_FAILED
      const parsed = JoinScrimRequest.safeParse(ctx.body);
      if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      if (isClosed(s, now)) return error('SCRIM_JOIN_CLOSED', '시작 시각 지남');
      const pi = validatePositions(parsed.data.preferred_positions, game.positions, s.use_positions);
      if (pi) return error('VALIDATION_FAILED', '희망 포지션을 확인해 주세요.', { details: [{ path: 'preferred_positions', message: pi }] });
      const mine = rowsOf(s.id).find((p) => p.user_id === me.id);
      if (mine && (mine.status === 'joined' || mine.status === 'waitlist')) {
        mine.preferred_positions = parsed.data.preferred_positions;
        s.updated_at = iso(now);
        persist();
        return json(200, detail(s));
      }
      const r = restrictionOf(me.id);
      if (r.restricted) return banned(r);
      const beforeJoin = joinedSet(s.id);
      const placed = joinedRows(s.id).length < s.capacity ? 'joined' : 'waitlist';
      // 재참가 행은 방어적으로 team·position도 지운다(S3 5-1)
      if (mine) Object.assign(mine, { status: placed, preferred_positions: parsed.data.preferred_positions, joined_at: iso(now), team: null, position: null });
      else {
        state.players.push({
          id: crypto.randomUUID(),
          scrim_id: s.id,
          user_id: me.id,
          status: placed,
          preferred_positions: parsed.data.preferred_positions,
          joined_at: iso(now),
          no_show_marked_at: null,
          no_show_marked_by: null,
          team: null,
          position: null,
        });
      }
      settleRoster(s);
      // S3 5-1(리더 수용: backend 변경 요청 1): 새 참가로 joined 집합이 바뀌어도 팀 전원 초기화
      if (joinedSet(s.id) !== beforeJoin) resetTeams(s.id);
      s.updated_at = iso(now);
      persist();
      return json(200, detail(s));
    }

    if (action === 'join' && method === 'DELETE') {
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      if (isClosed(s, now)) return error('SCRIM_JOIN_CLOSED', '시작 시각 지남');
      if (isHost) return error('SCRIM_HOST_CANNOT_LEAVE', '방장은 취소 불가');
      const mine = rowsOf(s.id).find((p) => p.user_id === me.id);
      if (mine && (mine.status === 'joined' || mine.status === 'waitlist')) {
        const before = joinedSet(s.id);
        mine.status = 'cancelled';
        settleRoster(s);
        // S3 5-1: joined 집합이 바뀌면 팀 배정 전원 초기화(D110)
        if (joinedSet(s.id) !== before) resetTeams(s.id);
        s.updated_at = iso(now);
        persist();
      }
      return json(200, detail(s));
    }

    if (action === 'start' && method === 'POST') {
      if (!isHost && !isAdmin) return error('FORBIDDEN', '방장·운영진만');
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      if (!canStart(s)) return error('SCRIM_CANNOT_START', '시작 조건 미충족');
      Object.assign(s, { status: 'playing', started_at: iso(now), updated_at: iso(now) });
      persist();
      return json(200, detail(s));
    }

    if (action === 'cancel' && method === 'POST') {
      if (!isHost && !isAdmin) return error('FORBIDDEN', '방장·운영진만');
      if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
      Object.assign(s, { status: 'cancelled', cancelled_at: iso(now), cancel_reason: isHost ? 'host' : 'admin', updated_at: iso(now) });
      persist();
      return json(200, detail(s));
    }
  }

  // GET·PATCH /scrims/:id
  m = matchTemplate(ApiPath.scrim, path);
  if (m && (method === 'GET' || method === 'PATCH')) {
    const bad = invalidId('id', m.id!);
    if (bad) return bad;
    const s = state.scrims.find((x) => x.id === m!.id);
    if (!s) return error('NOT_FOUND', '내전 없음');
    if (method === 'GET') return json(200, detail(s));

    const parsed = UpdateScrimRequest.safeParse(ctx.body);
    if (!parsed.success) return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', { details: issues(parsed.error) });
    if (s.host_id !== me.id) return error('FORBIDDEN', '방장만 수정');
    if (!isOpen(s)) return error('SCRIM_NOT_RECRUITING', '모집 중 아님');
    const b = parsed.data;
    const game = gameOf(s.game);
    const details: { path: string; message: string }[] = [];
    if (b.scheduled_at !== undefined) {
      const si = scheduleIssue(b.scheduled_at);
      if (si) details.push({ path: 'scheduled_at', message: si });
    }
    if (b.capacity !== undefined) {
      const ci = capacityIssue(game, b.capacity);
      if (ci) details.push({ path: 'capacity', message: ci });
    }
    const app = b.steam_app_id === undefined ? undefined : steamApp(b.steam_app_id);
    if (b.steam_app_id !== undefined && !game.requires_steam_app) {
      details.push({ path: 'steam_app_id', message: '이 게임은 스팀 게임을 고를 수 없습니다.' });
    } else if (app === null) details.push(notInStore);
    if (details.length) return error('VALIDATION_FAILED', '입력값을 확인해 주세요.', { details });
    if (b.capacity !== undefined && b.capacity < joinedRows(s.id).length) {
      return error('SCRIM_CAPACITY_BELOW_JOINED', '정원 < 참가 인원');
    }
    if (b.title !== undefined) s.title = b.title;
    if (b.scheduled_at !== undefined) s.scheduled_at = iso(Date.parse(b.scheduled_at));
    if (b.rules !== undefined) s.rules = b.rules ?? null;
    if (b.rated !== undefined) s.rated = b.rated;
    if (b.auto_balance !== undefined) s.auto_balance = b.auto_balance && game.has_teams;
    if (app) s.steam_app = app;
    if (b.capacity !== undefined) {
      const before = joinedSet(s.id);
      s.capacity = b.capacity;
      settleRoster(s);
      if (joinedSet(s.id) !== before) resetTeams(s.id);
    }
    s.updated_at = iso(now);
    persist();
    return json(200, detail(s));
  }

  return null;
}
