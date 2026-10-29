import type {
  DisputeStatus,
  GameAccountSyncState,
  RiotLinkVerificationStatus,
  ScrimPlayerStatus,
  ScrimResultStatus,
  ScrimStatus,
} from './enums';

/**
 * 상태 전이 맵. 서버는 상태를 바꿀 때 반드시 canTransition(맵, from, to)을 검사한다.
 * QA는 이 맵과 실제 갱신 코드를 대조한다. 맵에 없는 전이는 금지.
 */
export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * scrims.status
 * recruiting → full(마지막 자리 참) | cancelled
 * full → recruiting(취소로 자리 생김, 대기열 없음) | playing(방장 시작) | cancelled
 * playing → finished(결과 승인 시)
 */
export const SCRIM_STATUS_TRANSITIONS: TransitionMap<ScrimStatus> = {
  recruiting: ['full', 'cancelled'],
  full: ['recruiting', 'playing', 'cancelled'],
  playing: ['finished'],
  finished: [],
  cancelled: [],
};

/**
 * scrim_players.status
 * joined ↔ waitlist : 정원 초과 시 대기, 자리 나면 가장 먼저 대기한 사람 승격
 * joined|waitlist → cancelled : 본인 취소
 * cancelled → joined|waitlist : 모집 중 재참가(같은 행 재사용, joined_at 갱신)
 * joined → no_show : 내전 종료 후 운영진 표시
 * no_show → joined : 운영진 표시 정정
 */
export const SCRIM_PLAYER_STATUS_TRANSITIONS: TransitionMap<ScrimPlayerStatus> = {
  joined: ['waitlist', 'cancelled', 'no_show'],
  waitlist: ['joined', 'cancelled'],
  cancelled: ['joined', 'waitlist'],
  no_show: ['joined'],
};

/**
 * scrim_results.status
 * pending → approved(운영진, 제출자 본인 제외) | rejected(운영진)
 * 반려 후 재입력은 새 행(pending)으로 만든다. approved·rejected는 종착 상태.
 */
export const SCRIM_RESULT_STATUS_TRANSITIONS: TransitionMap<ScrimResultStatus> = {
  pending: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

/** scrim_result_disputes.status */
export const DISPUTE_STATUS_TRANSITIONS: TransitionMap<DisputeStatus> = {
  open: ['resolved'],
  resolved: [],
};

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return map[from].includes(to);
}

/**
 * riot_link_verifications.status (S1)
 * pending → verified(아이콘 일치) | expired(제한 시간 경과, 확인 시점에 지연 반영) | cancelled(사용자 취소·새 확인 시작)
 * 아이콘 불일치는 상태를 바꾸지 않는다(pending 유지, 제한 시간 안에서 다시 확인 가능).
 */
export const RIOT_LINK_VERIFICATION_TRANSITIONS: TransitionMap<RiotLinkVerificationStatus> = {
  pending: ['verified', 'expired', 'cancelled'],
  verified: [],
  expired: [],
  cancelled: [],
};

/**
 * game_accounts.sync_state (S1, 계약 6-1)
 * idle → queued(수동 새로고침·연동 직후) | running(주기 작업·프로필 조회 전적 갱신이 바로 실행)
 * queued → running(작업자 시작) | idle(작업이 버려짐: 계정 해제 등)
 * running → idle(성공·실패 모두. 결과는 last_synced_at / last_sync_error로 남김)
 *
 * 멈춘 상태 전이(sync_state_at이 SYNC_STATE_STALE_MS 넘게 지난 행에만 허용, 조건부 update로 보장):
 * queued → queued   멈춘 작업 정리: 작업을 다시 등록하고 sync_state_at만 갱신
 * running → queued  멈춘 작업 정리: 실행 중 죽은 작업을 다시 등록
 * running → running 작업자가 멈춘 running 행을 다시 잡음(잠금 재획득)
 */
export const GAME_ACCOUNT_SYNC_STATE_TRANSITIONS: TransitionMap<GameAccountSyncState> = {
  idle: ['queued', 'running'],
  queued: ['running', 'idle', 'queued'],
  running: ['idle', 'queued', 'running'],
};

/** 「멈춘 상태」 판단 기준: sync_state_at 이후 10분. 위 자기·역방향 전이는 이 기준을 넘긴 행에만 쓴다 */
export const SYNC_STATE_STALE_MS = 10 * 60 * 1000;

/**
 * 같은 상태로 남는 전이(queued→queued, running→running)와 running→queued는 멈춘 행에만 허용된다.
 * 서버는 sync_state를 바꿀 때 canTransition과 함께 이 함수를 검사한다.
 */
export function isStaleOnlySyncTransition(from: GameAccountSyncState, to: GameAccountSyncState): boolean {
  return from === to || (from === 'running' && to === 'queued');
}
