/**
 * core 조정 가능 상수. 운영 중 바꿀 수 있는 값은 여기 모아 둔다(domain-logic 스킬 2절).
 * S1: KST 기간 계산 상수만. 레이팅·밸런스·노쇼 값은 S2–S4에서 추가한다.
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
