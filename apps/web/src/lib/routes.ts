import {
  API_PREFIX,
  ApiPath,
  STEAM_LINK_COMPLETE_PATH,
  SafeRedirectPath,
  type GameCode,
  type OAuthLoginErrorCode,
  type ScrimListStatus,
  type SettingsPageQuery,
  type SteamLinkCompletePageQuery,
} from '@gcd/shared';

/** /scrims 쿼리. status 기본값 open은 주소에 쓰지 않는다 */
export interface ScrimsPageQuery {
  game?: GameCode;
  status?: ScrimListStatus;
}

/** /rankings 쿼리 */
export interface RankingsPageQuery {
  tab?: 'tier' | 'elo';
  game?: GameCode;
  season?: string;
}

/**
 * 웹 라우트. 링크는 반드시 이 함수들로 만든다(nextjs-dashboard-ui 1절).
 */
export const routes = {
  home: () => '/',
  scrims: (q: ScrimsPageQuery = {}) =>
    withQuery('/scrims', { game: q.game, status: q.status === 'open' ? undefined : q.status }),
  scrimNew: () => '/scrims/new',
  scrim: (id: string) => `/scrims/${encodeURIComponent(id)}`,
  /** 스팀 팝업 완료 페이지(S2 9-2). API 콜백이 302로 보낸다. 웹이 직접 만드는 건 목뿐 */
  steamLinkComplete: (q: SteamLinkCompletePageQuery = {}) => withQuery(STEAM_LINK_COMPLETE_PATH, q),
  /** tab·game·season은 필터 선택(기본 탭·시즌은 주소에 쓰지 않는다) */
  rankings: (q: RankingsPageQuery = {}) => withQuery('/rankings', { tab: q.tab === 'elo' ? undefined : q.tab, game: q.game, season: q.season }),
  member: (id: string) => `/members/${encodeURIComponent(id)}`,
  /** 스팀 콜백 결과는 API가 302로 붙여 준다(steam=linked / steam_error). 웹이 직접 만들 일은 목뿐 */
  settings: (q: SettingsPageQuery = {}) => withQuery('/settings', q),
  admin: () => '/admin',
  login: (q: { redirect?: string; error?: OAuthLoginErrorCode } = {}) => withQuery('/login', q),
  welcome: (redirect?: string) => withQuery('/welcome', { redirect }),
} as const;

/** 브라우저가 이동하는 API 주소(웹 오리진 프록시, 계약 5-1) */
export const apiRoutes = {
  /** [API 연결] 디스코드 OAuth 시작. 브라우저 전체 이동으로 연다(fetch 아님). */
  discordStart: (redirect?: string) => withQuery(`${API_PREFIX}${ApiPath.authDiscordStart}`, { redirect }),
} as const;

/** 인증 화면 자체로 돌아가는 redirect는 루프가 되므로 홈으로 바꾼다. */
const AUTH_PATHS = ['/login', '/welcome'];

/**
 * redirect 쿼리를 안전한 내부 경로로 바꾼다. SafeRedirectPath(오픈 리다이렉트 방지)를 통과하지 못하면 '/'.
 */
export function safeRedirect(raw: unknown): string {
  const parsed = SafeRedirectPath.safeParse(raw);
  if (!parsed.success) return '/';
  const path = parsed.data;
  const pathname = path.split(/[?#]/)[0] ?? '/';
  if (AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return '/';
  return path;
}

function withQuery(path: string, q: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, v);
  const s = params.toString();
  return s ? `${path}?${s}` : path;
}
