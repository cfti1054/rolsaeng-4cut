'use client';

import { DASHBOARD_TOP_RANKERS_LIMIT, type DashboardNextScrim, type DashboardNowPlaying, type DashboardRecentResult, type DashboardTopRankers, type GetDashboardSummaryResponse, type ScrimSummary } from '@gcd/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Avatar, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { CapacityPips } from '@/components/scrims/scrim-bits';
import { isApiError } from '@/lib/api/client';
import { brand } from '@/lib/brand';
import { cn } from '@/lib/cn';
import {
  HOME_STAT_GRID,
  MOBILE_TOP_RANKERS,
  homeStatCards,
  voiceStat,
  type HomeStatKey,
  eloBarPercent,
  joinedPercent,
  othersJoinedText,
  recentResultOutcome,
  recentResultStatus,
  scrimCapacityText,
  secondsUntil,
  topRankersTitle,
  type ResultPillTone,
} from '@/lib/dashboard';
import { errorMessage } from '@/lib/errors';
import { formatClock, formatFull, formatMonthDay } from '@/lib/format';
import { GAME_META, GAME_SCRIM_META } from '@/lib/games';
import { useMe } from '@/lib/hooks/auth';
import { useDashboardSummary } from '@/lib/hooks/rankings';
import { useNow } from '@/lib/hooks/use-now';
import { eloEmptyState, rankingStatusText, topRankersEmptyText } from '@/lib/rankings';
import { routes } from '@/lib/routes';
import { formatHms, scrimCardAction, scrimNeedLine, scrimWhen } from '@/lib/scrims';

const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' });

/**
 * 홈(목업 Main·MobileHome, 계약 10절). 값은 모두 GET /dashboard/summary.
 * 음성 접속·활동 멤버·지금 플레이 중은 community 블록 상태대로(S5). 스파크라인·증감, 패치·이벤트는 그리지 않는다(자료 없음).
 */
export function HomeView() {
  const me = useMe();
  const q = useDashboardSummary();
  const today = dateFmt
    .formatToParts(new Date())
    .filter((p) => p.type !== 'literal')
    .map((p) => p.value.toUpperCase());

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Eyebrow className="text-xs">
            <span suppressHydrationWarning>{`${today[0]} · ${today[1]} ${today[2]}`}</span>
          </Eyebrow>
          <h1 className="m-0 text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">{me.data ? <>안녕하세요, {me.data.nickname}님</> : <Skeleton className="h-9 w-64" />}</h1>
        </div>
        <Link
          href={routes.scrimNew()}
          className="hidden h-[46px] items-center rounded-[14px] bg-accent px-[18px] text-sm font-bold text-on-accent no-underline hover:text-on-accent md:flex"
        >
          + 내전/모집
        </Link>
      </header>

      {q.data ? (
        <Dashboard d={q.data} meId={me.data?.id} />
      ) : q.isError ? (
        <ErrorState message={isApiError(q.error) ? errorMessage(q.error.code) : errorMessage('NETWORK_ERROR')} onRetry={() => void q.refetch()} />
      ) : me.isError ? null : (
        // /me가 실패하면 요약은 시작되지 않는다. 오류·재시도는 앱 셸이 보여 준다
        <HomeSkeleton />
      )}
    </>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="홈 불러오는 중" className="flex flex-col gap-6">
      <Skeleton className="h-[300px] rounded-3xl" />
      <div className="grid grid-cols-2 gap-2.5 md:gap-4">
        <Skeleton className="h-[92px] rounded-[18px]" />
        <Skeleton className="h-[92px] rounded-[18px]" />
      </div>
      <Skeleton className="h-[320px] rounded-[20px]" />
    </div>
  );
}

function Dashboard({ d, meId }: { d: GetDashboardSummaryResponse; meId: string | undefined }) {
  return (
    <>
      <NextScrimHero next={d.next_scrim} />
      <StatsRow d={d} />
      {d.community.now_playing && <NowPlayingStrip np={d.community.now_playing} />}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[3fr_2fr]">
        <RecruitingPanel scrims={d.recruiting} />
        <div className="order-first min-w-0 xl:order-none">
          <TopRankersPanel top={d.top_rankers} state={d.top_rankers_state} minGames={d.rating_policy.min_games} meId={meId} />
        </div>
        <RecentResultsPanel results={d.recent_results} />
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// 다음 내전
// -----------------------------------------------------------------------------

const CHIP = 'rounded-lg bg-chip px-2.5 py-1 text-[13px] text-text-2';

function NextScrimHero({ next }: { next: DashboardNextScrim | null }) {
  return (
    <section aria-label="다음 내전/모집" data-theme="dark" className="relative overflow-hidden rounded-3xl border border-hero-line bg-hero text-text">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={brand.homeBanner} alt="" className="absolute inset-0 size-full object-cover object-[70%_center]" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-hero via-hero/90 to-hero/70 md:to-hero/25" />
      {next ? <NextScrimBody next={next} /> : <NoNextScrim />}
    </section>
  );
}

function NoNextScrim() {
  return (
    <div className="relative flex max-w-md flex-col items-start gap-3 px-6 py-8 md:px-8">
      <span className="rounded-lg bg-accent px-2.5 py-1 font-display text-xs font-bold tracking-[0.14em] text-on-accent">NEXT MATCH</span>
      <h2 className="m-0 text-2xl font-bold tracking-[-0.03em]">예정된 내전/모집이 없어요</h2>
      <Link href={routes.scrimNew()} className="flex h-[46px] items-center rounded-[14px] bg-accent px-[22px] text-sm font-bold text-on-accent no-underline hover:text-on-accent">
        내전/모집
      </Link>
    </div>
  );
}

function NextScrimBody({ next }: { next: DashboardNextScrim }) {
  const { scrim: s, participants, source } = next;
  const now = useNow(30_000);
  const need = scrimNeedLine(s);
  const label = GAME_SCRIM_META[s.game.code]?.label ?? s.game.name;
  const others = othersJoinedText(s.joined_count, participants.length);
  const href = routes.scrim(s.id);
  return (
    <div className="relative flex max-w-[640px] flex-col gap-[18px] p-5 md:px-8 md:py-[30px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-accent px-2.5 py-1 font-display text-xs font-bold tracking-[0.14em] text-on-accent">NEXT MATCH</span>
        <span className={CHIP}>{scrimCapacityText(label, s)}</span>
        {s.options.rated && <span className={CHIP}>시즌 ELO 반영</span>}
        {source === 'joined' && <span className={CHIP}>참가 중</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <h2 className="m-0 break-words text-[22px] font-bold tracking-[-0.03em] md:text-[28px]">{s.title}</h2>
        <span className="text-sm text-muted">
          {now !== null && `${scrimWhen(s.scheduled_at, now)} 시작 · `}방장 {s.host.nickname}
          {s.options.auto_balance && ' · 자동 밸런스'}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-x-7 gap-y-4">
        <Countdown at={s.scheduled_at} />
        <div className="flex min-w-[200px] flex-[1_1_200px] flex-col gap-2">
          <div className="flex justify-between gap-2 text-[13px]">
            <span className="text-muted">
              참가{' '}
              <span className="font-display font-semibold text-text" aria-label={`정원 ${s.capacity}명 중 ${s.joined_count}명`}>
                {s.joined_count} / {s.capacity}
              </span>
            </span>
            <span className={need.emphasis ? 'text-orange-ink-2' : 'text-muted'}>{need.text}</span>
          </div>
          <CapacityPips joined={s.joined_count} capacity={s.capacity} game={s.game.code} full={s.status === 'full'} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3.5 pt-1">
        <div className="flex min-w-0 items-center">
          {participants.map((u) => (
            <Avatar key={u.id} src={u.avatar_url} name={u.nickname} size={34} className="-mr-2 shadow-[0_0_0_3px_var(--hero)]" />
          ))}
          {others && <span className="ml-[18px] text-[13px] text-muted">{others}</span>}
        </div>
        <div className="flex gap-2.5">
          <Link href={href} className="flex h-[46px] items-center rounded-[14px] border border-hero-line-2 px-[18px] text-sm font-semibold text-text no-underline hover:text-text">
            상세 보기
          </Link>
          {source === 'recruiting' && (
            <Link href={href} className="flex h-[46px] items-center rounded-[14px] bg-accent px-[22px] text-sm font-bold text-on-accent no-underline hover:text-on-accent">
              참가하기
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/** 1초마다 다시 그리는 부분만 따로 둔다 */
function Countdown({ at }: { at: string }) {
  const now = useNow(1_000);
  const sec = secondsUntil(at, now);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-faint">시작까지</span>
      <span role="timer" className="font-display text-[34px] font-bold leading-none tracking-[0.02em] md:text-[46px]">
        {now === null ? '--:--:--' : sec === null ? '곧 시작' : formatHms(sec)}
      </span>
    </div>
  );
}

/** 통계 줄(계약 S5 10절). 봇 자료가 없는 칸은 숨기고, 카드 수(2–4)에 맞춰 열을 바꾼다 */
function StatsRow({ d }: { d: GetDashboardSummaryResponse }) {
  const cards = homeStatCards(d.community);
  const voice = voiceStat(d.community.voice);
  const active = d.community.active_members;
  const render = (key: HomeStatKey, mobile: boolean) => {
    const hide = mobile ? 'flex' : 'hidden md:flex';
    switch (key) {
      case 'voice':
        return voice ? (
          <StatCard key={key} className={hide} label="음성 채널 접속" mobileLabel="음성 접속" value={voice.value} unit={voice.unit} dot="bg-accent" live={voice.live} note={voice.note} />
        ) : null;
      case 'recruiting':
        return <StatCard key={key} className={hide} label="모집 중인 내전/모집" mobileLabel="모집 중" value={String(d.stats.recruiting_scrims)} unit="건" dot="bg-cyan" />;
      case 'week':
        return <StatCard key={key} className={hide} label="이번 주 내전/모집" value={String(d.stats.scrims_this_week)} unit="경기" dot="bg-violet" />;
      case 'active':
        return active.state === 'ready' ? <StatCard key={key} className={hide} label="이번 주 활동 멤버" value={String(active.count)} unit="명" dot="bg-orange" /> : null;
    }
  };
  return (
    <section aria-label="요약" className={cn('grid grid-cols-2 gap-2.5 md:gap-4', HOME_STAT_GRID[cards.length])}>
      {cards.map((c) => render(c.key, c.mobile))}
    </section>
  );
}

function StatCard({
  label,
  mobileLabel,
  value,
  unit,
  dot,
  live,
  note,
  className,
}: {
  label: string;
  mobileLabel?: string;
  value: string;
  unit: string | null;
  dot: string;
  live?: boolean;
  note?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 flex-col gap-2 rounded-[18px] border border-line bg-surface px-4 py-3.5 shadow-[inset_0_1px_0_var(--hi)] md:px-5 md:py-[18px]', className)}>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted md:text-[13px]">
          <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', dot)} />
          {mobileLabel ? (
            <>
              <span className="truncate md:hidden">{mobileLabel}</span>
              <span className="hidden truncate md:inline">{label}</span>
            </>
          ) : (
            <span className="truncate">{label}</span>
          )}
        </span>
        {live && <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 font-display text-[10px] font-bold tracking-[0.1em] text-accent-ink md:text-[11px]">LIVE</span>}
      </span>
      <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-display text-[26px] font-bold leading-none md:text-[34px]">{value}</span>
        {unit && <span className="text-[13px] text-muted md:text-sm">{unit}</span>}
        {note && <span className="text-xs text-faint">{note}</span>}
      </span>
    </div>
  );
}

/** 「지금 플레이 중」(D219). 값이 있을 때만 그린다. 이름은 봇이 보낸 그대로 */
function NowPlayingStrip({ np }: { np: DashboardNowPlaying }) {
  return (
    <section aria-label="지금 플레이 중" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border border-line bg-surface px-4 py-3 shadow-[inset_0_1px_0_var(--hi)] md:px-5">
      <span className="flex items-center gap-2">
        <Eyebrow>NOW PLAYING</Eyebrow>
        <span className="text-[13px] font-bold">지금 플레이 중</span>
      </span>
      <ul className="m-0 flex min-w-0 flex-1 list-none flex-wrap gap-2 p-0">
        {np.items.map((it, i) => (
          <li key={`${it.name}-${i}`} className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-chip px-2.5 py-1 text-[13px] text-text-2">
            <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', it.game ? GAME_SCRIM_META[it.game]?.dot : 'bg-line-4')} />
            <span className="truncate">{it.name}</span>
            <span className="shrink-0 text-muted">· {it.count}명</span>
          </li>
        ))}
      </ul>
      <time dateTime={np.captured_at} title={formatFull(np.captured_at)} className="text-xs text-faint">
        {formatClock(np.captured_at)} 기준
      </time>
    </section>
  );
}

function Panel({ eyebrow, title, right, label, className, children }: { eyebrow: string; title: ReactNode; right?: ReactNode; label: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-[inset_0_1px_0_var(--hi)] md:p-[22px]', className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="m-0 text-base font-bold tracking-[-0.02em] md:text-lg">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-2xl border border-dashed border-line-3 bg-surface-2 px-4 py-7 text-center text-[13px] text-muted">{children}</p>;
}

// -----------------------------------------------------------------------------
// 모집 중
// -----------------------------------------------------------------------------

function RecruitingPanel({ scrims }: { scrims: readonly ScrimSummary[] }) {
  const now = useNow(60_000);
  return (
    <Panel
      eyebrow="RECRUITING"
      title="모집 중인 내전/모집"
      label="모집 중인 내전/모집"
      right={
        <Link href={routes.scrims()} className="shrink-0 text-[13px] font-semibold no-underline">
          전체 보기 →
        </Link>
      }
    >
      {scrims.length === 0 ? (
        <PanelEmpty>지금 참가할 수 있는 다른 내전/모집이 없어요</PanelEmpty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {scrims.map((s) => (
            <RecruitingRow key={s.id} s={s} now={now} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

const ROW_ACTION = {
  primary: 'bg-accent text-on-accent hover:text-on-accent',
  secondary: 'bg-line-2 text-text hover:text-text',
  mine: 'bg-surface text-accent-ink hover:text-accent-ink-hover',
} as const;

function RecruitingRow({ s, now }: { s: ScrimSummary; now: number | null }) {
  const meta = GAME_SCRIM_META[s.game.code];
  const need = scrimNeedLine(s);
  const action = scrimCardAction(s);
  const href = routes.scrim(s.id);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-line bg-surface-2 p-3.5">
      <span aria-hidden="true" className={cn('flex size-12 shrink-0 items-center justify-center rounded-[14px] font-display text-sm font-bold', meta?.tile)}>
        {meta?.abbr}
      </span>
      <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1">
        <Link href={href} className="truncate text-[15px] font-semibold text-text no-underline hover:text-text hover:underline">
          {s.title}
        </Link>
        <span className="text-[13px] text-muted">
          {now !== null && `${scrimWhen(s.scheduled_at, now)} · `}방장 {s.host.nickname} · <span className={need.emphasis ? 'text-orange-ink-2' : undefined}>{need.text}</span>
        </span>
      </div>
      <div className="flex min-w-[96px] flex-[1_1_96px] flex-col gap-1.5 sm:flex-[0_0_120px]">
        <span className="text-right font-display text-sm font-semibold" aria-label={`정원 ${s.capacity}명 중 ${s.joined_count}명 참가`}>
          {s.joined_count} / {s.capacity}
        </span>
        <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-[3px] bg-line-2">
          <div className={cn('h-full rounded-[3px]', s.status === 'full' ? 'bg-orange' : meta?.dot)} style={{ width: `${joinedPercent(s)}%` }} />
        </div>
      </div>
      <Link
        href={href}
        aria-label={`${s.title} — ${action.label}`}
        className={cn('flex h-10 shrink-0 items-center rounded-xl px-4 text-[13px] font-bold no-underline', ROW_ACTION[action.tone])}
      >
        {action.label}
      </Link>
    </li>
  );
}

// -----------------------------------------------------------------------------
// 시즌 ELO TOP
// -----------------------------------------------------------------------------

const TOP_RANK_TONE = ['text-gold-text', 'text-silver-text', 'text-bronze-text'] as const;
const TOP_BAR_TONE = ['bg-gold-text', 'bg-silver-text', 'bg-bronze-text'] as const;

function TopRankersPanel({
  top,
  state,
  minGames,
  meId,
}: {
  top: DashboardTopRankers | null;
  state: 'ready' | 'no_season' | 'unavailable';
  minGames: number;
  meId: string | undefined;
}) {
  const topElo = top?.items[0]?.elo ?? 0;
  const status = top ? rankingStatusText({ synced_at: top.synced_at, stale: top.stale }) : null;
  return (
    <Panel
      eyebrow="LEADERBOARD"
      label="시즌 ELO 상위"
      title={
        <>
          <span className="md:hidden">{topRankersTitle(top, MOBILE_TOP_RANKERS)}</span>
          <span className="hidden md:inline">{topRankersTitle(top, DASHBOARD_TOP_RANKERS_LIMIT)}</span>
        </>
      }
      right={
        <Link href={routes.rankings(top ? { game: top.game } : {})} className="shrink-0 text-[13px] font-semibold no-underline">
          전체 →
        </Link>
      }
      className="h-full"
    >
      {state !== 'ready' || !top ? (
        <PanelEmpty>{topRankersEmptyText(state === 'unavailable' ? 'unavailable' : 'no_season')}</PanelEmpty>
      ) : top.items.length === 0 ? (
        <PanelEmpty>{eloEmptyState({ ...top, min_games: minGames })}</PanelEmpty>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
          {top.items.map((e, i) => (
            <li
              key={e.user.id}
              className={cn(
                'min-h-[52px] items-center gap-3 rounded-[14px] px-2.5',
                i < MOBILE_TOP_RANKERS ? 'flex' : 'hidden md:flex',
                e.user.id === meId ? 'bg-accent/8' : e.rank === 1 && 'bg-gold/8',
              )}
            >
              <span className={cn('w-5 font-display text-base font-bold', TOP_RANK_TONE[e.rank - 1] ?? 'text-faint')}>{e.rank}</span>
              <Avatar src={e.user.avatar_url} name={e.user.nickname} size={34} />
              <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
                <Link href={routes.member(e.user.id)} className="truncate text-sm font-semibold text-text no-underline hover:text-text hover:underline">
                  {e.user.nickname}
                </Link>
                <div aria-hidden="true" className="h-1 overflow-hidden rounded-sm bg-line-2">
                  <div className={cn('h-full rounded-sm', TOP_BAR_TONE[e.rank - 1] ?? 'bg-line-4')} style={{ width: `${eloBarPercent(e.elo, topElo)}%` }} />
                </div>
              </div>
              <span className="font-display text-base font-bold">{e.elo}</span>
            </li>
          ))}
        </ol>
      )}
      {top && top.items.length > 0 && (
        <span className="text-xs text-faint">
          {GAME_META[top.game]?.short ?? top.game}
          {status && !top.is_final && ` · ${status.text}`}
          {top.synced_at && top.is_final && ` · ${formatFull(top.synced_at).slice(0, 10)} 확정`}
        </span>
      )}
    </Panel>
  );
}

// -----------------------------------------------------------------------------
// 최근 내전 결과
// -----------------------------------------------------------------------------

const PILL_TONE: Record<ResultPillTone, string> = {
  pending: 'bg-orange/12 text-orange-ink-2',
  applied: 'bg-cyan/12 text-cyan-ink',
  none: 'bg-chip text-muted',
};

function OutcomeBar({ r }: { r: DashboardRecentResult }) {
  const o = recentResultOutcome(r);
  const cell = 'flex min-w-0 flex-1 items-center justify-center truncate px-1';
  return (
    <div className="flex h-7 flex-[0_0_170px] overflow-hidden rounded-lg font-display text-xs font-bold tracking-[0.06em]">
      {o.kind === 'team' ? (
        <>
          <span className={cn(cell, o.winner === 'blue' ? 'bg-blue text-on-accent' : 'bg-blue/12 text-blue-ink')}>{o.blue}</span>
          <span className={cn(cell, o.winner === 'orange' ? 'bg-team-red text-on-accent' : 'bg-team-red/12 text-team-red-ink')}>{o.orange}</span>
        </>
      ) : (
        <>
          <span className={cn(cell, 'bg-violet text-on-accent')}>{o.left}</span>
          <span className={cn(cell, 'bg-violet/12 text-violet-ink')}>{o.right}</span>
        </>
      )}
    </div>
  );
}

function RecentResultsPanel({ results }: { results: readonly DashboardRecentResult[] }) {
  return (
    <Panel eyebrow="MATCH HISTORY" title="최근 내전/모집 결과" label="최근 내전/모집 결과" className="xl:col-span-2">
      {results.length === 0 ? (
        <PanelEmpty>아직 입력된 내전/모집 결과가 없어요</PanelEmpty>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {results.map((r) => {
            const st = recentResultStatus(r);
            return (
              <li key={r.scrim_id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-line py-3">
                <time dateTime={r.at} title={formatFull(r.at)} className="flex flex-[0_0_56px] flex-col font-display">
                  <span className="text-[15px] font-bold">{formatMonthDay(r.at)}</span>
                  <span className="text-xs text-faint">{formatClock(r.at)}</span>
                </time>
                <Link href={routes.scrim(r.scrim_id)} className="min-w-0 flex-[1_1_180px] truncate text-sm font-medium text-text no-underline hover:text-text hover:underline">
                  {r.title}
                </Link>
                <OutcomeBar r={r} />
                <span className={cn('flex-[0_0_104px] rounded-full py-1 text-center text-xs font-semibold', PILL_TONE[st.tone])}>{st.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
