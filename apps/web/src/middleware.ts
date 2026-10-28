import { AUTH_COOKIE } from '@gcd/shared';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * 계약 5-9: (main) 경로와 /welcome에서 리프레시 쿠키(gcd_rt)가 없으면 /login?redirect={경로}.
 * 쿠키가 있으면 통과(유효성은 클라이언트가 부팅 때 /auth/refresh로 확인).
 * /login은 쿠키가 있어도 / 로 보내지 않는다(만료 쿠키로 갇히는 것 방지).
 */
export function middleware(req: NextRequest) {
  if (req.cookies.has(AUTH_COOKIE.refresh)) return NextResponse.next();
  const url = req.nextUrl.clone();
  // /welcome?redirect=X 는 X를 그대로 넘긴다(/login?redirect=/welcome… 은 루프 방지 규칙에 걸려 / 가 된다)
  const redirect =
    req.nextUrl.pathname === '/welcome'
      ? (req.nextUrl.searchParams.get('redirect') ?? '/')
      : `${req.nextUrl.pathname}${req.nextUrl.search}`;
  url.pathname = '/login';
  url.search = '';
  if (redirect !== '/') url.searchParams.set('redirect', redirect);
  return NextResponse.redirect(url);
}

export const config = {
  // /login, /api 프록시, Next 내부 파일, 확장자가 있는 정적 파일은 제외
  matcher: ['/((?!login|api/|_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
