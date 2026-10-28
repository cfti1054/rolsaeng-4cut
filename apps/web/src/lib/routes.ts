import { API_PREFIX, ApiPath, SafeRedirectPath, type OAuthLoginErrorCode } from '@gcd/shared';

/**
 * 웹 라우트. 링크는 반드시 이 함수들로 만든다(nextjs-dashboard-ui 1절).
 */
export const routes = {
  home: () => '/',
  scrims: () => '/scrims',
  rankings: () => '/rankings',
  member: (id: string) => `/members/${encodeURIComponent(id)}`,
  settings: () => '/settings',
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
