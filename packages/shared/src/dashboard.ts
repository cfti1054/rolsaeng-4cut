import { z } from 'zod';
import { IsoDateTime, Uuid } from './common/primitives';
import { GameCode } from './constants/games';
import { EloRankingEntry } from './rankings';
import { ScrimGameRef, ScrimOutcome, ScrimRatingStatus, ScrimSummary, ScrimUserRef } from './scrims';
import { SeasonRef } from './seasons';

// =============================================================================
// S4 GET /dashboard/summary — 홈 요약(문서 6장, 8장 /, 목업 Main·MobileHome)과 사이드바 시즌 카드·내 ELO·순위.
// 계약: _workspace/01_architect_contract.md 4-3·8절
//
// 캐시 범위(D156)
// - 공용 + 5분 캐시: top_rankers(GET /rankings/elo와 같은 캐시), me.rank
// - 공용 + 요청마다: season, rating_policy, stats, recent_results
// - 사용자별 + 요청마다: next_scrim, recruiting(ScrimSummary.my_status 때문), me
//   모집 인원은 5분 늦으면 안 되므로 내전 값은 캐시하지 않는다.
// 응답 전체를 캐시하지 않는다. 이 엔드포인트에는 사용자별 값이 섞여 있어 공용 키에 넣으면 남의 값이 보인다.
//
// S5(계약 S5 8절): 봇 데이터는 stats가 아니라 별도 블록 community에 둔다(D218). stats는 내전 집계 그대로다.
// community는 요청마다 읽는다(접속 현황 1행 + 이번 주 활동 멤버 수 1쿼리). 봇 자료가 없으면 state로 알리고 숫자를 null로 둔다.
// =============================================================================

/** 모집 중 내전 최대 개수(목업 3행). next_scrim과 같은 내전은 뺀다 */
export const DASHBOARD_RECRUITING_LIMIT = 3;
/** 시즌 ELO 상위 랭커 수(목업 TOP 5. 모바일은 앞 3명만 그린다) */
export const DASHBOARD_TOP_RANKERS_LIMIT = 5;
/** 최근 내전 결과 개수(목업 4행) */
export const DASHBOARD_RECENT_RESULTS_LIMIT = 4;
/** 다음 내전 카드 참가자 아바타 수(목업 6개 + 「외 N명 참가 중」) */
export const DASHBOARD_NEXT_SCRIM_AVATARS_MAX = 6;

/**
 * 현재 시즌 카드. 목업 「SEASON 2 · D-34」, 진행 칸 12개.
 * - days_left: 마지막 날(ends_at 직전 시각의 KST 날짜)까지 남은 KST 날짜 수. 마지막 날이면 0(화면 「D-DAY」)
 * - progress: (now − starts_at) ÷ (ends_at − starts_at), 0–1, 소수 셋째 자리
 */
export const DashboardSeason = SeasonRef.extend({
  days_left: z.number().int().min(0),
  progress: z.number().min(0).max(1),
});
export type DashboardSeason = z.infer<typeof DashboardSeason>;

/**
 * 화면 문구용 서버 설정값(D101 규칙).
 * k_base·k_new·new_player_games·loss_ratio: ELO 설명(ⓘ) 문구용(D176). 뜻은 RatingPolicyView와 같다.
 * full_weight_games·elo_weight_max: ⓘ 「팀을 나눌 때는요」 문구용(S4 20절 D188). 뜻은 RatingPolicyView와 같다.
 * S4 20절(D183)에서 soft_reset_ratio를 뺐다. 시작 점수는 상수 RATING_START_ELO(시즌마다 전원 초기화)다.
 */
export const DashboardRatingPolicy = z.object({
  min_games: z.number().int().min(1),
  k_base: z.number().int().min(1),
  k_new: z.number().int().min(1),
  new_player_games: z.number().int().min(1),
  loss_ratio: z.number().min(0).max(1),
  full_weight_games: z.number().int().min(1),
  elo_weight_max: z.number().min(0).max(1),
});
export type DashboardRatingPolicy = z.infer<typeof DashboardRatingPolicy>;

/**
 * 다음 내전 카드.
 * - source joined: 내가 joined인 recruiting·full 내전 중 가장 빠른 것
 * - source recruiting: 없으면 참가 가능한 내전(recruiting, 시작 시각 전) 중 가장 빠른 것
 * participants: joined 참가자 슬롯 순서 앞에서 DASHBOARD_NEXT_SCRIM_AVATARS_MAX명.
 */
export const DashboardNextScrim = z.object({
  source: z.enum(['joined', 'recruiting']),
  scrim: ScrimSummary,
  participants: z.array(ScrimUserRef).max(DASHBOARD_NEXT_SCRIM_AVATARS_MAX),
});
export type DashboardNextScrim = z.infer<typeof DashboardNextScrim>;

/**
 * 통계 카드.
 * - recruiting_scrims: GET /scrims status=open과 같은 집합(recruiting + full)의 개수
 * - scrims_this_week: scheduled_at이 이번 KST 주(월요일 00:00 시작)에 있고 cancelled가 아닌 내전 수
 * - week_start: 이번 주 시작 시각(+09:00 표기)
 */
export const DashboardStats = z.object({
  recruiting_scrims: z.number().int().min(0),
  scrims_this_week: z.number().int().min(0),
  week_start: IsoDateTime,
});
export type DashboardStats = z.infer<typeof DashboardStats>;

/**
 * 상위 랭커 블록. game = games.sort_order 순으로 처음 행이 있는 게임, 모두 비면 첫 게임(items []).
 * season = 현재 시즌, 없으면 가장 최근 시작 시즌. is_final이면 지난 시즌 최종 순위다(제목에 시즌 이름 표시).
 * top_rankers_state가 ready일 때만 객체이고, no_season·unavailable이면 null이다(S4 21절).
 */
export const DashboardTopRankers = z.object({
  game: GameCode,
  season: SeasonRef,
  is_final: z.boolean(),
  items: z.array(EloRankingEntry).max(DASHBOARD_TOP_RANKERS_LIMIT),
  synced_at: IsoDateTime.nullable(),
  stale: z.boolean(),
});
export type DashboardTopRankers = z.infer<typeof DashboardTopRankers>;

/**
 * 최근 내전 결과 1행. 승인 대기(pending)·승인(approved) 결과만, at 내림차순.
 * - at: approved면 approved_at, pending이면 제출 시각
 * - outcome: 제출된 값 기준(pending도 채운다. 목업 「BLUE WIN · 승인 대기」)
 * - elo_swing: 팀 게임 applied일 때 이 내전 rating_history |delta| 최댓값(화면 「최대 N점 변동」, D179). 그 외 null(「반영 완료」 등)
 */
export const DashboardRecentResult = z.object({
  scrim_id: Uuid,
  title: z.string(),
  game: ScrimGameRef,
  at: IsoDateTime,
  result_status: z.enum(['pending', 'approved']),
  outcome: ScrimOutcome,
  rating_status: ScrimRatingStatus,
  elo_swing: z.number().int().min(0).nullable(),
});
export type DashboardRecentResult = z.infer<typeof DashboardRecentResult>;

/**
 * 사이드바 「ELO 1421 · #3」. 현재 시즌에 ratings 행이 있는 게임 중 games가 가장 많은 것(같으면 sort_order, D157).
 * - elo: 순위권이면 rank와 같은 캐시 값(둘이 어긋나지 않게), 아니면 ratings 현재값
 * - rank: 그 게임 캐시의 내 순위. 경기 수 미달·아직 캐시에 없음이면 null(화면 「ELO 1421」만)
 * 현재 시즌이 없거나 행이 없으면 me 전체가 null.
 */
export const DashboardMe = z.object({
  game: GameCode,
  elo: z.number().int(),
  rank: z.number().int().min(1).nullable(),
  games: z.number().int().min(0),
});
export type DashboardMe = z.infer<typeof DashboardMe>;

/**
 * 상위 랭커 블록 상태(S4 21절, D196–D198). 요약은 이 블록만 부분 실패한다.
 * - ready: 블록이 있다. 순위 행이 0개여도 ready(items [])
 * - no_season: 시작한 시즌이 하나도 없다(화면 「아직 시즌이 없어요」)
 * - unavailable: 첫 계산 실패 또는 games 행 없음(서버 로그. 화면 「순위를 불러오지 못했어요」)
 * GET /rankings/*는 같은 실패에서 그대로 500이다.
 */
export const DashboardTopRankersState = z.enum(['ready', 'no_season', 'unavailable']);
export type DashboardTopRankersState = z.infer<typeof DashboardTopRankersState>;

// -----------------------------------------------------------------------------
// S5 community 블록(목업 Main 「음성 채널 접속」「이번 주 활동 멤버」, 문서 2장 「지금 플레이 중」)
// -----------------------------------------------------------------------------

/** 「지금 플레이 중」 최대 행 수 */
export const DASHBOARD_NOW_PLAYING_MAX = 5;

/**
 * 음성 채널 접속 인원(PUT /bot/presence 마지막 값).
 * - live: captured_at이 BOT_PRESENCE_STALE_AFTER_SEC 이내. member_count 숫자(목업 「23명 LIVE」)
 * - stale: 그보다 오래됨. 지난 숫자를 지금 값처럼 보이지 않게 member_count null, captured_at으로 「마지막 HH:mm」
 * - not_connected: 봇이 접속 현황을 한 번도 보내지 않음. 둘 다 null(화면은 카드를 숨긴다)
 */
export const DashboardVoice = z.discriminatedUnion('state', [
  z.object({ state: z.literal('live'), member_count: z.number().int().min(0), captured_at: IsoDateTime }),
  z.object({ state: z.literal('stale'), member_count: z.null(), captured_at: IsoDateTime }),
  z.object({ state: z.literal('not_connected'), member_count: z.null(), captured_at: z.null() }),
]);
export type DashboardVoice = z.infer<typeof DashboardVoice>;

/**
 * 이번 KST 주(stats.week_start부터) 활동(ACTIVITY_COUNTED_TYPES = voice·chat, play 제외(D240), 연동 회원, 탈퇴 제외)이 1건 이상인 회원 수.
 * - ready: count 숫자(0 가능)
 * - not_connected: activity_logs가 한 행도 없고 접속 현황도 없음(봇 미연결). count null(화면은 카드를 숨긴다)
 */
export const DashboardActiveMembers = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ready'), count: z.number().int().min(0) }),
  z.object({ state: z.literal('not_connected'), count: z.null() }),
]);
export type DashboardActiveMembers = z.infer<typeof DashboardActiveMembers>;

/** 지금 플레이 중 1행. 봇이 보낸 이름 그대로(game이 있으면 화면이 게임 칩 색을 쓴다) */
export const DashboardNowPlayingItem = z.object({
  name: z.string().min(1),
  game: GameCode.nullable(),
  steam_app_id: z.number().int().min(1).nullable(),
  count: z.number().int().min(1),
});
export type DashboardNowPlayingItem = z.infer<typeof DashboardNowPlayingItem>;

/**
 * 「지금 플레이 중」. voice가 live이고 봇이 보낸 playing이 1행 이상일 때만 값이 있다(「데이터가 충분할 때만」, D219).
 * 그 외 null → 화면은 영역을 숨긴다. items는 count DESC → name ASC, 최대 DASHBOARD_NOW_PLAYING_MAX.
 */
export const DashboardNowPlaying = z.object({
  captured_at: IsoDateTime,
  items: z.array(DashboardNowPlayingItem).min(1).max(DASHBOARD_NOW_PLAYING_MAX),
});
export type DashboardNowPlaying = z.infer<typeof DashboardNowPlaying>;

/** 봇 데이터 블록(S5). 항상 객체다. 각 칸이 자기 state를 가진다 */
export const DashboardCommunity = z.object({
  voice: DashboardVoice,
  active_members: DashboardActiveMembers,
  now_playing: DashboardNowPlaying.nullable(),
});
export type DashboardCommunity = z.infer<typeof DashboardCommunity>;

/**
 * 요약 응답의 필드 모양만. top_rankers와 top_rankers_state의 조합은 검사하지 않는다.
 * `.shape`·`.strict()`가 필요한 곳(테스트)용이다. 응답 parse는 GetDashboardSummaryResponse를 쓴다.
 */
export const GetDashboardSummaryBody = z.object({
  /** 현재 시즌. 시즌이 끝나고 다음 시즌이 아직 없으면 null(화면 「다음 시즌 준비 중」, D143) */
  season: DashboardSeason.nullable(),
  rating_policy: DashboardRatingPolicy,
  next_scrim: DashboardNextScrim.nullable(),
  recruiting: z.array(ScrimSummary).max(DASHBOARD_RECRUITING_LIMIT),
  stats: DashboardStats,
  /** S5. 필수 필드다 → api와 web을 같은 커밋으로 배포한다(D200과 같은 이유, 계약 S5 15절) */
  community: DashboardCommunity,
  top_rankers: DashboardTopRankers.nullable(),
  top_rankers_state: DashboardTopRankersState,
  recent_results: z.array(DashboardRecentResult).max(DASHBOARD_RECENT_RESULTS_LIMIT),
  me: DashboardMe.nullable(),
});

/**
 * GET /dashboard/summary 응답. top_rankers_state로 나뉜다:
 * ready ↔ top_rankers 객체, no_season·unavailable ↔ top_rankers null. 다른 조합은 parse 실패(D197).
 */
export const GetDashboardSummaryResponse = z.discriminatedUnion('top_rankers_state', [
  GetDashboardSummaryBody.extend({ top_rankers_state: z.literal('ready'), top_rankers: DashboardTopRankers }),
  GetDashboardSummaryBody.extend({ top_rankers_state: z.enum(['no_season', 'unavailable']), top_rankers: z.null() }),
]);
export type GetDashboardSummaryResponse = z.infer<typeof GetDashboardSummaryResponse>;
