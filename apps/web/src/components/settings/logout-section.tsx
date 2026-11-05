'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/controls';
import { Card, Eyebrow } from '@/components/ui/primitives';
import { useLogout } from '@/lib/hooks/auth';
import { routes } from '@/lib/routes';

/**
 * 설정 「계정」 섹션의 로그아웃. 모바일은 사이드바가 없어 여기서 로그아웃한다(PC는 사이드바 사용자 카드에도 있다).
 * 실패해도 클라이언트 세션은 비우고 /login으로 보낸다(useLogout의 onSettled).
 */
export function LogoutSection() {
  const logout = useLogout();
  const router = useRouter();

  const onLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => router.replace(routes.login()),
    });

  return (
    <Card aria-labelledby="logout-title">
      <div className="flex flex-col gap-1">
        <Eyebrow>ACCOUNT</Eyebrow>
        <h2 id="logout-title" className="m-0 text-lg font-bold">
          로그아웃
        </h2>
      </div>
      <p className="m-0 text-[13px] leading-relaxed text-muted">이 기기에서 로그아웃합니다. 다시 사용하려면 로그인해 주세요.</p>
      <div>
        <Button variant="danger" size="md" onClick={onLogout} disabled={logout.isPending}>
          {logout.isPending ? '로그아웃 중…' : '로그아웃'}
        </Button>
      </div>
    </Card>
  );
}
