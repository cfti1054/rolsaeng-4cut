'use client';

import {
  Uuid,
  type GameView,
  type ScrimDetail,
  type ScrimPlayerView,
  type ScrimRestriction,
} from '@gcd/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, ConfirmDialog, InlineError, Notice, Toast } from '@/components/ui/controls';
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { useMe } from '@/lib/hooks/auth';
import {
  useCancelScrim,
  useGames,
  useJoinScrim,
  useLeaveScrim,
  useScrim,
  useSetScrimNoShow,
  useStartScrim,
} from '@/lib/hooks/scrims';
import { useNow } from '@/lib/hooks/use-now';
import { routes } from '@/lib/routes';
import {
  CANCEL_REASON_TEXT,
  SCRIM_STEP_LABELS,
  formatHms,
  autoCloseHintText,
  isOpenStatus,
  noShowMarkHintText,
  noShowRuleText,
  positionsText,
  restrictionUntilText,
  samePositions,
  scrimDetailBadge,
  scrimShareText,
  scrimSteps,
  scrimWhen,
  startBlockedReason,
  toPreferredPositions,
  kstMonthDayTime,
} from '@/lib/scrims';
import { PositionPicker } from './position-picker';
import { GameTag, PositionChips, SectionHead, StatusPill, scrimErrorText, useRestriction } from './scrim-bits';
import { ScrimEditDialog } from './scrim-edit-dialog';
import { SteamAppImage, steamStoreUrl } from './steam-app-picker';

type ToastState = { message: string; tone: 'success' | 'error' } | null;

/**
 * /scrims/[id](목업 ScrimDetail, 계약 6·8절).
 * 버튼 노출은 서버가 계산한 viewer.can_*만 따른다(D93). 상태 변경 응답으로 캐시를 바로 바꾼다(D87).
 */
export function ScrimDetailView({ id }: { id: string }) {
  const validId = Uuid.safeParse(id).success;
  const q = useScrim(id, validId);
  const [toast, setToast] = useState<ToastState>(null);
  const closeToast = useCallback(() => setToast(null), []);

  if (!validId || (isApiError(q.error) && (q.error.code === 'NOT_FOUND' || q.error.code === 'VALIDATION_FAILED'))) {
    return (
      <>
        <BackLink />
        <EmptyState
          mark="?"
          title="내전을 찾을 수 없어요"
          description="주소가 잘못됐거나 지워진 모집글이에요."
          action={
            <Link href={routes.scrims()} className="text-sm font-semibold">
              내전 목록으로
            </Link>
          }
        />
      </>
    );
  }
  if (q.isPending) return <DetailSkeleton />;
  if (q.isError && !q.data) {
    return (
      <>
        <BackLink />
        <ErrorState
          message={isApiError(q.error) ? errorMessage(q.error.code) : errorMessage('NETWORK_ERROR')}
          onRetry={() => void q.refetch()}
        />
      </>
    );
  }
  return (
    <DetailBody data={q.data} updatedAt={q.dataUpdatedAt} refetch={q.refetch} toast={toast} setToast={setToast} closeToast={closeToast} />
  );
}

/**
 * 서버 join_closed는 다음 재조회(최대 20초) 때 바뀌므로, 시작 시각이 되면 화면에서 먼저 막고 한 번 다시 받아 온다.
 * 그 뒤에 받은 응답이 아직 열려 있다고 하면 서버 시각(D93)을 따른다(클라이언트 시계가 빠른 경우).
 */
function useJoinClosed(s: ScrimDetail, updatedAt: number, refetch: () => unknown): boolean {
  const open = isOpenStatus(s.status);
  const now = useNow(1_000, open && !s.join_closed);
  const passed = open && now !== null && now >= Date.parse(s.scheduled_at);
  const [passedAt, setPassedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!passed) {
      if (passedAt !== null) setPassedAt(null);
      return;
    }
    if (s.join_closed || passedAt !== null) return;
    setPassedAt(Date.now());
    void refetch();
  }, [passed, s.join_closed, passedAt, refetch]);
  const serverSaysOpen = passedAt !== null && updatedAt > passedAt;
  return s.join_closed || (passed && !serverSaysOpen);
}

function DetailBody({
  data,
  updatedAt,
  refetch,
  toast,
  setToast,
  closeToast,
}: {
  data: ScrimDetail;
  updatedAt: number;
  refetch: () => unknown;
  toast: ToastState;
  setToast: (t: ToastState) => void;
  closeToast: () => void;
}) {
  const joinClosed = useJoinClosed(data, updatedAt, refetch);
  const s = joinClosed === data.join_closed ? data : { ...data, join_closed: joinClosed };
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        <ShareButton s={s} onToast={setToast} />
      </div>
      <Hero s={s} />
      <HostMenu s={s} onToast={setToast} />
      <div className="flex flex-wrap items-start gap-5">
        <Roster s={s} onToast={setToast} />
        <div className="flex min-w-0 flex-[2_1_520px] flex-col gap-5">
          <JoinPanel s={s} onToast={setToast} />
          <Card aria-labelledby="balance-title">
            <SectionHead eyebrow="AUTO BALANCE" title="팀 자동 밸런스" id="balance-title" />
            <EmptyState
              mark="BAL"
              title="팀 밸런스는 곧 열려요"
              description={
                s.options.auto_balance
                  ? '정원이 차면 티어와 내전 레이팅으로 두 팀 전력을 맞춘 3가지 안을 보여 줄 예정이에요.'
                  : '이 내전은 자동 밸런스를 쓰지 않아요. 방장이 직접 팀을 나눠요.'
              }
            />
          </Card>
        </div>
      </div>
      <Card aria-labelledby="result-title">
        <SectionHead
          eyebrow="RESULT"
          title="결과 입력"
          id="result-title"
          right={<span className="text-xs text-faint">방장 입력 → 운영진 승인 → 레이팅 반영</span>}
        />
        <EmptyState mark="WIN" title="결과 입력은 곧 열려요" description="경기가 끝나면 방장이 승리 팀을 입력하고 운영진이 승인하는 기능이 열릴 예정이에요." />
      </Card>
      <Toast message={toast?.message ?? null} tone={toast?.tone} onClose={closeToast} />
    </>
  );
}

function BackLink() {
  return (
    <Link href={routes.scrims()} className="self-start text-[13px] text-muted no-underline hover:text-text">
      ← 내전 목록
    </Link>
  );
}

function ShareButton({ s, onToast }: { s: ScrimDetail; onToast: (t: ToastState) => void }) {
  const onClick = async () => {
    const url = `${window.location.origin}${routes.scrim(s.id)}`;
    const ok = await copyText(scrimShareText(s, url));
    onToast(
      ok
        ? { message: '모집 링크를 복사했어요. 메신저에 붙여 넣어 공유하세요.', tone: 'success' }
        : { message: '복사하지 못했어요. 주소창의 링크를 직접 복사해 주세요.', tone: 'error' },
    );
  };
  return (
    <Button onClick={() => void onClick()} aria-label="모집 링크 복사">
      링크 복사
    </Button>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="내전 불러오는 중" className="flex flex-col gap-5">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-[220px] rounded-[24px]" />
      <div className="flex flex-wrap gap-5">
        <Skeleton className="h-[420px] flex-[1_1_300px] rounded-[20px]" />
        <Skeleton className="h-[420px] flex-[2_1_520px] rounded-[20px]" />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 헤더 + 진행 단계
// -----------------------------------------------------------------------------

function Hero({ s }: { s: ScrimDetail }) {
  const open = isOpenStatus(s.status);
  const counting = open && !s.join_closed;
  const now = useNow(1_000, counting);
  const badge = scrimDetailBadge(s);
  const steps = scrimSteps(s.status);
  const remaining = now === null ? null : (Date.parse(s.scheduled_at) - now) / 1000;
  const meta = [
    now === null ? null : scrimWhen(s.scheduled_at, now),
    `방장 ${s.host.nickname}`,
    s.options.rated ? '시즌 ELO 반영' : 'ELO 미반영',
    s.options.auto_balance ? '자동 밸런스' : null,
    s.options.use_positions ? '포지션 선택' : null,
  ].filter(Boolean);

  return (
    <section aria-labelledby="scrim-title" className="flex flex-col gap-[22px] rounded-[24px] border border-hero-line bg-hero p-5 md:px-7 md:py-[26px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2.5">
          <div className="flex flex-wrap gap-2">
            <GameTag game={s.game.code} capacity={s.capacity} boxed />
            <StatusPill label={badge.label} tone={badge.tone} className="rounded-lg" />
            {s.viewer.status === 'joined' && open && <StatusPill label="참가 중" tone="cyan" className="rounded-lg" />}
            {s.viewer.status === 'waitlist' && open && (
              <StatusPill label={`대기 ${s.viewer.waitlist_order ?? ''}번`} tone="cyan" className="rounded-lg" />
            )}
          </div>
          <h1 id="scrim-title" className="m-0 break-words text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">
            {s.title}
          </h1>
          {s.steam_app && (
            <a
              href={steamStoreUrl(s.steam_app.app_id)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 self-start rounded-2xl border border-line-2 bg-surface p-2 pr-4 text-text no-underline hover:border-line-3 hover:text-text"
            >
              <SteamAppImage appId={s.steam_app.app_id} className="w-[100px]" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-faint">스팀 게임</span>
                <span className="break-words text-[15px] font-bold">{s.steam_app.name}</span>
              </span>
            </a>
          )}
          <span className="text-sm text-muted">
            <time dateTime={s.scheduled_at} title={formatFull(s.scheduled_at)}>
              {meta[0]}
            </time>
            {meta.slice(1).map((m) => ` · ${m}`)}
          </span>
        </div>
        {counting ? (
          <div className="flex flex-col items-end gap-0.5" role="timer" aria-label="시작까지 남은 시간">
            <span className="text-xs text-faint">시작까지</span>
            <span className="font-display text-[32px] font-bold leading-none tabular-nums md:text-[40px]">
              {remaining === null ? '--:--:--' : remaining <= 0 ? '곧 시작' : formatHms(remaining)}
            </span>
          </div>
        ) : open ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="text-xs text-faint">시작 시각이 지났어요</span>
            <span className="text-sm font-semibold text-text-2">방장이 시작하면 진행 중으로 바뀌어요</span>
          </div>
        ) : null}
      </div>

      {steps ? (
        <ol aria-label="진행 단계" className="m-0 grid list-none grid-cols-4 p-0">
          {SCRIM_STEP_LABELS.map((label, i) => {
            const st = steps[i]!;
            return (
              <li key={label} className="flex flex-col gap-2.5" aria-current={st === 'current' ? 'step' : undefined}>
                <div className="flex items-center">
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-full border-2 font-display text-[13px] font-bold',
                      st === 'done' && 'border-accent bg-accent text-on-accent',
                      st === 'current' && 'border-accent bg-on-accent text-accent-ink',
                      st === 'todo' && 'border-line-3 bg-transparent text-faint',
                    )}
                  >
                    {st === 'done' ? '✓' : i + 1}
                  </span>
                  {i < 3 && <span aria-hidden="true" className={cn('mx-2 h-0.5 flex-1', st === 'done' ? 'bg-accent' : 'bg-line-3')} />}
                </div>
                <span className={cn('text-[13px] font-semibold', st === 'todo' ? 'text-faint' : 'text-text')}>
                  {label}
                  <span className="sr-only">{st === 'done' ? ' (완료)' : st === 'current' ? ' (진행 중)' : ''}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="rounded-2xl border border-line-2 bg-surface px-4 py-3 text-sm text-muted">
          <strong className="text-text">취소된 내전</strong> · {s.cancel_reason ? CANCEL_REASON_TEXT[s.cancel_reason] : '모집이 취소됐어요.'}
          {s.cancelled_at && <span className="text-faint"> ({kstMonthDayTime(s.cancelled_at)})</span>}
        </div>
      )}

      {s.rules && (
        <details className="group rounded-2xl border border-line-2 bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-text-2">규칙 보기</summary>
          <p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-[1.7] text-muted">{s.rules}</p>
        </details>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// 방장(·운영진) 메뉴
// -----------------------------------------------------------------------------

function HostMenu({ s, onToast }: { s: ScrimDetail; onToast: (t: ToastState) => void }) {
  const games = useGames();
  const start = useStartScrim(s.id);
  const cancel = useCancelScrim(s.id);
  const { restriction } = useRestriction();
  const [dialog, setDialog] = useState<'edit' | 'start' | 'cancel' | null>(null);
  const v = s.viewer;
  if (!v.can_edit && !v.can_cancel && !v.can_start) return null;
  const game: GameView | undefined = games.data?.items.find((g) => g.code === s.game.code);
  const blocked = !v.can_start ? startBlockedReason(s.capacity, game?.capacity) : null;
  const err = start.error ?? cancel.error;

  return (
    <section aria-label={v.is_host ? '방장 메뉴' : '운영진 메뉴'} className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="px-1 font-display text-[11px] font-semibold tracking-[0.16em] text-faint">{v.is_host ? 'HOST' : 'STAFF'}</span>
        {v.can_edit && <Button onClick={() => setDialog('edit')}>수정</Button>}
        <Button variant="primary" onClick={() => setDialog('start')} disabled={!v.can_start || start.isPending} aria-describedby={blocked ? 'start-blocked' : undefined}>
          {start.isPending ? '시작하는 중…' : '내전 시작'}
        </Button>
        {v.can_cancel && (
          <Button variant="danger" onClick={() => setDialog('cancel')} disabled={cancel.isPending} className="ml-auto">
            모집 취소
          </Button>
        )}
      </div>
      {blocked && (
        <p id="start-blocked" className="m-0 px-1 text-xs text-faint">
          {blocked} {autoCloseHintText(restriction?.scrim_policy)}
        </p>
      )}
      {(start.isError || cancel.isError) && <InlineError>{scrimErrorText(err)}</InlineError>}

      {dialog === 'edit' && game && <ScrimEditDialog s={s} game={game} onClose={() => setDialog(null)} onSaved={() => onToast({ message: '모집글을 수정했어요.', tone: 'success' })} />}
      {dialog === 'edit' && !game && (
        <ConfirmDialog
          open
          title="게임 정보를 불러오지 못했어요"
          description="정원 범위를 확인해야 수정할 수 있어요. 잠시 후 다시 시도해 주세요."
          confirmLabel="다시 불러오기"
          confirmVariant="primary"
          onConfirm={() => void games.refetch()}
          onClose={() => setDialog(null)}
        />
      )}
      <ConfirmDialog
        open={dialog === 'start'}
        title="내전을 시작할까요?"
        description={
          <>
            참가 확정 {s.joined_count}명으로 시작해요. 시작하면 참가·취소·수정을 더 받지 않아요.
            {s.waitlist_count > 0 && ` 대기 ${s.waitlist_count}명은 대기 상태로 남아요.`}
          </>
        }
        confirmLabel="시작"
        confirmVariant="primary"
        pending={start.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          // 성공하면 이 메뉴가 사라지므로(can_* false) 컴포넌트 수명과 무관한 mutateAsync로 알린다
          start
            .mutateAsync()
            .then(() => onToast({ message: '내전을 시작했어요.', tone: 'success' }))
            .catch(() => setDialog(null))
        }
      />
      <ConfirmDialog
        open={dialog === 'cancel'}
        title="모집을 취소할까요?"
        description={`참가자 ${s.joined_count}명${s.waitlist_count ? `, 대기 ${s.waitlist_count}명` : ''}에게 취소된 내전으로 보여요. 되돌릴 수 없어요.`}
        confirmLabel="모집 취소"
        pending={cancel.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          cancel
            .mutateAsync()
            .then(() => onToast({ message: '모집을 취소했어요.', tone: 'success' }))
            .catch(() => setDialog(null))
        }
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// 참가자 슬롯 + 대기열 + 운영진 노쇼
// -----------------------------------------------------------------------------

function Roster({ s, onToast }: { s: ScrimDetail; onToast: (t: ToastState) => void }) {
  const me = useMe();
  const { restriction } = useRestriction();
  // 정책 숫자는 GET /me/scrim-restriction 응답에서만 쓴다(D101). 응답 전이면 숫자 없는 문구
  const policy = restriction?.policy;
  const isAdmin = me.data?.role === 'admin';
  const showNoShow = isAdmin && (s.status === 'playing' || s.status === 'finished');
  const noShow = useSetScrimNoShow(s.id);
  const [markTarget, setMarkTarget] = useState<ScrimPlayerView | null>(null);
  const open = isOpenStatus(s.status);
  const empty = open ? Math.max(0, s.capacity - s.players.length) : 0;

  return (
    <section
      aria-labelledby="roster-title"
      className="flex min-w-0 flex-[1_1_300px] flex-col gap-2 rounded-[20px] border border-line bg-surface p-[22px] shadow-[inset_0_1px_0_var(--hi)]"
    >
      <SectionHead
        eyebrow="ROSTER"
        title="참가자"
        id="roster-title"
        right={
          <span className="font-display text-[15px] font-bold text-accent-ink">
            {s.joined_count} / {s.capacity}
          </span>
        }
      />
      <ul className="m-0 mt-1.5 flex list-none flex-col p-0">
        {s.players.map((p) => (
          <li key={p.user.id} className="flex min-h-[42px] items-center gap-2.5 py-1">
            <Avatar src={p.user.avatar_url} name={p.user.nickname} size={30} />
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm font-medium">
              <Link href={routes.member(p.user.id)} className="truncate text-text no-underline hover:text-text hover:underline">
                {p.user.nickname}
              </Link>
              {p.is_host && <Badge tone="accent">방장</Badge>}
              {p.user.id === me.data?.id && <span className="text-xs text-faint">(나)</span>}
              {p.status === 'no_show' && (
                <span title={p.no_show_marked_at ? `${formatFull(p.no_show_marked_at)} 표시` : undefined}>
                  <Badge tone="orange">노쇼</Badge>
                </span>
              )}
            </span>
            <PositionChips positions={p.preferred_positions} />
            {showNoShow &&
              (p.status === 'no_show' ? (
                <Button
                  className="h-8 px-2.5 text-xs"
                  disabled={noShow.isPending}
                  onClick={() =>
                    noShow.mutate(
                      { userId: p.user.id, noShow: false },
                      { onSuccess: () => onToast({ message: `${p.user.nickname}님의 노쇼를 정정했어요.`, tone: 'success' }) },
                    )
                  }
                >
                  노쇼 정정
                </Button>
              ) : (
                s.viewer.can_mark_no_show && (
                  <Button variant="danger" className="h-8 px-2.5 text-xs" disabled={noShow.isPending} onClick={() => setMarkTarget(p)}>
                    노쇼 표시
                  </Button>
                )
              ))}
          </li>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <li key={`empty-${i}`} className="flex min-h-[42px] items-center gap-2.5 py-1 text-sm text-faint">
            <span aria-hidden="true" className="size-[30px] shrink-0 rounded-full border border-dashed border-line-3" />
            빈 자리
          </li>
        ))}
      </ul>
      {showNoShow && policy && <p className="m-0 px-1 text-xs text-faint">{noShowMarkHintText(policy)}</p>}
      {showNoShow && noShow.isError &&<InlineError>{scrimErrorText(noShow.error)}</InlineError>}

      {open && (s.waitlist.length > 0 || s.status === 'full') && (
        <div className="mt-2.5 flex flex-col gap-2 rounded-[14px] bg-surface-2 p-3.5">
          <span className="font-display text-[11px] font-semibold tracking-[0.14em] text-faint">WAITLIST · {s.waitlist.length}</span>
          {s.waitlist.length === 0 ? (
            <span className="text-[13px] text-muted">대기 중인 사람이 없어요. 지금 신청하면 1번이에요.</span>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2 p-0">
              {s.waitlist.map((w) => (
                <li key={w.user.id} className="flex justify-between gap-2 text-[13px] text-muted">
                  <span className="min-w-0 truncate">
                    <span className="mr-2 font-display text-text">{w.order}</span>
                    {w.user.nickname}
                    {w.user.id === me.data?.id && <span className="text-faint"> (나)</span>}
                  </span>
                  <span className="shrink-0">{positionsText(w.preferred_positions)}</span>
                </li>
              ))}
            </ol>
          )}
          <span className="text-xs text-faint">참가 확정자가 취소하면 1번부터 자동으로 참가 확정돼요.</span>
        </div>
      )}

      <ConfirmDialog
        open={markTarget !== null}
        title="노쇼로 표시할까요?"
        description={
          markTarget && (
            <>
              <strong className="text-text">{markTarget.user.nickname}</strong>님을 이 내전의 노쇼로 표시해요. {noShowRuleText(policy)} 잘못 표시했다면 「노쇼
              정정」으로 되돌릴 수 있어요.
            </>
          )
        }
        confirmLabel="노쇼 표시"
        pending={noShow.isPending}
        onClose={() => setMarkTarget(null)}
        onConfirm={() => {
          if (!markTarget) return;
          noShow.mutate(
            { userId: markTarget.user.id, noShow: true },
            {
              onSuccess: () => onToast({ message: `${markTarget.user.nickname}님을 노쇼로 표시했어요.`, tone: 'success' }),
              onSettled: () => setMarkTarget(null),
            },
          );
        }}
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// 참가 영역
// -----------------------------------------------------------------------------

function JoinPanel({ s, onToast }: { s: ScrimDetail; onToast: (t: ToastState) => void }) {
  const v = s.viewer;
  const open = isOpenStatus(s.status);
  const { restriction } = useRestriction();
  // 서버 응답의 희망 포지션이 바뀌면(포지션 변경 성공·다른 탭) 선택 상태를 새로 시작한다
  const key = `${v.status ?? 'none'}:${v.preferred_positions.join(',')}`;

  return (
    <Card aria-labelledby="join-title">
      <SectionHead eyebrow="JOIN" title="내 참가" id="join-title" right={<MyStatusLine s={s} />} />
      {!open ? (
        <ClosedStateText s={s} />
      ) : (
        <JoinControls key={key} s={s} restriction={restriction ?? null} onToast={onToast} />
      )}
    </Card>
  );
}

function MyStatusLine({ s }: { s: ScrimDetail }) {
  const v = s.viewer;
  if (v.status === 'joined') return <Badge tone="cyan" icon="check">참가 확정</Badge>;
  if (v.status === 'waitlist') return <Badge tone="cyan">대기 {v.waitlist_order}번</Badge>;
  if (v.status === 'no_show') return <Badge tone="orange">노쇼</Badge>;
  return null;
}

function ClosedStateText({ s }: { s: ScrimDetail }) {
  const mine = s.viewer.status;
  const text =
    s.status === 'playing'
      ? mine === 'joined'
        ? '경기가 진행 중이에요. 즐거운 내전 되세요!'
        : '경기가 진행 중이에요. 참가 신청은 마감됐어요.'
      : s.status === 'finished'
        ? '끝난 내전이에요.'
        : '취소된 내전이라 참가할 수 없어요.';
  return <p className="m-0 text-sm text-muted">{text}</p>;
}

function JoinControls({
  s,
  restriction,
  onToast,
}: {
  s: ScrimDetail;
  restriction: ScrimRestriction | null;
  onToast: (t: ToastState) => void;
}) {
  const v = s.viewer;
  const join = useJoinScrim(s.id);
  const leave = useLeaveScrim(s.id);
  const [first, setFirst] = useState<string | null>(v.preferred_positions[0] ?? null);
  const [second, setSecond] = useState<string | null>(v.preferred_positions[1] ?? null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const inRoster = v.status === 'joined' || v.status === 'waitlist';
  const usePositions = s.options.use_positions;
  const picked = usePositions ? toPreferredPositions(first, second) : [];
  const changed = !samePositions(picked, v.preferred_positions);
  const willWait = s.status === 'full' || s.joined_count >= s.capacity;
  const restrictedUntil = v.restricted_until ?? (restriction?.restricted ? restriction.until : null);
  const busy = join.isPending || leave.isPending;
  const err = join.error ?? leave.error;

  // 성공하면 key가 바뀌어 이 컴포넌트가 다시 만들어지므로 mutateAsync로 결과를 알린다
  const submitJoin = () =>
    join.mutateAsync(picked).then(
      (d) => {
        if (inRoster) onToast({ message: '희망 포지션을 바꿨어요.', tone: 'success' });
        else if (d.viewer.status === 'joined') onToast({ message: '참가 확정! 시작 시각에 맞춰 와 주세요.', tone: 'success' });
        else if (d.viewer.status === 'waitlist')
          onToast({ message: `대기 ${d.viewer.waitlist_order}번으로 등록했어요. 자리가 나면 자동으로 참가 확정돼요.`, tone: 'success' });
      },
      () => {},
    );

  if (s.join_closed) {
    return (
      <Notice tone="info" title="시작 시각이 지나 참가·취소할 수 없어요">
        {v.can_edit
          ? '방장은 「수정」에서 시작 시각을 미루면 다시 참가를 받을 수 있어요.'
          : '사정이 생겼다면 방장에게 직접 알려 주세요.'}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {restrictedUntil && !inRoster && (
        <Notice title={restrictionUntilText(restrictedUntil)}>
          제한이 풀리면 다시 참가할 수 있어요. 이미 참가한 내전은 그대로예요.
        </Notice>
      )}

      {inRoster && (
        <p className="m-0 text-sm text-text-2">
          {v.status === 'joined'
            ? v.is_host
              ? '방장으로 참가 중이에요.'
              : '참가가 확정됐어요.'
            : `대기 ${v.waitlist_order}번이에요. 참가 확정자가 취소하면 순서대로 자동 확정돼요.`}
        </p>
      )}

      {usePositions && (v.can_join || inRoster) && (
        <PositionPicker
          positions={s.game.positions}
          first={first}
          second={second}
          disabled={busy}
          onChange={(a, b) => {
            setFirst(a);
            setSecond(b);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {v.can_join && (
          <Button variant="primary" size="lg" onClick={submitJoin} disabled={busy || (usePositions && !first)}>
            {join.isPending ? '신청하는 중…' : willWait ? '대기열 등록' : '참가하기'}
          </Button>
        )}
        {inRoster && usePositions && (
          <Button size="lg" onClick={submitJoin} disabled={busy || !changed || !first}>
            {join.isPending ? '바꾸는 중…' : '포지션 변경'}
          </Button>
        )}
        {v.can_leave && (
          <Button variant="ghost" size="lg" onClick={() => setConfirmLeave(true)} disabled={busy} className="ml-auto">
            {v.status === 'waitlist' ? '대기 취소' : '참가 취소'}
          </Button>
        )}
      </div>
      {v.can_join && usePositions && !first && <p className="m-0 text-xs text-faint">1지망 포지션을 고르면 신청할 수 있어요.</p>}
      {v.can_join && willWait && <p className="m-0 text-xs text-faint">정원이 찼어요. 지금 신청하면 대기 {s.waitlist_count + 1}번이 돼요.</p>}
      {v.is_host && inRoster && <p className="m-0 text-xs text-faint">방장은 참가를 취소할 수 없어요. 내전을 열지 않으려면 「모집 취소」를 눌러 주세요.</p>}
      {(join.isError || leave.isError) && <InlineError>{scrimErrorText(err, restriction)}</InlineError>}

      <ConfirmDialog
        open={confirmLeave}
        title={v.status === 'waitlist' ? '대기를 취소할까요?' : '참가를 취소할까요?'}
        description={
          v.status === 'waitlist'
            ? '대기 순번을 잃어요. 다시 신청하면 대기열 맨 뒤로 들어가요.'
            : `내 자리는 ${s.waitlist_count > 0 ? '대기 1번에게 자동으로 넘어가요' : '빈 자리가 돼요'}. 다시 신청하면 그때 상황에 따라 참가 또는 대기로 들어가요.`
        }
        confirmLabel={v.status === 'waitlist' ? '대기 취소' : '참가 취소'}
        pending={leave.isPending}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => {
          const wasWaiting = v.status === 'waitlist';
          leave.mutateAsync().then(
            () => onToast({ message: wasWaiting ? '대기를 취소했어요.' : '참가를 취소했어요.', tone: 'success' }),
            () => setConfirmLeave(false),
          );
        }}
      />
    </div>
  );
}
