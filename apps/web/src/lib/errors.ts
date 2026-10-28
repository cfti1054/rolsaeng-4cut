import type { ErrorCode } from '@gcd/shared';

/**
 * 화면 문구는 서버 message가 아니라 code로 정한다(계약 3절). 문구 표는 여기 한 곳에만 둔다.
 * ClientErrorCode는 웹 내부 전용(서버가 보내지 않음): 네트워크 실패, 응답 계약 위반.
 */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE';
export type AppErrorCode = ErrorCode | ClientErrorCode;

export const ERROR_MESSAGES: Record<AppErrorCode, string> = {
  VALIDATION_FAILED: '입력값을 다시 확인해 주세요.',
  UNAUTHENTICATED: '로그인이 필요해요.',
  ACCESS_TOKEN_EXPIRED: '로그인 시간이 지났어요. 다시 시도해 주세요.',
  FORBIDDEN: '이 작업을 할 권한이 없어요.',
  NOT_FOUND: '찾는 내용이 없어요.',
  RATE_LIMITED: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '서버에서 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  REFRESH_TOKEN_INVALID: '로그인이 만료됐어요. 다시 로그인해 주세요.',
  REFRESH_TOKEN_REUSED: '보안을 위해 로그아웃됐어요. 다시 로그인해 주세요.',
  OAUTH_NOT_CONFIGURED: '디스코드 로그인이 아직 설정되지 않았어요. 운영진에게 알려 주세요.',
  OAUTH_STATE_INVALID: '로그인 요청이 만료됐거나 올바르지 않아요. 처음부터 다시 시도해 주세요.',
  OAUTH_DENIED: '디스코드 로그인을 취소했어요. 계속하려면 다시 로그인해 주세요.',
  OAUTH_PROVIDER_ERROR: '디스코드와 통신하지 못했어요. 잠시 후 다시 시도해 주세요.',
  DISCORD_NOT_GUILD_MEMBER:
    '롤생네컷 디스코드 서버 멤버만 입장할 수 있어요. 서버에 가입했다면 가입 심사(규칙 동의)를 마친 뒤 다시 시도해 주세요.',
  NICKNAME_TAKEN: '이미 다른 멤버가 쓰는 닉네임이에요.',
  NETWORK_ERROR: '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.',
  INVALID_RESPONSE: '서버 응답 형식이 예상과 달라요. 운영진에게 알려 주세요.',
};

export function errorMessage(code: AppErrorCode): string {
  return ERROR_MESSAGES[code];
}
