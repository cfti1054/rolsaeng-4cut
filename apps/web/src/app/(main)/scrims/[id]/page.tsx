import type { Metadata } from 'next';
import { ScrimDetailView } from '@/components/scrims/scrim-detail';

export const metadata: Metadata = { title: '내전/모집' };

/** 내전 상세(목업 ScrimDetail, 계약 S2 8절). 데이터는 클라이언트에서 GET /scrims/:id(모집 중 20초 재조회) */
export default async function ScrimDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScrimDetailView id={id} />;
}
