import type { Metadata } from 'next';
import { PlaceholderPage } from '@/components/shell/placeholder-page';

export const metadata: Metadata = { title: '프로필' };

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  await params; // S1·S4에서 멤버 조회에 쓴다
  return (
    <PlaceholderPage
      eyebrow="PROFILE"
      title="프로필"
      mark="ME"
      description="연동한 게임 계정의 티어, 최근 전적, 내전 레이팅 추이가 이 화면에 열릴 예정이에요."
    />
  );
}
