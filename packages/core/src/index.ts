/**
 * @gcd/core — 순수 도메인 로직 진입점.
 *
 * 규칙: I/O(DB, 네트워크, 시계, 난수) 없이 입력 → 출력만 계산한다. 현재 시각·난수가 필요하면 인자로 받는다.
 * 의존: @gcd/shared 만 허용.
 *
 * S1: KST 하루 구간·수동 새로고침 횟수, 주 포지션, 소유 확인 아이콘, 티어 변환·비교, 전적 캐시 만료.
 * S2: 노쇼 제한(7-4, no-show.ts), 내전 참가·대기열·시작·자동 마감(scrim.ts).
 * S3(ELO 7-1, 팀 밸런스 7-2), S4(랭킹 집계 7-3)에서 추가한다.
 */
export * from './config';
export { kstDayWindow, formatKstMidnight, buildSyncQuota } from './time';
export { computeMainPosition, MAIN_POSITION_MAX } from './profile';
export {
  pickVerificationIcon,
  toRankValue,
  isSameRank,
  isMatchesCacheStale,
  type RiotLeagueEntryLike,
} from './riot';
export {
  computeScrimRestriction,
  noShowLookbackStart,
  isNoShowMarkWindowOpen,
  type NoShowPolicy,
  type ScrimRestrictionState,
} from './no-show';
export {
  orderWaitlist,
  placeNewParticipant,
  statusForJoinedCount,
  planRosterAfterChange,
  validatePreferredPositions,
  validateScrimSchedule,
  isCapacityInRange,
  canStartScrim,
  decideOverdueScrim,
  computeOpenPositions,
  isJoinClosed,
  type WaitlistRow,
  type OpenScrimStatus,
} from './scrim';
