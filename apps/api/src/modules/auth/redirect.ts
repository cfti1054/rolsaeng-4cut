import { type OAuthLoginErrorCode, SafeRedirectPath } from '@gcd/shared';

/** 로그인 후 이동 대상이 될 수 없는 인증 화면(계약 D31). 웹 lib/routes.ts AUTH_PATHS와 같은 값 */
const AUTH_PATHS = ['/login', '/welcome'];

/**
 * SafeRedirectPath에 맞으면 그 값, 아니면 '/'(계약 5-5 시작 2번). 배열·비문자열도 '/'.
 * `/login`·`/welcome`(하위 경로·쿼리 포함)도 '/'(계약 D31, 인증 화면 루프 방지).
 */
export function toSafeRedirect(raw: unknown): string {
  const parsed = SafeRedirectPath.safeParse(raw);
  if (!parsed.success) return '/';
  const path = parsed.data;
  const pathname = path.split(/[?#]/)[0] ?? '/';
  if (AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return '/';
  return path;
}

/** 웹 오리진 기준 절대 URL(계약 5-1: Location은 항상 WEB_ORIGIN 기준). path는 '/'로 시작해야 한다. */
export function webUrl(webOrigin: string, path: string): string {
  return `${webOrigin}${path}`;
}

/** `{WEB_ORIGIN}/login?error={code}[&redirect=...]` (계약 5-5 콜백 10번) */
export function loginErrorUrl(
  webOrigin: string,
  code: OAuthLoginErrorCode,
  redirect?: string,
): string {
  const params = new URLSearchParams({ error: code });
  if (redirect && redirect !== '/') params.set('redirect', redirect);
  return webUrl(webOrigin, `/login?${params.toString()}`);
}

/** 로그인 성공 후 이동 대상(계약 5-5 콜백 9번) */
export function postLoginTarget(redirect: string, needsNicknameConfirmation: boolean): string {
  return needsNicknameConfirmation ? `/welcome?redirect=${encodeURIComponent(redirect)}` : redirect;
}
