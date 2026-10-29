'use client';

import { Badge } from '@/components/ui/controls';
import { DiscordIcon } from '@/components/ui/icons';
import { Avatar, Card, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { useMe } from '@/lib/hooks/auth';

/**
 * 「디스코드 계정」 섹션(읽기 전용, 계약 12절). 로그인에 쓴 디스코드 계정을 보여 주기만 한다.
 * 목업의 「연동 코드 발급」은 봇 슬라이스 몫이라 그리지 않는다(D23).
 */
export function DiscordSection() {
  const me = useMe();
  const isDev = me.data?.discord_id?.startsWith('dev-') ?? false;
  return (
    <Card aria-labelledby="discord-title" className="border-hero-line bg-hero">
      <div className="flex flex-col gap-1">
        <Eyebrow>DISCORD</Eyebrow>
        <h2 id="discord-title" className="m-0 text-lg font-bold">
          디스코드 계정
        </h2>
        <p className="m-0 text-[13px] text-muted">로그인한 디스코드 계정이에요. 다른 계정으로 바꾸려면 로그아웃 후 다시 로그인해 주세요.</p>
      </div>
      {me.isPending ? (
        <div className="flex items-center gap-3">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : me.isError ? (
        <ErrorState
          message={isApiError(me.error) ? errorMessage(me.error.code) : errorMessage('NETWORK_ERROR')}
          onRetry={() => void me.refetch()}
        />
      ) : me.data ? (
        <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-hero-line-2 bg-hero-2 p-4">
          <Avatar src={me.data.avatar_url} name={me.data.nickname} size={48} />
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[15px] font-bold">
              <DiscordIcon size={18} className="text-discord" />
              {me.data.discord_username ? `@${me.data.discord_username}` : '이름 없음'}
            </span>
            <span className="text-[13px] text-muted">
              {isDev
                ? '개발용 로그인 계정이에요(실제 디스코드 계정 아님).'
                : me.data.discord_guild_verified_at
                  ? `서버 멤버 확인 · ${formatFull(me.data.discord_guild_verified_at)}`
                  : '로그인한 디스코드 계정'}
            </span>
          </div>
          <Badge tone={isDev ? 'neutral' : 'cyan'} icon={isDev ? undefined : 'check'}>
            {isDev ? '개발용' : '로그인 계정'}
          </Badge>
        </div>
      ) : null}
    </Card>
  );
}
