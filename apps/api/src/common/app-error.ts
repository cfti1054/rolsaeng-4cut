import { ERROR_HTTP_STATUS, type ErrorCode, type ErrorDetail } from '@gcd/shared';

/** 코드별 기본 메시지(한국어). 화면 문구는 웹이 code로 분기한다. */
export const DEFAULT_ERROR_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_FAILED: '요청 형식이 올바르지 않습니다.',
  UNAUTHENTICATED: '로그인이 필요합니다.',
  ACCESS_TOKEN_EXPIRED: '액세스 토큰이 만료되었습니다.',
  FORBIDDEN: '권한이 없습니다.',
  NOT_FOUND: '찾을 수 없습니다.',
  RATE_LIMITED: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '서버 오류가 발생했습니다.',
  REFRESH_TOKEN_INVALID: '로그인 정보가 없거나 만료되었습니다. 다시 로그인해 주세요.',
  REFRESH_TOKEN_REUSED: '이미 사용된 로그인 정보입니다. 보안을 위해 다시 로그인해 주세요.',
  OAUTH_NOT_CONFIGURED: '디스코드 로그인이 설정되지 않았습니다.',
  OAUTH_STATE_INVALID: '로그인 요청이 만료되었거나 올바르지 않습니다.',
  OAUTH_DENIED: '디스코드 로그인을 취소했습니다.',
  OAUTH_PROVIDER_ERROR: '디스코드와 통신하지 못했습니다.',
  DISCORD_NOT_GUILD_MEMBER: '커뮤니티 디스코드 서버 멤버만 이용할 수 있습니다.',
  NICKNAME_TAKEN: '이미 사용 중인 닉네임입니다.',
  // S1 (계약 _workspace/01_architect_contract.md 2절)
  GAME_PROVIDER_NOT_CONFIGURED: '게임 계정 연동이 설정되지 않았습니다.',
  GAME_PROVIDER_ERROR: '라이엇·스팀 서버와 통신하지 못했습니다.',
  GAME_PROVIDER_RATE_LIMITED: '라이엇·스팀 호출 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.',
  GAME_ACCOUNT_LIMIT_REACHED: '연동할 수 있는 계정 수를 모두 사용했습니다(라이엇 ID 최대 개수 또는 스팀 1개). 다른 계정을 해제한 뒤 다시 시도해 주세요.',
  GAME_ACCOUNT_ALREADY_LINKED: '다른 멤버가 이미 연동한 계정입니다. 본인 계정이라면 운영진에게 문의해 주세요.',
  GAME_ACCOUNT_ALREADY_LINKED_TO_ME: '이미 내 계정에 연동한 라이엇 ID입니다.',
  RIOT_ID_NOT_FOUND: '라이엇 ID를 찾을 수 없습니다.',
  RIOT_SUMMONER_NOT_FOUND: '한국 서버 리그 오브 레전드 기록이 없는 계정입니다.',
  OWNERSHIP_CHECK_FAILED: '프로필 아이콘이 지정한 아이콘과 다릅니다.',
  OWNERSHIP_CHECK_EXPIRED: '소유 확인 시간이 지났습니다. 처음부터 다시 시작해 주세요.',
  STEAM_LINK_STATE_INVALID: '스팀 연동 요청이 만료되었거나 올바르지 않습니다.',
  STEAM_LINK_CANCELLED: '스팀 로그인을 취소했습니다.',
  STEAM_OPENID_INVALID: '스팀 로그인 응답을 확인하지 못했습니다.',
  SYNC_LIMIT_EXCEEDED: '오늘 새로고침 횟수를 모두 사용했습니다.',
  // S2 (계약 _workspace/01_architect_contract.md 2절)
  SCRIM_NOT_RECRUITING: '모집 중인 내전이 아닙니다.',
  SCRIM_JOIN_CLOSED: '시작 시각이 지나 참가·취소를 받지 않습니다.',
  SCRIM_HOST_CANNOT_LEAVE: '방장은 참가를 취소할 수 없습니다. 모집글을 취소해 주세요.',
  SCRIM_BANNED: '노쇼 누적으로 내전 참가가 제한된 상태입니다.',
  SCRIM_CAPACITY_BELOW_JOINED: '정원을 현재 참가 인원보다 적게 바꿀 수 없습니다.',
  SCRIM_CANNOT_START: '시작 조건을 채우지 못했습니다.',
  SCRIM_NO_SHOW_NOT_ALLOWED: '노쇼를 표시할 수 없는 상태입니다.',
  SCRIM_TEAMS_NOT_EDITABLE: '지금은 팀 구성을 바꿀 수 없습니다.',
  SCRIM_BALANCE_UNAVAILABLE: '이 내전은 팀 자동 밸런스를 쓸 수 없습니다.',
  SCRIM_RESULT_NOT_ALLOWED: '진행 중인 내전에만 결과를 입력할 수 있습니다.',
  SCRIM_RESULT_EXISTS: '이미 승인 대기 중이거나 승인된 결과가 있습니다.',
  SCRIM_TEAMS_REQUIRED: '결과를 입력하기 전에 두 팀을 구성해야 합니다.',
  SCRIM_RESULT_NOT_PENDING: '승인 대기 중인 결과가 아닙니다.',
  SCRIM_RESULT_SELF_REVIEW: '자기가 제출한 결과는 승인하거나 반려할 수 없습니다.',
  API_KEY_INVALID: 'API 키가 없거나 올바르지 않습니다.',
  API_KEY_SCOPE_MISSING: '이 API 키에는 해당 요청 권한(scope)이 없습니다.',
};

/**
 * 서비스·가드에서 던지는 오류. error.filter가 `{ code, message, details? }`로 바꾼다.
 * 상태 코드 기본값은 shared ERROR_HTTP_STATUS.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  /** 있으면 error.filter가 Retry-After 헤더(초)로 보낸다(S1 계약 2절). 본문에는 넣지 않는다 */
  readonly retryAfterSec: number | undefined;

  constructor(
    code: ErrorCode,
    status?: number,
    options: { message?: string; details?: ErrorDetail[]; cause?: unknown; retryAfterSec?: number } = {},
  ) {
    super(options.message ?? DEFAULT_ERROR_MESSAGE[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? ERROR_HTTP_STATUS[code];
    this.details = options.details;
    this.retryAfterSec =
      options.retryAfterSec === undefined ? undefined : Math.max(1, Math.ceil(options.retryAfterSec));
  }
}
