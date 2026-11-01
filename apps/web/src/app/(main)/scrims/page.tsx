import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ScrimsView } from '@/components/scrims/scrims-view';
import { Skeleton } from '@/components/ui/primitives';

export const metadata: Metadata = { title: '내전/모집' };

/** 내전 목록(목업 Scrims, 계약 S2 8절). 데이터는 클라이언트에서 GET /scrims(useInfiniteQuery) */
export default function ScrimsPage() {
  return (
    // useSearchParams(게임·상태 쿼리 동기화)는 Suspense 경계 안에서만 정적 빌드가 가능하다
    <Suspense fallback={<Skeleton className="h-[420px] rounded-[20px]" />}>
      <ScrimsView />
    </Suspense>
  );
}
