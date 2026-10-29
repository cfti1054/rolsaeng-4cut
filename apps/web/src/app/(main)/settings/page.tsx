import type { Metadata } from 'next';
import { DiscordSection } from '@/components/settings/discord-section';
import { GameAccountsSection } from '@/components/settings/game-accounts-section';
import { ThemeSettingsSection } from '@/components/theme/theme-settings';
import { PageHeader } from '@/components/ui/primitives';

export const metadata: Metadata = { title: '설정' };

/**
 * 설정(목업 Settings, 계약 S1 12절). 섹션 순서: 화면 테마 → 게임 계정 연동 → 디스코드 계정.
 * 알림 섹션은 알림 발송 기능 슬라이스까지 그리지 않는다(D48).
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <PageHeader eyebrow="SETTINGS" title="설정" />
      <ThemeSettingsSection />
      <GameAccountsSection />
      <DiscordSection />
    </div>
  );
}
