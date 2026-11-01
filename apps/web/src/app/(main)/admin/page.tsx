import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminView } from '@/components/admin/admin-view';
import { Skeleton } from '@/components/ui/primitives';

export const metadata: Metadata = { title: '관리자' };

/** 관리자(목업 Admin, 계약 S6 13절). 사이드바 링크는 admin에게만 렌더하고, 실제 권한 검사는 서버가 한다 */
export default function AdminPage() {
  return (
    // useSearchParams(?tab=)는 Suspense 경계 안에서만 정적 빌드가 가능하다
    <Suspense fallback={<Skeleton className="h-[420px] rounded-[20px]" />}>
      <AdminView />
    </Suspense>
  );
}
