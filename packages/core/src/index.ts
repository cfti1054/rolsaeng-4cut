/**
 * @gcd/core — 순수 도메인 로직 진입점.
 *
 * 규칙: I/O(DB, 네트워크, 시계, 난수) 없이 입력 → 출력만 계산한다. 현재 시각·난수가 필요하면 인자로 받는다.
 * 의존: @gcd/shared 만 허용.
 *
 * S1: KST 하루 구간·수동 새로고침 횟수, 주 포지션, 소유 확인 아이콘, 티어 변환·비교, 전적 캐시 만료.
 * S2: 노쇼 제한(7-4, no-show.ts), 내전 참가·대기열·시작·자동 마감(scrim.ts).
 * S3: 내전 ELO(7-1, rating.ts), 팀 자동 밸런스(7-2, balance.ts), 시즌 판정·자동 생성(season.ts).
 * S4: 티어·ELO 랭킹과 순위 변동(7-3, ranking.ts), 시즌 종료·시즌 표시(season.ts), KST 주 구간(time.ts).
 * S5: KST 달 구간·활동 기간·날짜 키(time.ts), 봇 활동·활동/플레이타임 랭킹·입퇴장·접속 현황(activity.ts).
 */
export * from './config';
export {
  kstDayWindow,
  kstWeekWindow,
  kstMonthWindow,
  activityPeriodWindow,
  kstDateKey,
  formatKstMidnight,
  buildSyncQuota,
} from './time';
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
export {
  tierSeedRating,
  eloKFactor,
  expectedScore,
  roundHalfAwayFromZero,
  applyLossRatio,
  meanRating,
  computeTeamEloUpdates,
  computePlacementEloUpdates,
  isPlacementWin,
  computeWinRate,
  previewTeamElo,
  selectRatedParticipants,
  type EloPolicy,
  type RatedPlayer,
  type EloUpdate,
  type RatedParticipantsSelection,
} from './rating';
export {
  balanceEloWeight,
  computeSkill,
  positionPreferenceOf,
  bestPositionAssignment,
  balanceTeams,
  evaluateTeams,
  validateTeamAssignment,
  validatePlacementUsers,
  type BalancePlayer,
  type TeamMemberPlan,
  type TeamPlan,
  type TeamsEvaluation,
  type BalanceResult,
  type ValidationIssue,
} from './balance';
export {
  resolveSeasonAt,
  latestStartedSeason,
  kstMonthStart,
  addKstMonths,
  planAutoSeason,
  selectSeasonsToClose,
  computeSeasonStandings,
  computeSeasonBadges,
  seasonDaysLeft,
  seasonProgress,
  type SeasonLike,
} from './season';
export {
  tierScore,
  compareRanking,
  buildTierRanking,
  buildEloRanking,
  computeRankChange,
  rollRankBaseline,
  isRankingStale,
  type RankingComparable,
  type RankBaseline,
} from './ranking';
export {
  checkActivityEventTime,
  planActivityBatch,
  buildActivityRanking,
  pickMainGames,
  buildPlaytimeRanking,
  planMemberEvents,
  presenceState,
  checkPresenceCapture,
  nowPlayingItems,
  type ActivityPlan,
  type MemberEventStatus,
  type MemberEventFinal,
} from './activity';
