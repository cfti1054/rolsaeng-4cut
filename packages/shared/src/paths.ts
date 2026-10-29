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
  // S1 게임 계정 연동 (`:id`는 Nest 라우트 파라미터. 웹은 fillPath로 채운다)
  myGameAccounts: '/me/game-accounts',
  myGameAccount: '/me/game-accounts/:id',
  myGameAccountSync: '/me/game-accounts/:id/sync',
  myGameAccountPrimary: '/me/game-accounts/:id/primary',
  riotVerification: '/me/game-accounts/riot-verifications/:id',
  riotVerificationConfirm: '/me/game-accounts/riot-verifications/:id/confirm',
  steamLinkCallback: '/me/game-accounts/steam/callback',
  // S1 프로필
  userProfile: '/users/:id/profile',
  // S2 게임 목록(작성 폼·필터용)
  games: '/games',
  // 스팀 내전 게임 검색(D98)
  steamApps: '/steam-apps',
  // S2 내전
  scrims: '/scrims',
  scrim: '/scrims/:id',
  scrimJoin: '/scrims/:id/join',
  scrimStart: '/scrims/:id/start',
  scrimCancel: '/scrims/:id/cancel',
  scrimPlayerNoShow: '/scrims/:id/players/:userId/no-show',
  // S2 내 노쇼 제한 상태
  myScrimRestriction: '/me/scrim-restriction',
} as const;
export type ApiPath = (typeof ApiPath)[keyof typeof ApiPath];

/**
 * 경로 템플릿의 `:name`을 값으로 채운다(encodeURIComponent 적용). 빠진 파라미터가 있으면 예외.
 * 예: fillPath(ApiPath.userProfile, { id }) → '/users/{id}/profile'
 */
export function fillPath(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`fillPath: '${name}' 값 없음 (${template})`);
    return encodeURIComponent(v);
  });
}
