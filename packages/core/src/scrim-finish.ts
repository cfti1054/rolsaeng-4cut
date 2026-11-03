import { assertValidDate } from './time';

/** 운영진이 결과 없이 경기를 끝낼 수 있는 시작 후 경과 시간(분). 방장은 언제든 끝낼 수 있다 */
export const FINISH_ADMIN_AFTER_MIN = 6 * 60;
/** 방장·운영진 누구도 끝내지 않으면 자동 종료하는 시작 후 경과 시간(분) */
export const FINISH_AUTO_AFTER_MIN = 24 * 60;

export type FinishInput = {
  status: string;
  /** 시작 시각(start·자동 시작에서 기록). 아직 시작 전이면 null */
  startedAt: Date | null;
  now: Date;
  /** 결과를 입력하지 않는 모집(스팀, 롤·롤체 인원 모집). 내전은 false */
  noResult: boolean;
  /** 승인 대기 결과가 있으면 운영진 승인·반려가 먼저다 */
  hasPendingResult: boolean;
};

function finishable(input: FinishInput): boolean {
  return input.status === 'playing' && input.noResult && !input.hasPendingResult && input.startedAt !== null;
}

function elapsedMin(startedAt: Date, now: Date): number {
  assertValidDate(startedAt, 'startedAt');
  assertValidDate(now, 'now');
  return (now.getTime() - startedAt.getTime()) / 60_000;
}

/** 수동 종료 가능 여부: 방장은 시작 뒤 언제든, 운영진은 FINISH_ADMIN_AFTER_MIN 뒤부터 */
export function canFinishScrim(input: FinishInput & { isHost: boolean; isAdmin: boolean }): boolean {
  if (!finishable(input)) return false;
  if (input.isHost) return true;
  return input.isAdmin && elapsedMin(input.startedAt!, input.now) >= FINISH_ADMIN_AFTER_MIN;
}

/** 자동 종료 대상: FINISH_AUTO_AFTER_MIN이 지났고 종료 가능한 상태 */
export function isAutoFinishDue(input: FinishInput): boolean {
  if (!finishable(input)) return false;
  return elapsedMin(input.startedAt!, input.now) >= FINISH_AUTO_AFTER_MIN;
}
