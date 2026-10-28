'use client';

import { PlaceholderPage } from '@/components/shell/placeholder-page';
import { ErrorState } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/errors';
import { useMe } from '@/lib/hooks/auth';

/** 관리자 자리(S6). 사이드바 링크는 admin에게만 보이고, 실제 권한 검사는 S6 API가 한다. */
export default function AdminPage() {
  const me = useMe();
  if (me.data && me.data.role !== 'admin') return <ErrorState message={errorMessage('FORBIDDEN')} />;
  return (
    <PlaceholderPage
      eyebrow="STAFF"
      title="관리자"
      mark="ADM"
      description="내전 결과 승인, 노쇼 관리, 멤버 관리, 공지 작성이 이 화면에 열릴 예정이에요."
    />
  );
}
