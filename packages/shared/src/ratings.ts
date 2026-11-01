import { z } from 'zod';
import { IsoDateTime, Uuid } from './common/primitives';
import { ScrimTeam } from './constants/enums';
import { GameCode } from './constants/games';
import { SeasonRef } from './seasons';

// =============================================================================
// S3 내전 레이팅 조회: 프로필 내전 블록(GET /users/{id}/profile 의 scrim), 레이팅 변동 그래프
// (GET /users/{id}/rating-history). 문서 7-1 마지막 줄, 8장 /members/[id], 목업 Profile.
// 계약: _workspace/01_architect_contract.md(S3) 4·9절
// =============================================================================

/** 프로필 「최근 내전」 개수 */
export const PROFILE_RECENT_SCRIMS_LIMIT = 5;
/** 프로필 최근 내전을 고르려고 조회하는 승인 결과 후보 수(최신 approved_at 순). 이력이 많아도 읽는 양을 이 값으로 묶는다 */
export const PROFILE_RECENT_SCRIMS_SCAN_LIMIT = 10;
/** 레이팅 그래프 최대 점 수(최근 것부터 이만큼, 응답은 오래된 순) */
export const RATING_HISTORY_POINTS_MAX = 100;

/** 시즌 레이팅 요약(ratings 1행). 목업 내전 레이팅 카드 「1421 · 17승 11패 · 승률 61%」 */
export const RatingSummary = z.object({
  elo: z.number().int(),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  /** wins + losses */
  games: z.number().int().min(0),
  /** wins ÷ games(0–1, 소수 셋째 자리 반올림). games = 0이면 null */
  win_rate: z.number().min(0).max(1).nullable(),
});
export type RatingSummary = z.infer<typeof RatingSummary>;

/**
 * 게임별 현재 시즌 레이팅 카드 1개.
 * rank(S4, D127 후속): 그 게임 ELO 랭킹 캐시의 순위. 경기 수 미달·캐시에 아직 없음이면 null. 목업 「#3 ELO」
 */
export const ProfileGameRating = RatingSummary.extend({
  game: GameCode,
  rank: z.number().int().min(1).nullable(),
});
export type ProfileGameRating = z.infer<typeof ProfileGameRating>;

/**
 * 프로필 최근 내전 1행. 대상: 이 사용자가 joined·no_show로 남아 있는 finished 내전(승인 시각 내림차순).
 * - outcome: win/loss(팀 게임은 내 팀 = 승리 팀, 개인 순위는 상위 절반) / no_show(노쇼) / unassigned(팀·순위에 없음)
 * - elo_delta: 이 내전으로 반영된 변동(rating_history). 반영 안 됐으면(rated=false, 노쇼, 미배정) null
 */
export const ProfileRecentScrim = z.object({
  scrim_id: Uuid,
  title: z.string(),
  game: GameCode,
  /** 결과 승인 시각 */
  finished_at: IsoDateTime,
  rated: z.boolean(),
  team: ScrimTeam.nullable(),
  position: z.string().nullable(),
  /** 개인 순위 게임 순위(제출된 순위 그대로), 그 외 null */
  placement: z.number().int().min(1).nullable(),
  outcome: z.enum(['win', 'loss', 'no_show', 'unassigned']),
  elo_delta: z.number().int().nullable(),
});
export type ProfileRecentScrim = z.infer<typeof ProfileRecentScrim>;

/**
 * 프로필 내전 블록(S3에서 GetUserProfileResponse.scrim을 이 모양으로 넓힘, D39 규칙).
 * backend는 S3부터 항상 객체를 넣는다(데이터가 없으면 빈 배열·null 필드).
 * - season: 현재 시즌(now가 속한 시즌, 없으면 null — 조회는 시즌을 만들지 않는다)
 * - ratings: 현재 시즌에 ratings 행이 있는 게임만, games.sort_order 순. season이 null이면 []
 * - recent: 최근 내전 최대 PROFILE_RECENT_SCRIMS_LIMIT개
 */
export const ProfileScrim = z.object({
  season: SeasonRef.nullable(),
  ratings: z.array(ProfileGameRating),
  recent: z.array(ProfileRecentScrim).max(PROFILE_RECENT_SCRIMS_LIMIT),
});
export type ProfileScrim = z.infer<typeof ProfileScrim>;

// -----------------------------------------------------------------------------
// GET /users/{id}/rating-history?game=&season= — 레이팅 변동 그래프(Recharts)
// -----------------------------------------------------------------------------

/**
 * game 필수. season 생략 → 현재 시즌, 현재 시즌이 없으면 starts_at ≤ now인 가장 최근 시즌, 그것도 없으면 season null·points [].
 * 없는 season id → NOT_FOUND.
 */
export const GetUserRatingHistoryQuery = z.object({
  game: GameCode,
  season: Uuid.optional(),
});
export type GetUserRatingHistoryQuery = z.infer<typeof GetUserRatingHistoryQuery>;

export const GetUserRatingHistoryParams = z.object({ id: Uuid });
export type GetUserRatingHistoryParams = z.infer<typeof GetUserRatingHistoryParams>;

/** 그래프 점 1개(rating_history 1행) */
export const RatingHistoryPoint = z.object({
  scrim_id: Uuid,
  scrim_title: z.string(),
  /** 반영 시각(rating_history.created_at = 결과 승인 시각) */
  at: IsoDateTime,
  elo_before: z.number().int(),
  elo_after: z.number().int(),
  delta: z.number().int(),
});
export type RatingHistoryPoint = z.infer<typeof RatingHistoryPoint>;

/**
 * 목록 리소스가 아니라 그래프 데이터셋이라 paginated 모양을 쓰지 않는다(D118).
 * points: 해당 사용자·게임·시즌의 최근 RATING_HISTORY_POINTS_MAX개를 오래된 순으로. truncated = 더 오래된 점이 있음.
 * rating: 그 시즌 ratings 행(없으면 null).
 */
export const GetUserRatingHistoryResponse = z.object({
  game: GameCode,
  season: SeasonRef.nullable(),
  rating: RatingSummary.nullable(),
  points: z.array(RatingHistoryPoint).max(RATING_HISTORY_POINTS_MAX),
  truncated: z.boolean(),
});
export type GetUserRatingHistoryResponse = z.infer<typeof GetUserRatingHistoryResponse>;
