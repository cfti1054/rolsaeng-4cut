import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/placeholder-page';

export const metadata: Metadata = { title: '내전' };

export default function ScrimsPage() {
  return (
    <PlaceholderPage
      eyebrow="SCRIMS"
      title="내전"
      mark="5V5"
      description="내전 모집, 참가, 대기열, 팀 자동 밸런스가 이 화면에 열릴 예정이에요."
    />
  );
}
