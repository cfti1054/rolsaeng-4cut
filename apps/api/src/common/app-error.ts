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
};

/**
 * 서비스·가드에서 던지는 오류. error.filter가 `{ code, message, details? }`로 바꾼다.
 * 상태 코드 기본값은 shared ERROR_HTTP_STATUS.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    code: ErrorCode,
    status?: number,
    options: { message?: string; details?: ErrorDetail[]; cause?: unknown } = {},
  ) {
    super(options.message ?? DEFAULT_ERROR_MESSAGE[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? ERROR_HTTP_STATUS[code];
    this.details = options.details;
  }
}
