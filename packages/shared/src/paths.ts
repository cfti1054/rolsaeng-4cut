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
  /** 롤체 더블업 2인 팀 저장. POST, 방장·운영진. 응답은 ScrimDetail */
  scrimDuos: '/scrims/:id/duos',
  scrimJoin: '/scrims/:id/join',
  scrimStart: '/scrims/:id/start',
  scrimCancel: '/scrims/:id/cancel',
  scrimPlayerNoShow: '/scrims/:id/players/:userId/no-show',
  // S2 내 노쇼 제한 상태
  myScrimRestriction: '/me/scrim-restriction',
  // S3 팀 밸런스·팀 구성·결과 (scrimResult: POST 제출, DELETE 제출 취소)
  scrimBalance: '/scrims/:id/balance',
  scrimTeams: '/scrims/:id/teams',
  scrimResult: '/scrims/:id/result',
  scrimResultApprove: '/scrims/:id/result/approve',
  scrimResultReject: '/scrims/:id/result/reject',
  // S3 시즌·레이팅 그래프
  seasons: '/seasons',
  userRatingHistory: '/users/:id/rating-history',
  // S4 랭킹·홈 요약
  rankingsTier: '/rankings/tier',
  rankingsElo: '/rankings/elo',
  dashboardSummary: '/dashboard/summary',
  // S4 후속 변경 2 라인 추천(계약 S4 20절 D190)
  myPositionSuggestions: '/me/position-suggestions',
  // S5 활동·플레이타임 랭킹
  rankingsActivity: '/rankings/activity',
  rankingsPlaytime: '/rankings/playtime',
  // S5 디스코드 봇(X-API-Key). 문서 6장 5개 중 /bot/link 제외 4개(D237) + 서버 입장·퇴장, 음성 접속 현황(D214)
  botActivity: '/bot/activity',
  botUserLookup: '/bot/users/lookup',
  botUpcomingScrims: '/bot/scrims/upcoming',
  botRanking: '/bot/rankings/:type',
  botMemberEvents: '/bot/member-events',
  botPresence: '/bot/presence',
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
