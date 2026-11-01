import type { RiotTier } from '@gcd/shared';

/**
 * core 상수. 코드 수정으로만 바꾸는 값을 모아 둔다(domain-logic 스킬 2절).
 * 환경 변수로 조정하는 값(노쇼 정책, K 값 등)은 여기 두지 않고 인자로 받는다.
 * S1: KST 기간 계산. S3: 밸런스 티어 환산값·밸런스 비용·λ(아래 S3 절).
 */

/** 한국 표준시 UTC 오프셋(밀리초). KST는 일광 절약 시간이 없다. */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** KST 오프셋 문자열 표기 */
export const KST_OFFSET_LABEL = '+09:00';
/** 하루(밀리초) */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** 한 시간(밀리초) */
export const HOUR_MS = 60 * 60 * 1000;
/** 1분(밀리초) */
export const MINUTE_MS = 60 * 1000;

// S2 내전·노쇼 값(정원 범위, 노쇼 3회/30일/1일, 자동 마감 60분 등)은 환경 변수로 조정하므로
// core 상수로 두지 않고 인자(NoShowPolicy, maxDaysAhead, autoCloseAfterMin …)로 받는다.
// 기본값은 @gcd/shared(NO_SHOW_*_DEFAULT, SCRIM_*_DEFAULT)에 있다.

// -----------------------------------------------------------------------------
// S3 레이팅·밸런스 상수(계약 S3 7-1). 설정값이 아니다(메인 기본값 5, D124).
// K 값(32/40/10)은 환경 변수로 조정하므로 EloPolicy 인자로 받는다(기본값은 @gcd/shared SCRIM_ELO_*_DEFAULT).
// RATING_START_ELO(1000)·BALANCE_ELO_WEIGHT_MAX(0.2)·BALANCE_FULL_WEIGHT_GAMES(10)·BALANCE_OPTIONS_MAX(3)·BALANCE_PLAYERS_MIN/MAX(2/16)는 @gcd/shared 값을 쓴다.
// -----------------------------------------------------------------------------

/**
 * 밸런스 티어 환산값(D103·D189), ELO 시작값 아님(시작값은 @gcd/shared RATING_START_ELO).
 * 디비전·LP 무시. UNRANKED·티어 없음 = RATING_SEED_DEFAULT
 */
export const RATING_SEED_BY_TIER: Readonly<Record<RiotTier, number>> = {
  IRON: 600,
  BRONZE: 800,
  SILVER: 1000,
  GOLD: 1200,
  PLATINUM: 1400,
  EMERALD: 1600,
  DIAMOND: 1800,
  MASTER: 2000,
  GRANDMASTER: 2000,
  CHALLENGER: 2000,
};
/** 티어 없음·언랭 밸런스 티어 환산값(D189), ELO 시작값 아님 */
export const RATING_SEED_DEFAULT = 1000;
/** 기대 승률 식 분모(문서 7-1) */
export const ELO_SCALE = 400;
/** 포지션 비용(문서 7-2 3번): 1지망 0, 2지망 1, 그 외 3 */
export const POSITION_PREFERENCE_COST = { first: 0, second: 1, other: 3 } as const;
/** 총 비용 = 전력 차 + λ × 포지션 비용 (D108, 메인 기본값 5) */
export const BALANCE_POSITION_COST_WEIGHT = 50;
