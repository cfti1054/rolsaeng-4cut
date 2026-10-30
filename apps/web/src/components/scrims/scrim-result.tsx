'use client';

import {
  RejectReason,
  SCRIM_REJECT_REASON_MAX_LENGTH,
  SCRIM_REJECT_REASON_MIN_LENGTH,
  type ScrimDetail,
  type ScrimResultView,
  type ScrimTeam,
} from '@gcd/shared';
import Link from 'next/link';
import { useId, useState } from 'react';
import { Badge, Button, ConfirmDialog, InlineError, Notice } from '@/components/ui/controls';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { formatFull } from '@/lib/format';
import { useMe } from '@/lib/hooks/auth';
import {
  useApproveScrimResult,
  useRejectScrimResult,
  useSubmitScrimResult,
  useWithdrawScrimResult,
} from '@/lib/hooks/scrims';
import { routes } from '@/lib/routes';
import {
  TEAM_LABEL,
  buildPlacements,
  placementPathUser,
  pruneDraft,
  splitValidationDetails,
  tooFewPlayersText,
  pendingResultText,
  ratingStatusText,
  resultFlowText,
  resultPanelState,
  signed,
  type PlacementDraft,
} from '@/lib/scrim-results';
import { RowErrors, SectionHead, scrimErrorText, scrimErrorTextRest } from './scrim-bits';
import { isApiError } from '@/lib/api/client';
import { TEAM_TONE, isStaleError, staleToast } from './scrim-teams';

type ToastFn = (t: { message: string; tone: 'success' | 'error' }) => void;

/** RESULT 영역(계약 S3 9절 표). 버튼 노출은 viewer.can_*만 따른다 */
export function ResultPanel({ s, onToast }: { s: ScrimDetail; onToast: ToastFn }) {
  const me = useMe();
  const st = resultPanelState(s, { isAdmin: me.data?.role === 'admin' });
  const rejected = 'rejected' in st ? st.rejected : null;
  return (
    <section
      aria-labelledby="result-title"
      className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-[22px] shadow-[inset_0_1px_0_var(--hi)]"
    >
      <SectionHead
        eyebrow="RESULT"
        title={st.kind === 'approved' ? '경기 결과' : '결과 입력'}
        id="result-title"
        right={<span className="text-xs text-faint">{resultFlowText(s.options.rated)}</span>}
      />
      {rejected && (
        <Notice title={`운영진이 결과를 반려했어요: ${rejected.reject_reason ?? ''}`}>
          {rejected.rejected_by && rejected.rejected_at && `${rejected.rejected_by.nickname} · ${formatFull(rejected.rejected_at)}`}
        </Notice>
      )}
      {st.kind === 'before' && <Muted>경기가 시작되면 결과를 입력할 수 있어요</Muted>}
      {st.kind === 'cancelled' && <Muted>취소된 내전이라 결과가 없어요</Muted>}
      {st.kind === 'no_result' && <Muted>기록된 결과가 없어요</Muted>}
      {st.kind === 'waiting' && <Muted>방장이 결과를 입력하면 운영진 승인 후 확정돼요</Muted>}
      {st.kind === 'need_teams' && <Muted>결과를 입력하기 전에 팀을 구성해 주세요</Muted>}
      {st.kind === 'too_few' && <Muted>{tooFewPlayersText()}</Muted>}
      {st.kind === 'input' && (s.game.has_teams ? <TeamResultForm s={s} onToast={onToast} /> : <PlacementForm s={s} onToast={onToast} />)}
      {st.kind === 'pending' && <PendingResult s={s} r={st.result} onToast={onToast} />}
      {st.kind === 'approved' && <ApprovedResult s={s} r={st.result} />}
    </section>
  );
}

function Muted({ children }: { children: string }) {
  return <p className="m-0 text-sm text-muted">{children}</p>;
}

// -----------------------------------------------------------------------------
// 입력
// -----------------------------------------------------------------------------

function TeamResultForm({ s, onToast }: { s: ScrimDetail; onToast: ToastFn }) {
  const submit = useSubmitScrimResult(s.id);
  const [winner, setWinner] = useState<ScrimTeam | null>(null);
  const legendId = useId();
  const onSubmit = () =>
    winner &&
    submit.mutate(
      { winner_team: winner },
      {
        onSuccess: () => onToast({ message: `${TEAM_LABEL[winner].ko} 승리로 제출했어요.`, tone: 'success' }),
        onError: (e) => staleToast(e, onToast),
      },
    );
  return (
    <div className="flex flex-col gap-2.5">
      <div role="group" aria-labelledby={legendId} className="flex flex-col gap-2.5">
        <span id={legendId} className="text-[13px] text-muted">
          승리 팀을 고르세요
        </span>
        <div className="flex flex-wrap items-stretch gap-3">
          {(['blue', 'orange'] as const).map((t) => {
            const on = winner === t;
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                disabled={submit.isPending}
                onClick={() => setWinner(t)}
                className={cn(
                  'flex h-[72px] flex-[1_1_220px] items-center justify-center gap-3 rounded-[18px] border-2',
                  TEAM_TONE[t].ink,
                  on ? cn(t === 'blue' ? 'border-blue' : 'border-orange', TEAM_TONE[t].soft) : 'border-line-3 bg-surface-2',
                )}
              >
                <span className="font-display text-xl font-bold tracking-[0.12em]">{TEAM_LABEL[t].tag}</span>
                <span className="text-sm font-semibold">승리</span>
              </button>
            );
          })}
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={!winner || submit.isPending}
            className="h-[72px] flex-[0_0_auto] rounded-[18px] px-7 text-[15px]"
          >
            {submit.isPending ? '제출하는 중…' : '결과 제출'}
          </Button>
        </div>
      </div>
      {submit.isError && !isStaleError(submit.error) && <InlineError>{scrimErrorText(submit.error)}</InlineError>}
    </div>
  );
}

function PlacementForm({ s, onToast }: { s: ScrimDetail; onToast: ToastFn }) {
  const submit = useSubmitScrimResult(s.id);
  const joined = s.players.filter((p) => p.status === 'joined');
  const [rawDraft, setDraft] = useState<PlacementDraft>({});
  // 재조회로 명단이 바뀌면(노쇼·이탈) 현재 joined 기준으로 정리해서 쓴다
  const draft = pruneDraft(rawDraft, joined.map((p) => p.user.id));
  const touched = Object.values(draft).some((v) => v !== null);
  const { placements, issue } = buildPlacements(draft);
  const split = splitValidationDetails(isApiError(submit.error) ? submit.error.details : undefined, (path) =>
    placementPathUser(submit.variables && 'placements' in submit.variables ? submit.variables : undefined, path),
  );
  const restText = submit.isError && !isStaleError(submit.error) ? scrimErrorTextRest(submit.error, split.rest) : null;
  const onSubmit = () =>
    placements &&
    submit.mutate(
      { placements },
      {
        onSuccess: () => onToast({ message: '순위를 제출했어요.', tone: 'success' }),
        onError: (e) => staleToast(e, onToast),
      },
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] text-muted">
        1위부터 순위를 매기세요. 경기에 참여하지 않은 사람은 「순위 없음」으로 두면 레이팅에 반영되지 않아요.
      </p>
      <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
        {joined.map((p) => (
          <li key={p.user.id} className="flex flex-wrap items-center gap-2.5 rounded-[14px] bg-surface-2 px-3 py-2">
            <Avatar src={p.user.avatar_url} name={p.user.nickname} size={28} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.user.nickname}</span>
            <select
              aria-label={`${p.user.nickname} 순위`}
              value={draft[p.user.id] ?? ''}
              disabled={submit.isPending}
              onChange={(e) => setDraft({ ...draft, [p.user.id]: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-10 rounded-xl border border-line-3 bg-surface px-2.5 text-[13px] text-text"
            >
              <option value="">순위 없음</option>
              {joined.map((_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}위
                </option>
              ))}
            </select>
            {submit.isError && <RowErrors messages={split.byKey[p.user.id]} />}
          </li>
        ))}
      </ul>
      {touched && issue && (
        <p className="m-0 text-xs text-orange-text" aria-live="polite">
          {issue}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="lg" variant="primary" onClick={onSubmit} disabled={!placements || submit.isPending}>
          {submit.isPending ? '제출하는 중…' : '결과 제출'}
        </Button>
      </div>
      {restText && <InlineError>{restText}</InlineError>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 승인 대기
// -----------------------------------------------------------------------------

function PendingResult({ s, r, onToast }: { s: ScrimDetail; r: ScrimResultView; onToast: ToastFn }) {
  const v = s.viewer;
  const me = useMe();
  const withdraw = useWithdrawScrimResult(s.id);
  const approve = useApproveScrimResult(s.id);
  const reject = useRejectScrimResult(s.id);
  const [dialog, setDialog] = useState<'withdraw' | 'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const reasonOk = RejectReason.safeParse(reason).success;
  const selfSubmitted = me.data?.role === 'admin' && me.data.id === r.submitted_by.id;
  const busy = withdraw.isPending || approve.isPending || reject.isPending;
  const err = withdraw.error ?? approve.error ?? reject.error;
  const showErr = (withdraw.isError || approve.isError || reject.isError) && !isStaleError(err);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange/35 bg-orange/8 px-[18px] py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm text-warn-text">{pendingResultText(r, s.options.rated)}</span>
          <span className="text-xs text-warn-text-2">
            {r.submitted_by.nickname} 제출 · <time dateTime={r.submitted_at}>{formatFull(r.submitted_at)}</time>
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.can_withdraw_result && (
            <Button onClick={() => setDialog('withdraw')} disabled={busy} className="border-orange/35 bg-transparent text-warn-text">
              제출 취소
            </Button>
          )}
          {v.can_review_result && (
            <>
              <Button variant="danger" onClick={() => setDialog('reject')} disabled={busy}>
                반려
              </Button>
              <Button variant="primary" onClick={() => setDialog('approve')} disabled={busy}>
                승인
              </Button>
            </>
          )}
        </div>
      </div>
      {!s.game.has_teams && r.placements.length > 0 && <PlacementList r={r} />}
      {selfSubmitted && <p className="m-0 text-xs text-faint">내가 제출한 결과는 다른 운영진이 승인해야 해요</p>}
      {showErr && <InlineError>{scrimErrorText(err)}</InlineError>}

      <ConfirmDialog
        open={dialog === 'withdraw'}
        title="제출을 취소할까요?"
        description="제출한 결과를 지우고 다시 입력할 수 있어요."
        confirmLabel="제출 취소"
        pending={withdraw.isPending}
        onClose={close}
        onConfirm={() =>
          withdraw.mutate(undefined, {
            onSuccess: () => onToast({ message: '제출을 취소했어요. 결과를 다시 입력할 수 있어요.', tone: 'success' }),
            onError: (e) => staleToast(e, onToast),
            onSettled: close,
          })
        }
      />
      <ConfirmDialog
        open={dialog === 'approve'}
        title="결과를 승인할까요?"
        description={s.options.rated ? '승인하면 참가자 레이팅이 바로 반영되고 되돌릴 수 없어요' : '승인하면 결과가 확정되고 되돌릴 수 없어요'}
        confirmLabel="승인"
        confirmVariant="primary"
        pending={approve.isPending}
        onClose={close}
        onConfirm={() =>
          approve.mutate(r.id, {
            onSuccess: () => onToast({ message: '결과를 승인했어요.', tone: 'success' }),
            onError: (e) => staleToast(e, onToast),
            onSettled: close,
          })
        }
      />
      <ConfirmDialog
        open={dialog === 'reject'}
        title="결과를 반려할까요?"
        description={
          <label className="flex flex-col gap-2">
            <span>반려 사유를 적어 주세요. 방장에게 그대로 보여요.</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={SCRIM_REJECT_REASON_MAX_LENGTH + 20}
              rows={3}
              className="w-full resize-y rounded-xl border border-line-3 bg-surface px-3 py-2 text-sm text-text"
              placeholder="예: 승리 팀이 반대로 입력됐어요"
            />
            <span className={cn('text-xs', reason && !reasonOk ? 'text-orange-text' : 'text-faint')}>
              {SCRIM_REJECT_REASON_MIN_LENGTH}–{SCRIM_REJECT_REASON_MAX_LENGTH}자
            </span>
          </label>
        }
        confirmLabel="반려"
        confirmDisabled={!reasonOk}
        pending={reject.isPending}
        onClose={close}
        onConfirm={() =>
          reject.mutate(
            { result_id: r.id, reason },
            {
              onSuccess: () => {
                setReason('');
                onToast({ message: '결과를 반려했어요. 방장이 다시 입력할 수 있어요.', tone: 'success' });
              },
              onError: (e) => staleToast(e, onToast),
              onSettled: close,
            },
          )
        }
      />
    </div>
  );
}

function PlacementList({ r }: { r: ScrimResultView }) {
  return (
    <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label="제출한 순위">
      {r.placements.map((p) => (
        <li key={p.user.id} className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2 text-sm">
          <span className="w-8 font-display font-bold text-accent-ink">{p.placement}위</span>
          <Link href={routes.member(p.user.id)} className="truncate font-semibold text-text no-underline hover:underline">
            {p.user.nickname}
          </Link>
        </li>
      ))}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// 승인됨 + ELO 변동
// -----------------------------------------------------------------------------

function ApprovedResult({ s, r }: { s: ScrimDetail; r: ScrimResultView }) {
  const statusText = ratingStatusText(r.rating_status);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-[18px] py-4">
        {r.winner_team ? (
          <span className={cn('flex items-center gap-3', TEAM_TONE[r.winner_team].ink)}>
            <span aria-hidden="true" className={cn('size-3 rounded-full', TEAM_TONE[r.winner_team].dot)} />
            <span className="font-display text-xl font-bold tracking-[0.12em]">{TEAM_LABEL[r.winner_team].tag}</span>
            <span className="text-sm font-semibold text-text">{TEAM_LABEL[r.winner_team].ko} 승리</span>
          </span>
        ) : (
          <span className="text-sm font-semibold">
            1위 <span className="text-accent-ink">{r.placements[0]?.user.nickname ?? '—'}</span>
          </span>
        )}
        {r.approved_by && r.approved_at && (
          <span className="text-xs text-faint">
            {r.approved_by.nickname} 승인 · <time dateTime={r.approved_at}>{formatFull(r.approved_at)}</time>
          </span>
        )}
      </div>
      {!r.winner_team && r.placements.length > 0 && r.rating_status !== 'applied' && <PlacementList r={r} />}
      {statusText && <p className="m-0 text-sm text-muted">{statusText}</p>}
      {r.rating_status === 'applied' && (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-faint">
            레이팅 변동{r.season ? ` · ${r.season.name}` : ''}
          </span>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="py-2 pr-3 font-medium">참가자</th>
                  <th className="py-2 pr-3 font-medium">{r.winner_team ? '팀' : '순위'}</th>
                  <th className="py-2 pr-3 text-right font-medium">레이팅</th>
                  <th className="py-2 text-right font-medium">변동</th>
                </tr>
              </thead>
              <tbody>
                {r.rating_changes.map((c) => (
                  <tr key={c.user.id} className="border-t border-hair">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-1.5">
                        <Link href={routes.member(c.user.id)} className="truncate font-semibold text-text no-underline hover:underline">
                          {c.user.nickname}
                        </Link>
                        <span className="font-display text-[11px] text-faint">K {c.k_factor}</span>
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {c.team ? (
                        <span className={cn('font-display text-xs font-bold tracking-[0.08em]', TEAM_TONE[c.team].ink)}>{TEAM_LABEL[c.team].tag}</span>
                      ) : c.placement !== null ? (
                        <span className="font-display">{c.placement}위</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-display tabular-nums">
                      {c.elo_before} → {c.elo_after}
                    </td>
                    <td className={cn('py-2 text-right font-display font-bold tabular-nums', c.delta >= 0 ? 'text-accent-ink' : 'text-orange-text')}>
                      {signed(c.delta)}
                      <span className="sr-only">{c.outcome === 'win' ? ' 승' : ' 패'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {r.rating_status === 'applied' && r.rating_changes.length === 0 && <Badge>반영된 참가자가 없어요</Badge>}
    </div>
  );
}
