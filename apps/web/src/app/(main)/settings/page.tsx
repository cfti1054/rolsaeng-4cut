import type { Metadata } from 'next';
import { DiscordSection } from '@/components/settings/discord-section';
import { GameAccountsSection } from '@/components/settings/game-accounts-section';
import { NotificationSection } from '@/components/settings/notification-section';
import { ThemeSettingsSection } from '@/components/theme/theme-settings';
import { PageHeader } from '@/components/ui/primitives';

export const metadata: Metadata = { title: '설정' };

/**
 * 설정(목업 Settings, 계약 S1 12절·S5 10절·S6 13절). 섹션 순서: 화면 테마 → 게임 계정 연동 → 디스코드 연동 → 알림.
 * 알림은 발송 경로가 있는 두 항목만(S6 D259).
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <PageHeader eyebrow="SETTINGS" title="설정" />
      <ThemeSettingsSection />
      <GameAccountsSection />
      <DiscordSection />
      <NotificationSection />
    </div>
  );
}
