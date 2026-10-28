import type { Metadata } from 'next';
import { WelcomePanel } from '@/components/auth/welcome-panel';
import { safeRedirect } from '@/lib/routes';

export const metadata: Metadata = { title: '닉네임 확인' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /welcome (목업 Login 2단계, 계약 5-7). 콜백이 /welcome?redirect=… 로 보낸다. */
export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.redirect) ? sp.redirect[0] : sp.redirect;
  return <WelcomePanel redirect={safeRedirect(raw)} />;
}
