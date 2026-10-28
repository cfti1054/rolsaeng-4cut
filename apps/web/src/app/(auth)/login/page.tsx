import { LoginPageQuery } from '@gcd/shared';
import type { Metadata } from 'next';
import { LoginPanel } from '@/components/auth/login-panel';
import { safeRedirect } from '@/lib/routes';

export const metadata: Metadata = { title: '로그인' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * /login (목업 Login 1단계). 쿼리는 LoginPageQuery로 필드별 파싱한다.
 * 알 수 없는 error 값이나 위험한 redirect는 버린다(다른 필드는 살린다).
 */
export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const error = LoginPageQuery.shape.error.safeParse(first(sp.error));
  const redirect = safeRedirect(first(sp.redirect));
  return (
    <LoginPanel
      error={error.success ? error.data : undefined}
      redirect={redirect}
      devLoginEnabled={process.env.NEXT_PUBLIC_AUTH_DEV_LOGIN === 'true'}
    />
  );
}
