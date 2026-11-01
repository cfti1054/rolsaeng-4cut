'use client';

import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { SEASON_PIPS, SEASON_WAITING_NOTE, SEASON_WAITING_TITLE, seasonDayText, seasonFilledPips, seasonResetText } from '@/lib/dashboard';
import { useMe } from '@/lib/hooks/auth';
import { useDashboardSummary } from '@/lib/hooks/rankings';

/** 사이드바 시즌 카드(목업 Main, 계약 10절). 요약이 실패하면 숨긴다(앱 셸을 막지 않는다) */
export function SeasonCard() {
  const q = useDashboardSummary();
  const me = useMe();
  // /me가 실패하면 요약 쿼리는 disabled(isPending + idle)로 남는다. 실제로 기다리는 중일 때만 스켈레톤
  if (q.isPending && (q.fetchStatus === 'fetching' || me.isPending)) return <Skeleton className="h-[92px] rounded-2xl" />;
  if (!q.data) return null;
  const { season } = q.data;
  if (!season) {
    return (
      <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-3.5">
        <span className="text-[13px] font-bold">{SEASON_WAITING_TITLE}</span>
        <span className="text-xs text-muted">{SEASON_WAITING_NOTE}</span>
      </div>
    );
  }
  const filled = seasonFilledPips(season.progress);
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-display text-xs font-bold tracking-[0.12em]">{season.name}</span>
        <span className="shrink-0 font-display text-xs text-accent-ink">{seasonDayText(season.days_left)}</span>
      </div>
      <div
        role="img"
        aria-label={`시즌 진행 ${Math.round(season.progress * 100)}%`}
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${SEASON_PIPS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: SEASON_PIPS }, (_, i) => (
          <span key={i} className={cn('h-1.5 rounded-[2px]', i < filled ? 'bg-accent' : 'bg-line-2')} />
        ))}
      </div>
      <span className="text-xs text-muted">{seasonResetText()}</span>
    </div>
  );
}
