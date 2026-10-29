'use client';

import {
  Uuid,
  type GetUserProfileResponse,
  type ProfileTierCard,
  type RecentLolMatch,
} from '@gcd/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, InlineError } from '@/components/ui/controls';
import { RefreshIcon } from '@/components/ui/icons';
import { EmptyState, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage, errorMessageWithRetry } from '@/lib/errors';
import { formatAgo, formatDuration, formatFull, formatSyncedAt, formatYearMonth } from '@/lib/format';
import { groupRiotAccounts, hasPendingSync, steamAccount } from '@/lib/game-accounts';
import { POSITION_META, PROVIDER_META } from '@/lib/games';
import { useSyncGameAccount, useUserProfile } from '@/lib/hooks/game-accounts';
import { useNow } from '@/lib/hooks/use-now';
import { routes } from '@/lib/routes';
import { TIER_META, lolRankSub, tftRankSub, tierLabel, tierMark } from '@/lib/tiers';

/**
 * 멤버 프로필(목업 Profile, 계약 8·12절). 대표 라이엇 계정 기준 티어·주 포지션·최근 솔로 랭크.
 * 내전 레이팅·그래프·최근 내전(S3), 뱃지(P2)는 응답이 null이라 빈 상태 카드.
 */
export function ProfileView({ id }: { id: string }) {
  const validId = Uuid.safeParse(id).success;
  const q = useUserProfile(id, validId);
  const now = useNow(30_000);

  if (!validId || (isApiError(q.error) && (q.error.code === 'NOT_FOUND' || q.error.code === 'VALIDATION_FAILED'))) {
    return (
      <EmptyState
        mark="?"
        title="멤버를 찾을 수 없어요"
        description="주소가 잘못됐거나 탈퇴한 멤버예요."
        action={
          <Link href={routes.home()} className="text-sm font-semibold">
            홈으로
          </Link>
        }
      />
    );
  }
  if (q.isPending) return <ProfileSkeleton />;
  if (q.isError) {
    return (
      <ErrorState
        message={isApiError(q.error) ? errorMessage(q.error.code) : errorMessage('NETWORK_ERROR')}
        onRetry={() => void q.refetch()}
      />
    );
  }
  const p = q.data;
  return (
    <>
      <ProfileBanner p={p} now={now} />
      {p.is_self && p.game_accounts.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-accent/30 bg-accent/8 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">게임 계정을 연동하면 티어와 최근 전적이 프로필에 나와요.</span>
          <Link href={routes.settings()} className="font-semibold">
            설정에서 계정 연동 →
          </Link>
        </div>
      )}
      <SummaryCards p={p} now={now} />
      <div className="flex flex-wrap items-stretch gap-5">
        <Panel eyebrow="RATING HISTORY" title="내전 레이팅 변동" className="flex-[2_1_540px]">
          <EmptyState mark="ELO" title="내전 기록은 곧 열려요" description="내전 결과가 쌓이면 레이팅 변동 그래프가 여기에 그려져요." />
        </Panel>
        <Panel eyebrow="BADGES" title="뱃지" className="flex-[1_1_300px]">
          <EmptyState mark="★" title="아직 뱃지가 없어요" description="뱃지는 이후 업데이트에서 열려요." />
        </Panel>
      </div>
      <div className="flex flex-wrap items-stretch gap-5">
        <Panel eyebrow="SCRIMS" title="최근 내전" className="flex-[1_1_420px]">
          <EmptyState mark="VS" title="내전 기록은 곧 열려요" description="참가한 내전과 레이팅 변동이 여기에 쌓여요." />
        </Panel>
        <RecentMatchesPanel p={p} now={now} />
      </div>
    </>
  );
}

function Panel({
  eyebrow,
  title,
  right,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-surface p-[22px] shadow-[inset_0_1px_0_var(--hi)]',
        className,
      )}
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

// -----------------------------------------------------------------------------
// 배너
// -----------------------------------------------------------------------------

function ProfileBanner({ p, now }: { p: GetUserProfileResponse; now: number | null }) {
  const firstPos = p.main_position?.positions[0]?.position;
  const initial = Array.from(p.user.nickname.trim())[0] ?? '?';
  return (
    <section className="relative overflow-hidden rounded-[24px] border border-hero-line bg-hero">
      <svg aria-hidden="true" viewBox="0 0 1200 140" preserveAspectRatio="xMidYMid slice" className="block h-[140px] w-full">
        <defs>
          <pattern id="profile-stripes" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
            <line x1="0" y1="0" x2="0" y2="12" strokeOpacity="0.05" strokeWidth="5" className="stroke-overlay" />
          </pattern>
        </defs>
        <rect width="1200" height="140" className="fill-hero-3" />
        <polygon points="760,0 1200,0 1200,140 700,140" fillOpacity="0.22" className="fill-blue" />
        <polygon points="900,0 960,0 900,140 840,140" fillOpacity="0.85" className="fill-accent" />
        <rect width="1200" height="140" fill="url(#profile-stripes)" />
        {firstPos && (
          <text
            x="1170"
            y="118"
            textAnchor="end"
            fontSize="64"
            fontWeight="700"
            fillOpacity="0.06"
            className="fill-overlay font-display"
          >
            {POSITION_META[firstPos].banner}
          </text>
        )}
      </svg>
      <div className="relative -mt-11 flex flex-wrap items-end gap-5 px-5 pb-6 md:px-7">
        {p.user.avatar_url ? (
          // 디스코드 CDN 이미지
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.user.avatar_url} alt="" width={96} height={96} className="size-24 rounded-[28px] border-4 border-hero object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-24 items-center justify-center rounded-[28px] border-4 border-hero bg-avatar-deep text-4xl font-bold text-blue-ink"
          >
            {initial}
          </span>
        )}
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 text-[28px] font-bold tracking-[-0.03em]">{p.user.nickname}</h1>
            <span className="rounded-[7px] bg-chip px-2 py-[3px] text-xs text-text-2">
              {p.user.role === 'admin' ? '운영진' : '멤버'} · {formatYearMonth(p.user.joined_at)} 가입
            </span>
          </div>
          <LinkChips p={p} />
        </div>
        {p.is_self && <SelfRefresh p={p} now={now} />}
      </div>
    </section>
  );
}

function Chip({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[7px] rounded-[10px] border px-[11px] py-1.5 text-[13px]',
        on ? PROVIDER_META.riot.chip : 'border-line-3 bg-hair-2 text-muted',
      )}
    >
      <span aria-hidden="true" className={cn('size-[7px] rounded-full', on ? PROVIDER_META.riot.dot : 'bg-faint')} />
      {children}
    </span>
  );
}

function LinkChips({ p }: { p: GetUserProfileResponse }) {
  const riot = groupRiotAccounts(p.game_accounts);
  const steam = steamAccount(p.game_accounts);
  return (
    <ul aria-label="연동 계정" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {riot.map((g) => (
        <li key={g.id}>
          <Chip on>
            라이엇 {g.display_name}
            {g.is_primary && riot.length > 1 && <span className="font-semibold">· 대표</span>}
          </Chip>
        </li>
      ))}
      {steam && (
        <li>
          <Chip on>스팀 연동됨</Chip>
        </li>
      )}
      {riot.length === 0 && !steam && (
        <li>
          <Chip on={false}>연동한 계정이 없어요</Chip>
        </li>
      )}
      <li>
        <Chip on={p.user.discord_linked}>{p.user.discord_linked ? '디스코드 연동' : '디스코드 미연동'}</Chip>
      </li>
    </ul>
  );
}

/** 「지금 갱신 · 오늘 N회 남음」 — 대표 라이엇 lol 행, 없으면 스팀 행(계약 8절 마지막 줄) */
function SelfRefresh({ p, now }: { p: GetUserProfileResponse; now: number | null }) {
  const sync = useSyncGameAccount();
  const quota = p.sync_quota;
  const lolTier = p.tiers.find((t) => t.game === 'lol');
  const target = lolTier?.game_account_id ?? steamAccount(p.game_accounts)?.id ?? null;
  const targetRow = p.game_accounts.find((a) => a.id === target);
  const busy = hasPendingSync(p.game_accounts.filter((a) => a.id === target || a.display_name === targetRow?.display_name));
  const syncedAt = targetRow?.sync.synced_at ?? null;

  if (!target || !quota) {
    return (
      <Link href={routes.settings()} className="self-center text-sm font-semibold">
        설정에서 계정 연동 →
      </Link>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1.5 md:items-end">
      <Button
        size="lg"
        onClick={() => sync.mutate(target)}
        disabled={busy || sync.isPending || quota.remaining <= 0}
        className="border-hero-line-2 bg-surface"
      >
        <RefreshIcon size={16} className={busy || sync.isPending ? 'animate-spin' : undefined} />
        {busy ? '갱신 중…' : '지금 갱신'}
      </Button>
      <span className="text-xs text-faint">
        {syncedAt && now ? `${formatSyncedAt(syncedAt, now)} 갱신 · ` : ''}오늘 {quota.remaining}회 남음
      </span>
      {sync.isError && (
        <InlineError>
          {isApiError(sync.error) ? errorMessageWithRetry(sync.error.code, sync.error.retryAfterSec) : errorMessage('NETWORK_ERROR')}
        </InlineError>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 요약 카드 4개
// -----------------------------------------------------------------------------

function HexMark({ mark, className }: { mark: string; className: string }) {
  return (
    <svg aria-hidden="true" width="44" height="48" viewBox="0 0 44 48" className={cn('shrink-0', className)}>
      <path d="M22 2 42 13v22L22 46 2 35V13z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="2" />
      <text x="22" y="29" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" className="font-display">
        {mark}
      </text>
    </svg>
  );
}

function SummaryCard({ mark, tone, label, value, sub }: { mark: string; tone: string; label: ReactNode; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3.5 rounded-[18px] border border-line bg-surface p-[18px] shadow-[inset_0_1px_0_var(--hi)]">
      <HexMark mark={mark} className={tone} />
      <div className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-xs text-faint">{label}</span>
        <span className="truncate text-lg font-bold tracking-[-0.01em]">{value}</span>
        <span className="text-xs text-muted">{sub}</span>
      </div>
    </div>
  );
}

function TierSummary({
  card,
  label,
  isSelf,
  game,
  now,
}: {
  card: ProfileTierCard | undefined;
  label: string;
  isSelf: boolean;
  game: 'lol' | 'tft';
  now: number | null;
}) {
  if (!card) {
    return (
      <SummaryCard
        mark="—"
        tone="text-faint"
        label={label}
        value={<span className="text-muted">미연동</span>}
        sub={isSelf ? <Link href={routes.settings()}>설정에서 라이엇 ID 연동</Link> : '라이엇 계정을 연동하지 않았어요'}
      />
    );
  }
  if (!card.rank) {
    return <SummaryCard mark="…" tone="text-faint" label={label} value={<span className="text-muted">동기화 대기 중</span>} sub="티어를 가져오는 중이에요" />;
  }
  const r = card.rank;
  return (
    <SummaryCard
      mark={tierMark(r)}
      tone={TIER_META[r.tier].text}
      label={
        <>
          {label}
          {card.synced_at && now && (
            <time dateTime={card.synced_at} title={`${formatFull(card.synced_at)} 동기화`}>
              {' · '}
              {formatSyncedAt(card.synced_at, now)}
            </time>
          )}
        </>
      }
      value={tierLabel(r)}
      sub={game === 'lol' ? lolRankSub(r) : tftRankSub(r)}
    />
  );
}

function SummaryCards({ p, now }: { p: GetUserProfileResponse; now: number | null }) {
  const lol = p.tiers.find((t) => t.game === 'lol');
  const tft = p.tiers.find((t) => t.game === 'tft');
  const mp = p.main_position;
  const top = mp?.positions[0];
  return (
    <section aria-label="게임별 요약" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <TierSummary card={lol} label="롤 솔로 랭크" isSelf={p.is_self} game="lol" now={now} />
      <TierSummary card={tft} label="롤체 랭크" isSelf={p.is_self} game="tft" now={now} />
      {mp && top ? (
        <SummaryCard
          mark={POSITION_META[top.position].banner.split(' ')[0]!.slice(0, 3)}
          tone="text-blue-ink"
          label="주 포지션"
          value={mp.positions.map((x) => POSITION_META[x.position].ko).join(' / ')}
          sub={`솔로 랭크 최근 ${mp.sample_size}경기 기준 ${POSITION_META[top.position].ko} ${Math.round(top.ratio * 100)}%`}
        />
      ) : (
        <SummaryCard
          mark="—"
          tone="text-faint"
          label="주 포지션"
          value={<span className="text-muted">기록 없음</span>}
          sub={p.tiers.length ? '최근 솔로 랭크 경기가 쌓이면 나와요' : '라이엇 ID를 연동하면 나와요'}
        />
      )}
      <SummaryCard mark="#" tone="text-accent-ink" label="내전 레이팅" value={<span className="text-muted">준비 중</span>} sub="내전 기록은 곧 열려요" />
    </section>
  );
}

// -----------------------------------------------------------------------------
// 최근 솔로 랭크
// -----------------------------------------------------------------------------

function RecentMatchesPanel({ p, now }: { p: GetUserProfileResponse; now: number | null }) {
  const rm = p.recent_matches;
  const right = rm?.synced_at ? (
    <time dateTime={rm.synced_at} title={formatFull(rm.synced_at)} className="text-xs text-faint">
      라이엇 API · {now ? formatSyncedAt(rm.synced_at, now) : ''}
    </time>
  ) : rm?.refresh_queued ? (
    <span className="text-xs text-faint">갱신 중…</span>
  ) : null;

  return (
    <Panel eyebrow="RANKED SOLO" title="최근 솔로 랭크" right={right} className="flex-[1_1_420px]">
      {!rm ? (
        <EmptyState
          mark="LoL"
          title="라이엇 계정이 없어요"
          description={p.is_self ? '라이엇 ID를 연동하면 최근 솔로 랭크 전적이 여기에 나와요.' : '이 멤버는 라이엇 ID를 연동하지 않았어요.'}
          action={
            p.is_self ? (
              <Link href={routes.settings()} className="text-sm font-semibold">
                설정에서 계정 연동
              </Link>
            ) : undefined
          }
        />
      ) : rm.items.length === 0 ? (
        rm.refresh_queued ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="전적 불러오는 중">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[54px] rounded-[14px]" />
            ))}
            <p className="m-0 text-center text-xs text-faint">라이엇에서 전적을 가져오는 중이에요. 잠시 뒤 자동으로 갱신돼요.</p>
          </div>
        ) : (
          <EmptyState mark="0" title="최근 솔로 랭크 경기가 없어요" description="솔로 랭크를 플레이하면 여기에 나와요." />
        )
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rm.items.map((m) => (
            <MatchRow key={m.id} m={m} now={now} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function MatchRow({ m, now }: { m: RecentLolMatch; now: number | null }) {
  return (
    <li
      className={cn(
        'grid min-h-[54px] grid-cols-[4px_38px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[14px] px-3',
        m.win ? 'bg-accent/4' : 'bg-orange/4',
      )}
    >
      <span aria-hidden="true" className={cn('h-[34px] rounded-sm', m.win ? 'bg-accent' : 'bg-orange')} />
      <span className={cn('font-display text-[13px] font-bold', m.win ? 'text-accent-ink' : 'text-orange-text')}>
        {m.win ? 'WIN' : 'LOSS'}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{m.champion_name}</span>
        <span className="truncate text-xs text-faint">
          {m.position ? POSITION_META[m.position].ko : '포지션 없음'} ·{' '}
          <time dateTime={m.played_at} title={formatFull(m.played_at)}>
            {now ? formatAgo(m.played_at, now) : ''}
          </time>
        </span>
      </div>
      <span className="font-display text-sm font-semibold" aria-label={`${m.kills}킬 ${m.deaths}데스 ${m.assists}어시스트`}>
        {m.kills}/{m.deaths}/{m.assists}
      </span>
      <span className="w-11 text-right font-display text-xs text-faint">{formatDuration(m.duration_sec)}</span>
    </li>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="프로필 불러오는 중">
      <Skeleton className="h-[240px] rounded-[24px]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[86px] rounded-[18px]" />
        ))}
      </div>
      <Skeleton className="h-[260px] rounded-[20px]" />
    </div>
  );
}
