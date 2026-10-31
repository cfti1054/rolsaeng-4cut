import { z } from 'zod';
import { PaginationQuery, paginated } from './common/pagination';
import { IsoDateTime, Uuid } from './common/primitives';
import { ScrimCancelReason, ScrimPlayerStatus, ScrimResultStatus, ScrimStatus, ScrimTeam } from './constants/enums';
import { GameCode } from './constants/games';
import { RECENT_MATCHES_MAX } from './constants/riot';
import { SeasonRef } from './seasons';
import { SteamAppId, SteamAppRef } from './steam-apps';

// =============================================================================
// S2 내전 모집·참가·대기열·노쇼 제한. 계약: _workspace/S2/01_architect_contract.md 4–8절
// S3 팀 구성·결과·레이팅 응답 조각과 ScrimSummary·ScrimDetail 확장. 계약: _workspace/01_architect_contract.md(S3) 4·9절
// (S3 요청 스키마는 scrim-results.ts)
//
// 응답 공통 규칙
// - 상태를 바꾸는 엔드포인트(생성·수정·참가·취소·시작·모집 취소·노쇼 표시, S3 팀 저장·결과 제출·제출 취소·승인·반려)는
//   모두 갱신 후 ScrimDetail을 돌려준다.
//   웹은 응답으로 상세 캐시를 바꾸고 목록 캐시만 무효화한다.
// - 서버 시각 기준 판단(join_closed, viewer.can_*)은 서버가 계산해 내려준다(클라이언트 시계 오차 방지).
// =============================================================================

// -----------------------------------------------------------------------------
// 상수 (환경 변수 기본값. 실제 값은 API 설정에서 읽는다 — 계약 11절)
// -----------------------------------------------------------------------------

export const SCRIM_TITLE_MIN_LENGTH = 2;
export const SCRIM_TITLE_MAX_LENGTH = 40;
export const SCRIM_RULES_MAX_LENGTH = 1000;
/** 희망 포지션 최대 개수(1지망·2지망) */
export const SCRIM_PREFERRED_POSITIONS_MAX = 2;
/** 시작 시각은 지금보다 뒤, 최대 이 일수 뒤까지(환경 변수 SCRIM_SCHEDULE_MAX_DAYS_AHEAD) */
export const SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT = 30;
/** 시작 시각 + 이 분이 지나도 시작하지 않은 모집글을 자동 마감(SCRIM_AUTO_CLOSE_AFTER_MIN, D78) */
export const SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT = 60;
/** 포지션이 없는 게임의 최소 시작 인원(방장 포함) */
export const SCRIM_MIN_PLAYERS_TO_START = 2;

/**
 * 노쇼 제한 규칙: 최근 30일 3회 → 마지막 노쇼 표시 시각부터 1일 제한. 환경 변수로 조정.
 * 아래 `*_DEFAULT`는 API env 기본값·목 백엔드 전용이다. 웹 화면 문구·사전 검사는
 * GET /me/scrim-restriction의 policy·scrim_policy를 쓴다(D101).
 */
export const NO_SHOW_THRESHOLD_DEFAULT = 3;
export const NO_SHOW_WINDOW_DAYS_DEFAULT = 30;
export const NO_SHOW_RESTRICTION_DAYS_DEFAULT = 1;
/** 운영진이 노쇼를 표시할 수 있는 기한: 시작 시각(scheduled_at)부터 이 일수까지(D83). 정정(해제)은 기한 없음 */
export const NO_SHOW_MARK_WINDOW_DAYS_DEFAULT = 7;

// ---- S3 레이팅·밸런스 (계약 S3 7·12절) ----
// `*_DEFAULT`는 API env 기본값·목 백엔드 전용. 화면 문구는 BalanceScrimResponse.rating_policy를 쓴다(D101과 같은 규칙).

/** ELO 기본 K(SCRIM_ELO_K_BASE, 문서 7-1) */
export const SCRIM_ELO_K_BASE_DEFAULT = 32;
/** 신규 멤버 K(SCRIM_ELO_K_NEW) */
export const SCRIM_ELO_K_NEW_DEFAULT = 40;
/** 「신규」 기준: 그 게임의 승인된 rated 내전 경기 수(모든 시즌 합계)가 이 값 미만(SCRIM_ELO_NEW_PLAYER_GAMES) */
export const SCRIM_ELO_NEW_PLAYER_GAMES_DEFAULT = 10;
/**
 * 점수가 내려갈 때 곱하는 패배 배율(SCRIM_ELO_LOSS_RATIO, 0 이상 1 이하). 1이면 승패가 같은 크기다.
 * 화면 문구는 응답 rating_policy.loss_ratio를 쓴다(D169, D176).
 */
export const SCRIM_ELO_LOSS_RATIO_DEFAULT = 0.5;
/**
 * 내전 ELO 시작 점수. 티어와 무관하게 모든 (사용자, 게임, 시즌) ratings 행이 이 값으로 시작하고,
 * 새 시즌마다 다시 이 값에서 시작한다(소프트 리셋 없음, 계약 S4 20절 D182·D183). 설정값 아님
 */
export const RATING_START_ELO = 1000;
/**
 * 밸런스 실력값에서 내전 ELO의 최대 비중(계약 S4 20절 D187). 티어 비중은 최소 1 − 이 값.
 * w = BALANCE_ELO_WEIGHT_MAX × min(현재 시즌 경기 수 ÷ BALANCE_FULL_WEIGHT_GAMES, 1). 설정값 아님
 */
export const BALANCE_ELO_WEIGHT_MAX = 0.2;
/** w가 최대(BALANCE_ELO_WEIGHT_MAX)에 닿는 현재 시즌 내전 경기 수. 설정값 아님(D187) */
export const BALANCE_FULL_WEIGHT_GAMES = 10;
/** 밸런스 결과 안 최대 개수(문서 7-2 4번) */
export const BALANCE_OPTIONS_MAX = 3;
/** 밸런스·팀 구성 인원 범위(팀에 넣을 참가 확정 인원). 16명 = C(16,8)/2 = 6435가지 */
export const BALANCE_PLAYERS_MIN = 2;
export const BALANCE_PLAYERS_MAX = 16;
/** 결과 반려 사유 길이(정규화 후) */
export const SCRIM_REJECT_REASON_MIN_LENGTH = 2;
export const SCRIM_REJECT_REASON_MAX_LENGTH = 200;

// -----------------------------------------------------------------------------
// 입력 조각
// -----------------------------------------------------------------------------

/** 제목: 앞뒤 공백 제거·연속 공백 1개로 정규화 후 2–40자 */
export const ScrimTitle = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(SCRIM_TITLE_MIN_LENGTH).max(SCRIM_TITLE_MAX_LENGTH));
export type ScrimTitle = z.infer<typeof ScrimTitle>;

/** 규칙(자유 텍스트, 줄바꿈 허용): 앞뒤 공백 제거 후 최대 1000자. 빈 문자열은 null로 저장 */
export const ScrimRules = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().max(SCRIM_RULES_MAX_LENGTH))
  .transform((v) => (v === '' ? null : v));
export type ScrimRules = z.infer<typeof ScrimRules>;

/**
 * 포지션 코드 형식만 검사한다. 값이 그 게임의 games.positions에 있는지는 서버가 DB 기준으로 검사한다
 * (게임은 데이터, 설계 원칙 3). 롤은 'top' | 'jungle' | 'mid' | 'bot' | 'support'.
 */
export const ScrimPosition = z.string().regex(/^[a-z][a-z0-9_]{0,19}$/, 'position: 소문자 코드');
export type ScrimPosition = z.infer<typeof ScrimPosition>;

/**
 * 희망 포지션, 1지망부터 순서대로 0–2개, 중복 금지.
 * 포지션을 받는 내전(게임 has_positions && 모집글 use_positions)이면 서버가 1개 이상을 요구하고,
 * 그 밖의 내전이면 빈 배열만 허용한다(위반 시 VALIDATION_FAILED, details path = 이 필드).
 */
export const PreferredPositions = z
  .array(ScrimPosition)
  .max(SCRIM_PREFERRED_POSITIONS_MAX)
  .refine((a) => new Set(a).size === a.length, 'preferred_positions: 같은 포지션을 두 번 고를 수 없음');
export type PreferredPositions = z.infer<typeof PreferredPositions>;

// -----------------------------------------------------------------------------
// 응답 조각
// -----------------------------------------------------------------------------

/** 내전 화면에 나오는 사용자(공개 정보만, D38과 같은 원칙) */
export const ScrimUserRef = z.object({
  id: Uuid,
  nickname: z.string(),
  avatar_url: z.string().url().nullable(),
});
export type ScrimUserRef = z.infer<typeof ScrimUserRef>;

/** 내전의 게임(games 행 요약) */
export const ScrimGameRef = z.object({
  code: GameCode,
  name: z.string(),
  has_positions: z.boolean(),
  has_teams: z.boolean(),
  positions: z.array(z.string()),
});
export type ScrimGameRef = z.infer<typeof ScrimGameRef>;

/**
 * 진행 방식(목업 ScrimNew 「03 진행 방식」, D77). 저장값이 아니라 **적용값**:
 * auto_balance = 입력 && has_teams, use_positions = 입력 && has_positions. rated는 입력 그대로.
 * S2는 저장·표시만 하고 동작은 S3(밸런스·레이팅)에서 쓴다. use_positions만 S2 참가 검증에 쓴다.
 */
export const ScrimOptions = z.object({
  rated: z.boolean(),
  auto_balance: z.boolean(),
  use_positions: z.boolean(),
});
export type ScrimOptions = z.infer<typeof ScrimOptions>;

/**
 * 포지션별 남은 자리(목업 「서폿 1 · 정글 1 구함」). core computeOpenPositions 결과.
 * 불변식(D100): 배열의 count 합계 ≤ 빈 자리(capacity − joined_count). 넘을 상황이면 서버가 []를 내려
 * 카드는 「N자리 남음」으로 표시한다.
 */
export const OpenPosition = z.object({
  position: z.string(),
  count: z.number().int().min(1),
});
export type OpenPosition = z.infer<typeof OpenPosition>;

/** 내 참가 상태. cancelled 행은 「참가 안 함」과 같으므로 null로 내려준다 */
export const MyScrimStatus = ScrimPlayerStatus.exclude(['cancelled']);
export type MyScrimStatus = z.infer<typeof MyScrimStatus>;

// -----------------------------------------------------------------------------
// S3 응답 조각: 팀 구성·결과 (계약 S3 4·5·9절)
// -----------------------------------------------------------------------------

/**
 * 배정 포지션이 희망 순위 몇 번째인가(문서 7-2 3번 비용: first 0, second +1, other +3).
 * 포지션을 쓰지 않는 내전이거나 포지션이 없으면 null.
 */
export const PositionPreference = z.enum(['first', 'second', 'other']);
export type PositionPreference = z.infer<typeof PositionPreference>;

/**
 * 한 팀 승패 시 예상 ELO 변동(팀 평균 레이팅 기준, K = rating_policy.k_base, lose에는 패배 배율 적용). 표시용 근사값이다 —
 * 실제 반영은 참가자별 K(신규 40)로 계산한다. rated=false 내전이면 null.
 */
export const EloPreview = z.object({
  win: z.number().int(),
  lose: z.number().int(),
});
export type EloPreview = z.infer<typeof EloPreview>;

/**
 * 한 팀의 전력 요약. 실력값(skill) = w × 내전 ELO + (1 − w) × 티어 환산값(정수, core computeSkill, D187).
 * rating_avg = 팀원 현재 시즌 ELO(행이 없으면 RATING_START_ELO) 평균(반올림) — ELO 기대 승률 계산에 쓰는 값.
 */
export const ScrimTeamSide = z.object({
  /** 팀 인원 */
  size: z.number().int().min(0),
  skill_sum: z.number().int(),
  skill_avg: z.number().int(),
  rating_avg: z.number().int(),
  /** 이 팀의 포지션 비용 합(포지션 미사용 내전은 0) */
  position_cost: z.number().int().min(0),
  elo_preview: EloPreview.nullable(),
});
export type ScrimTeamSide = z.infer<typeof ScrimTeamSide>;

/**
 * 저장된 팀 구성 요약(ScrimDetail.balance). 팀원 목록은 players[].team·position으로 본다.
 * - 대상: status joined인 참가자 중 team이 있는 사람(노쇼는 빠진다)
 * - blue_win_probability: 실력값 평균 기준 블루 기대 승률(0–1, 소수 셋째 자리 반올림). 오렌지 = 1 − 값
 * - power_diff: 전력 차 = |블루 평균 − 오렌지 평균| × (두 팀 인원 합 ÷ 2), 반올림. 두 팀 인원이 같으면 실력값 합의 차와 같다
 * - position_cost: 두 팀 포지션 비용 합
 */
export const ScrimTeamsView = z.object({
  blue: ScrimTeamSide,
  orange: ScrimTeamSide,
  blue_win_probability: z.number().min(0).max(1),
  power_diff: z.number().int().min(0),
  position_cost: z.number().int().min(0),
  /** 팀에 배정되지 않은 참가 확정자(노쇼 제외). 결과 승인 때 레이팅 반영 대상이 아니다 */
  unassigned_user_ids: z.array(Uuid),
});
export type ScrimTeamsView = z.infer<typeof ScrimTeamsView>;

/** 개인 순위 결과 1행(placement 1이 1등) */
export const ScrimPlacementView = z.object({
  user: ScrimUserRef,
  placement: z.number().int().min(1),
});
export type ScrimPlacementView = z.infer<typeof ScrimPlacementView>;

/** 결과 승인으로 반영된 참가자 1명의 레이팅 변동(rating_history 1행) */
export const ScrimRatingChange = z.object({
  user: ScrimUserRef,
  /** 팀 게임: 반영 당시 팀. 개인 순위 게임: null */
  team: ScrimTeam.nullable(),
  /** 개인 순위 게임: 반영 대상끼리 다시 매긴 순위(1부터). 팀 게임: null */
  placement: z.number().int().min(1).nullable(),
  /** 팀 게임은 승리 팀이면 win. 개인 순위 게임은 2 × placement ≤ 반영 인원이면 win(상위 절반) */
  outcome: z.enum(['win', 'loss']),
  elo_before: z.number().int(),
  elo_after: z.number().int(),
  /** elo_after − elo_before */
  delta: z.number().int(),
  /** 적용한 K(32 또는 40) */
  k_factor: z.number().int().min(1),
});
export type ScrimRatingChange = z.infer<typeof ScrimRatingChange>;

/**
 * 결과 레이팅 상태.
 * - waiting: rated 내전이고 결과가 아직 승인되지 않음(pending·rejected)
 * - applied: 승인되어 1명 이상 반영됨(rating_changes 채움)
 * - skipped: 승인됐지만 반영 대상이 2명 미만이거나 한 팀이 비어(노쇼 등) 반영하지 않음
 * - not_rated: rated=false 내전(결과 흐름은 같고 레이팅만 바뀌지 않음, 메인 기본값 6)
 */
export const ScrimRatingStatus = z.enum(['waiting', 'applied', 'skipped', 'not_rated']);
export type ScrimRatingStatus = z.infer<typeof ScrimRatingStatus>;

/**
 * 내전의 가장 최근 결과 행(created_at 최신). 반려 뒤 재입력이 없으면 반려된 행이 보인다.
 * 팀 게임: winner_team 값, placements []. 개인 순위 게임: winner_team null, placements(placement 오름차순).
 */
export const ScrimResultView = z.object({
  id: Uuid,
  status: ScrimResultStatus,
  winner_team: ScrimTeam.nullable(),
  placements: z.array(ScrimPlacementView),
  submitted_by: ScrimUserRef,
  submitted_at: IsoDateTime,
  approved_by: ScrimUserRef.nullable(),
  approved_at: IsoDateTime.nullable(),
  rejected_by: ScrimUserRef.nullable(),
  rejected_at: IsoDateTime.nullable(),
  reject_reason: z.string().nullable(),
  rating_status: ScrimRatingStatus,
  /** 레이팅을 반영한 시즌(applied일 때만), 그 외 null */
  season: SeasonRef.nullable(),
  /** applied일 때 반영된 참가자 전원(delta 내림차순, 같으면 user id 순). 그 외 [] */
  rating_changes: z.array(ScrimRatingChange),
});
export type ScrimResultView = z.infer<typeof ScrimResultView>;

/**
 * 목록 카드용 결과 요약(승인된 결과만, 목업 Scrims 「종료」 탭).
 * 팀 게임: winner_team, winner null. 개인 순위 게임: winner_team null, winner = 1위.
 */
export const ScrimOutcome = z.object({
  winner_team: ScrimTeam.nullable(),
  winner: ScrimUserRef.nullable(),
});
export type ScrimOutcome = z.infer<typeof ScrimOutcome>;

// -----------------------------------------------------------------------------
// GET /scrims?game=&status=&cursor=&limit= — 목록(문서 6장)
// -----------------------------------------------------------------------------

/**
 * 목록 탭(목업 Scrims 「모집 중 · 진행 중 · 종료」).
 * - open: recruiting, full(시작 시각이 지났지만 아직 시작·자동 마감 전인 것 포함). 정렬 scheduled_at 오름차순, id 오름차순
 * - playing: playing. 정렬 scheduled_at 내림차순, id 내림차순
 * - ended: finished, cancelled. 정렬 scheduled_at 내림차순, id 내림차순
 */
export const ScrimListStatus = z.enum(['open', 'playing', 'ended']);
export type ScrimListStatus = z.infer<typeof ScrimListStatus>;

/** status 생략 시 open. game 생략 시 전체 게임. 모르는 값은 VALIDATION_FAILED */
export const ListScrimsQuery = PaginationQuery.extend({
  game: GameCode.optional(),
  status: ScrimListStatus.default('open'),
});
export type ListScrimsQuery = z.infer<typeof ListScrimsQuery>;

/** 목록 카드 1개 */
export const ScrimSummary = z.object({
  id: Uuid,
  game: ScrimGameRef,
  title: z.string(),
  scheduled_at: IsoDateTime,
  /** 정원(방장 포함) */
  capacity: z.number().int().min(1),
  status: ScrimStatus,
  host: ScrimUserRef,
  /** 참가 확정(joined) 인원. 시작 후에는 joined + no_show */
  joined_count: z.number().int().min(0),
  /** 대기열(waitlist) 인원 */
  waitlist_count: z.number().int().min(0),
  options: ScrimOptions,
  /** 스팀 내전에서 고른 게임(D98). 다른 게임과, 이 기능 전에 만든 스팀 내전은 null */
  steam_app: SteamAppRef.nullable(),
  /**
   * 모집 중(recruiting·full) && use_positions일 때만 값이 있고 그 외 []. 자리가 다 찼으면 [].
   * count 합계 ≤ capacity − joined_count(D100). 포지션별 남은 수 합계가 빈 자리를 넘으면 [](카드는 「N자리 남음」)
   */
  open_positions: z.array(OpenPosition),
  /** 서버 시각 ≥ scheduled_at → 참가·대기 등록·참가 취소 마감(시작·자동 마감 전이어도) */
  join_closed: z.boolean(),
  /** 요청자의 참가 상태(joined | waitlist | no_show), 참가하지 않았거나 취소했으면 null */
  my_status: MyScrimStatus.nullable(),
  created_at: IsoDateTime,
  /**
   * S3. 가장 최근 결과 행의 상태(pending = 「승인 대기」, rejected = 반려 후 재입력 전, approved), 결과가 없으면 null
   */
  result_status: ScrimResultStatus.nullable(),
  /** S3. 승인된 결과 요약(status finished일 때만), 그 외 null */
  outcome: ScrimOutcome.nullable(),
});
export type ScrimSummary = z.infer<typeof ScrimSummary>;

export const ListScrimsResponse = paginated(ScrimSummary);
export type ListScrimsResponse = z.infer<typeof ListScrimsResponse>;

// -----------------------------------------------------------------------------
// GET /scrims/{id} — 상세(문서 6장). 상태 변경 엔드포인트의 응답도 이 모양
// -----------------------------------------------------------------------------

/**
 * 참가자 슬롯 1개(참가 확정·노쇼). 순서: 방장 먼저, 나머지는 joined_at 오름차순, 같으면 user id 순.
 * position·team은 S3 팀 구성 저장(PUT /scrims/{id}/teams) 후 채워진다. 명단(joined 집합)이 바뀌면 서버가 전원 null로 지운다.
 */
export const ScrimPlayerView = z.object({
  user: ScrimUserRef,
  status: ScrimPlayerStatus.extract(['joined', 'no_show']),
  is_host: z.boolean(),
  /** 1지망부터. 포지션 없는 내전은 [] */
  preferred_positions: z.array(z.string()),
  /** 마지막 참가 신청 시각(대기 후 승격된 사람은 대기 등록 시각) */
  joined_at: IsoDateTime,
  position: z.string().nullable(),
  team: ScrimTeam.nullable(),
  /** no_show일 때 운영진이 표시한 시각. 그 외 null */
  no_show_marked_at: IsoDateTime.nullable(),
  /** S3. 배정 포지션의 희망 순위(team·position이 있고 use_positions 내전일 때), 그 외 null */
  position_preference: PositionPreference.nullable(),
  /** S3. 이 게임 실력값(core computeSkill, 정수, w는 현재 시즌 경기 수 기준 D187). 목업 ROSTER 숫자 */
  skill: z.number().int(),
  /** S3. 이 게임 승인된 rated 내전 경기 수 < rating_policy.new_player_games(신규 K 적용 대상). 목업 「NEW」 */
  is_new: z.boolean(),
});
export type ScrimPlayerView = z.infer<typeof ScrimPlayerView>;

/** 대기열 1명. order = 1부터(joined_at 오름차순, 같으면 scrim_players.id 순). 1번이 다음 승격 대상 */
export const ScrimWaitlistEntry = z.object({
  order: z.number().int().min(1),
  user: ScrimUserRef,
  preferred_positions: z.array(z.string()),
  joined_at: IsoDateTime,
});
export type ScrimWaitlistEntry = z.infer<typeof ScrimWaitlistEntry>;

/**
 * 요청자 기준 상태와 버튼 노출(서버 판단). 서버는 같은 조건을 요청 처리 때 다시 검사한다 — 이 값은 표시용.
 * - can_join: 모집 중 && !join_closed && 내 상태가 joined·waitlist 아님 && 노쇼 제한 아님
 *   (정원이 찼으면 「대기열 등록」으로 표시. 내 상태가 joined·waitlist면 같은 POST로 희망 포지션만 바꿀 수 있다)
 * - can_leave: 모집 중 && !join_closed && 내 상태가 joined·waitlist && 방장 아님
 * - can_edit: 방장 && 모집 중
 * - can_cancel: (방장 || 운영진) && 모집 중
 * - can_start: (방장 || 운영진) && 모집 중 && 시작 조건 충족(core canStartScrim)
 * - can_mark_no_show: 운영진 && status ∈ {playing, finished} && 노쇼 표시 기한 안
 * S3(「활성 결과」 = status pending 또는 approved인 결과 행):
 * - can_edit_teams: (방장 || 운영진) && game.has_teams && status ∈ {full, playing} && 활성 결과 없음
 * - can_balance: can_edit_teams && options.auto_balance && 팀에 넣을 수 있는 참가 확정자(joined, 노쇼 제외) 2–16명
 * - can_submit_result: (방장 || 운영진) && status = playing && 활성 결과 없음
 *   && (has_teams면 두 팀 모두 joined 참가자 1명 이상 배정 / 아니면 joined 참가자 2명 이상)
 * - can_withdraw_result: 결과 pending && (내가 제출자 || 방장)
 * - can_review_result: 운영진 && 결과 pending && 제출자가 내가 아님(자기 제출 승인·반려 금지, 메인 기본값 8)
 */
export const ScrimViewer = z.object({
  status: MyScrimStatus.nullable(),
  /** 대기 중이면 내 순번(1부터), 아니면 null */
  waitlist_order: z.number().int().min(1).nullable(),
  /**
   * 내 희망 포지션(참가·대기 중일 때). 아니면 [].
   * 비어 있을 때 화면의 1지망·2지망 기본 선택은 GET /me/position-suggestions로 채운다(D190, 이 필드에 넣지 않는다)
   */
  preferred_positions: z.array(z.string()),
  is_host: z.boolean(),
  /** 노쇼 제한 해제 시각. 제한 중이 아니면 null(제한 상세는 GET /me/scrim-restriction) */
  restricted_until: IsoDateTime.nullable(),
  can_join: z.boolean(),
  can_leave: z.boolean(),
  can_edit: z.boolean(),
  can_cancel: z.boolean(),
  can_start: z.boolean(),
  can_mark_no_show: z.boolean(),
  can_edit_teams: z.boolean(),
  can_balance: z.boolean(),
  can_submit_result: z.boolean(),
  can_withdraw_result: z.boolean(),
  can_review_result: z.boolean(),
});
export type ScrimViewer = z.infer<typeof ScrimViewer>;

export const ScrimDetail = ScrimSummary.extend({
  rules: z.string().nullable(),
  /** playing으로 바뀐 시각(방장·운영진 시작 또는 자동 시작). 시작 전 null */
  started_at: IsoDateTime.nullable(),
  cancelled_at: IsoDateTime.nullable(),
  cancel_reason: ScrimCancelReason.nullable(),
  updated_at: IsoDateTime,
  /** 참가 확정·노쇼 인원(슬롯). 길이 = joined_count */
  players: z.array(ScrimPlayerView),
  /** 대기열(order 오름차순). 길이 = waitlist_count */
  waitlist: z.array(ScrimWaitlistEntry),
  viewer: ScrimViewer,
  /**
   * S3. 저장된 팀 구성 요약. 팀 게임(has_teams)에서 블루·오렌지 모두 joined 참가자(노쇼 제외)가 1명 이상 배정돼 있을 때만,
   * 그 외 null(팀 저장 전, 노쇼 표시로 한 팀이 비었을 때, 개인 순위 게임).
   * (밸런스 3안은 저장하지 않는다 — POST /scrims/{id}/balance 응답으로만 받는다)
   */
  balance: ScrimTeamsView.nullable(),
  /** S3. 가장 최근 결과 행. 결과가 없으면 null */
  result: ScrimResultView.nullable(),
});
export type ScrimDetail = z.infer<typeof ScrimDetail>;

export const GetScrimResponse = ScrimDetail;
export type GetScrimResponse = z.infer<typeof GetScrimResponse>;

// -----------------------------------------------------------------------------
// POST /scrims — 모집글 작성(문서 6장). 201 CreateScrimResponse
// -----------------------------------------------------------------------------

/**
 * 서버 검사(VALIDATION_FAILED + details, 필드 경로는 snake_case):
 * - scheduled_at: now < scheduled_at ≤ now + SCRIM_SCHEDULE_MAX_DAYS_AHEAD일
 * - capacity: games.capacity_min ≤ capacity ≤ games.capacity_max
 * - host_preferred_positions: 포지션 받는 내전이면 1–2개·games.positions 안의 값, 아니면 []
 * - steam_app_id: games.requires_steam_app이면 필수, 아니면 없거나 null(D98). 이름은 서버가 정한다
 *   (멤버 보유 게임 이름 → 없으면 스팀 상점 조회. 상점에 없는 id면 VALIDATION_FAILED, 상점 오류는 GAME_PROVIDER_*)
 * 노쇼 제한 중이면 SCRIM_BANNED. 방장은 같은 트랜잭션에서 참가자 1번(joined)으로 들어간다.
 */
export const CreateScrimRequest = z
  .object({
    game: GameCode,
    title: ScrimTitle,
    scheduled_at: IsoDateTime,
    capacity: z.number().int().min(1).max(100),
    rules: ScrimRules.nullable().optional(),
    rated: z.boolean().default(true),
    auto_balance: z.boolean().default(true),
    use_positions: z.boolean().default(true),
    host_preferred_positions: PreferredPositions.default([]),
    steam_app_id: SteamAppId.nullable().optional(),
  })
  .strict();
export type CreateScrimRequest = z.infer<typeof CreateScrimRequest>;
export type CreateScrimRequestInput = z.input<typeof CreateScrimRequest>;

export const CreateScrimResponse = ScrimDetail;
export type CreateScrimResponse = z.infer<typeof CreateScrimResponse>;

// -----------------------------------------------------------------------------
// PATCH /scrims/{id} — 모집글 수정(방장, 모집 중일 때만)
// -----------------------------------------------------------------------------

/**
 * 바꿀 필드만 보낸다(1개 이상). game·use_positions는 바꿀 수 없다(이미 고른 포지션이 무의미해짐).
 * - capacity < 참가 확정 인원 → SCRIM_CAPACITY_BELOW_JOINED. 늘리면 같은 트랜잭션에서 대기열을 순서대로 승격.
 * - scheduled_at은 작성과 같은 범위. 시작 시각이 지난 모집글(join_closed)도 미래로 미루면 다시 참가를 받는다.
 * - rules: null 또는 빈 문자열이면 지운다.
 * - steam_app_id: games.requires_steam_app인 내전만 바꿀 수 있다(그 밖은 VALIDATION_FAILED). 이름 결정은 작성과 같다.
 */
export const UpdateScrimRequest = z
  .object({
    title: ScrimTitle.optional(),
    steam_app_id: SteamAppId.optional(),
    scheduled_at: IsoDateTime.optional(),
    capacity: z.number().int().min(1).max(100).optional(),
    rules: ScrimRules.nullable().optional(),
    rated: z.boolean().optional(),
    auto_balance: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), '바꿀 필드를 1개 이상 보내야 함');
export type UpdateScrimRequest = z.infer<typeof UpdateScrimRequest>;
export type UpdateScrimRequestInput = z.input<typeof UpdateScrimRequest>;

export const UpdateScrimResponse = ScrimDetail;
export type UpdateScrimResponse = z.infer<typeof UpdateScrimResponse>;

// -----------------------------------------------------------------------------
// POST /scrims/{id}/join — 참가·대기 등록·희망 포지션 변경 / DELETE /scrims/{id}/join — 취소
// -----------------------------------------------------------------------------

/**
 * 본문은 항상 객체로 보낸다(포지션 없는 게임은 `{}`).
 * - 참가 안 함·취소했음 → 자리가 있으면 joined, 없으면 waitlist(대기열 맨 뒤)
 * - 이미 joined·waitlist → 상태·순번은 그대로 두고 희망 포지션만 바꾼다(멱등)
 * 대기열 자동 승격 때는 여기서 고른 희망 포지션을 그대로 쓴다(메인 기본값 7).
 */
export const JoinScrimRequest = z
  .object({
    preferred_positions: PreferredPositions.default([]),
  })
  .strict();
export type JoinScrimRequest = z.infer<typeof JoinScrimRequest>;
export type JoinScrimRequestInput = z.input<typeof JoinScrimRequest>;

/** 200. 결과(참가 확정·대기 순번)는 viewer.status·viewer.waitlist_order로 확인한다 */
export const JoinScrimResponse = ScrimDetail;
export type JoinScrimResponse = z.infer<typeof JoinScrimResponse>;

/**
 * DELETE /scrims/{id}/join — 본문 없음. 200 ScrimDetail.
 * 참가 확정자가 취소하면 같은 트랜잭션에서 대기 1번을 승격(대기열이 없으면 full → recruiting).
 * 참가하지 않았거나 이미 취소했으면 변경 없이 200(멱등). 방장 → SCRIM_HOST_CANNOT_LEAVE.
 */
export const LeaveScrimResponse = ScrimDetail;
export type LeaveScrimResponse = z.infer<typeof LeaveScrimResponse>;

// -----------------------------------------------------------------------------
// POST /scrims/{id}/start — 시작(방장·운영진). 본문 없음. 200 ScrimDetail
// POST /scrims/{id}/cancel — 모집 취소(방장·운영진). 본문 없음. 200 ScrimDetail
// -----------------------------------------------------------------------------

export const StartScrimResponse = ScrimDetail;
export type StartScrimResponse = z.infer<typeof StartScrimResponse>;

export const CancelScrimResponse = ScrimDetail;
export type CancelScrimResponse = z.infer<typeof CancelScrimResponse>;

// -----------------------------------------------------------------------------
// PUT /scrims/{id}/players/{userId}/no-show — 노쇼 표시·정정(운영진, 문서 7-4)
// -----------------------------------------------------------------------------

/** no_show=true: joined → no_show(표시 시각·표시자 기록), false: no_show → joined(정정). 이미 그 상태면 변경 없이 200 */
export const SetScrimNoShowRequest = z
  .object({
    no_show: z.boolean(),
  })
  .strict();
export type SetScrimNoShowRequest = z.infer<typeof SetScrimNoShowRequest>;

export const SetScrimNoShowParams = z.object({
  id: Uuid,
  userId: Uuid,
});
export type SetScrimNoShowParams = z.infer<typeof SetScrimNoShowParams>;

export const SetScrimNoShowResponse = ScrimDetail;
export type SetScrimNoShowResponse = z.infer<typeof SetScrimNoShowResponse>;

// -----------------------------------------------------------------------------
// GET /me/scrim-restriction — 내 노쇼 제한 상태(목록·작성·상세 화면 안내)
// -----------------------------------------------------------------------------

/**
 * 노쇼 정책(API 환경 변수 실제 값, 계약 11절). 웹은 안내 문구의 숫자를 이 값으로 채우고
 * shared `NO_SHOW_*_DEFAULT` 상수를 화면 문구·검사에 쓰지 않는다(D101). 모두 양의 정수.
 */
export const NoShowPolicyView = z.object({
  /** 이 횟수 이상이면 제한(SCRIM_NO_SHOW_THRESHOLD, 기본 3). 단위: 회 */
  threshold: z.number().int().min(1),
  /** 집계 기간(SCRIM_NO_SHOW_WINDOW_DAYS, 기본 30). 단위: 일 = 24시간 × 일수의 이동 구간(KST 날짜 경계 아님) */
  window_days: z.number().int().min(1),
  /** 제한 기간(SCRIM_NO_SHOW_RESTRICTION_DAYS, 기본 1). 단위: 일. 제한을 일으킨 노쇼 표시 시각부터 */
  restriction_days: z.number().int().min(1),
  /**
   * 운영진 노쇼 표시 기한(SCRIM_NO_SHOW_MARK_WINDOW_DAYS, 기본 7, D83). 단위: 일.
   * 내전 시작 시각(scheduled_at)부터 이 일수까지 표시 가능. 정정(해제)은 기한 없음
   */
  mark_window_days: z.number().int().min(1),
});
export type NoShowPolicyView = z.infer<typeof NoShowPolicyView>;

/**
 * 내전 모집 정책(API 환경 변수 실제 값, 계약 11절, D101). 사용자와 무관한 전역 값이다.
 * 웹은 `SCRIM_SCHEDULE_MAX_DAYS_AHEAD_DEFAULT`·`SCRIM_AUTO_CLOSE_AFTER_MIN_DEFAULT`를 화면에 쓰지 않고 이 값을 쓴다.
 */
export const ScrimPolicyView = z.object({
  /** 시작 시각 상한(SCRIM_SCHEDULE_MAX_DAYS_AHEAD, 기본 30). 단위: 일. now < scheduled_at ≤ now + 이 일수 */
  schedule_max_days_ahead: z.number().int().min(1),
  /** 자동 마감(SCRIM_AUTO_CLOSE_AFTER_MIN, 기본 60). 단위: 분. 시작 시각 + 이 분이 지나도 시작하지 않으면 cron이 처리(D78) */
  auto_close_after_min: z.number().int().min(1),
});
export type ScrimPolicyView = z.infer<typeof ScrimPolicyView>;

export const ScrimRestriction = z.object({
  restricted: z.boolean(),
  /** 해제 시각(제한 중일 때만). 화면은 KST로 표시 */
  until: IsoDateTime.nullable(),
  /**
   * (now − window_days, now] 안의 노쇼 횟수(제한 여부와 무관한 참고값).
   * 제한을 일으킨 횟수가 아니다 — 제한 중에도 threshold보다 작을 수 있으므로 제한 배너·이유 문구에 쓰지 않는다(D99)
   */
  recent_no_show_count: z.number().int().min(0),
  /** 조회 범위(now − (window_days + restriction_days)일 초과) 안의 마지막 노쇼 표시 시각, 없으면 null */
  last_no_show_at: IsoDateTime.nullable(),
  policy: NoShowPolicyView,
  /** 내전 모집 정책(작성 폼 시작 시각 상한, 방장 메뉴 자동 마감 안내). D101 */
  scrim_policy: ScrimPolicyView,
});
export type ScrimRestriction = z.infer<typeof ScrimRestriction>;

export const GetMyScrimRestrictionResponse = ScrimRestriction;
export type GetMyScrimRestrictionResponse = z.infer<typeof GetMyScrimRestrictionResponse>;

// -----------------------------------------------------------------------------
// GET /me/position-suggestions?game= — 참가 신청·작성 화면의 1지망·2지망 기본 선택(계약 S4 20절 D190–D192)
// -----------------------------------------------------------------------------

/** game 필수. 모르는 값은 VALIDATION_FAILED */
export const GetMyPositionSuggestionsQuery = z.object({
  game: GameCode,
});
export type GetMyPositionSuggestionsQuery = z.infer<typeof GetMyPositionSuggestionsQuery>;

/**
 * 요청자 본인의 추천 라인. 서버는 저장된 전적만 읽는다(외부 API 호출·동기화 등록 없음).
 * - 출처: 그 게임 대표(is_primary) 계정의 recent_matches 최신 RECENT_MATCHES_MAX(20)경기 → core computeMainPosition
 *   → games.positions에 있는 값만, 순서 유지(= 프로필 main_position과 같은 계산)
 * - positions: 1지망부터 0–2개. has_positions가 아닌 게임·계정 없음·포지션 있는 경기 없음이면 []
 * - 화면은 기본 선택으로만 쓴다. 참가 신청·작성 요청은 사용자가 보낸 값을 그대로 저장한다(서버가 채우지 않는다)
 */
export const GetMyPositionSuggestionsResponse = z.object({
  game: GameCode,
  positions: PreferredPositions,
  /** 근거 경기 수(포지션이 있는 경기, computeMainPosition sample_size). 근거가 없으면 0 */
  sample_size: z.number().int().min(0).max(RECENT_MATCHES_MAX),
  /** 근거 전적의 마지막 동기화 시각(대표 계정 matches_synced_at). 계정이 없거나 동기화 전이면 null */
  synced_at: IsoDateTime.nullable(),
});
export type GetMyPositionSuggestionsResponse = z.infer<typeof GetMyPositionSuggestionsResponse>;
