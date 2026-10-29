'use client';

import {
  RiotIdInput,
  type GameAccountView,
  type RankValue,
  type RiotLinkVerificationView,
  type SyncQuota,
} from '@gcd/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Badge, Button, ConfirmDialog, InlineError, Notice, Toast } from '@/components/ui/controls';
import { RefreshIcon, ShieldCheckIcon } from '@/components/ui/icons';
import { Card, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { SYNC_ERROR_MESSAGES, errorMessage, errorMessageWithRetry } from '@/lib/errors';
import { formatCountdown, formatFull, formatMonthDay, formatSyncedAt } from '@/lib/format';
import {
  groupRiotAccounts,
  hasSteamCallbackKeys,
  isVerificationExpired,
  parseSteamCallbackQuery,
  riotAccountsMax,
  riotAddState,
  steamAccount,
  unlinkPromotes,
  verificationRemainingSec,
  type RiotAccountGroup,
} from '@/lib/game-accounts';
import { PROVIDER_META } from '@/lib/games';
import {
  gameAccountKeys,
  useCancelRiotVerification,
  useConfirmRiotVerification,
  useLinkGameAccount,
  useMyGameAccounts,
  useSetPrimaryGameAccount,
  useSyncGameAccount,
  useUnlinkGameAccount,
} from '@/lib/hooks/game-accounts';
import { useNow } from '@/lib/hooks/use-now';
import { routes } from '@/lib/routes';
import {
  STEAM_POPUP_CLOSED_POLL_MS,
  STEAM_POPUP_FEATURES,
  STEAM_POPUP_WINDOW_NAME,
  browserChannelFactory,
  listenSteamLinkResult,
} from '@/lib/steam-link-popup';
import { TIER_META, tierLabel } from '@/lib/tiers';

function apiErrorText(err: unknown): string {
  if (isApiError(err)) return errorMessageWithRetry(err.code, err.retryAfterSec);
  return errorMessage('NETWORK_ERROR');
}

/**
 * 설정 「게임 계정 연동」 섹션(목업 Settings LINKED ACCOUNTS, 계약 12절).
 * 라이엇 ID마다 카드 1장(대표 먼저) → 진행 중 소유 확인 또는 「+ 부계정 추가」 → 스팀 카드.
 */
export function GameAccountsSection() {
  const q = useMyGameAccounts();
  const now = useNow(30_000);
  const [unlinkTarget, setUnlinkTarget] = useState<{ id: string; name: string; promotes: string | null } | null>(null);
  const unlink = useUnlinkGameAccount();
  const primary = useSetPrimaryGameAccount();
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  useSteamCallbackToast(setToast);

  const data = q.data;
  const groups = data ? groupRiotAccounts(data.accounts) : [];
  const steam = data ? steamAccount(data.accounts) : null;

  return (
    <Card aria-labelledby="linked-title">
      <div className="flex flex-col gap-1">
        <Eyebrow>LINKED ACCOUNTS</Eyebrow>
        <h2 id="linked-title" className="m-0 text-lg font-bold">
          게임 계정 연동
        </h2>
        <p className="m-0 text-[13px] text-muted">
          연동한 계정으로 티어, 전적, 플레이타임을 가져옵니다. 다른 사람 계정은 등록할 수 없도록 소유 확인을 거칩니다.
        </p>
      </div>

      {q.isPending ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="연동 계정 불러오는 중">
          <Skeleton className="h-[78px] rounded-2xl" />
          <Skeleton className="h-[78px] rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState message={apiErrorText(q.error)} onRetry={() => void q.refetch()} />
      ) : data ? (
        <>
          {primary.isError && <InlineError>{apiErrorText(primary.error)} 대표 계정을 원래대로 되돌렸어요.</InlineError>}
          {groups.map((g) => (
            <RiotAccountCard
              key={g.id}
              group={g}
              quota={data.sync_quota}
              now={now}
              onSetPrimary={() => primary.mutate(g.id)}
              primaryPending={primary.isPending && primary.variables === g.id}
              onUnlink={() =>
                setUnlinkTarget({
                  id: g.id,
                  name: g.display_name,
                  promotes: unlinkPromotes(groups, g.id)?.display_name ?? null,
                })
              }
            />
          ))}
          <RiotAddArea
            state={riotAddState(data)}
            max={riotAccountsMax(data)}
            verification={data.riot_verification}
            hasRiot={groups.length > 0}
          />
          <SteamCard
            account={steam}
            quota={data.sync_quota}
            now={now}
            onUnlink={(a) => setUnlinkTarget({ id: a.id, name: a.display_name, promotes: null })}
            onToast={setToast}
          />
          <p className="m-0 text-xs text-faint">
            지금 갱신은 라이엇·스팀 합쳐 하루 {data.sync_quota.limit}회까지예요 · 오늘 {data.sync_quota.remaining}회 남음 ·
            자정(한국 시간)에 다시 채워져요.
          </p>
        </>
      ) : null}

      {unlink.isError && <InlineError>{apiErrorText(unlink.error)}</InlineError>}

      <ConfirmDialog
        open={unlinkTarget !== null}
        title="연동을 해제할까요?"
        description={
          unlinkTarget && (
            <>
              <strong className="text-text">{unlinkTarget.name}</strong> 연동을 해제하면 이 계정의 티어 기록과 최근 전적이
              함께 지워져요. 다시 연동하면 처음부터 다시 쌓여요.
              {unlinkTarget.promotes && (
                <>
                  <br />
                  대표 계정이라서 해제하면 <strong className="text-text">{unlinkTarget.promotes}</strong>이(가) 다음 대표가
                  돼요.
                </>
              )}
            </>
          )
        }
        confirmLabel="연동 해제"
        pending={unlink.isPending}
        onClose={() => setUnlinkTarget(null)}
        onConfirm={() => {
          if (!unlinkTarget) return;
          unlink.mutate(unlinkTarget.id, {
            onSuccess: () => setToast({ message: `${unlinkTarget.name} 연동을 해제했어요.`, tone: 'success' }),
            onSettled: () => setUnlinkTarget(null),
          });
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} onClose={closeToast} />
    </Card>
  );
}

/** 스팀 콜백 결과(?steam=linked / ?steam_error=…) → 토스트 후 쿼리 제거(계약 12절) */
function useSteamCallbackToast(setToast: (t: { message: string; tone: 'success' | 'error' }) => void) {
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    const search = window.location.search;
    if (!hasSteamCallbackKeys(search)) return;
    const result = parseSteamCallbackQuery(search);
    if (result?.kind === 'linked') {
      setToast({ message: '스팀 계정을 연동했어요. 플레이타임을 가져오는 중이에요.', tone: 'success' });
      void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
    } else if (result?.kind === 'error') {
      setToast({ message: errorMessage(result.code), tone: 'error' });
    }
    router.replace(routes.settings(), { scroll: false });
  }, [router, qc, setToast]);
}

// -----------------------------------------------------------------------------
// 공통 조각
// -----------------------------------------------------------------------------

function ProviderTile({ provider, label }: { provider: 'riot' | 'steam'; label?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-[46px] shrink-0 items-center justify-center rounded-[14px] font-display text-[11px] font-bold tracking-[0.06em]',
        label ? 'bg-accent/10 text-accent-ink text-xl' : PROVIDER_META[provider].tile,
      )}
    >
      {label ?? PROVIDER_META[provider].mark}
    </span>
  );
}

function AccountRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3.5 rounded-2xl border border-line-2 bg-surface-2 p-4', className)}>{children}</div>
  );
}

function syncLine(sync: GameAccountView['sync'], now: number | null): string {
  if (sync.state !== 'idle') return '동기화 중…';
  if (!sync.synced_at) return sync.error ? '동기화 실패' : '동기화 대기 중';
  return now ? `${formatSyncedAt(sync.synced_at, now)} 동기화` : '';
}

function RankPill({ game, rank }: { game: string; rank: RankValue | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-chip px-2 py-1 text-xs text-text-2">
      <span className="text-faint">{game}</span>
      {rank ? (
        <span className={cn('font-semibold', TIER_META[rank.tier].text)}>
          {tierLabel(rank)}
          {rank.tier !== 'UNRANKED' && <span className="font-normal text-muted"> {rank.lp} LP</span>}
        </span>
      ) : (
        <span className="text-muted">대기 중</span>
      )}
    </span>
  );
}

function SyncButton({
  accountId,
  quota,
  busy,
  label = '지금 갱신',
}: {
  accountId: string;
  quota: SyncQuota;
  busy: boolean;
  label?: string;
}) {
  const sync = useSyncGameAccount();
  const disabled = busy || sync.isPending || quota.remaining <= 0;
  return (
    <span className="flex flex-col items-start gap-1.5">
      <Button onClick={() => sync.mutate(accountId)} disabled={disabled}>
        <RefreshIcon size={15} className={busy || sync.isPending ? 'animate-spin' : undefined} />
        {busy ? '갱신 중…' : `${label} · 오늘 ${quota.remaining}회 남음`}
      </Button>
      {sync.isError && <InlineError>{apiErrorText(sync.error)}</InlineError>}
    </span>
  );
}

function SyncFailure({ sync }: { sync: GameAccountView['sync'] }) {
  if (!sync.error || sync.error.code === 'STEAM_PROFILE_PRIVATE') return null;
  const m = SYNC_ERROR_MESSAGES[sync.error.code];
  return (
    <Notice title={m.title}>
      {m.body}
      {sync.synced_at && ` 마지막 성공: ${formatFull(sync.synced_at)}.`}
    </Notice>
  );
}

// -----------------------------------------------------------------------------
// 라이엇
// -----------------------------------------------------------------------------

function RiotAccountCard({
  group,
  quota,
  now,
  onSetPrimary,
  primaryPending,
  onUnlink,
}: {
  group: RiotAccountGroup;
  quota: SyncQuota;
  now: number | null;
  onSetPrimary: () => void;
  primaryPending: boolean;
  onUnlink: () => void;
}) {
  const busy = group.sync.state !== 'idle';
  return (
    <AccountRow className={group.is_primary ? 'border-accent/35' : undefined}>
      <div className="flex flex-wrap items-center gap-3.5">
        <ProviderTile provider="riot" />
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
            <span className="break-all">{group.display_name}</span>
            {group.is_primary && <Badge tone="accent">대표</Badge>}
          </span>
          <span className="text-[13px] text-muted">
            라이엇 ID · 롤, 롤체 공통
            {(() => {
              const s = syncLine(group.sync, now);
              return s ? (
                <>
                  {' · '}
                  <time dateTime={group.sync.synced_at ?? undefined} title={group.sync.synced_at ? formatFull(group.sync.synced_at) : undefined}>
                    {s}
                  </time>
                </>
              ) : null;
            })()}
          </span>
        </div>
        <Badge tone="cyan" icon="check">
          소유 확인
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="티어 요약">
        <RankPill game="롤 솔로" rank={group.lolRank} />
        <RankPill game="롤체" rank={group.tftRank} />
      </div>

      <SyncFailure sync={group.sync} />

      <div className="flex flex-wrap items-start gap-2">
        <SyncButton accountId={group.id} quota={quota} busy={busy} />
        {!group.is_primary && (
          <Button onClick={onSetPrimary} disabled={primaryPending}>
            {primaryPending ? '지정 중…' : '대표로 지정'}
          </Button>
        )}
        <Button variant="ghost" onClick={onUnlink} className="ml-auto">
          연동 해제
        </Button>
      </div>
      {!group.is_primary && (
        <p className="m-0 text-xs text-faint">부계정이에요. 프로필 티어·최근 전적과 랭킹은 대표 계정 기준이에요.</p>
      )}
    </AccountRow>
  );
}

function RiotAddArea({
  state,
  max,
  verification,
  hasRiot,
}: {
  state: ReturnType<typeof riotAddState>;
  max: number;
  verification: RiotLinkVerificationView | null;
  hasRiot: boolean;
}) {
  const [open, setOpen] = useState(false);
  // 소유 확인 카드로 넘어가면 입력 폼은 닫는다. 확인이 끝난 뒤 폼이 다시 열린 채 나타나지 않게 한다
  useEffect(() => {
    if (state === 'verifying') setOpen(false);
  }, [state]);

  if (state === 'verifying' && verification) return <RiotVerificationCard v={verification} isSub={hasRiot} />;

  if (state === 'first') {
    return (
      <AccountRow>
        <div className="flex flex-wrap items-center gap-3.5">
          <ProviderTile provider="riot" />
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
            <span className="text-[15px] font-bold">라이엇 ID 연동</span>
            <span className="text-[13px] text-muted">롤 · 롤체 티어와 최근 솔로 랭크 전적을 가져와요</span>
          </div>
        </div>
        <RiotIdForm />
      </AccountRow>
    );
  }

  if (open && state === 'more') {
    return (
      <AccountRow>
        <div className="flex flex-wrap items-center gap-3.5">
          <ProviderTile provider="riot" label="+" />
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
            <span className="text-[15px] font-bold">부계정 추가</span>
            <span className="text-[13px] text-muted">추가할 라이엇 ID를 입력해 주세요</span>
          </div>
        </div>
        <RiotIdForm onCancel={() => setOpen(false)} />
      </AccountRow>
    );
  }

  const full = state === 'full';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={() => setOpen(true)} disabled={full} aria-describedby={full ? 'riot-full-hint' : undefined}>
        + 부계정 추가
      </Button>
      {full && (
        <span id="riot-full-hint" className="text-xs text-faint">
          라이엇 ID는 최대 {max}개까지 연동할 수 있어요. 추가하려면 하나를 해제해 주세요.
        </span>
      )}
    </div>
  );
}

function RiotIdForm({ onCancel, initial = '' }: { onCancel?: () => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const link = useLinkGameAccount();
  const inputId = useId();
  const errId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = RiotIdInput.safeParse(value);
    if (!parsed.success) {
      setLocalError('게임이름#태그 형식으로 입력해 주세요. 예: 새벽감자#KR1');
      return;
    }
    setLocalError(null);
    link.mutate({ provider: 'riot', riot_id: value.trim() });
  };
  const err = localError ?? (link.isError ? apiErrorText(link.error) : null);

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor={inputId} className="text-[13px] font-semibold text-text-2">
        라이엇 ID
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="게임이름#태그"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? errId : undefined}
          className="h-[46px] min-w-0 flex-[1_1_220px] rounded-[14px] border border-line-3 bg-bg px-4 text-[15px] text-text outline-none focus:border-accent"
        />
        <Button type="submit" variant="primary" size="lg" disabled={link.isPending || value.trim() === ''}>
          {link.isPending ? '확인 중…' : '다음'}
        </Button>
        {onCancel && (
          <Button variant="ghost" size="lg" onClick={onCancel} disabled={link.isPending}>
            취소
          </Button>
        )}
      </div>
      <span className="text-xs text-faint">게임 클라이언트 프로필에 보이는 이름과 # 뒤 태그를 그대로 입력해 주세요.</span>
      {err && (
        <div id={errId}>
          <InlineError>{err}</InlineError>
        </div>
      )}
    </form>
  );
}

/** 소유 확인 단계(목업 「소유 확인 1 / 2 단계」 카드) */
function RiotVerificationCard({ v, isSub }: { v: RiotLinkVerificationView; isSub: boolean }) {
  const now = useNow(1_000);
  const confirm = useConfirmRiotVerification();
  const cancel = useCancelRiotVerification();
  const link = useLinkGameAccount();
  const remaining = now === null ? null : verificationRemainingSec(v, now);
  const serverExpired = isApiError(confirm.error) && confirm.error.code === 'OWNERSHIP_CHECK_EXPIRED';
  const expired = serverExpired || (now !== null && isVerificationExpired(v, now));

  // 새 확인(다시 시작)으로 바뀌면 이전 확인의 오류를 지운다
  const { reset } = confirm;
  useEffect(() => reset(), [v.id, reset]);

  // 다시 시작·다른 아이콘 받기 = 같은 라이엇 ID로 새 확인 시작(서버가 기존 pending을 cancelled로 바꾸고 새 아이콘 지정, D65)
  const restart = () => link.mutate({ provider: 'riot', riot_id: v.display_name });
  const busy = confirm.isPending || cancel.isPending || link.isPending;

  let confirmError: string | null = null;
  if (confirm.isError && !serverExpired) {
    const e = confirm.error;
    confirmError = isApiError(e) ? errorMessageWithRetry(e.code, e.retryAfterSec) : errorMessage('NETWORK_ERROR');
  }

  return (
    <AccountRow className="border-accent/30">
      <div className="flex flex-wrap items-center gap-3.5">
        <ProviderTile provider="riot" label="+" />
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
          <span className="text-[15px] font-bold">
            <span className="break-all">{v.display_name}</span>{' '}
            {isSub && <span className="text-[13px] font-medium text-muted">부계정 추가</span>}
          </span>
          {/* P5: 아이콘 변경 = 1/2, 대조 중 = 2/2 */}
          <span className="text-[13px] text-muted" aria-live="polite">
            소유 확인 {confirm.isPending ? '2 / 2 단계 · 아이콘 대조 중' : '1 / 2 단계'}
          </span>
        </div>
        <span
          role="timer"
          aria-label={expired ? '확인 시간 종료' : `남은 시간 ${formatCountdown(remaining ?? 0)}`}
          className={cn('font-display text-xl font-bold tabular-nums', expired ? 'text-faint' : 'text-orange-text')}
        >
          {remaining === null ? '--:--' : formatCountdown(expired ? 0 : remaining)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-[18px] rounded-[14px] border border-line-2 bg-bg p-4">
        <div className="relative flex size-16 shrink-0 items-center justify-center rounded-2xl border border-hero-line-2 bg-hero">
          {v.icon_image_url ? (
            // Data Dragon 이미지. 원격 도메인 설정 없이 쓰기 위해 img
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.icon_image_url} alt={`프로필 아이콘 #${v.icon_id}`} width={64} height={64} className="size-16 rounded-2xl" />
          ) : (
            <ShieldCheckIcon size={34} className="text-accent-ink" />
          )}
          <span className="absolute -bottom-2.5 rounded-md border border-line-3 bg-surface-3 px-1.5 font-display text-[10px] font-bold text-text">
            #{v.icon_id}
          </span>
        </div>
        <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
          {expired ? (
            <>
              <span className="text-sm font-semibold">확인 시간이 지났어요</span>
              <span className="text-xs text-muted">「다시 시작」을 누르면 새 아이콘 번호와 시간을 받아요.</span>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">게임 클라이언트에서 프로필 아이콘을 #{v.icon_id}(으)로 바꿔 주세요</span>
              <span className="text-xs text-muted">시간 안에 확인 버튼을 누르면 라이엇 API로 아이콘을 대조합니다.</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {expired ? (
            <Button variant="primary" size="lg" onClick={restart} disabled={busy}>
              {link.isPending ? '시작 중…' : '다시 시작'}
            </Button>
          ) : (
            <Button variant="primary" size="lg" onClick={() => confirm.mutate(v.id)} disabled={busy}>
              {confirm.isPending ? '확인 중…' : '바꿨어요, 확인'}
            </Button>
          )}
          <Button variant="ghost" size="lg" onClick={() => cancel.mutate(v.id)} disabled={busy}>
            {cancel.isPending ? '취소 중…' : '취소'}
          </Button>
        </div>
      </div>

      {confirmError && <InlineError>{confirmError}</InlineError>}
      {link.isError && <InlineError>{apiErrorText(link.error)}</InlineError>}
      {cancel.isError && <InlineError>{apiErrorText(cancel.error)}</InlineError>}
      {!expired && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-xs text-faint">확인이 끝나면 원래 아이콘으로 다시 바꿔도 돼요.</p>
          <button
            type="button"
            onClick={restart}
            disabled={busy}
            className="text-xs font-semibold text-accent-ink underline underline-offset-2 disabled:opacity-50"
          >
            {link.isPending ? '새 아이콘 받는 중…' : '이 아이콘이 없나요? 다른 아이콘 받기'}
          </button>
        </div>
      )}
    </AccountRow>
  );
}

// -----------------------------------------------------------------------------
// 스팀
// -----------------------------------------------------------------------------

type ToastFn = (t: { message: string; tone: 'success' | 'error' }) => void;

/**
 * 스팀 연동 팝업(S2 계약 9-2).
 * 1. 클릭 핸들러 안에서 동기적으로 빈 팝업을 연다(비동기 뒤에 열면 차단된다)
 * 2. 차단(null) → display=redirect로 요청하고 현재 창 이동(S1 흐름, /settings?steam=… 토스트)
 * 3. 열림 → display=popup으로 요청하고 팝업을 authorize_url로 보낸다. 실패하면 팝업을 닫고 오류 토스트
 * 4. 결과: BroadcastChannel + window message(같은 origin) 중 첫 메시지만 → 계정 목록 무효화 + 토스트
 * 5. 메시지 없이 팝업이 닫히면 목록을 한 번 다시 받고 버튼을 되살린다. 채널 리스너는 600초까지 유지
 */
function useSteamLinkPopup(onToast: ToastFn) {
  const link = useLinkGameAccount();
  const qc = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  const stopListening = useRef<(() => void) | null>(null);
  const closedWatch = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopWatch = useCallback(() => {
    if (closedWatch.current) clearInterval(closedWatch.current);
    closedWatch.current = null;
  }, []);

  useEffect(
    () => () => {
      stopListening.current?.();
      stopWatch();
    },
    [stopWatch],
  );

  const start = () => {
    stopListening.current?.();
    stopWatch();
    const popup = window.open('', STEAM_POPUP_WINDOW_NAME, STEAM_POPUP_FEATURES);

    if (!popup) {
      // 팝업 차단 → 같은 창 이동(S1 흐름 그대로)
      link.mutate(
        { provider: 'steam', display: 'redirect' },
        { onSuccess: (res) => res.provider === 'steam' && window.location.assign(res.authorize_url) },
      );
      return;
    }

    try {
      popup.document.title = '스팀 연동';
      popup.document.body.textContent = 'Steam 로그인 화면으로 이동하는 중이에요…';
    } catch {
      /* 이미 다른 오리진이면 무시 */
    }
    setWaiting(true);
    let received = false;
    stopListening.current = listenSteamLinkResult({
      target: window,
      origin: window.location.origin,
      createChannel: browserChannelFactory(),
      onResult: (msg) => {
        received = true;
        stopWatch();
        setWaiting(false);
        void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
        onToast(
          msg.status === 'linked'
            ? { message: '스팀 계정을 연동했어요. 플레이타임을 가져오는 중이에요.', tone: 'success' }
            : { message: errorMessage(msg.code), tone: 'error' },
        );
      },
    });

    link.mutate(
      { provider: 'steam', display: 'popup' },
      {
        onSuccess: (res) => {
          if (res.provider !== 'steam') return;
          // [API 연결] 실제: Steam OpenID → API 콜백 → /steam-link/complete?steam=… 목: 곧바로 완료 페이지
          popup.location.href = res.authorize_url;
          closedWatch.current = setInterval(() => {
            if (!popup.closed) return;
            stopWatch();
            setWaiting(false);
            // 메시지 없이 닫힘(사용자가 닫음 또는 COOP로 일찍 closed) → 한 번 재조회. 채널 리스너는 TTL까지 유지
            if (!received) void qc.invalidateQueries({ queryKey: gameAccountKeys.mine });
          }, STEAM_POPUP_CLOSED_POLL_MS);
        },
        onError: (err) => {
          popup.close();
          stopListening.current?.();
          setWaiting(false);
          onToast({ message: apiErrorText(err), tone: 'error' });
        },
      },
    );
  };

  return { start, link, waiting };
}

function SteamCard({
  account,
  quota,
  now,
  onUnlink,
  onToast,
}: {
  account: GameAccountView | null;
  quota: SyncQuota;
  now: number | null;
  onUnlink: (a: GameAccountView) => void;
  onToast: ToastFn;
}) {
  const { start, link, waiting } = useSteamLinkPopup(onToast);

  if (!account) {
    const redirectAttempt = link.variables?.provider === 'steam' && link.variables.display === 'redirect';
    const redirecting = link.isSuccess && redirectAttempt;
    const busy = link.isPending || waiting || redirecting;
    return (
      <AccountRow>
        <div className="flex flex-wrap items-center gap-3.5">
          <ProviderTile provider="steam" />
          <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
            <span className="text-[15px] font-bold">스팀</span>
            <span className="text-[13px] text-muted">보유 게임과 플레이타임을 가져와요 · 스팀 로그인으로 소유 확인</span>
          </div>
          <Button variant="primary" size="lg" onClick={start} disabled={busy}>
            {waiting ? '새 창에서 진행 중…' : busy ? '스팀으로 이동 중…' : 'Steam으로 로그인'}
          </Button>
        </div>
        {waiting && (
          <p className="m-0 text-xs text-faint" aria-live="polite">
            새 창에서 스팀 로그인을 마치면 이 화면이 자동으로 바뀌어요. 창이 보이지 않으면 다른 창 뒤에 있는지 확인해 주세요.
          </p>
        )}
        {/* 팝업 경로 실패는 토스트로 알린다. 같은 창 이동(팝업 차단) 실패만 카드 안에 */}
        {link.isError && redirectAttempt && <InlineError>{apiErrorText(link.error)}</InlineError>}
      </AccountRow>
    );
  }

  const isPrivate = account.sync.error?.code === 'STEAM_PROFILE_PRIVATE';
  const busy = account.sync.state !== 'idle';
  const count = account.steam_owned_game_count;
  const sl = syncLine(account.sync, now);

  return (
    <AccountRow>
      <div className="flex flex-wrap items-center gap-3.5">
        <ProviderTile provider="steam" />
        <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-0.5">
          <span className="break-all text-[15px] font-bold">{account.display_name}</span>
          <span className="text-[13px] text-muted">
            스팀 · {count === null ? '보유 게임 확인 전' : `보유 게임 ${count}개`}
            {sl && ` · ${sl}`}
          </span>
        </div>
        {isPrivate ? <Badge tone="orange">게임 정보 비공개</Badge> : <Badge tone="cyan" icon="check">소유 확인</Badge>}
      </div>

      {isPrivate ? (
        <Notice
          title="플레이타임을 가져오지 못했어요"
          action={<SyncButton accountId={account.id} quota={quota} busy={busy} label="다시 시도" />}
        >
          스팀 프로필 › 개인 정보 설정에서 <strong className="text-warn-text">게임 세부 정보</strong>를 공개로 바꾼 뒤 다시
          시도해 주세요.
          {account.sync.synced_at
            ? ` 그동안 마지막 성공 값(${formatMonthDay(account.sync.synced_at)})을 보여줍니다.`
            : ' 아직 가져온 플레이타임이 없어요.'}
        </Notice>
      ) : (
        <SyncFailure sync={account.sync} />
      )}

      <div className="flex flex-wrap items-start gap-2">
        {!isPrivate && <SyncButton accountId={account.id} quota={quota} busy={busy} />}
        <Button variant="ghost" onClick={() => onUnlink(account)} className="ml-auto">
          연동 해제
        </Button>
      </div>
    </AccountRow>
  );
}
