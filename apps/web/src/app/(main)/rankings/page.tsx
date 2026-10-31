import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RankingsView } from '@/components/rankings/rankings-view';
import { Skeleton } from '@/components/ui/primitives';

export const metadata: Metadata = { title: '랭킹' };

/** 랭킹(목업 Rankings, 계약 10절). 데이터는 클라이언트에서 GET /rankings/tier·elo */
export default function RankingsPage() {
  return (
    // useSearchParams(탭·게임·시즌 쿼리 동기화)는 Suspense 경계 안에서만 정적 빌드가 가능하다
    <Suspense fallback={<Skeleton className="h-[420px] rounded-[20px]" />}>
      <RankingsView />
    </Suspense>
  );
}
