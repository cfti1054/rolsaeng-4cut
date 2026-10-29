import type { Metadata } from 'next';
import { ScrimNewForm } from '@/components/scrims/scrim-new-form';

export const metadata: Metadata = { title: '내전 모집글 작성' };

/** 내전 모집글 작성(목업 ScrimNew, 계약 S2 8절). POST /scrims 성공 → /scrims/{id} */
export default function ScrimNewPage() {
  return <ScrimNewForm />;
}
