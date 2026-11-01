'use client';

import type { CalendarEventItem, CalendarScrimItem, GameCode, GetCalendarResponse } from '@gcd/shared';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import { DeleteDialog, EventForm } from '@/components/admin/admin-news';
import type { ToastFn } from '@/components/admin/admin-view';
import { StatusPill } from '@/components/scrims/scrim-bits';
import { Badge, Button, Notice } from '@/components/ui/controls';
import { FilterChips, PanelHead } from '@/components/ui/form';
import { ChevronIcon, ExternalIcon } from '@/components/ui/icons';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import {
  calendarAddLabel,
  calendarCellLabel,
  calendarDay,
  calendarDayLabel,
  calendarMobileDayLabel,
  dayCellScrims,
  mobileCalendarDays,
  splitCalendarItems,
  type CalendarDay,
} from '@/lib/calendar';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { GAME_META, GAME_SCRIM_META } from '@/lib/games';
import { useDeleteEvent } from '@/lib/hooks/admin';
import { useMe } from '@/lib/hooks/auth';
import { useCalendar } from '@/lib/hooks/calendar';
import { useGames } from '@/lib/hooks/scrims';
import { useNow } from '@/lib/hooks/use-now';
import { WEEKDAY_LABELS, eventScheduleText, gameFilterOptions, kstToday, monthGrid, monthOf, monthTitle, shiftMonth, weekBars } from '@/lib/news';
import { routes } from '@/lib/routes';
import { kstClock, scrimCardBadge, type BadgeTone } from '@/lib/scrims';

/**
 * 커뮤니티 캘린더(계약 S6 23-6, 목업 없음 — /news 이벤트 캘린더의 격자·막대 모양과 토큰을 그대로 쓴다).
 * 한 달(KST, 월요일 시작) 격자에 운영진 일정(events)과 내전/모집(취소 제외)을 함께 보인다. 값은 GET /calendar 하나.
 *
 * - mode 'read'(홈): 운영진이어도 편집 UI 없음(D294). 운영진에게만 머리 「관리 →」.
 * - mode 'admin'(/admin 결과 탭): 날짜 칸 「+」·「+ 일정 추가」로 일정 추가, 일정 막대·행 「수정」으로 수정·삭제.
 *   쓰기는 기존 /admin/events…(EventForm·DeleteDialog 재사용, D284). 권한은 서버 RolesGuard가 기준이고 화면 모드는 보조다.
 * - 내전은 어느 모드든 읽기 전용(상세 링크).
 * - 일정 시각(23-8-5, D298): 막대 첫 조각에 시작 시각 접두사, 상세·모바일 행은 eventScheduleText.
 * - 달·게임 선택은 컴포넌트 상태(D297). 로딩·오류는 이 카드 안에서만(홈·관리자 다른 블록에 영향 없음).
 */
export function CommunityCalendar({ mode, onToast, id }: { mode: 'read' | 'admin'; onToast?: ToastFn; id?: string }) {
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const canEdit = mode === 'admin' && isAdmin && onToast !== undefined;
  const games = useGames();
  const now = useNow(60_000);
  const today = now === null ? null : kstToday(now);
  const [month, setMonth] = useState<string | null>(null);
  const [game, setGame] = useState<GameCode | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const shown = month ?? (today ? monthOf(today) : null);
  const thisMonth = today ? monthOf(today) : null;
  const titleId = useId();

  const right =
    mode === 'read' ? (
      isAdmin ? (
        <Link href={routes.admin()} className="shrink-0 text-[13px] font-semibold no-underline">
          관리 →
        </Link>
      ) : undefined
    ) : canEdit && today ? (
      <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'create', date: today })}>
        + 일정 추가
      </Button>
    ) : undefined;

  return (
    <Card id={id} aria-labelledby={titleId} className={id ? 'scroll-mt-4' : undefined}>
      <PanelHead eyebrow="CALENDAR" title="일정" id={titleId} right={right} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" aria-label="이전 달" disabled={!shown} onClick={() => shown && setMonth(shiftMonth(shown, -1))} className="w-9 px-0">
            <ChevronIcon dir="left" size={16} />
          </Button>
          <span className="min-w-[110px] text-center font-display text-base font-bold" aria-live="polite">
            {shown ? monthTitle(shown) : ''}
          </span>
          <Button size="sm" aria-label="다음 달" disabled={!shown} onClick={() => shown && setMonth(shiftMonth(shown, 1))} className="w-9 px-0">
            <ChevronIcon dir="right" size={16} />
          </Button>
          <Button size="sm" onClick={() => setMonth(null)} disabled={!shown || shown === thisMonth}>
            오늘
          </Button>
        </div>
        <FilterChips<GameCode | null>
          label="캘린더 게임"
          options={gameFilterOptions(games.data?.items ?? [])}
          value={game}
          onChange={setGame}
          render={(g) => (g === null ? '전체' : (GAME_META[g]?.short ?? g))}
        />
      </div>
      <Legend />
      {shown && today ? (
        <CalendarBody
          month={shown}
          game={game}
          today={today}
          canEdit={canEdit}
          onAdd={(date) => setDialog({ kind: 'create', date })}
          onEdit={(e) => setDialog({ kind: 'edit', event: e })}
        />
      ) : (
        <Skeleton className="h-[420px] rounded-2xl" />
      )}
      {canEdit && dialog && onToast && <EventDialog state={dialog} onClose={() => setDialog(null)} onToast={onToast} />}
    </Card>
  );
}

type DialogState = { kind: 'create'; date: string } | { kind: 'edit'; event: CalendarEventItem };

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));

/** 상태 점 색(scrimCardBadge tone, StatusPill과 같은 토큰) */
const DOT: Record<BadgeTone, string> = {
  accent: 'bg-accent',
  orange: 'bg-orange',
  cyan: 'bg-cyan',
  violet: 'bg-violet',
  neutral: 'bg-faint',
};

const gameShort = (g: { code: GameCode; name: string }) => GAME_META[g.code]?.short ?? g.name;
const eventTile = (e: CalendarEventItem) => (e.game ? (GAME_SCRIM_META[e.game.code]?.tile ?? 'bg-chip text-text-2') : 'bg-chip text-text-2');

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted" aria-label="범례">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-chip ring-1 ring-line-3" />
        일정
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full bg-accent" />
        내전/모집
      </span>
    </div>
  );
}

function CalendarBody({
  month,
  game,
  today,
  canEdit,
  onAdd,
  onEdit,
}: {
  month: string;
  game: GameCode | null;
  today: string;
  canEdit: boolean;
  onAdd: (date: string) => void;
  onEdit: (e: CalendarEventItem) => void;
}) {
  const q = useCalendar({ month, game });
  // 선택한 날짜는 그 달에만 유효하다(달을 옮기면 선택 해제)
  const [pick, setPick] = useState<{ month: string; date: string } | null>(null);
  if (q.isPending) return <Skeleton className="h-[420px] rounded-2xl" />;
  if (q.isError) return <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />;
  const data: GetCalendarResponse = q.data;
  const { events, scrims } = splitCalendarItems(data.items);
  const truncated = data.truncated.scrims || data.truncated.events;
  const picked = pick?.month === data.month ? pick.date : null;
  const onPick = (date: string) => setPick(picked === date ? null : { month: data.month, date });
  return (
    <div className={cn('flex flex-col gap-3', q.isPlaceholderData && 'opacity-60')} aria-busy={q.isFetching}>
      {truncated && (
        <Notice tone="info" title="일정이 많아 일부만 보여요">
          <Link href={routes.scrims()} className="font-semibold no-underline">
            내전 목록에서 전체 보기 →
          </Link>
        </Notice>
      )}
      <MonthGrid
        month={data.month}
        today={today}
        events={events}
        scrims={scrims}
        picked={picked}
        onPick={onPick}
        canEdit={canEdit}
        onAdd={onAdd}
        onEdit={onEdit}
      />
      <div className="hidden md:block">
        {picked ? (
          <DayDetail day={calendarDay(picked, events, scrims)} today={today} canEdit={canEdit} onAdd={onAdd} onEdit={onEdit} />
        ) : (
          <p className="m-0 text-[13px] text-faint">날짜를 누르면 그 날의 일정과 내전을 볼 수 있어요</p>
        )}
      </div>
      <MobileList key={data.month} month={data.month} today={today} data={data} canEdit={canEdit} onEdit={onEdit} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// 데스크톱(md+) 월 격자 — /news Calendar와 같은 구조(배경 칸 + 날짜 + 일정 막대) + 칸 아래 내전 줄
// -----------------------------------------------------------------------------

function MonthGrid({
  month,
  today,
  events,
  scrims,
  picked,
  onPick,
  canEdit,
  onAdd,
  onEdit,
}: {
  month: string;
  today: string;
  events: CalendarEventItem[];
  scrims: CalendarScrimItem[];
  picked: string | null;
  onPick: (date: string) => void;
  canEdit: boolean;
  onAdd: (date: string) => void;
  onEdit: (e: CalendarEventItem) => void;
}) {
  const grid = monthGrid(month);
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-line md:block" role="table" aria-label={`${monthTitle(month)} 일정`}>
      <div role="row" className="grid grid-cols-7 border-b border-line bg-surface-2">
        {WEEKDAY_LABELS.map((d, i) => (
          <span key={d} role="columnheader" className={cn('py-2 text-center text-xs font-semibold', i >= 5 ? 'text-orange-text' : 'text-faint')}>
            {d}
          </span>
        ))}
      </div>
      {grid.weeks.map((week) => {
        const bars = weekBars(week, events) as (ReturnType<typeof weekBars>[number] & { event: CalendarEventItem })[];
        const lanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
        return (
          <div
            key={week[0]}
            role="row"
            className="grid grid-cols-7 border-b border-line last:border-b-0"
            style={{ gridTemplateRows: `auto${lanes > 0 ? ` repeat(${lanes}, 26px)` : ''} minmax(52px, auto)` }}
          >
            {week.map((d, i) => {
              const day = calendarDay(d, events, scrims);
              const label = calendarCellLabel(d, day.events.length, day.scrims.length);
              return (
                <span key={d} role="cell" aria-label={label} className={cn('relative border-line', i > 0 && 'border-l')} style={{ gridColumn: i + 1, gridRow: `1 / span ${lanes + 2}` }}>
                  <Button
                    size="custom"
                    variant="plain"
                    aria-label={label}
                    aria-pressed={picked === d}
                    onClick={() => onPick(d)}
                    className={cn('absolute inset-0 size-full hover:bg-hover', picked === d && 'bg-accent/8 ring-2 ring-inset ring-accent/60')}
                  />
                </span>
              );
            })}
            {week.map((d, i) => (
              <span
                key={`n-${d}`}
                className={cn('pointer-events-none flex items-start justify-between px-2 pb-1 pt-1.5 text-xs', monthOf(d) !== month && 'text-faint opacity-60')}
                style={{ gridColumn: i + 1, gridRow: 1 }}
              >
                <span aria-hidden="true" className={cn('inline-flex size-6 items-center justify-center rounded-full font-display font-semibold', d === today && 'bg-accent text-on-accent')}>
                  {Number(d.slice(8, 10))}
                </span>
                {canEdit && (
                  <Button
                    size="custom"
                    variant="plain"
                    aria-label={calendarAddLabel(d)}
                    title={calendarAddLabel(d)}
                    onClick={() => onAdd(d)}
                    className="pointer-events-auto z-[1] inline-flex size-6 items-center justify-center rounded-md text-sm font-bold leading-none text-faint hover:bg-chip hover:text-text"
                  >
                    +
                  </Button>
                )}
              </span>
            ))}
            {bars.map((b) => {
              const segStart = week[b.col]!;
              const when = eventScheduleText(b.event);
              const clock = !b.fromPrev && b.event.start_time ? b.event.start_time : null;
              return (
                <Button
                  key={`${b.event.id}-${week[0]}`}
                  size="custom"
                  variant="plain"
                  onClick={() => (canEdit ? onEdit(b.event) : onPick(segStart))}
                  title={`${b.event.title} · ${when}${canEdit ? ' · 눌러서 수정' : ''}`}
                  aria-label={`일정 ${b.event.title} ${when}${canEdit ? ' 수정' : ''}`}
                  className={cn(
                    'z-[1] mx-1 my-0.5 flex min-w-0 items-center truncate px-2 text-left text-[11px] font-bold',
                    eventTile(b.event),
                    b.fromPrev ? 'rounded-l-none' : 'rounded-l-md',
                    b.toNext ? 'rounded-r-none' : 'rounded-r-md',
                  )}
                  style={{ gridColumn: `${b.col + 1} / span ${b.span}`, gridRow: b.lane + 2 }}
                >
                  <span className="truncate">
                    {clock && <span className="font-display tabular-nums">{clock} </span>}
                    {b.event.title}
                  </span>
                </Button>
              );
            })}
            {week.map((d, i) => {
              const { shown, more } = dayCellScrims(calendarDay(d, [], scrims).scrims);
              if (shown.length === 0) return null;
              return (
                <div
                  key={`s-${d}`}
                  className="pointer-events-none z-[1] flex min-w-0 flex-col gap-0.5 px-1 pb-1.5 pt-0.5"
                  style={{ gridColumn: i + 1, gridRow: lanes + 2 }}
                >
                  {shown.map((s) => (
                    <ScrimCellLine key={s.id} s={s} />
                  ))}
                  {more > 0 && (
                    <Button
                      size="custom"
                      variant="plain"
                      onClick={() => onPick(d)}
                      aria-label={`${calendarDayLabel(d)} 내전 ${more}개 더 보기`}
                      className="pointer-events-auto self-start rounded px-1 text-[11px] font-semibold text-muted hover:text-text"
                    >
                      +{more}개
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ScrimCellLine({ s }: { s: CalendarScrimItem }) {
  const badge = scrimCardBadge(s);
  const text = `${kstClock(s.scheduled_at)} ${gameShort(s.game)} ${s.title}`;
  return (
    <Link
      href={routes.scrim(s.id)}
      title={`${text} · ${badge.label}`}
      className={cn(
        'pointer-events-auto flex min-w-0 items-center gap-1 rounded px-1 py-px text-[11px] text-text-2 no-underline hover:bg-chip hover:text-text',
        s.my_status && 'font-bold text-text',
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[badge.tone])} />
      <span className="truncate">
        <span className="font-display tabular-nums">{kstClock(s.scheduled_at)}</span> {gameShort(s.game)} {s.title}
      </span>
      <span className="sr-only">
        {' '}
        · {badge.label}
      </span>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// 선택한 날짜 상세(데스크톱)
// -----------------------------------------------------------------------------

function DayDetail({
  day,
  today,
  canEdit,
  onAdd,
  onEdit,
}: {
  day: CalendarDay;
  today: string;
  canEdit: boolean;
  onAdd: (date: string) => void;
  onEdit: (e: CalendarEventItem) => void;
}) {
  const empty = day.events.length === 0 && day.scrims.length === 0;
  return (
    <section aria-label={`${calendarDayLabel(day.date)} 일정`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[15px] font-bold">{calendarDayLabel(day.date)}</h3>
        {canEdit && (
          <Button size="sm" onClick={() => onAdd(day.date)}>
            + 이 날 일정 추가
          </Button>
        )}
      </div>
      {empty ? (
        <p className="m-0 rounded-2xl border border-dashed border-line-3 bg-surface-2 px-4 py-5 text-center text-[13px] text-muted">이 날 등록된 일정이 없어요</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {day.events.map((e) => (
            <li key={e.id}>
              <EventRow e={e} today={today} onEdit={canEdit ? () => onEdit(e) : undefined} />
            </li>
          ))}
          {day.scrims.map((s) => (
            <li key={s.id}>
              <ScrimRow s={s} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 일정 행 = /news EventDetail과 같은 모양(+ admin 모드 「수정」) */
function EventRow({ e, today, onEdit }: { e: CalendarEventItem; today: string; onEdit?: () => void }) {
  const live = e.starts_on <= today && e.ends_on >= today;
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold', eventTile(e))}>{e.game ? gameShort(e.game) : '서버'}</span>
        <span className="font-display text-xs font-semibold text-muted">{eventScheduleText(e)}</span>
        {live && <Badge tone="accent">진행 중</Badge>}
        {onEdit && (
          <Button size="sm" className="ml-auto" onClick={onEdit} aria-label={`일정 ${e.title} 수정`}>
            수정
          </Button>
        )}
      </div>
      <h4 className="m-0 break-words text-[15px] font-bold">{e.title}</h4>
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

/** 내전 행 = 시각 · 게임 · 제목 · 상태 배지 · 인원 · 상세 링크(읽기 전용) */
function ScrimRow({ s }: { s: CalendarScrimItem }) {
  const badge = scrimCardBadge(s);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface-2 px-4 py-3">
      <span className="font-display text-sm font-bold tabular-nums">{kstClock(s.scheduled_at)}</span>
      <span className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold', GAME_SCRIM_META[s.game.code]?.tile ?? 'bg-chip text-text-2')}>{gameShort(s.game)}</span>
      <span className={cn('min-w-0 flex-[1_1_160px] break-words text-sm', s.my_status ? 'font-bold' : 'font-semibold')}>
        {s.title}
        {s.steam_app && <span className="font-normal text-muted"> · {s.steam_app.name}</span>}
      </span>
      <StatusPill label={badge.label} tone={badge.tone} />
      <span className="font-display text-xs text-muted tabular-nums" aria-label={`참가 ${s.joined_count}명, 정원 ${s.capacity}명`}>
        {s.joined_count}/{s.capacity}
      </span>
      <Link href={routes.scrim(s.id)} className="ml-auto shrink-0 text-[13px] font-semibold no-underline" aria-label={`${s.title} 상세 보기`}>
        상세 →
      </Link>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 모바일(md 미만) 목록형
// -----------------------------------------------------------------------------

function MobileList({
  month,
  today,
  data,
  canEdit,
  onEdit,
}: {
  month: string;
  today: string;
  data: GetCalendarResponse;
  canEdit: boolean;
  onEdit: (e: CalendarEventItem) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const { past, upcoming, pastCount } = mobileCalendarDays(data.items, month, today);
  if (past.length === 0 && upcoming.length === 0) {
    return (
      <div className="md:hidden">
        <EmptyState mark="C" title="이 달에 등록된 일정이 없어요" />
      </div>
    );
  }
  const days = showPast ? [...past, ...upcoming] : upcoming;
  return (
    <div className="flex flex-col gap-3 md:hidden">
      {pastCount > 0 && (
        <Button size="sm" variant="ghost" className="self-start" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
          {showPast ? '지난 일정 접기' : `지난 일정 ${pastCount}개 보기`}
        </Button>
      )}
      {days.length === 0 ? (
        <p className="m-0 text-center text-[13px] text-muted">앞으로 남은 일정이 없어요</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0" aria-label={`${monthTitle(month)} 일정`}>
          {days.map((d) => (
            <li key={d.date} className="flex flex-col gap-2">
              <h3 className="m-0 flex items-center gap-2 font-display text-sm font-bold">
                {calendarMobileDayLabel(d.date)}
                {d.date === today && <Badge tone="accent">오늘</Badge>}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {d.events.map((e) => (
                  <li key={e.id}>
                    <EventRow e={e} today={today} onEdit={canEdit ? () => onEdit(e) : undefined} />
                  </li>
                ))}
                {d.scrims.map((s) => (
                  <li key={s.id}>
                    <ScrimRow s={s} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// admin 모드 일정 대화상자(scrim-edit-dialog 패턴: 네이티브 <dialog> showModal)
// -----------------------------------------------------------------------------

function EventDialog({ state, onClose, onToast }: { state: DialogState; onClose: () => void; onToast: ToastFn }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headId = useId();
  const [deleting, setDeleting] = useState(false);
  const del = useDeleteEvent();
  const editing = state.kind === 'edit' ? state.event : null;
  const date = state.kind === 'create' ? state.date : state.event.starts_on;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // 안쪽 대화상자의 close가 React 트리를 타고 올라와도 이 대화상자를 닫지 않는다
  const onNativeClose = (e: SyntheticEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <>
      <dialog
        ref={ref}
        aria-labelledby={headId}
        onClose={onNativeClose}
        onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-[20px] border border-line-2 bg-surface-3 p-0 text-text shadow-[0_12px_30px_var(--shadow)] backdrop:bg-shadow"
      >
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 id={headId} className="m-0 text-lg font-bold">
                {editing ? '일정 수정' : '일정 추가'}
              </h2>
              <p className="m-0 text-xs text-faint">{editing ? eventScheduleText(editing) : calendarDayLabel(date)} · 시각을 비우면 종일 일정으로 저장돼요</p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => ref.current?.close()} aria-label="닫기">
              닫기
            </Button>
          </div>
          <EventForm
            key={editing?.id ?? `new-${date}`}
            editing={editing}
            today={date}
            onDone={() => ref.current?.close()}
            onToast={onToast}
            onSaved={(k) => onToast({ message: k === 'create' ? '일정을 추가했어요.' : '일정을 고쳤어요.', tone: 'success' })}
          />
          {editing && (
            <div className="flex justify-start border-t border-line pt-4">
              <Button size="sm" variant="danger" onClick={() => setDeleting(true)} disabled={del.isPending}>
                삭제
              </Button>
            </div>
          )}
        </div>
      </dialog>
      {editing && (
        <DeleteDialog
          what="일정"
          title={editing.title}
          open={deleting}
          pending={del.isPending}
          onClose={() => setDeleting(false)}
          onConfirm={() =>
            del.mutate(editing.id, {
              onSuccess: () => {
                onToast({ message: '일정을 삭제했어요.', tone: 'success' });
                setDeleting(false);
                ref.current?.close();
              },
              onError: (e) => {
                onToast({ message: errText(e), tone: 'error' });
                setDeleting(false);
              },
            })
          }
        />
      )}
    </>
  );
}
