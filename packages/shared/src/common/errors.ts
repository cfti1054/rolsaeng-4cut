import { z } from 'zod';

/**
 * 오류 코드 목록. API는 이 enum에 있는 값만 `code`로 반환한다.
 * 새 코드는 architect가 계약 문서와 함께 추가한다(슬라이스마다 늘어난다).
 */
export const ErrorCode = z.enum([
  // ---- 공통 ----
  'VALIDATION_FAILED', // 400 요청 본문·쿼리가 shared 스키마와 맞지 않음
  'UNAUTHENTICATED', // 401 액세스 토큰 없음·서명 불일치·사용자 없음
  'ACCESS_TOKEN_EXPIRED', // 401 액세스 토큰 만료 → 클라이언트는 /auth/refresh 후 1회 재시도
  'FORBIDDEN', // 403 권한 부족(역할)
  'NOT_FOUND', // 404 리소스 없음 또는 비활성 엔드포인트(개발 전용 로그인 등)
  'RATE_LIMITED', // 429 일반 요청 횟수 제한
  'INTERNAL_ERROR', // 500 예상하지 못한 오류(응답 계약 위반 포함)

  // ---- S0 인증 ----
  'REFRESH_TOKEN_INVALID', // 401 리프레시 쿠키 없음·모르는 토큰·만료·폐기됨
  'REFRESH_TOKEN_REUSED', // 401 이미 회전된 리프레시 토큰 재사용 → 해당 토큰 계열 전체 폐기
  'OAUTH_NOT_CONFIGURED', // 503 DISCORD_CLIENT_ID/SECRET/REDIRECT_URI 미설정
  'OAUTH_STATE_INVALID', // 400 state 쿠키 없음·불일치·만료
  'OAUTH_DENIED', // 400 사용자가 디스코드 동의 화면에서 취소(error=access_denied)
  'OAUTH_PROVIDER_ERROR', // 502 디스코드 토큰 교환·사용자 조회 실패
  'DISCORD_NOT_GUILD_MEMBER', // 403 DISCORD_GUILD_ID 서버 멤버가 아니거나 가입 심사 대기(pending=true)

  // ---- S0 내 정보 ----
  'NICKNAME_TAKEN', // 409 다른 사용자가 쓰는 닉네임

  // ---- S1 게임 계정 연동·동기화 ----
  'GAME_PROVIDER_NOT_CONFIGURED', // 503 RIOT_API_KEY 또는 STEAM_API_KEY 미설정
  'GAME_PROVIDER_ERROR', // 502 라이엇·스팀 호출 실패(401/403 키 문제, 5xx, 타임아웃)
  'GAME_PROVIDER_RATE_LIMITED', // 503 라이엇·스팀 429 또는 서버 호출 한도 소진. Retry-After 헤더(초) 동반
  'GAME_ACCOUNT_LIMIT_REACHED', // 409 라이엇 ID가 이미 RIOT_ACCOUNTS_MAX개(기본 3), 또는 스팀을 이미 1개 연동함
  'GAME_ACCOUNT_ALREADY_LINKED', // 409 그 외부 계정(PUUID·스팀 ID)이 다른 멤버에게 연동됨 → 운영진 문의(D45)
  'GAME_ACCOUNT_ALREADY_LINKED_TO_ME', // 409 내가 이미 연동한 라이엇 ID를 다시 추가하려 함
  'RIOT_ID_NOT_FOUND', // 404 Account-V1에 없는 라이엇 ID
  'RIOT_SUMMONER_NOT_FOUND', // 404 라이엇 계정은 있으나 KR 롤 소환사 정보 없음(아이콘 확인 불가)
  'OWNERSHIP_CHECK_FAILED', // 409 현재 프로필 아이콘이 지정 아이콘과 다름(pending 유지, 다시 확인 가능)
  'OWNERSHIP_CHECK_EXPIRED', // 410 소유 확인 제한 시간 경과 또는 취소됨 → 처음부터 다시 시작
  'STEAM_LINK_STATE_INVALID', // 400 스팀 연동 state 쿠키 없음·서명 불일치·만료·state 불일치
  'STEAM_LINK_CANCELLED', // 400 스팀 로그인 화면에서 취소(openid.mode=cancel)
  'STEAM_OPENID_INVALID', // 400 OpenID 응답 검증 실패(check_authentication is_valid:false, 형식·return_to 불일치)
  'SYNC_LIMIT_EXCEEDED', // 429 수동 새로고침 하루(KST) 한도 소진. Retry-After 헤더 = 다음 KST 자정까지 초
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** 오류 코드별 HTTP 상태. error.filter는 이 표를 기본값으로 쓴다. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  ACCESS_TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  REFRESH_TOKEN_INVALID: 401,
  REFRESH_TOKEN_REUSED: 401,
  OAUTH_NOT_CONFIGURED: 503,
  OAUTH_STATE_INVALID: 400,
  OAUTH_DENIED: 400,
  OAUTH_PROVIDER_ERROR: 502,
  DISCORD_NOT_GUILD_MEMBER: 403,
  NICKNAME_TAKEN: 409,
  GAME_PROVIDER_NOT_CONFIGURED: 503,
  GAME_PROVIDER_ERROR: 502,
  GAME_PROVIDER_RATE_LIMITED: 503,
  GAME_ACCOUNT_LIMIT_REACHED: 409,
  GAME_ACCOUNT_ALREADY_LINKED: 409,
  GAME_ACCOUNT_ALREADY_LINKED_TO_ME: 409,
  RIOT_ID_NOT_FOUND: 404,
  RIOT_SUMMONER_NOT_FOUND: 404,
  OWNERSHIP_CHECK_FAILED: 409,
  OWNERSHIP_CHECK_EXPIRED: 410,
  STEAM_LINK_STATE_INVALID: 400,
  STEAM_LINK_CANCELLED: 400,
  STEAM_OPENID_INVALID: 400,
  SYNC_LIMIT_EXCEEDED: 429,
};

/** VALIDATION_FAILED일 때만 채우는 필드별 상세. path는 snake_case 필드 경로(`nickname`, `events.0.type`). */
export const ErrorDetail = z.object({
  path: z.string(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof ErrorDetail>;

/**
 * 모든 오류 응답 본문. 문서 6장: `{ "code": "...", "message": "..." }`.
 * `details`는 VALIDATION_FAILED에서만 선택적으로 붙는다. 그 외 필드는 붙이지 않는다.
 */
export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.array(ErrorDetail).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;
