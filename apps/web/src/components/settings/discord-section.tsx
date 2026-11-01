'use client';

import { Badge } from '@/components/ui/controls';
import { DiscordIcon } from '@/components/ui/icons';
import { Avatar, Card, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { DISCORD_LINKED_DESCRIPTION, DISCORD_UNLINKED_DESCRIPTION, discordStatus } from '@/lib/discord-status';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { useMe } from '@/lib/hooks/auth';

/**
 * 「디스코드 연동」 섹션(목업 Settings DISCORD, 계약 S5 10절 r2).
 * 상태는 GET /me의 discord_id 하나로 정한다(D238): 연동됨(실제 디스코드 로그인) / 미연동(개발 전용 로그인·null).
 * 연동 코드 발급·「/연동」 안내·만료 타이머는 없다(D237). 연동 해제도 없다(D204).
 */
export function DiscordSection() {
  const me = useMe();
  const status = me.data ? discordStatus(me.data) : null;

  return (
    <Card aria-labelledby="discord-title" className="border-hero-line bg-hero">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="flex flex-col gap-1">
          <Eyebrow>DISCORD</Eyebrow>
          <h2 id="discord-title" className="m-0 text-lg font-bold">
            디스코드 연동
          </h2>
          <p className="m-0 text-[13px] text-muted">{DISCORD_LINKED_DESCRIPTION}</p>
        </div>
        {status === 'linked' && (
          <Badge tone="cyan" icon="check">
            연동됨
          </Badge>
        )}
        {status === 'unlinked' && <Badge tone="neutral">미연동</Badge>}
      </div>

      {me.isPending ? (
        <div className="flex items-center gap-3" aria-busy="true" aria-label="디스코드 연동 상태 불러오는 중">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : me.isError && !me.data ? (
        <ErrorState
          message={isApiError(me.error) ? errorMessage(me.error.code) : errorMessage('NETWORK_ERROR')}
          onRetry={() => void me.refetch()}
        />
      ) : me.data && status === 'linked' ? (
        <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-hero-line-2 bg-hero-2 p-4">
          <Avatar src={me.data.avatar_url} name={me.data.nickname} size={48} />
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
            <span className="flex items-center gap-2 break-all text-[15px] font-bold">
              <DiscordIcon size={18} className="shrink-0 text-discord" />
              {me.data.discord_username ? `@${me.data.discord_username}` : '이름 없음'}
            </span>
            <span className="text-[13px] text-muted">
              {me.data.discord_guild_verified_at ? `서버 멤버 확인 · ${formatFull(me.data.discord_guild_verified_at)}` : '연동된 디스코드 계정'}
            </span>
          </div>
        </div>
      ) : me.data ? (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-hero-line-2 p-4">
          <DiscordIcon size={22} className="shrink-0 text-faint" />
          <span className="text-sm font-semibold text-text-2">{DISCORD_UNLINKED_DESCRIPTION}</span>
        </div>
      ) : null}
    </Card>
  );
}
