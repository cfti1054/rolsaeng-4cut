'use client';

import { GameCode, ScrimListStatus } from '@gcd/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/controls';
import { RefreshIcon } from '@/components/ui/icons';
import { EmptyState, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatClock } from '@/lib/format';
import { GAME_SCRIM_META } from '@/lib/games';
import { useGames, useScrims } from '@/lib/hooks/scrims';
import { useNow } from '@/lib/hooks/use-now';
import { routes } from '@/lib/routes';
import { SCRIM_LIST_TABS, restrictionUntilShort } from '@/lib/scrims';
import { RestrictionBanner, useRestriction } from './scrim-bits';
import { ScrimCard } from './scrim-card';

const EMPTY_TEXT: Record<ScrimListStatus, { title: string; description: string }> = {
  open: { title: '모집 중인 내전이 없어요', description: '보고 싶은 내전이 없다면 직접 모집글을 올려 보세요.' },
  playing: { title: '진행 중인 내전이 없어요', description: '시작한 내전이 여기에 보여요.' },
  ended: { title: '끝난 내전이 아직 없어요', description: '종료되거나 취소된 내전이 여기에 남아요.' },
};

/**
 * /scrims(목업 Scrims, 계약 8절). 게임 필터·상태 탭은 URL 쿼리(game, status)와 동기화된다.
 */
export function ScrimsView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const game = GameCode.safeParse(sp.get('game') ?? undefined).data;
  const status = ScrimListStatus.safeParse(sp.get('status') ?? undefined).data ?? 'open';
  const go = (next: { game?: GameCode; status: ScrimListStatus }) => {
    if (pathname !== '/scrims') return;
    router.replace(routes.scrims(next), { scroll: false });
  };

  const games = useGames();
  const list = useScrims({ game, status });
  const { restriction, restricted } = useRestriction();
  const now = useNow(60_000);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const gameName = game ? (GAME_SCRIM_META[game]?.label ?? game) : null;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Eyebrow className="text-xs">SCRIMS</Eyebrow>
          <h1 className="m-0 text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">내전</h1>
          <p className="m-0 text-sm text-muted">정원이 차면 방장이 팀을 나누고, 정원을 넘으면 대기열에 들어갑니다.</p>
        </div>
        <NewScrimButton restricted={restricted} until={restriction?.until ?? null} />
      </header>

      <RestrictionBanner restriction={restriction} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-line bg-surface p-2">
        <div role="group" aria-label="게임 필터" className="flex flex-wrap gap-1.5">
          <FilterButton label="전체" pressed={!game} dotClass="bg-text" onClick={() => go({ status })} />
          {games.isPending ? (
            <>
              <Skeleton className="h-[42px] w-20 rounded-xl" />
              <Skeleton className="h-[42px] w-16 rounded-xl" />
            </>
          ) : (
            games.data?.items.map((g) => (
              <FilterButton
                key={g.code}
                label={GAME_SCRIM_META[g.code]?.label ?? g.name}
                pressed={game === g.code}
                dotClass={GAME_SCRIM_META[g.code]?.dot ?? 'bg-muted'}
                onClick={() => go({ game: g.code, status })}
              />
            ))
          )}
        </div>
        <div role="group" aria-label="상태 필터" className="flex gap-1 pr-1">
          {SCRIM_LIST_TABS.map((t) => {
            const on = t.value === status;
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={on}
                onClick={() => go({ game, status: t.value })}
                className={cn(
                  'h-9 rounded-[10px] border px-3.5 text-[13px]',
                  on ? 'border-line-3 bg-surface-2 font-semibold text-text' : 'border-transparent bg-transparent text-muted hover:text-text',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {list.isPending ? (
        <div aria-busy="true" aria-label="내전 목록 불러오는 중" className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[330px] rounded-[20px]" />
          ))}
        </div>
      ) : list.isError && items.length === 0 ? (
        <ErrorState
          message={isApiError(list.error) ? errorMessage(list.error.code) : errorMessage('NETWORK_ERROR')}
          onRetry={() => void list.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          mark="5V5"
          title={gameName ? `${gameName} ${EMPTY_TEXT[status].title}` : EMPTY_TEXT[status].title}
          description={EMPTY_TEXT[status].description}
          action={
            status === 'open' && !restricted ? (
              <Link
                href={routes.scrimNew()}
                className="flex h-10 items-center rounded-xl bg-accent px-4 text-[13px] font-bold text-on-accent no-underline hover:text-on-accent"
              >
                모집글 작성
              </Link>
            ) : undefined
          }
        />
      ) : (
        <section aria-label="내전 목록" className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <ScrimCard key={s.id} s={s} now={now} />
          ))}
        </section>
      )}

      {items.length > 0 && (
        <div className="flex flex-col items-center gap-3">
          {list.hasNextPage && (
            <Button onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className="min-w-[160px]">
              {list.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
            </Button>
          )}
          {list.isFetchNextPageError && (
            <ErrorState
              message={isApiError(list.error) ? errorMessage(list.error.code) : errorMessage('NETWORK_ERROR')}
              onRetry={() => void list.fetchNextPage()}
            />
          )}
          <p className="m-0 flex items-center gap-2 text-xs text-faint">
            {list.dataUpdatedAt > 0 && <span>{formatClock(new Date(list.dataUpdatedAt).toISOString())} 기준</span>}
            <button
              type="button"
              onClick={() => void list.refetch()}
              disabled={list.isFetching}
              className="inline-flex items-center gap-1 font-semibold text-muted hover:text-text disabled:opacity-50"
            >
              <RefreshIcon size={13} className={list.isFetching ? 'animate-spin' : undefined} />
              새로 고침
            </button>
          </p>
        </div>
      )}
    </>
  );
}

function FilterButton({ label, pressed, dotClass, onClick }: { label: string; pressed: boolean; dotClass: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'flex h-[42px] items-center gap-2 rounded-xl px-4 text-sm font-semibold',
        pressed ? 'bg-accent text-on-accent' : 'bg-transparent text-text-2 hover:bg-hover',
      )}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', pressed ? 'bg-on-accent' : dotClass)} />
      {label}
    </button>
  );
}

/** 「모집글 작성」. 노쇼 제한 중이면 비활성 + 해제 시각 툴팁(계약 8절) */
export function NewScrimButton({ restricted, until }: { restricted: boolean; until: string | null }) {
  const icon = (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
  if (restricted) {
    const tip = until ? `노쇼 제한 중 · ${restrictionUntilShort(until)}` : '노쇼 제한 중';
    return (
      <span title={tip} className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled
          aria-describedby="new-scrim-restricted"
          className="flex h-[46px] cursor-not-allowed items-center gap-2 rounded-[14px] bg-accent px-[18px] text-sm font-bold text-on-accent opacity-50"
        >
          {icon}모집글 작성
        </button>
        <span id="new-scrim-restricted" className="text-xs text-faint">
          {tip}
        </span>
      </span>
    );
  }
  return (
    <Link
      href={routes.scrimNew()}
      className="flex h-[46px] items-center gap-2 rounded-[14px] bg-accent px-[18px] text-sm font-bold text-on-accent no-underline hover:text-on-accent"
    >
      {icon}모집글 작성
    </Link>
  );
}
