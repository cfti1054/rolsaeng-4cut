import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NewsView } from '@/components/news/news-view';
import { Skeleton } from '@/components/ui/primitives';

export const metadata: Metadata = { title: '정보' };

/** 정보(문서 8장 /news, 계약 S6 13절, 목업 없음): 공지 · 패치노트 · 이벤트 캘린더. 데이터는 GET /notices·/patch-notes·/events */
export default function NewsPage() {
  return (
    // useSearchParams(탭·게임·달 쿼리)는 Suspense 경계 안에서만 정적 빌드가 가능하다
    <Suspense fallback={<Skeleton className="h-[420px] rounded-[20px]" />}>
      <NewsView />
    </Suspense>
  );
}
