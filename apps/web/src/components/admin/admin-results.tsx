'use client';

import {
  ADMIN_UPCOMING_DAYS,
  RejectReason,
  RevertReason,
  SCRIM_REJECT_REASON_MAX_LENGTH,
  SCRIM_REJECT_REASON_MIN_LENGTH,
  SCRIM_REVERT_REASON_MAX_LENGTH,
  SCRIM_REVERT_REASON_MIN_LENGTH,
  type AdminNoShowScrim,
  type AdminOverview,
  type AdminResultItem,
  type AdminResultView,
  type AdminUpcoming,
  type NoShowPolicyView,
} from '@gcd/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, InlineError } from '@/components/ui/controls';
import { FilterChips, PanelHead, ReasonDialog, SelectInput, apiErrorText } from '@/components/ui/form';
import { AlertIcon } from '@/components/ui/icons';
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import {
  REVERT_BLOCK_TEXT,
  REVERT_CONFIRM_TEXT,
  RESULT_VIEW_LABEL,
  noShowChanges,
  noShowPolicyText,
  noShowTag,
  overviewCards,
  resultOutcomeText,
  revertErrorText,
  upcomingRows,
  UPCOMING_EMPTY_TEXT,
  type StatDot,
  type UpcomingRow,
} from '@/lib/admin';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatAgo, formatClock, formatFull, formatMonthDay } from '@/lib/format';
import { GAME_SCRIM_META } from '@/lib/games';
import { useAdminNoShowScrims, useAdminResultAction, useAdminResults, useSaveNoShows, type ResultAction } from '@/lib/hooks/admin';
import { useNow } from '@/lib/hooks/use-now';
import { routes } from '@/lib/routes';
import { CommunityCalendar } from '@/components/calendar/community-calendar';
import { TEAM_TONE } from '@/components/scrims/scrim-teams';
import type { ToastFn } from './admin-view';

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));

/** 결과·노쇼 탭(목업 Admin 첫 화면): 통계 4칸(3 + 「다가오는 일정」, D306) + 캘린더 + APPROVAL QUEUE + NO-SHOW(D291·D292·D309) */
export function AdminResultsTab({ overview, onToast }: { overview: UseQueryResult<AdminOverview, unknown>; onToast: ToastFn }) {
  return (
    <>
      <StatsGrid q={overview} />
      <CommunityCalendar mode="admin" onToast={onToast} id={ADMIN_CALENDAR_ID} />
      <ApprovalQueue onToast={onToast} />
      <NoShowPanel onToast={onToast} />
    </>
  );
}

// -----------------------------------------------------------------------------
// 통계 4칸 = 통계 3칸(D291: 「참가 제한 중」 칸은 화면에서 뺐다) + 「다가오는 일정」(D306)
// 모바일 2열(노쇼·다가오는 일정 각 전체 폭) / md 3열 + 다가오는 일정 다음 줄 전체 폭 / xl 4열
// -----------------------------------------------------------------------------

/** 「캘린더에서 더 보기 ↓」가 스크롤해 가는 캘린더 카드 id(23-8-5) */
const ADMIN_CALENDAR_ID = 'admin-calendar';

const DOT: Record<StatDot, string> = { accent: 'bg-accent', orange: 'bg-orange', violet: 'bg-violet', cyan: 'bg-cyan' };

const STAT_GRID = 'grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-4 xl:grid-cols-4';
const STAT_CARD = 'flex min-w-0 flex-col gap-2.5 rounded-[20px] border border-line bg-surface px-4 py-4 shadow-[inset_0_1px_0_var(--hi)] md:px-5 md:py-[18px]';
const UPCOMING_SPAN = 'col-span-2 md:col-span-3 xl:col-span-1';

function StatsGrid({ q }: { q: UseQueryResult<AdminOverview, unknown> }) {
  const now = useNow(60_000);
  if (q.isPending || now === null) {
    return (
      <div className={STAT_GRID} aria-busy="true" aria-label="운영 요약 불러오는 중">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className={cn('rounded-[20px]', i === 3 ? cn('h-[236px]', UPCOMING_SPAN) : 'h-[118px] xl:h-[236px]', i === 2 && 'col-span-2 md:col-span-1')}
          />
        ))}
      </div>
    );
  }
  if (q.isError) return <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <section aria-label="운영 요약" className={STAT_GRID}>
      {overviewCards(q.data, now).map((c, i) => (
        <div key={c.key} className={cn(i === 2 && 'col-span-2 md:col-span-1', STAT_CARD)}>
          <span className="flex items-center gap-2 text-xs text-muted md:text-[13px]">
            <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[c.dot])} />
            <span className="truncate">{c.label}</span>
          </span>
          <span className="flex items-baseline gap-1">
            <span className="font-display text-[28px] font-bold leading-none md:text-[34px]">{c.value}</span>
            <span className="text-sm text-muted">{c.unit}</span>
          </span>
          <span className="truncate text-xs text-faint" title={c.sub}>
            {c.sub}
          </span>
        </div>
      ))}
      <UpcomingCard upcoming={q.data.upcoming} />
    </section>
  );
}

/** 「다가오는 일정」 카드(23-8-5). 행 = 응답 순서 그대로, 내전 행만 상세 링크(일정 편집은 아래 캘린더) */
function UpcomingCard({ upcoming }: { upcoming: AdminUpcoming }) {
  const rows = upcomingRows(upcoming);
  return (
    <div className={cn(UPCOMING_SPAN, STAT_CARD, 'gap-2')}>
      <span className="flex items-center gap-2 text-xs text-muted md:text-[13px]">
        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT.cyan)} />
        <span className="truncate">다가오는 일정</span>
        <span className="ml-auto shrink-0 text-[11px] text-faint">오늘부터 {ADMIN_UPCOMING_DAYS}일</span>
      </span>
      {rows.length === 0 ? (
        <p className="m-0 flex flex-1 items-center justify-center py-3 text-center text-[13px] text-muted">{UPCOMING_EMPTY_TEXT}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0" aria-label={`다가오는 일정 ${rows.length}개`}>
          {rows.map((r) => (
            <li key={r.key} className="border-t border-line first:border-t-0">
              {r.href ? (
                <Link href={r.href} aria-label={r.linkLabel ?? undefined} className="-mx-2 block rounded-lg px-2 text-text no-underline hover:bg-hover">
                  <UpcomingRowBody r={r} />
                </Link>
              ) : (
                <UpcomingRowBody r={r} />
              )}
            </li>
          ))}
        </ul>
      )}
      {upcoming.has_more && (
        <a href={`#${ADMIN_CALENDAR_ID}`} className="mt-auto self-start text-xs font-semibold no-underline">
          캘린더에서 더 보기 ↓
        </a>
      )}
    </div>
  );
}

const UPCOMING_CHIP: Record<UpcomingRow['chip'], string> = {
  일정: 'bg-chip text-text-2',
  내전: 'bg-accent/15 text-accent-ink',
  모집: 'bg-cyan/14 text-cyan-ink',
};

/** 좁은 칸(모바일·xl 1칸)은 두 줄(날짜·시각·칩 / 게임·제목), md 전체 폭은 한 줄 */
function UpcomingRowBody({ r }: { r: UpcomingRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-2 md:flex-row md:items-center md:gap-3 xl:flex-col xl:items-stretch xl:gap-0.5">
      <span className="flex min-w-0 items-center gap-2 font-display text-xs text-muted tabular-nums md:w-[200px] md:shrink-0 xl:w-auto">
        <span className="shrink-0 font-semibold text-text-2">{r.date}</span>
        <span className="shrink-0">{r.time}</span>
        <span className={cn('ml-auto shrink-0 rounded-md px-1.5 py-px font-sans text-[11px] font-bold md:hidden xl:inline', UPCOMING_CHIP[r.chip])}>{r.chip}</span>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
        <span className="shrink-0 text-xs text-faint">{r.game}</span>
        <span className={cn('min-w-0 truncate', r.bold ? 'font-bold text-text' : 'font-medium text-text-2')} title={r.title}>
          {r.title}
        </span>
        <span className={cn('ml-auto hidden shrink-0 rounded-md px-1.5 py-px text-[11px] font-bold md:inline xl:hidden', UPCOMING_CHIP[r.chip])}>{r.chip}</span>
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 결과 승인 큐
// -----------------------------------------------------------------------------

const VIEWS: readonly AdminResultView[] = ['pending', 'approved'];

function ApprovalQueue({ onToast }: { onToast: ToastFn }) {
  const [view, setView] = useState<AdminResultView>('pending');
  const q = useAdminResults(view);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card aria-labelledby="queue-title">
      <PanelHead
        eyebrow="APPROVAL QUEUE"
        title="결과 승인 대기"
        id="queue-title"
        right={<span className="text-xs text-faint">승인하면 참가자 레이팅이 갱신되고 기록에 남아요</span>}
      />
      <FilterChips<AdminResultView> label="큐 보기" options={VIEWS} value={view} onChange={setView} render={(v) => RESULT_VIEW_LABEL[v]} />
      {q.isPending ? (
        <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="결과 큐 불러오는 중">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          mark="OK"
          title={view === 'pending' ? '승인할 결과가 없어요' : '되돌릴 수 있는 최근 승인이 없어요'}
        />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {items.map((r) => (
              <QueueRow key={r.result_id} r={r} onToast={onToast} />
            ))}
          </ul>
          {q.hasNextPage && (
            <Button className="self-center" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              {q.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

const RATING_TEXT: Record<AdminResultItem['rating_status'], string> = {
  waiting: '승인하면 레이팅 반영',
  applied: '레이팅 반영됨',
  skipped: '반영 대상 부족 · 레이팅 변동 없음',
  not_rated: 'ELO 미반영 내전',
};

function QueueRow({ r, onToast }: { r: AdminResultItem; onToast: ToastFn }) {
  const action = useAdminResultAction();
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'revert' | null>(null);
  const meta = GAME_SCRIM_META[r.scrim.game.code];
  const team = r.outcome.winner_team;
  const close = () => {
    setDialog(null);
    action.reset();
  };
  const run = (a: ResultAction, ok: string) =>
    action.mutate(a, {
      onSuccess: () => {
        setDialog(null);
        onToast({ message: ok, tone: 'success' });
      },
      onError: (e) => {
        // 이미 처리된 결과(409)는 큐가 다시 조회된다 → 대화상자를 닫고 알린다
        if (isApiError(e) && (e.code === 'SCRIM_RESULT_NOT_PENDING' || e.code === 'SCRIM_RESULT_NOT_APPROVED')) {
          setDialog(null);
          onToast({ message: errorMessage(e.code), tone: 'error' });
        } else if (dialog === 'approve') {
          setDialog(null);
          onToast({ message: apiErrorText(e), tone: 'error' });
        }
      },
    });
  const err = action.isError && isApiError(action.error) ? (revertErrorText(action.error.code, r.revert_blocked_reason) ?? apiErrorText(action.error)) : action.isError ? apiErrorText(action.error) : null;
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border bg-surface-2 p-4',
        r.status === 'approved' ? 'border-accent/30' : 'border-line-2',
      )}
    >
      <span aria-hidden="true" className={cn('flex size-12 shrink-0 items-center justify-center rounded-[14px] font-display text-[13px] font-bold', meta?.tile)}>
        {meta?.abbr}
      </span>
      <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <Link href={routes.scrim(r.scrim.id)} className="min-w-0 break-words text-[15px] font-bold text-text no-underline hover:text-text hover:underline">
            {r.scrim.title}
          </Link>
        </span>
        <span className="text-[13px] text-muted">
          <time dateTime={r.submitted_at} title={formatFull(r.submitted_at)}>
            {formatMonthDay(r.submitted_at)} {formatClock(r.submitted_at)}
          </time>{' '}
          · 제출 {r.submitted_by.nickname}
          {r.submitted_by.id === r.scrim.host.id && '(방장)'}
        </span>
      </div>
      <div className="flex min-w-0 flex-[0_1_240px] flex-col gap-1">
        <span className={cn('text-[13px] font-bold', team ? TEAM_TONE[team].ink : 'text-violet-ink')}>{resultOutcomeText(r.outcome)}</span>
        <span className="text-xs text-muted">
          {r.status === 'approved' && r.approved_by && r.approved_at
            ? `${r.approved_by.nickname} 승인 · ${formatMonthDay(r.approved_at)} ${formatClock(r.approved_at)}`
            : RATING_TEXT[r.rating_status]}
        </span>
      </div>
      {r.status === 'pending' && (
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Button variant="ghost" className="border-line-3 text-text" onClick={() => setDialog('reject')} disabled={!r.can_review || action.isPending}>
              반려
            </Button>
            <Button variant="primary" onClick={() => setDialog('approve')} disabled={!r.can_review || action.isPending}>
              승인 · 레이팅 반영
            </Button>
          </div>
          {!r.can_review && <span className="text-xs text-faint">내가 제출한 결과</span>}
        </div>
      )}
      {r.status === 'approved' && (
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => setDialog('revert')} disabled={!r.can_revert || action.isPending}>
            되돌리기
          </Button>
          {r.revert_blocked_reason && <span className="max-w-[260px] text-right text-xs text-faint">{REVERT_BLOCK_TEXT[r.revert_blocked_reason]}</span>}
        </div>
      )}
      {r.status !== 'pending' && r.status !== 'approved' && <Badge>{r.status === 'rejected' ? '반려됨' : '되돌림'}</Badge>}

      <ConfirmDialog
        open={dialog === 'approve'}
        title="결과를 승인할까요?"
        description={r.scrim.rated ? '승인하면 참가자 레이팅이 바로 반영돼요.' : '승인하면 결과가 확정돼요.'}
        confirmLabel="승인"
        confirmVariant="primary"
        pending={action.isPending}
        onClose={close}
        onConfirm={() => run({ kind: 'approve', scrimId: r.scrim.id, resultId: r.result_id }, '결과를 승인했어요.')}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        title="결과를 반려할까요?"
        label="반려 사유를 적어 주세요. 방장에게 그대로 보여요."
        placeholder="예: 승리 팀이 반대로 입력됐어요"
        min={SCRIM_REJECT_REASON_MIN_LENGTH}
        max={SCRIM_REJECT_REASON_MAX_LENGTH}
        schema={RejectReason}
        confirmLabel="반려"
        pending={action.isPending}
        error={dialog === 'reject' ? err : null}
        onClose={close}
        onConfirm={(reason) => run({ kind: 'reject', scrimId: r.scrim.id, resultId: r.result_id, reason }, '결과를 반려했어요. 방장이 다시 입력할 수 있어요.')}
      />
      <ReasonDialog
        open={dialog === 'revert'}
        title="승인을 되돌릴까요?"
        description={REVERT_CONFIRM_TEXT}
        label="되돌리는 이유(감사 기록에 남아요)"
        placeholder="예: 승리 팀이 반대로 입력됐어요"
        min={SCRIM_REVERT_REASON_MIN_LENGTH}
        max={SCRIM_REVERT_REASON_MAX_LENGTH}
        schema={RevertReason}
        confirmLabel="되돌리기"
        pending={action.isPending}
        error={dialog === 'revert' ? err : null}
        onClose={close}
        onConfirm={(reason) => run({ kind: 'revert', scrimId: r.scrim.id, resultId: r.result_id, reason }, '승인을 되돌렸어요. 방장이 결과를 다시 입력해야 해요.')}
      />
    </li>
  );
}

// -----------------------------------------------------------------------------
// 노쇼 표시
// -----------------------------------------------------------------------------

function NoShowPanel({ onToast }: { onToast: ToastFn }) {
  const q = useAdminNoShowScrims();
  const scrims = q.data?.pages.flatMap((p) => p.items) ?? [];
  const policy = q.data?.pages[0]?.policy ?? null;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = scrims.find((s) => s.id === pickedId) ?? scrims[0] ?? null;
  // 저장 상태는 패널에 둔다: 저장 뒤 다시 받은 값으로 명단이 새로 그려져도 실패 문구가 남는다
  const save = useSaveNoShows();
  return (
    <Card aria-labelledby="noshow-title">
      <PanelHead
        eyebrow="NO-SHOW"
        title={picked ? `노쇼 표시 · ${picked.title}` : '노쇼 표시'}
        id="noshow-title"
        right={policy ? <span className="text-xs text-faint">{noShowPolicyText(policy)}</span> : undefined}
      />
      {q.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : q.isError ? (
        <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
      ) : !picked || !policy ? (
        <EmptyState mark="NS" title="노쇼를 표시할 내전이 없어요" description="진행 중이거나 끝난 내전 중 표시 기한이 남은 것만 보여요." />
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-text-2">
            내전 선택
            <SelectInput
              value={picked.id}
              onChange={(e) => {
                setPickedId(e.target.value);
                save.reset();
              }}
              className="w-full"
            >
              {scrims.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatMonthDay(s.scheduled_at)} {formatClock(s.scheduled_at)} · {s.title}
                </option>
              ))}
            </SelectInput>
          </label>
          {q.hasNextPage && (
            <Button size="sm" className="self-start" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
              이전 내전 더 불러오기
            </Button>
          )}
          {/* 내전이 바뀌거나 저장 후 다시 받으면 체크 상태를 서버 값으로 다시 맞춘다 */}
          <NoShowRoster key={`${picked.id}:${picked.players.map((p) => `${p.user.id}=${p.status}`).join(',')}`} s={picked} policy={policy} save={save} onToast={onToast} />
        </>
      )}
    </Card>
  );
}

function NoShowRoster({
  s,
  policy,
  save,
  onToast,
}: {
  s: AdminNoShowScrim;
  policy: NoShowPolicyView;
  save: ReturnType<typeof useSaveNoShows>;
  onToast: ToastFn;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(s.players.filter((p) => p.status === 'no_show').map((p) => p.user.id)));
  const changes = noShowChanges(s.players, checked);
  const willRestrict = s.players.filter((p) => p.restrict_if_marked && checked.has(p.user.id) && p.status === 'joined').map((p) => p.user.nickname);
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const saveErr = save.error as (Error & { saved?: number }) | null;
  return (
    <>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
        {s.players.map((p, i) => {
          const on = checked.has(p.user.id);
          const tag = noShowTag(p);
          const count = p.no_show_count_30d + (on && p.status === 'joined' ? 1 : 0) - (!on && p.status === 'no_show' ? 1 : 0);
          return (
            <li key={p.user.id}>
              <Button
                size="custom"
                variant="plain"
                aria-pressed={on}
                onClick={() => toggle(p.user.id)}
                disabled={save.isPending}
                className={cn(
                  'flex min-h-[52px] w-full items-center gap-2.5 rounded-[14px] border px-3 text-left text-text',
                  on ? 'border-orange/35 bg-orange/8' : 'border-line bg-surface-2',
                )}
              >
                <span className="w-5 shrink-0 text-center font-display text-xs text-faint">{i + 1}</span>
                <Avatar src={p.user.avatar_url} name={p.user.nickname} size={30} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{p.user.nickname}</span>
                  <span className="text-[11px] text-faint">
                    최근 {policy.window_days}일 노쇼 {count}회
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className={cn('text-xs font-bold', on ? 'text-orange-ink-2' : 'text-faint')}>{on ? '노쇼' : '참석'}</span>
                  {tag && <span className={cn('text-[11px]', tag.tone === 'warn' ? 'text-orange-text' : 'text-warn-text-2')}>{tag.text}</span>}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
      {willRestrict.length > 0 && (
        <div role="status" className="flex items-center gap-2.5 rounded-[14px] border border-orange/25 bg-orange/6 px-3.5 py-3 text-[13px] text-warn-text">
          <AlertIcon size={18} className="shrink-0 text-orange" />
          {`${willRestrict.join(', ')}님은 저장하면 내전 참가가 제한돼요(${noShowPolicyText(policy)}).`}
        </div>
      )}
      {save.isError && (
        <InlineError>
          {`${apiErrorText(save.error)}${saveErr?.saved ? ` 앞의 ${saveErr.saved}명은 저장됐어요.` : ''} 최신 상태로 다시 불러왔어요.`}
        </InlineError>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {changes.length > 0 && <span className="text-xs text-faint">바뀐 참가자 {changes.length}명만 저장해요</span>}
        <Button
          variant="primary"
          disabled={changes.length === 0 || save.isPending}
          onClick={() =>
            save.mutate(
              { scrimId: s.id, changes },
              { onSuccess: () => onToast({ message: `노쇼 표시를 저장했어요. (${changes.length}명 변경)`, tone: 'success' }) },
            )
          }
        >
          {save.isPending ? '저장하는 중…' : `노쇼 ${checked.size}명 저장`}
        </Button>
      </div>
    </>
  );
}
