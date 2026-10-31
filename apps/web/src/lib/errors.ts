import type { ErrorCode, GameAccountSyncError } from '@gcd/shared';

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
  // S1 게임 계정 연동·동기화
  GAME_PROVIDER_NOT_CONFIGURED: '게임 계정 연동이 아직 준비되지 않았어요. 운영진에게 알려 주세요.',
  GAME_PROVIDER_ERROR: '라이엇·스팀 서버와 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
  GAME_PROVIDER_RATE_LIMITED: '라이엇·스팀에 요청이 몰려 있어요. 1–2분 뒤에 다시 시도해 주세요.',
  // 아래 두 줄은 architect 초안 그대로 둔다(리더 공지: 문구 확정 전 frontend 수정 금지)
  GAME_ACCOUNT_LIMIT_REACHED: '더 연동할 수 없어요. 라이엇 ID는 정해진 개수까지, 스팀은 1개만 연동할 수 있어요. 다른 계정을 해제한 뒤 다시 시도해 주세요.',
  GAME_ACCOUNT_ALREADY_LINKED: '다른 멤버가 이미 연동한 계정이에요. 본인 계정이라면 운영진에게 문의해 주세요.',
  GAME_ACCOUNT_ALREADY_LINKED_TO_ME: '이미 내 계정에 연동한 라이엇 ID예요.',
  RIOT_ID_NOT_FOUND: '라이엇 ID를 찾지 못했어요. 게임이름#태그(예: 새벽감자#KR1)를 다시 확인해 주세요.',
  RIOT_SUMMONER_NOT_FOUND:
    '한국 서버 롤 기록이 없는 라이엇 ID예요. 한국 서버에서 한 번 이상 로그인한 계정만 소유 확인을 할 수 있어요.',
  OWNERSHIP_CHECK_FAILED:
    '아직 지정한 아이콘으로 바뀌지 않았어요. 게임 클라이언트에서 아이콘을 바꾸고 몇 초 뒤에 다시 확인해 주세요.',
  OWNERSHIP_CHECK_EXPIRED: '확인 시간이 지났어요. 「다시 시작」을 눌러 새 아이콘을 받아 주세요.',
  STEAM_LINK_STATE_INVALID: '스팀 연동 요청이 만료됐어요. 「Steam으로 로그인」을 다시 눌러 주세요.',
  STEAM_LINK_CANCELLED: '스팀 로그인을 취소해서 연동하지 않았어요.',
  STEAM_OPENID_INVALID: '스팀 로그인 결과를 확인하지 못했어요. 「Steam으로 로그인」을 다시 눌러 주세요.',
  SYNC_LIMIT_EXCEEDED: '오늘 새로고침 횟수를 모두 썼어요. 자정(한국 시간)에 다시 채워져요.',
  // S2 내전
  SCRIM_NOT_RECRUITING: '이미 시작했거나 취소된 내전이에요. 화면을 새로 고쳤어요.',
  SCRIM_JOIN_CLOSED: '시작 시각이 지나 참가·취소·포지션 변경을 할 수 없어요. 사정이 생겼다면 방장에게 직접 알려 주세요.',
  SCRIM_HOST_CANNOT_LEAVE: '방장은 참가를 취소할 수 없어요. 내전을 열지 않으려면 「모집 취소」를 눌러 주세요.',
  SCRIM_BANNED: '노쇼가 쌓여 지금은 새 내전 참가·대기 등록·모집글 작성이 제한돼 있어요.',
  SCRIM_CAPACITY_BELOW_JOINED: '정원을 지금 참가 확정된 인원보다 적게 줄일 수 없어요.',
  SCRIM_CANNOT_START: '아직 시작할 수 없어요. 시작에 필요한 인원이 모였는지 확인해 주세요.',
  SCRIM_NO_SHOW_NOT_ALLOWED: '지금은 노쇼를 표시할 수 없어요. 진행 중·종료된 내전의 참가자에게만, 표시 기한 안에 표시할 수 있어요.',
  // S3 팀 구성·결과(409는 훅이 상세를 다시 조회하므로 「새로 고쳤어요」로 안내)
  SCRIM_TEAMS_NOT_EDITABLE: '지금은 팀 구성을 바꿀 수 없어요. 결과가 제출됐거나 내전 상태가 바뀌었어요. 화면을 새로 고쳤어요.',
  SCRIM_BALANCE_UNAVAILABLE: '지금은 자동 밸런스를 쓸 수 없어요. 참가 인원이 맞지 않거나 자동 밸런스를 끈 내전이에요. 「팀 직접 구성」으로 나눠 주세요.',
  SCRIM_RESULT_NOT_ALLOWED: '경기가 진행 중일 때만 결과를 입력할 수 있어요.',
  SCRIM_RESULT_EXISTS: '이미 제출됐거나 승인된 결과가 있어요. 화면을 새로 고쳤어요.',
  SCRIM_TEAMS_REQUIRED: '결과를 입력하기 전에 블루·레드 두 팀을 먼저 구성해 주세요.',
  SCRIM_RESULT_NOT_PENDING: '결과가 이미 처리됐거나 바뀌었어요. 화면을 새로 고쳤어요.',
  SCRIM_RESULT_SELF_REVIEW: '내가 제출한 결과는 승인하거나 반려할 수 없어요. 다른 운영진이 처리해야 해요.',
  // S5. 봇 전용 코드(API_KEY_*)는 웹이 받지 않지만 표를 채운다
  API_KEY_INVALID: '봇 인증에 실패했어요.',
  API_KEY_SCOPE_MISSING: '봇 권한이 부족해요.',
  NETWORK_ERROR: '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.',
  INVALID_RESPONSE: '서버 응답 형식이 예상과 달라요. 운영진에게 알려 주세요.',
};

export function errorMessage(code: AppErrorCode): string {
  return ERROR_MESSAGES[code];
}

/**
 * 동기화 실패(`GameAccountSyncInfo.error.code`) 안내. HTTP 오류가 아니라 계정 카드 안에 보여 준다(계약 2절 표).
 * STEAM_PROFILE_PRIVATE는 스팀 카드가 목업 문구로 따로 그린다(여기 문구는 짧은 요약용).
 */
export const SYNC_ERROR_MESSAGES: Record<GameAccountSyncError, { title: string; body: string }> = {
  STEAM_PROFILE_PRIVATE: {
    title: '플레이타임을 가져오지 못했어요',
    body: '스팀 프로필의 게임 세부 정보가 비공개예요.',
  },
  ACCOUNT_NOT_FOUND: {
    title: '계정을 찾지 못했어요',
    body: '계정이 삭제됐거나 바뀐 것 같아요. 연동을 해제한 뒤 다시 연동해 주세요.',
  },
  PROVIDER_AUTH_FAILED: {
    title: '최근 갱신에 실패했어요',
    body: '잠시 후 자동으로 다시 시도해요. 그동안 마지막으로 가져온 값을 보여 줘요.',
  },
  PROVIDER_RATE_LIMITED: {
    title: '최근 갱신에 실패했어요',
    body: '잠시 후 자동으로 다시 시도해요. 그동안 마지막으로 가져온 값을 보여 줘요.',
  },
  PROVIDER_UNAVAILABLE: {
    title: '최근 갱신에 실패했어요',
    body: '잠시 후 자동으로 다시 시도해요. 그동안 마지막으로 가져온 값을 보여 줘요.',
  },
  PROVIDER_NOT_CONFIGURED: {
    title: '갱신할 수 없어요',
    body: '게임 연동 설정에 문제가 있어요. 운영진에게 알려 주세요.',
  },
  INTERNAL_ERROR: {
    title: '갱신할 수 없어요',
    body: '서버에서 문제가 생겼어요. 계속되면 운영진에게 알려 주세요.',
  },
};

/** RATE_LIMITED 등 Retry-After가 있으면 「N초 뒤」를 덧붙인다 */
export function errorMessageWithRetry(code: AppErrorCode, retryAfterSec: number | undefined): string {
  const base = ERROR_MESSAGES[code];
  // 하루 이상 걸리는 대기(새로고침 한도, 노쇼 제한)는 「N분 뒤」 대신 화면이 해제 시각을 따로 보여 준다
  if (retryAfterSec === undefined || code === 'SYNC_LIMIT_EXCEEDED' || code === 'SCRIM_BANNED') return base;
  if (retryAfterSec <= 0) return base;
  const wait = retryAfterSec < 60 ? `${retryAfterSec}초` : `${Math.ceil(retryAfterSec / 60)}분`;
  return `${base} (${wait} 뒤 가능)`;
}
