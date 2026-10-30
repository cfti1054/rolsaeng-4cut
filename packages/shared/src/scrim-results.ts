import { z } from 'zod';
import { Uuid } from './common/primitives';
import { ScrimTeam } from './constants/enums';
import {
  BALANCE_OPTIONS_MAX,
  BALANCE_PLAYERS_MAX,
  BALANCE_PLAYERS_MIN,
  PositionPreference,
  SCRIM_REJECT_REASON_MAX_LENGTH,
  SCRIM_REJECT_REASON_MIN_LENGTH,
  ScrimDetail,
  ScrimPosition,
  ScrimTeamSide,
  ScrimUserRef,
} from './scrims';

// =============================================================================
// S3 팀 자동 밸런스·팀 구성 저장·결과 입력·승인·반려·제출 취소.
// 계약: _workspace/01_architect_contract.md(S3) 4·5절
//
// - 상태를 바꾸는 엔드포인트(팀 저장·결과 제출·승인·반려·제출 취소)는 모두 갱신 후 ScrimDetail(D87).
// - POST /scrims/{id}/balance는 계산만 하고 저장하지 않는다(문서 7-2 4번). 고른 안은 PUT /scrims/{id}/teams로 저장.
// =============================================================================

// -----------------------------------------------------------------------------
// 레이팅 정책(API 환경 변수 실제 값) — 화면 설명 문구용(D101과 같은 규칙: 웹은 *_DEFAULT 대신 이 값을 쓴다)
// -----------------------------------------------------------------------------

export const RatingPolicyView = z.object({
  /** SCRIM_ELO_K_BASE(기본 32) */
  k_base: z.number().int().min(1),
  /** SCRIM_ELO_K_NEW(기본 40) */
  k_new: z.number().int().min(1),
  /** SCRIM_ELO_NEW_PLAYER_GAMES(기본 10). 그 게임 rated 경기 수가 이 값 미만이면 k_new */
  new_player_games: z.number().int().min(1),
  /** 실력값 w = min(경기 수 ÷ 이 값, 1). BALANCE_FULL_WEIGHT_GAMES(10, 설정값 아님) */
  full_weight_games: z.number().int().min(1),
});
export type RatingPolicyView = z.infer<typeof RatingPolicyView>;

// -----------------------------------------------------------------------------
// POST /scrims/{id}/balance — 팀 자동 밸런스 3안 계산(방장·운영진). 본문 없음(또는 {}). 200
// -----------------------------------------------------------------------------

/** 밸런스 안의 팀원 1명 */
export const BalanceOptionMember = z.object({
  user: ScrimUserRef,
  /** 포지션 사용 내전이면 배정 포지션, 아니면 null */
  position: z.string().nullable(),
  preference: PositionPreference.nullable(),
  skill: z.number().int(),
  /** 현재 시즌 레이팅(행이 없으면 시드) */
  rating: z.number().int(),
  is_new: z.boolean(),
});
export type BalanceOptionMember = z.infer<typeof BalanceOptionMember>;

/**
 * 팀 1개. members 순서: 포지션 사용 내전은 game.positions 순서, 아니면 실력값 내림차순(같으면 user id 순).
 */
export const BalanceOptionSide = ScrimTeamSide.extend({
  members: z.array(BalanceOptionMember).min(1),
});
export type BalanceOptionSide = z.infer<typeof BalanceOptionSide>;

/**
 * 밸런스 안 1개. 정렬: total_cost 오름차순 → power_diff → position_cost → 안 키(core 동점 규칙). rank 1부터.
 * total_cost = 전력 차(반올림 전) + BALANCE_POSITION_COST_WEIGHT(50) × position_cost. 표시는 반올림 정수.
 */
export const BalanceOption = z.object({
  rank: z.number().int().min(1).max(BALANCE_OPTIONS_MAX),
  blue: BalanceOptionSide,
  orange: BalanceOptionSide,
  blue_win_probability: z.number().min(0).max(1),
  power_diff: z.number().int().min(0),
  position_cost: z.number().int().min(0),
  total_cost: z.number().int().min(0),
});
export type BalanceOption = z.infer<typeof BalanceOption>;

export const BalanceScrimRequest = z.object({}).strict();
export type BalanceScrimRequest = z.infer<typeof BalanceScrimRequest>;

export const BalanceScrimResponse = z.object({
  /** 1–3개(서로 다른 팀 나누기. 나누는 방법이 3가지 미만이면 그 수만큼) */
  options: z.array(BalanceOption).min(1).max(BALANCE_OPTIONS_MAX),
  /** 계산에 넣은 인원(joined, 노쇼 제외) */
  player_count: z.number().int().min(BALANCE_PLAYERS_MIN).max(BALANCE_PLAYERS_MAX),
  /** 탐색한 팀 나누기 경우의 수(목업 「126가지 팀 구성」 문구) */
  partitions_evaluated: z.number().int().min(1),
  /** 포지션 배정까지 했는가(scrim.use_positions && game.has_positions) */
  used_positions: z.boolean(),
  rating_policy: RatingPolicyView,
});
export type BalanceScrimResponse = z.infer<typeof BalanceScrimResponse>;

// -----------------------------------------------------------------------------
// PUT /scrims/{id}/teams — 팀 구성 저장(안 선택·직접 수정, 방장·운영진). 200 ScrimDetail
// -----------------------------------------------------------------------------

/** 팀원 1명. position은 포지션 사용 내전이면 필수(games.positions 값), 아니면 null·생략 */
export const TeamSlot = z
  .object({
    user_id: Uuid,
    position: ScrimPosition.nullable().default(null),
  })
  .strict();
export type TeamSlot = z.infer<typeof TeamSlot>;

/**
 * 두 팀 전체를 덮어쓴다(부분 수정 없음). 요청에 없는 joined 참가자는 팀 미배정(team·position null).
 * zod 검사: 각 팀 1명 이상, 두 팀 합 ≤ 16, user_id 중복 금지(팀 사이 포함), 한 팀 안 position 중복 금지(null 제외).
 * 서버 검사(VALIDATION_FAILED, details path `blue.0.user_id` 등): user_id가 그 내전 joined 참가자(노쇼·대기·취소 아님),
 * 포지션 사용 내전이면 position 필수·games.positions 안·팀 인원 ≤ 포지션 수, 아니면 position null.
 */
export const SaveScrimTeamsRequest = z
  .object({
    blue: z.array(TeamSlot).min(1).max(BALANCE_PLAYERS_MAX),
    orange: z.array(TeamSlot).min(1).max(BALANCE_PLAYERS_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.blue.length + v.orange.length > BALANCE_PLAYERS_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['orange'], message: `두 팀 합계는 최대 ${BALANCE_PLAYERS_MAX}명` });
    }
    const seen = new Set<string>();
    for (const team of ['blue', 'orange'] as const) {
      const positions = new Set<string>();
      v[team].forEach((slot, i) => {
        if (seen.has(slot.user_id)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [team, i, 'user_id'], message: '같은 참가자를 두 번 넣을 수 없음' });
        }
        seen.add(slot.user_id);
        if (slot.position !== null) {
          if (positions.has(slot.position)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [team, i, 'position'], message: '한 팀에 같은 포지션 두 명' });
          }
          positions.add(slot.position);
        }
      });
    }
  });
export type SaveScrimTeamsRequest = z.infer<typeof SaveScrimTeamsRequest>;
export type SaveScrimTeamsRequestInput = z.input<typeof SaveScrimTeamsRequest>;

export const SaveScrimTeamsResponse = ScrimDetail;
export type SaveScrimTeamsResponse = z.infer<typeof SaveScrimTeamsResponse>;

// -----------------------------------------------------------------------------
// POST /scrims/{id}/result — 결과 제출(방장·운영진). 200 ScrimDetail
// -----------------------------------------------------------------------------

/** 팀 게임(has_teams) 결과: 승리 팀 */
export const TeamResultInput = z
  .object({
    winner_team: ScrimTeam,
  })
  .strict();
export type TeamResultInput = z.infer<typeof TeamResultInput>;

/** 개인 순위 1명 */
export const PlacementInput = z
  .object({
    user_id: Uuid,
    placement: z.number().int().min(1).max(BALANCE_PLAYERS_MAX),
  })
  .strict();
export type PlacementInput = z.infer<typeof PlacementInput>;

/**
 * 개인 순위 게임(has_teams=false) 결과: 순위를 매길 참가자 2–16명, placement는 1..n을 한 번씩(동순위 없음, 메인 기본값 3).
 * 빠진 joined 참가자는 레이팅 반영 대상이 아니다(팀 미배정과 같은 취급, 메인 기본값 7).
 * 서버 검사: user_id가 그 내전 joined 참가자(노쇼 아님) → 아니면 VALIDATION_FAILED(path `placements.{i}.user_id`).
 */
export const PlacementResultInput = z
  .object({
    placements: z
      .array(PlacementInput)
      .min(BALANCE_PLAYERS_MIN)
      .max(BALANCE_PLAYERS_MAX)
      .superRefine((a, ctx) => {
        const users = new Set(a.map((p) => p.user_id));
        if (users.size !== a.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: '같은 참가자를 두 번 넣을 수 없음' });
        }
        const ranks = [...a.map((p) => p.placement)].sort((x, y) => x - y);
        if (!ranks.every((r, i) => r === i + 1)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'placement는 1부터 인원 수까지 한 번씩(동순위 없음)' });
        }
      }),
  })
  .strict();
export type PlacementResultInput = z.infer<typeof PlacementResultInput>;

/**
 * 게임 종류와 맞지 않는 모양(팀 게임에 placements, 개인 순위 게임에 winner_team)은 서버가 VALIDATION_FAILED.
 */
export const SubmitScrimResultRequest = z.union([TeamResultInput, PlacementResultInput]);
export type SubmitScrimResultRequest = z.infer<typeof SubmitScrimResultRequest>;

export const SubmitScrimResultResponse = ScrimDetail;
export type SubmitScrimResultResponse = z.infer<typeof SubmitScrimResultResponse>;

// -----------------------------------------------------------------------------
// DELETE /scrims/{id}/result — pending 결과 제출 취소(제출자 또는 방장). 본문 없음. 200 ScrimDetail
// (목업 ScrimDetail 「제출 취소」. pending 행을 지운다 — 승인·반려된 행은 지우지 않는다)
// -----------------------------------------------------------------------------

export const WithdrawScrimResultResponse = ScrimDetail;
export type WithdrawScrimResultResponse = z.infer<typeof WithdrawScrimResultResponse>;

// -----------------------------------------------------------------------------
// POST /scrims/{id}/result/approve — 승인 + 레이팅 반영(운영진, 제출자 본인 제외). 200 ScrimDetail
// POST /scrims/{id}/result/reject — 반려(운영진, 제출자 본인 제외). 200 ScrimDetail
// result_id: 화면에서 본 결과 행. 지금 pending인 행과 다르면 SCRIM_RESULT_NOT_PENDING(오래된 화면에서 다른 결과를 승인하지 않게)
// -----------------------------------------------------------------------------

export const ApproveScrimResultRequest = z
  .object({
    result_id: Uuid,
  })
  .strict();
export type ApproveScrimResultRequest = z.infer<typeof ApproveScrimResultRequest>;

export const ApproveScrimResultResponse = ScrimDetail;
export type ApproveScrimResultResponse = z.infer<typeof ApproveScrimResultResponse>;

/** 반려 사유: 앞뒤 공백 제거·연속 공백 1개(줄바꿈 포함)로 정규화 후 2–200자, 필수 */
export const RejectReason = z
  .string()
  .transform((v) => v.trim().replace(/\s+/g, ' '))
  .pipe(z.string().min(SCRIM_REJECT_REASON_MIN_LENGTH).max(SCRIM_REJECT_REASON_MAX_LENGTH));
export type RejectReason = z.infer<typeof RejectReason>;

export const RejectScrimResultRequest = z
  .object({
    result_id: Uuid,
    reason: RejectReason,
  })
  .strict();
export type RejectScrimResultRequest = z.infer<typeof RejectScrimResultRequest>;
export type RejectScrimResultRequestInput = z.input<typeof RejectScrimResultRequest>;

export const RejectScrimResultResponse = ScrimDetail;
export type RejectScrimResultResponse = z.infer<typeof RejectScrimResultResponse>;

// =============================================================================
// 서버 내부 저장 형식(와이어 아님): scrim_results.placements JSON
// backend가 쓰고 읽을 때 이 스키마로 parse한다. 팀 게임 행은 null.
// =============================================================================
export const ScrimResultPlacementsJson = z
  .array(
    z.object({
      user_id: Uuid,
      placement: z.number().int().min(1),
    }),
  )
  .min(BALANCE_PLAYERS_MIN);
export type ScrimResultPlacementsJson = z.infer<typeof ScrimResultPlacementsJson>;
