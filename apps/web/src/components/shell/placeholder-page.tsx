import type { ReactNode } from 'react';
import { Card, EmptyState, PageHeader } from '@/components/ui/primitives';

/** 다음 슬라이스에서 채울 메뉴의 자리 화면(계약 9-5 「준비 중」 빈 상태). */
export function PlaceholderPage({
  eyebrow,
  title,
  mark,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  mark: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Card aria-label={`${title} 준비 중`}>
        <EmptyState mark={mark} title="준비 중이에요" description={description} action={children} />
      </Card>
    </>
  );
}
