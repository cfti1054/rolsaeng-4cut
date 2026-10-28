/** 모든 API의 기본 경로(문서 6장). 아래 ApiPath는 이 접두사 뒤에 붙는다. */
export const API_PREFIX = '/api/v1';

/**
 * 엔드포인트 경로. 서버 컨트롤러와 웹 클라이언트가 같은 상수를 쓴다.
 * 슬라이스마다 architect가 추가한다.
 */
export const ApiPath = {
  // S0 인증
  authDiscordStart: '/auth/discord',
  authDiscordCallback: '/auth/discord/callback',
  authRefresh: '/auth/refresh',
  authLogout: '/auth/logout',
  authDevLogin: '/auth/dev-login',
  // S0 내 정보
  me: '/me',
} as const;
export type ApiPath = (typeof ApiPath)[keyof typeof ApiPath];
