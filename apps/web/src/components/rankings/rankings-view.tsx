'use client';

import type { EloRankingEntry, GameCode, GetEloRankingResponse, GetTierRankingResponse, TierRankingEntry, TierRankingGame } from '@gcd/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/controls';
import { EloInfo } from './elo-info';
import { Avatar, EmptyState, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { GAME_SCRIM_META } from '@/lib/games';
import { useMe } from '@/lib/hooks/auth';
import { useEloRanking, useTierRanking } from '@/lib/hooks/rankings';
import { useSeasons } from '@/lib/hooks/ratings';
import { useGames } from '@/lib/hooks/scrims';
import { useNow } from '@/lib/hooks/use-now';
import {
  RANKING_DISABLED_NOTE,
  RANKING_DISABLED_TABS,
  RANKING_TABS,
  TIER_EMPTY_TEXT,
  TIER_RULE_TEXT,
  eloEmptyNote,
  eloEmptyState,
  eloRecordText,
  eloRuleText,
  meRowOutside,
  parseRankingsQuery,
  podiumOrder,
  rankChangeView,
  rankingGames,
  rankingStatusText,
  resolveRankingGame,
  seasonFallbackLabel,
  tierRowText,
  type RankingStatusTone,
  type RankingTab,
} from '@/lib/rankings';
import { routes } from '@/lib/routes';
import { TIER_META, tierMark } from '@/lib/tiers';

/** 1·2·3위 표시 토큰. 색 + 글자(1ST…)로 구분한다 */
const PLACE_META = {
  1: { label: '1ST', text: 'text-gold-text', fill: 'fill-gold-text', ring: 'shadow-[0_0_0_3px_var(--surface),0_0_0_5px_var(--gold-text)]' },
  2: { label: '2ND', text: 'text-silver-text', fill: 'fill-silver-text', ring: 'shadow-[0_0_0_3px_var(--surface),0_0_0_5px_var(--silver-text)]' },
  3: { label: '3RD', text: 'text-bronze-text', fill: 'fill-bronze-text', ring: 'shadow-[0_0_0_3px_var(--surface),0_0_0_5px_var(--bronze-text)]' },
} as const;

const rankColor = (rank: number) => (rank === 1 ? PLACE_META[1].text : rank === 2 ? PLACE_META[2].text : rank === 3 ? PLACE_META[3].text : 'text-faint');

/** 표·상위 3명이 쓰는 행 공통 모양 */
interface RankRow {
  id: string;
  rank: number;
  user: EloRankingEntry['user'];
  sub: string;
  extra: ReactNode;
  extraText: string;
  main: string;
  change: number | null;
}

const tierRow = (e: TierRankingEntry): RankRow => ({
  id: e.user.id,
  rank: e.rank,
  user: e.user,
  sub: e.account_name,
  extra: (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className={cn('font-display text-xs font-bold', TIER_META[e.tier].text)}>
        {tierMark(e)}
      </span>
      {tierRowText(e)}
    </span>
  ),
  extraText: tierRowText(e),
  main: String(e.score),
  change: e.rank_change,
});

const eloRow = (e: EloRankingEntry): RankRow => ({
  id: e.user.id,
  rank: e.rank,
  user: e.user,
  sub: `${e.games}경기`,
  extra: eloRecordText(e),
  extraText: eloRecordText(e),
  main: String(e.elo),
  change: e.rank_change,
});

/**
 * /rankings(목업 Rankings, 계약 10절). 탭·게임·시즌은 URL 쿼리(tab, game, season)와 동기화된다.
 * 활동·플레이타임 탭은 S5까지 비활성이다(가짜 숫자를 그리지 않는다).
 */
export function RankingsView() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const q = parseRankingsQuery(sp);
  const go = (next: { tab: RankingTab; game?: GameCode | null; season?: string | null }) => {
    if (pathname !== '/rankings') return;
    router.replace(
      routes.rankings({
        tab: next.tab,
        game: next.game ?? undefined,
        season: next.tab === 'elo' ? (next.season ?? undefined) : undefined,
      }),
      { scroll: false },
    );
  };

  const me = useMe();
  const games = useGames();
  const seasons = useSeasons();
  const options = rankingGames(q.tab, games.data?.items ?? []);
  const game = resolveRankingGame(q.game, options);
  const tier = useTierRanking(q.tab === 'tier' ? (game as TierRankingGame | null) : null);
  const elo = useEloRanking(q.tab === 'elo' ? game : null, q.season);

  const status = q.tab === 'tier' ? (tier.data ? rankingStatusText(tier.data) : null) : elo.data ? rankingStatusText(elo.data) : null;
  const syncedAt = q.tab === 'tier' ? tier.data?.synced_at : elo.data?.synced_at;
  const tabMeta = RANKING_TABS.find((t) => t.value === q.tab)!;
  const seasonValue = q.season ?? elo.data?.season?.id ?? '';
  const currentSeasonId = seasons.data?.items.find((s) => s.is_current)?.id;
  const seasonFallback = seasonFallbackLabel(seasons.data?.items ?? [], seasonValue, elo.data?.season);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Eyebrow className="text-xs">LEADERBOARD</Eyebrow>
          <h1 className="m-0 text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">랭킹</h1>
          <div className="text-sm text-muted">
            {tabMeta.description}
            {q.tab === 'elo' && <EloInfo />}
          </div>
        </div>
        {status && <StatusChip text={status.text} tone={status.tone} title={syncedAt ? formatFull(syncedAt) : undefined} />}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="랭킹 종류" className="flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-[5px]">
          {RANKING_TABS.map((t) => {
            const on = t.value === q.tab;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => go({ tab: t.value, game: q.game, season: q.season })}
                className={cn('h-[42px] rounded-xl px-[18px] text-sm font-bold', on ? 'bg-accent text-on-accent' : 'bg-transparent text-muted hover:text-text')}
              >
                {t.label}
              </button>
            );
          })}
          {RANKING_DISABLED_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={false}
              aria-disabled="true"
              tabIndex={-1}
              title={RANKING_DISABLED_NOTE}
              className="flex h-[42px] cursor-not-allowed flex-col items-center justify-center rounded-xl px-3.5 text-[13px] font-bold leading-tight text-faint"
            >
              {t.label}
              <span className="text-[10px] font-medium">{RANKING_DISABLED_NOTE}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterSelect label="게임" value={game ?? ''} disabled={!games.data} onChange={(v) => go({ tab: q.tab, game: v as GameCode, season: q.season })}>
            {!game && <option value="">게임</option>}
            {options.map((g) => (
              <option key={g.code} value={g.code}>
                {GAME_SCRIM_META[g.code]?.label ?? g.name}
              </option>
            ))}
          </FilterSelect>
          {q.tab === 'elo' && (
            <FilterSelect
              label="시즌"
              value={seasonValue}
              disabled={!seasons.data?.items.length && !elo.data?.season}
              onChange={(v) => go({ tab: 'elo', game: q.game, season: v === currentSeasonId ? null : v })}
            >
              {!seasons.data?.items.length && <option value={seasonValue}>{elo.data?.season?.name ?? (seasons.data ? '시즌 없음' : '시즌')}</option>}
              {/* 목록에 없는 값이 다른 시즌처럼 보이지 않게 옵션을 하나 더 둔다 */}
              {!!seasons.data?.items.length && seasonFallback !== null && <option value={seasonValue}>{seasonFallback}</option>}
              {seasons.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.is_current ? ' (진행 중)' : ''}
                </option>
              ))}
            </FilterSelect>
          )}
        </div>
      </div>

      <div role="tabpanel" aria-label={tabMeta.label} className="flex flex-col gap-[22px]">
        {!game && games.isError ? (
          <QueryError error={games.error} onRetry={() => void games.refetch()} />
        ) : !game ? (
          <BoardSkeleton />
        ) : q.tab === 'tier' ? (
          <TierPanel q={tier} meId={me.data?.id} />
        ) : (
          <EloPanel q={elo} meId={me.data?.id} onReset={() => go({ tab: 'elo', game: q.game })} />
        )}
      </div>
    </>
  );
}

function FilterSelect({ label, value, disabled, onChange, children }: { label: string; value: string; disabled?: boolean; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <label className="flex h-[42px] items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-[13px] text-faint">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[150px] bg-transparent text-[13px] font-semibold text-text outline-none"
      >
        {children}
      </select>
    </label>
  );
}

const STATUS_DOT: Record<RankingStatusTone, string> = { ok: 'bg-accent', warn: 'bg-orange', final: 'bg-gold' };

function StatusChip({ text, tone, title }: { text: string; tone: RankingStatusTone; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted">
      <span aria-hidden="true" className={cn('size-[7px] rounded-full', STATUS_DOT[tone])} />
      {text}
    </span>
  );
}

function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return <ErrorState message={isApiError(error) ? errorMessage(error.code) : errorMessage('NETWORK_ERROR')} onRetry={onRetry} />;
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" aria-label="랭킹 불러오는 중" className="flex flex-col gap-[22px]">
      <div className="grid grid-cols-3 items-end gap-2 md:gap-4">
        <Skeleton className="h-[190px] rounded-[22px]" />
        <Skeleton className="h-[230px] rounded-[22px]" />
        <Skeleton className="h-[190px] rounded-[22px]" />
      </div>
      <Skeleton className="h-[380px] rounded-[20px]" />
    </div>
  );
}

/** 재조회가 실패해도 이전 데이터를 유지한다(계약 10절). 알림만 한 줄 띄운다 */
function RefetchNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-orange/30 bg-orange/8 px-4 py-2 text-[13px] text-warn-text">
      <span className="min-w-0 flex-1">
        최신 순위를 받지 못해 마지막으로 받은 순위를 보여 드려요.
        <span className="sr-only">{isApiError(error) ? errorMessage(error.code) : errorMessage('NETWORK_ERROR')}</span>
      </span>
      <Button onClick={onRetry}>다시 시도</Button>
    </div>
  );
}

interface PanelQuery<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isPlaceholderData: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

function TierPanel({ q, meId }: { q: PanelQuery<GetTierRankingResponse>; meId: string | undefined }) {
  if (q.data) {
    const d = q.data;
    return (
      <Board
        rows={d.items.map(tierRow)}
        me={meRow(d.items, d.me, tierRow)}
        meId={meId}
        mainHead="SCORE"
        extraHead="TIER"
        rule={TIER_RULE_TEXT}
        empty={TIER_EMPTY_TEXT}
        emptyNote={
          <>
            <Link href={routes.settings()}>설정</Link>에서 라이엇 ID를 연동하면 순위에 올라요.
          </>
        }
        emptyMark="LP"
        q={q}
      />
    );
  }
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  return <BoardSkeleton />;
}

function EloPanel({ q, meId, onReset }: { q: PanelQuery<GetEloRankingResponse>; meId: string | undefined; onReset: () => void }) {
  const now = useNow(60_000);
  if (q.data) {
    const d = q.data;
    return (
      <Board
        rows={d.items.map(eloRow)}
        me={meRow(d.items, d.me, eloRow)}
        meId={meId}
        mainHead="RATING"
        extraHead="RECORD"
        rule={d.season ? eloRuleText(d) : null}
        empty={eloEmptyState(d)}
        emptyNote={eloEmptyNote(d, now)}
        emptyMark="ELO"
        q={q}
      />
    );
  }
  if (isApiError(q.error) && q.error.code === 'NOT_FOUND') {
    return (
      <EmptyState
        mark="?"
        title="시즌을 찾을 수 없어요"
        description="주소의 시즌이 없어졌거나 잘못됐어요."
        action={
          <Button onClick={onReset}>기본 시즌 보기</Button>
        }
      />
    );
  }
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  return <BoardSkeleton />;
}

function meRow<T extends { user: { id: string } }>(items: readonly T[], me: T | null, toRow: (e: T) => RankRow): RankRow | null {
  const outside = meRowOutside(items, me);
  return outside ? toRow(outside) : null;
}

function Board({
  rows,
  me,
  meId,
  mainHead,
  extraHead,
  rule,
  empty,
  emptyNote,
  emptyMark,
  q,
}: {
  rows: readonly RankRow[];
  /** items 밖 내 행 */
  me: RankRow | null;
  meId: string | undefined;
  mainHead: string;
  extraHead: string;
  rule: string | null;
  empty: string;
  emptyNote: ReactNode;
  emptyMark: string;
  q: PanelQuery<unknown>;
}) {
  const dim = q.isPlaceholderData && q.isFetching;
  return (
    <div className={cn('flex flex-col gap-[22px]', dim && 'opacity-70')}>
      {q.isError && <RefetchNotice error={q.error} onRetry={() => void q.refetch()} />}
      {rows.length === 0 && !me ? (
        <EmptyState mark={emptyMark} title={empty} description={emptyNote} />
      ) : (
        <>
          {rows.length > 0 && <Podium rows={rows} meId={meId} />}
          <RankTable rows={rows} me={me} meId={meId} mainHead={mainHead} extraHead={extraHead} />
        </>
      )}
      {rule && <span className="text-xs text-faint">{rule}</span>}
    </div>
  );
}

function Podium({ rows, meId }: { rows: readonly RankRow[]; meId: string | undefined }) {
  const placed = podiumOrder(rows);
  if (placed.length === 0) return null;
  return (
    <section aria-label="상위 3명" className="flex items-end justify-center gap-2 md:gap-4">
      {placed.map(({ entry: r, place }) => {
        const meta = PLACE_META[place];
        const first = place === 1;
        return (
          <div
            key={r.id}
            className={cn(
              'relative flex min-w-0 max-w-[calc(100%/3)] flex-1 flex-col items-center gap-2 overflow-hidden rounded-[22px] border bg-surface px-2 text-center md:gap-2.5 md:px-5',
              first ? 'border-gold/35 pb-6 pt-6 md:pb-7 md:pt-[30px]' : 'border-line py-[18px] md:py-[22px]',
            )}
          >
            <svg aria-hidden="true" viewBox="0 0 300 80" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-20 w-full">
              <polygon points="0,0 300,0 300,40 0,80" fillOpacity="0.12" className={meta.fill} />
            </svg>
            <span className={cn('relative font-display text-[13px] font-bold tracking-[0.16em]', meta.text)}>{meta.label}</span>
            <Avatar src={r.user.avatar_url} name={r.user.nickname} size={first ? 84 : 68} className={cn('relative hidden md:flex', meta.ring)} />
            <Avatar src={r.user.avatar_url} name={r.user.nickname} size={first ? 56 : 46} className={cn('relative md:hidden', meta.ring)} />
            <Link href={routes.member(r.user.id)} className="relative mt-1 max-w-full truncate text-[15px] font-bold text-text no-underline hover:text-text hover:underline md:text-[17px]">
              {r.user.nickname}
            </Link>
            <span className="relative max-w-full text-[11px] leading-snug text-muted md:text-xs">{r.extraText}</span>
            <span className={cn('relative font-display text-[22px] font-bold leading-none md:text-[28px]', meta.text)}>{r.main}</span>
            {r.id === meId && <YouTag />}
          </div>
        );
      })}
    </section>
  );
}

function YouTag() {
  return <span className="relative shrink-0 rounded-[5px] bg-accent px-1.5 py-0.5 font-display text-[10px] font-bold tracking-[0.1em] text-on-accent">YOU</span>;
}

const CHANGE_TONE = { up: 'bg-accent/10 text-accent-ink', down: 'bg-orange/12 text-orange-ink-2', none: 'text-faint' } as const;

function RankTable({ rows, me, meId, mainHead, extraHead }: { rows: readonly RankRow[]; me: RankRow | null; meId: string | undefined; mainHead: string; extraHead: string }) {
  return (
    <section aria-label="전체 순위" className="rounded-[20px] border border-line bg-surface p-2.5 shadow-[inset_0_1px_0_var(--hi)]">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left font-display text-[11px] tracking-[0.14em] text-faint">
              <th scope="col" className="w-11 px-2 py-2 font-semibold sm:w-14 sm:px-3.5">
                RANK
              </th>
              <th scope="col" className="px-2 py-2 font-semibold sm:px-3.5">
                PLAYER
              </th>
              <th scope="col" className="hidden px-3.5 py-2 font-semibold sm:table-cell">
                {extraHead}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-semibold sm:px-3.5">
                {mainHead}
              </th>
              <th scope="col" className="w-14 px-2 py-2 text-right font-semibold sm:w-[72px] sm:px-3.5">
                +/−
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.id} r={r} mine={r.id === meId} />
            ))}
            {me && <Row r={me} mine />}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ r, mine }: { r: RankRow; mine: boolean }) {
  const change = rankChangeView(r.change);
  const bg = mine ? 'bg-accent/8' : 'bg-surface-2';
  return (
    <tr aria-current={mine ? 'true' : undefined}>
      <td className={cn('rounded-l-xl px-2 py-3 font-display text-base font-bold sm:px-3.5', bg, rankColor(r.rank))}>{r.rank}</td>
      <td className={cn('max-w-0 px-2 py-3 sm:px-3.5', bg)}>
        <div className="flex min-w-0 items-center gap-3">
          {/* 좁은 폭에서는 아바타를 빼고 이름·전적에 자리를 준다 */}
          <span className="hidden shrink-0 sm:block">
            <Avatar src={r.user.avatar_url} name={r.user.nickname} size={34} />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <Link href={routes.member(r.user.id)} className="truncate font-semibold text-text no-underline hover:text-text hover:underline">
                {r.user.nickname}
              </Link>
              {mine && <YouTag />}
            </span>
            <span className="truncate text-xs text-faint">{r.sub}</span>
            <span className="truncate text-xs text-text-2 sm:hidden">{r.extraText}</span>
          </div>
        </div>
      </td>
      <td className={cn('hidden px-3.5 py-3 text-text-2 sm:table-cell', bg)}>{r.extra}</td>
      <td className={cn('px-2 py-3 text-right font-display text-base font-bold sm:px-3.5', bg)}>{r.main}</td>
      <td className={cn('rounded-r-xl px-2 py-3 text-right sm:px-3.5', bg)}>
        <span aria-label={change.label} className={cn('whitespace-nowrap rounded-full px-2 py-[3px] font-display text-xs font-bold', CHANGE_TONE[change.tone])}>
          {change.text}
        </span>
      </td>
    </tr>
  );
}
