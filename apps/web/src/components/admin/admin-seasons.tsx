'use client';

import type { AdminSeasonPhase } from '@gcd/shared';
import { Badge } from '@/components/ui/controls';
import { PanelHead } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { SEASON_PHASE_LABEL } from '@/lib/admin';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { useAdminSeasons } from '@/lib/hooks/admin';

const PHASE_TONE: Record<AdminSeasonPhase, 'accent' | 'cyan' | 'orange' | 'neutral'> = {
  upcoming: 'cyan',
  current: 'accent',
  ended: 'orange',
  closed: 'neutral',
};

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));

/** 분기 탭. 기간은 결과 승인 때 달력 분기로 만들어지고, 여기서는 목록만 본다 */
export function AdminSeasonsTab() {
  const q = useAdminSeasons();
  return (
    <Card aria-labelledby="season-list-title">
      <PanelHead eyebrow="QUARTER" title="분기 목록" id="season-list-title" />
      <p className="m-0 text-[13px] text-muted">1·4·7·10월 1일(한국 시간)에 바뀌고, 점수는 1000에서 다시 시작해요.</p>
      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : q.isError ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState mark="Q" title="분기가 없어요" description="첫 결과가 승인되면 이번 분기가 자동으로 만들어져요." />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-x-0 border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-left font-display text-[11px] tracking-[0.14em] text-faint">
                <th className="px-3.5 py-2 font-semibold">NAME</th>
                <th className="px-3.5 py-2 font-semibold">PERIOD</th>
                <th className="px-3.5 py-2 font-semibold">PHASE</th>
                <th className="px-3.5 py-2 text-right font-semibold">GAMES</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((s) => (
                <tr key={s.id} className="bg-surface-2">
                  <td className="rounded-l-xl px-3.5 py-3 font-semibold">{s.name}</td>
                  <td className="px-3.5 py-3 font-display text-[13px] text-text-2">
                    {formatFull(s.starts_at)} – {formatFull(s.ends_at)}
                  </td>
                  <td className="px-3.5 py-3">
                    <Badge tone={PHASE_TONE[s.phase]}>{SEASON_PHASE_LABEL[s.phase]}</Badge>
                  </td>
                  <td className="rounded-r-xl px-3.5 py-3 text-right font-display font-semibold">{s.rated_games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
