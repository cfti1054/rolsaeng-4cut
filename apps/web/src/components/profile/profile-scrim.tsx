'use client';

import type { GameCode, GetUserProfileResponse, ProfileRecentScrim } from '@gcd/shared';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { EmptyState, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { ratingEmptyText } from '@/lib/dashboard';
import { errorMessage } from '@/lib/errors';
import { formatFull, formatMonthDay } from '@/lib/format';
import { GAME_META } from '@/lib/games';
import { useUserRatingHistory, useSeasons } from '@/lib/hooks/ratings';
import { useGames } from '@/lib/hooks/scrims';
import { routes } from '@/lib/routes';
import {
  RECENT_OUTCOME_LABEL,
  primaryRating,
  ratingChartData,
  ratingRecordText,
  recentScrimRole,
  signed,
} from '@/lib/scrim-results';

/**
 * 프로필 내전 블록(목업 Profile, 계약 S3 9절): 레이팅 카드 값, RATING HISTORY(Recharts), 최근 내전.
 * 그래프 색은 CSS 변수(토큰)만 쓴다(hex 금지, D53).
 */

/** 레이팅 그래프는 recharts와 함께 나중에 받는다. 자리는 같은 높이로 비워 둬 화면이 흔들리지 않게 한다 */
const RatingChart = dynamic(() => import('./rating-chart').then((m) => m.RatingChart), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-[210px] w-full" />,
});

/** 요약 카드 「내전 레이팅」 값. 값이 없을 때 문구는 ratingEmptyText */
export function scrimRatingSummary(p: GetUserProfileResponse): { value: ReactNode; sub: string; game: GameCode | null; rank: number | null } {
  const best = primaryRating(p.scrim?.ratings ?? []);
  if (!best) {
    const empty = ratingEmptyText(p.scrim);
    return { value: <span className="text-muted">{empty.value}</span>, sub: empty.sub, game: null, rank: null };
  }
  return {
    value: (
      <span className="font-display">
        {best.elo}
        <span className="ml-1.5 text-xs font-semibold text-faint">{GAME_META[best.game].short}</span>
      </span>
    ),
    sub: ratingRecordText(best),
    game: best.game,
    rank: best.rank,
  };
}

function Panel({ eyebrow, title, right, className, children }: { eyebrow: string; title: string; right?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className={cn('flex min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-surface p-[22px] shadow-[inset_0_1px_0_var(--hi)]', className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="m-0 text-lg font-bold">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const selectClass = 'h-9 rounded-[10px] border border-line-3 bg-surface-2 px-2.5 text-[13px] text-text';

// -----------------------------------------------------------------------------
// 레이팅 그래프
// -----------------------------------------------------------------------------

export function RatingHistoryPanel({ p, className }: { p: GetUserProfileResponse; className?: string }) {
  const games = useGames();
  const seasons = useSeasons();
  const gameSelectId = useId();
  const seasonSelectId = useId();
  const defaultGame: GameCode | null =
    primaryRating(p.scrim?.ratings ?? [])?.game ??
    [...(games.data?.items ?? [])].filter((g) => g.has_teams).sort((a, b) => a.sort_order - b.sort_order)[0]?.code ??
    null;
  const [picked, setPicked] = useState<GameCode | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const game = picked ?? defaultGame;
  const q = useUserRatingHistory(p.user.id, game, season);
  const data = q.data;
  const points = data?.points ?? [];
  const last = points[points.length - 1];

  const right = last ? (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-[30px] font-bold leading-none">{last.elo_after}</span>
      <span className={cn('font-display text-[13px] font-bold', last.delta >= 0 ? 'text-accent-ink' : 'text-orange-text')}>
        {signed(last.delta)}
        {data?.season && <span className="font-sans font-semibold text-faint"> · {data.season.name}</span>}
      </span>
    </div>
  ) : null;

  return (
    <Panel eyebrow="RATING HISTORY" title="내전/모집 레이팅 변동" right={right} className={className}>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={gameSelectId} className="sr-only">
          게임
        </label>
        <select
          id={gameSelectId}
          className={selectClass}
          value={game ?? ''}
          onChange={(e) => setPicked(e.target.value as GameCode)}
          disabled={!games.data}
        >
          {!game && <option value="">게임</option>}
          {(games.data?.items ?? [])
            .filter((g) => g.code !== 'other')
            .map((g) => (
            <option key={g.code} value={g.code}>
              {g.name}
            </option>
          ))}
        </select>
        <label htmlFor={seasonSelectId} className="sr-only">
          분기
        </label>
        <select id={seasonSelectId} className={selectClass} value={season ?? ''} onChange={(e) => setSeason(e.target.value || null)}>
          <option value="">{seasons.data ? '현재 분기' : '분기'}</option>
          {(seasons.data?.items ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.is_current ? ' (진행 중)' : ''}
            </option>
          ))}
        </select>
      </div>
      {!game && games.isError ? (
        // 레이팅 기록이 없어 기본 게임을 GET /games로 고르는데 그 조회가 실패한 경우
        <ErrorState
          message={isApiError(games.error) ? errorMessage(games.error.code) : errorMessage('NETWORK_ERROR')}
          onRetry={() => void games.refetch()}
        />
      ) : !game ? (
        <Skeleton className="h-[210px] rounded-[14px]" />
      ) : q.isPending ? (
        <Skeleton className="h-[210px] rounded-[14px]" />
      ) : q.isError && !data ? (
        <ErrorState message={isApiError(q.error) ? errorMessage(q.error.code) : errorMessage('NETWORK_ERROR')} onRetry={() => void q.refetch()} />
      ) : points.length === 0 ? (
        <EmptyState mark="ELO" title="이 분기 내전/모집 기록이 없어요" description="레이팅에 반영된 내전/모집이 쌓이면 변동 그래프가 그려져요." />
      ) : (
        <RatingChart points={points} truncated={data?.truncated ?? false} fetching={q.isFetching} />
      )}
    </Panel>
  );
}

// 최근 내전
// -----------------------------------------------------------------------------

const OUTCOME_TONE: Record<ProfileRecentScrim['outcome'], { bar: string; text: string; row: string }> = {
  win: { bar: 'bg-accent', text: 'text-accent-ink', row: 'bg-accent/4' },
  loss: { bar: 'bg-orange', text: 'text-orange-text', row: 'bg-orange/4' },
  no_show: { bar: 'bg-orange', text: 'text-orange-text', row: 'bg-surface-2' },
  unassigned: { bar: 'bg-line-3', text: 'text-faint', row: 'bg-surface-2' },
};

export function RecentScrimsPanel({ p, className }: { p: GetUserProfileResponse; className?: string }) {
  const recent = p.scrim?.recent ?? [];
  return (
    <Panel eyebrow="SCRIMS" title="최근 내전/모집" className={className}>
      {recent.length === 0 ? (
        <EmptyState mark="VS" title="아직 끝난 내전/모집이 없어요" description="참가한 내전/모집 결과가 승인되면 여기에 쌓여요." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {recent.map((r) => {
            const tone = OUTCOME_TONE[r.outcome];
            const role = recentScrimRole(r);
            return (
              <li key={r.scrim_id} className={cn('flex min-h-[54px] items-center gap-3 rounded-[14px] px-3', tone.row)}>
                <span aria-hidden="true" className={cn('my-2.5 w-1 self-stretch rounded-sm', tone.bar)} />
                <span className={cn('w-[42px] shrink-0 font-display text-[13px] font-bold', tone.text)}>{RECENT_OUTCOME_LABEL[r.outcome]}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link href={routes.scrim(r.scrim_id)} className="truncate text-sm font-semibold text-text no-underline hover:text-text hover:underline">
                    {r.title}
                  </Link>
                  <span className="truncate text-xs text-faint">
                    <time dateTime={r.finished_at} title={formatFull(r.finished_at)}>
                      {formatMonthDay(r.finished_at)}
                    </time>
                    {` · ${GAME_META[r.game].short}`}
                    {role && ` · ${role}`}
                  </span>
                </div>
                {r.elo_delta !== null ? (
                  <span className={cn('font-display text-base font-bold', r.elo_delta >= 0 ? 'text-accent-ink' : 'text-orange-text')}>{signed(r.elo_delta)}</span>
                ) : (
                  <span className="text-xs text-faint">미반영</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
