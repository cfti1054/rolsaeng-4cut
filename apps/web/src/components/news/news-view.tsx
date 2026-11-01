'use client';

import { PAGE_LIMIT_MAX, type EventView, type GameCode, type NoticeView, type PatchNoteView } from '@gcd/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Badge, Button } from '@/components/ui/controls';
import { FilterChips, PanelHead } from '@/components/ui/form';
import { ChevronIcon, ExternalIcon } from '@/components/ui/icons';
import { Avatar, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { GAME_META, GAME_SCRIM_META } from '@/lib/games';
import { useMe } from '@/lib/hooks/auth';
import { useEvents, useNotices, usePatchNotes } from '@/lib/hooks/news';
import { useGames } from '@/lib/hooks/scrims';
import { useNow } from '@/lib/hooks/use-now';
import {
  WEEKDAY_LABELS,
  eventScheduleText,
  eventsOn,
  gameFilterOptions,
  patchNoteGameOptions,
  isoDateDotted,
  kstToday,
  monthGrid,
  monthOf,
  monthTitle,
  parseMonth,
  shiftMonth,
  weekBars,
} from '@/lib/news';
import { NEWS_TABS, routes, type NewsPageQuery, type NewsTab } from '@/lib/routes';

/** 공지 첫 화면 개수(「더 보기」로 같은 수만큼 더) */
const NOTICE_PAGE = 3;
const PATCH_PAGE = 6;

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));

/**
 * /news(목업 없음, 문서 8장, 계약 S6 13절): 공지 · 패치노트 · 이벤트 캘린더. 스팀 할인 영역은 그리지 않는다(D274).
 * 쿼리: tab(보이는 섹션, 없으면 셋 다), game(패치노트·이벤트 공통), month(캘린더 YYYY-MM, KST).
 */
export function NewsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const me = useMe();
  const games = useGames();
  const isAdmin = me.data?.role === 'admin';

  const tabRaw = sp.get('tab');
  const tab = (NEWS_TABS as readonly string[]).includes(tabRaw ?? '') ? (tabRaw as NewsTab) : null;
  const gameRaw = sp.get('game');
  const gameCodes = (games.data?.items ?? []).map((g) => g.code);
  const game = gameCodes.includes(gameRaw as GameCode) ? (gameRaw as GameCode) : null;
  const month = parseMonth(sp.get('month'));

  const go = (next: NewsPageQuery) => {
    const q: NewsPageQuery = { tab: tab ?? undefined, game: game ?? undefined, month: month ?? undefined, ...next };
    router.replace(routes.news(q), { scroll: false });
  };

  const show = (t: NewsTab) => tab === null || tab === t;
  const manage = isAdmin ? (
    <Link href={routes.admin('news')} className="shrink-0 text-[13px] font-semibold no-underline">
      관리 →
    </Link>
  ) : undefined;

  return (
    <>
      <PageHeader eyebrow="NEWS" title="정보" />
      <FilterChips<NewsTab | null>
        label="보기"
        options={[null, ...NEWS_TABS]}
        value={tab}
        onChange={(t) => go({ tab: t ?? undefined })}
        render={(t) => (t === null ? '전체' : t === 'notices' ? '공지' : t === 'patch-notes' ? '패치노트' : '이벤트')}
      />
      {show('notices') && <NoticesSection manage={manage} />}
      {show('patch-notes') && (
        <PatchNotesSection
          manage={manage}
          game={game === 'steam' ? null : game}
          gameOptions={patchNoteGameOptions(games.data?.items ?? [])}
          onGame={(g) => go({ game: g ?? undefined })}
        />
      )}
      {show('events') && (
        <EventsSection
          manage={manage}
          game={game}
          gameOptions={gameFilterOptions(games.data?.items ?? [])}
          onGame={(g) => go({ game: g ?? undefined })}
          month={month}
          onMonth={(m) => go({ month: m ?? undefined })}
        />
      )}
    </>
  );
}

const gameLabel = (g: GameCode | null) => (g === null ? '전체' : (GAME_META[g]?.short ?? g));

function GameTagChip({ code, name }: { code: GameCode; name: string }) {
  return (
    <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold', GAME_SCRIM_META[code]?.tile ?? 'bg-chip text-text-2')}>
      {GAME_META[code]?.short ?? name}
    </span>
  );
}

function MoreButton({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown; isFetchNextPageError: boolean } }) {
  if (!q.hasNextPage) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
        {q.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
      </Button>
      {q.isFetchNextPageError && <span className="text-xs text-orange-text">더 불러오지 못했어요. 다시 눌러 주세요.</span>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 공지
// -----------------------------------------------------------------------------

function NoticesSection({ manage }: { manage: ReactNode }) {
  const q = useNotices(NOTICE_PAGE);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card aria-labelledby="news-notices">
      <PanelHead eyebrow="NOTICE" title="공지" id="news-notices" right={manage} />
      {q.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="공지 불러오는 중">
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState mark="N" title="등록된 공지가 없어요" />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((n, i) => (
              <NoticeRow key={n.id} n={n} defaultOpen={i === 0} />
            ))}
          </ul>
          <MoreButton q={q} />
        </>
      )}
    </Card>
  );
}

function NoticeRow({ n, defaultOpen }: { n: NoticeView; defaultOpen: boolean }) {
  return (
    <li>
      <details open={defaultOpen} className="group rounded-2xl border border-line bg-surface-2 px-4 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-3">
          <Avatar src={n.author.avatar_url} name={n.author.nickname} size={30} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-bold">{n.title}</span>
            <span className="text-xs text-faint">
              {n.author.nickname} · <time dateTime={n.created_at}>{formatFull(n.created_at)}</time>
            </span>
          </span>
          <ChevronIcon dir="down" className="shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <p className="m-0 mt-3 whitespace-pre-wrap break-words border-t border-line pt-3 text-sm leading-relaxed text-text-2">{n.body}</p>
      </details>
    </li>
  );
}

// -----------------------------------------------------------------------------
// 패치노트
// -----------------------------------------------------------------------------

function PatchNotesSection({
  manage,
  game,
  gameOptions,
  onGame,
}: {
  manage: ReactNode;
  game: GameCode | null;
  gameOptions: (GameCode | null)[];
  onGame: (g: GameCode | null) => void;
}) {
  const q = usePatchNotes(game, PATCH_PAGE);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card aria-labelledby="news-patches">
      <PanelHead eyebrow="PATCH NOTES" title="패치노트" id="news-patches" right={manage} />
      <FilterChips<GameCode | null> label="패치노트 게임" options={gameOptions} value={game} onChange={onGame} render={gameLabel} />
      {q.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy="true" aria-label="패치노트 불러오는 중">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState mark="P" title={game ? `${gameLabel(game)} 패치노트가 없어요` : '등록된 패치노트가 없어요'} />
      ) : (
        <>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
            {items.map((p) => (
              <PatchCard key={p.id} p={p} />
            ))}
          </ul>
          <MoreButton q={q} />
        </>
      )}
    </Card>
  );
}

function PatchCard({ p }: { p: PatchNoteView }) {
  return (
    <li className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <GameTagChip code={p.game.code} name={p.game.name} />
        {p.version && <span className="font-display text-sm font-bold text-accent-ink">{p.version}</span>}
        <time dateTime={p.published_on} className="ml-auto font-display text-xs text-faint">
          {isoDateDotted(p.published_on)}
        </time>
      </div>
      <h3 className="m-0 break-words text-base font-bold">{p.title}</h3>
      <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">{p.summary}</p>
      {p.url && (
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="mt-auto inline-flex items-center gap-1.5 self-start text-[13px] font-semibold no-underline">
          원문 보기 <ExternalIcon size={14} />
          <span className="sr-only">(새 창)</span>
        </a>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------------
// 이벤트 캘린더(KST 달 격자, 월요일 시작)
// -----------------------------------------------------------------------------

function EventsSection({
  manage,
  game,
  gameOptions,
  onGame,
  month,
  onMonth,
}: {
  manage: ReactNode;
  game: GameCode | null;
  gameOptions: (GameCode | null)[];
  onGame: (g: GameCode | null) => void;
  month: string | null;
  onMonth: (m: string | null) => void;
}) {
  const now = useNow(60_000);
  const today = now === null ? null : kstToday(now);
  const shown = month ?? (today ? monthOf(today) : null);
  return (
    <Card aria-labelledby="news-events">
      <PanelHead eyebrow="EVENTS" title="이벤트 캘린더" id="news-events" right={manage} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" aria-label="이전 달" disabled={!shown} onClick={() => shown && onMonth(shiftMonth(shown, -1))} className="w-9 px-0">
            <ChevronIcon dir="left" size={16} />
          </Button>
          <span className="min-w-[110px] text-center font-display text-base font-bold" aria-live="polite">
            {shown ? monthTitle(shown) : ''}
          </span>
          <Button size="sm" aria-label="다음 달" disabled={!shown} onClick={() => shown && onMonth(shiftMonth(shown, 1))} className="w-9 px-0">
            <ChevronIcon dir="right" size={16} />
          </Button>
          <Button size="sm" onClick={() => onMonth(null)} disabled={!month || (!!today && month === monthOf(today))}>
            오늘
          </Button>
        </div>
        <FilterChips<GameCode | null> label="이벤트 게임" options={gameOptions} value={game} onChange={onGame} render={gameLabel} />
      </div>
      {shown && today ? <Calendar month={shown} today={today} game={game} /> : <Skeleton className="h-[420px] rounded-2xl" />}
    </Card>
  );
}

function Calendar({ month, today, game }: { month: string; today: string; game: GameCode | null }) {
  // 격자 구간은 최대 6주(42일)라 GET /events 조회 상한(EVENTS_RANGE_MAX_DAYS) 안이다
  const grid = monthGrid(month);
  const q = useEvents({ from: grid.from, to: grid.to, game, limit: PAGE_LIMIT_MAX });
  const [picked, setPicked] = useState<string | null>(null);
  if (q.isPending) return <Skeleton className="h-[420px] rounded-2xl" />;
  if (q.isError) return <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />;
  const events = q.data.items;
  const inMonth = events.filter((e) => e.ends_on >= `${month}-01` && e.starts_on <= `${month}-31`);
  const selected = events.find((e) => e.id === picked) ?? null;
  return (
    <div className="flex flex-col gap-3">
      {/* 데스크톱: 월 격자 */}
      <div className="hidden overflow-hidden rounded-2xl border border-line md:block" role="table" aria-label={`${monthTitle(month)} 이벤트`}>
        <div role="row" className="grid grid-cols-7 border-b border-line bg-surface-2">
          {WEEKDAY_LABELS.map((d, i) => (
            <span key={d} role="columnheader" className={cn('py-2 text-center text-xs font-semibold', i >= 5 ? 'text-orange-text' : 'text-faint')}>
              {d}
            </span>
          ))}
        </div>
        {grid.weeks.map((week) => {
          const bars = weekBars(week, events);
          const lanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
          return (
            <div key={week[0]} role="row" className="grid grid-cols-7 border-b border-line last:border-b-0" style={{ gridTemplateRows: lanes > 0 ? `auto repeat(${lanes}, 26px) 10px` : 'auto 28px' }}>
              {week.map((d, i) => (
                <span
                  key={d}
                  role="cell"
                  aria-label={`${d} 이벤트 ${eventsOn(d, events).length}개`}
                  className={cn('border-line', i > 0 && 'border-l')}
                  style={{ gridColumn: i + 1, gridRow: `1 / span ${lanes + 2}` }}
                />
              ))}
              {week.map((d, i) => (
                <span
                  key={`n-${d}`}
                  aria-hidden="true"
                  className={cn('px-2 pb-1 pt-1.5 text-xs', monthOf(d) !== month && 'text-faint opacity-60')}
                  style={{ gridColumn: i + 1, gridRow: 1 }}
                >
                  <span className={cn('inline-flex size-6 items-center justify-center rounded-full font-display font-semibold', d === today && 'bg-accent text-on-accent')}>
                    {Number(d.slice(8, 10))}
                  </span>
                </span>
              ))}
              {bars.map((b) => (
                <Button
                  key={`${b.event.id}-${week[0]}`}
                  size="custom"
                  variant="plain"
                  onClick={() => setPicked(b.event.id === picked ? null : b.event.id)}
                  aria-pressed={b.event.id === picked}
                  title={`${b.event.title} · ${eventScheduleText(b.event)}`}
                  aria-label={`일정 ${b.event.title} ${eventScheduleText(b.event)}`}
                  className={cn(
                    'z-[1] mx-1 my-0.5 flex min-w-0 items-center truncate px-2 text-left text-[11px] font-bold',
                    b.event.game ? GAME_SCRIM_META[b.event.game.code]?.tile : 'bg-chip text-text-2',
                    b.fromPrev ? 'rounded-l-none' : 'rounded-l-md',
                    b.toNext ? 'rounded-r-none' : 'rounded-r-md',
                    b.event.id === picked && 'ring-2 ring-accent',
                  )}
                  style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.lane + 2 }}
                >
                  <span className="truncate">
                    {!b.fromPrev && b.event.start_time && <span className="font-display tabular-nums">{b.event.start_time} </span>}
                    {b.event.title}
                  </span>
                </Button>
              ))}
            </div>
          );
        })}
      </div>

      {/* 모바일: 목록형 */}
      <div className="md:hidden">
        {inMonth.length === 0 ? (
          <EmptyState mark="E" title="이 달에 등록된 이벤트가 없어요" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={`${monthTitle(month)} 이벤트`}>
            {inMonth.map((e) => (
              <li key={e.id}>
                <EventDetail e={e} today={today} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="hidden md:block">
        {selected ? (
          <EventDetail e={selected} today={today} />
        ) : inMonth.length === 0 ? (
          <p className="m-0 text-center text-[13px] text-muted">이 달에 등록된 이벤트가 없어요</p>
        ) : (
          <p className="m-0 text-[13px] text-faint">막대를 누르면 이벤트 내용을 볼 수 있어요</p>
        )}
      </div>
    </div>
  );
}

function EventDetail({ e, today }: { e: EventView; today: string }) {
  const live = e.starts_on <= today && e.ends_on >= today;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        {e.game ? <GameTagChip code={e.game.code} name={e.game.name} /> : <span className="rounded-md bg-chip px-2 py-0.5 text-[11px] font-bold text-text-2">서버</span>}
        <span className="font-display text-xs font-semibold text-muted">{eventScheduleText(e)}</span>
        {live && <Badge tone="accent">진행 중</Badge>}
      </div>
      <h3 className="m-0 break-words text-[15px] font-bold">{e.title}</h3>
      {e.description && <p className="m-0 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">{e.description}</p>}
      {e.url && (
        <a href={e.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold no-underline">
          안내 보기 <ExternalIcon size={14} />
          <span className="sr-only">(새 창)</span>
        </a>
      )}
    </div>
  );
}
