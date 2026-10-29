import type { Metadata } from 'next';
import { ProfileView } from '@/components/profile/profile-view';

export const metadata: Metadata = { title: '프로필' };

/** 멤버 프로필(목업 Profile, 계약 S1 8·12절). 데이터는 클라이언트에서 GET /users/:id/profile */
export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProfileView id={id} />;
}
