import type { Metadata } from 'next';
import { ThemeSettingsSection } from '@/components/theme/theme-settings';
import { PageHeader } from '@/components/ui/primitives';

export const metadata: Metadata = { title: '설정' };

/** 설정. S0은 「화면 테마」 섹션만(게임 계정 연동·알림·계정은 S1 이후). */
export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <PageHeader eyebrow="SETTINGS" title="설정" />
      <ThemeSettingsSection />
    </div>
  );
}
