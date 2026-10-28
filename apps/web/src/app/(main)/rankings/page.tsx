import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/placeholder-page';

export const metadata: Metadata = { title: '랭킹' };

export default function RankingsPage() {
  return (
    <PlaceholderPage
      eyebrow="RANKINGS"
      title="랭킹"
      mark="ELO"
      description="티어, 내전 레이팅, 활동량, 플레이타임 랭킹이 이 화면에 열릴 예정이에요."
    />
  );
}
