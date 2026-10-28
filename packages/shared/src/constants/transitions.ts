import type { DisputeStatus, ScrimPlayerStatus, ScrimResultStatus, ScrimStatus } from './enums';

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
