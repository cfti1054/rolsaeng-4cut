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
 * S6: 승인 되돌리기(result-review.ts, 이의 제기는 D281로 제거), 시즌 관리(season.ts), 역할 변경·멤버 상태(admin.ts),
 *     노쇼 표시 미리보기(no-show.ts), 공지·패치노트·이벤트 날짜·부제(news.ts), 커뮤니티 캘린더 구간(calendar.ts),
 *     패치노트 자동 등록 버전·주소(patch-note-sync.ts).
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
  previewNoShowRestriction,
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
  balanceDuos,
  evaluateTeams,
  validateTeamAssignment,
  validatePlacementUsers,
  type DuoPlan,
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
  seasonPhase,
  seasonEditable,
  validateSeasonWrite,
  validateSeasonDelete,
  type SeasonLike,
  type SeasonPhase,
  type SeasonWriteIssue,
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
export {
  inferRevertOutcomes,
  revertBlockReason,
  planRatingRevert,
  type RatingOutcome,
  type RevertHistoryRow,
  type RevertRatingRow,
} from './result-review';
export { planRoleChange, adminMemberStatus } from './admin';
export { newsSubtitle, resolveEventsRange, dashboardNewsWindow } from './news';
export {
  parsePatchLine,
  formatPatchLine,
  comparePatchLine,
  firstPatchSlug,
  latestStoredPatchLine,
  planPatchNoteInsert,
  patchNoteUrl,
  PATCH_NOTE_AUTO_TITLE,
  PATCH_NOTE_AUTO_SUMMARY,
  type PatchLine,
} from './patch-note-sync';
export {
  calendarMonthRange,
  resolveCalendarMonth,
  compareEventSchedule,
  eventStartsAt,
  upcomingWindow,
  mergeUpcomingItems,
  type EventScheduleKey,
} from './calendar';
