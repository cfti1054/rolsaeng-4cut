'use client';

import type { Me } from '@gcd/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ThemeSegment, ThemeToggleButton } from '@/components/theme/theme-controls';
import { LogoutIcon, ShieldIcon } from '@/components/ui/icons';
import { Avatar, ErrorState, Eyebrow, FullScreenLoading, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { mobileSeasonText, userEloText } from '@/lib/dashboard';
import { useLogout, useMe } from '@/lib/hooks/auth';
import { useDashboardSummary } from '@/lib/hooks/rankings';
import { routes } from '@/lib/routes';
import { navItems } from './nav-items';
import { SeasonCard } from './season-card';

/**
 * (main) 공통 레이아웃(계약 9-5).
 * - md 이상: 좌측 사이드바(로고, MENU 5개, STAFF(admin만), 테마 세그먼트, 시즌 카드, 사용자 카드)
 * - md 미만: 상단 헤더(로고 + 시즌·D-day + 테마 토글) + 하단 탭 5개
 * - 시즌 카드·내 ELO는 useDashboardSummary(홈과 같은 쿼리, D157). 요약이 실패해도 셸은 그대로 뜬다
 * - 세션 확인: useMe(토큰 없으면 refresh로 부팅). 실패하면 클라이언트가 /login으로 보낸다.
 * - needs_nickname_confirmation이면 /welcome?redirect={현재 경로}
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();

  const needsWelcome = me.data?.needs_nickname_confirmation === true;
  useEffect(() => {
    if (needsWelcome) {
      const search = typeof window === 'undefined' ? '' : window.location.search;
      router.replace(routes.welcome(`${pathname}${search}`));
    }
  }, [needsWelcome, pathname, router]);

  const authLost = isApiError(me.error) && me.error.status === 401;
  if (needsWelcome || authLost) return <FullScreenLoading label={authLost ? '로그인 화면으로 이동 중' : '불러오는 중'} />;

  return (
    <div className="min-h-dvh md:flex">
      <Sidebar me={me.data} pathname={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main className="flex-1 px-4 pb-32 pt-2 md:px-9 md:pb-14 md:pt-7">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
            {me.isError && !authLost ? (
              <ErrorState
                message={isApiError(me.error) ? errorMessage(me.error.code) : errorMessage('NETWORK_ERROR')}
                onRetry={() => void me.refetch()}
              />
            ) : null}
            {children}
          </div>
        </main>
      </div>
      <BottomTabs me={me.data} pathname={pathname} />
    </div>
  );
}

function Logo({ compact = false, sub = 'GAME CLUB' }: { compact?: boolean; sub?: string }) {
  return (
    <Link href={routes.home()} className="flex items-center gap-3 text-text no-underline hover:text-text">
      <span className="flex flex-col leading-tight">
        <span className={cn('font-bold tracking-[-0.02em]', compact ? 'text-base' : 'text-[17px]')}>롤생네컷</span>
        <Eyebrow className={compact ? 'text-[10px]' : undefined}>{sub}</Eyebrow>
      </span>
    </Link>
  );
}

function Sidebar({ me, pathname }: { me: Me | undefined; pathname: string }) {
  const items = navItems(me);
  return (
    <nav
      aria-label="주 메뉴"
      className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-[26px] overflow-y-auto border-r border-nav-line bg-nav px-3.5 py-[22px] md:flex"
    >
      <div className="px-2">
        <Logo />
      </div>

      <div className="flex flex-col gap-0.5">
        <Eyebrow className="px-3 pb-2">MENU</Eyebrow>
        {items.map((item) => {
          const active = item.match(pathname);
          const disabled = item.href === '#';
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm no-underline',
                active
                  ? 'bg-accent/8 font-semibold text-text hover:text-text'
                  : 'font-medium text-muted hover:text-text',
                disabled && 'pointer-events-none opacity-60',
              )}
            >
              <item.Icon className={active ? 'text-accent-ink' : undefined} strokeWidth={active ? 2 : 1.8} />
              {item.label}
            </Link>
          );
        })}
      </div>

      {me?.role === 'admin' && (
        <div className="flex flex-col gap-0.5">
          <Eyebrow className="px-3 pb-2">STAFF</Eyebrow>
          <Link
            href={routes.admin()}
            aria-current={pathname.startsWith('/admin') ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm no-underline',
              pathname.startsWith('/admin')
                ? 'bg-accent/8 font-semibold text-text hover:text-text'
                : 'font-medium text-muted hover:text-text',
            )}
          >
            <ShieldIcon />
            관리자
          </Link>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <ThemeSegment />
        <SeasonCard />
        <UserCard me={me} />
      </div>
    </nav>
  );
}

/** 사이드바 하단 사용자 카드. 누르면 위로 메뉴(내 프로필, 로그아웃)가 열린다. */
function UserCard({ me }: { me: Me | undefined }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logout = useLogout();
  const router = useRouter();
  const summary = useDashboardSummary();
  const eloText = userEloText(summary.data?.me ?? null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!me) {
    return (
      <div className="flex items-center gap-2.5 p-2" aria-hidden="true">
        <Skeleton className="size-[38px] rounded-full" />
        <span className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3 w-14" />
        </span>
      </div>
    );
  }

  const onLogout = () =>
    logout.mutate(undefined, {
      onSettled: () => router.replace(routes.login()),
    });

  return (
    <div ref={ref} className="relative">
      {open && (
        <div
          id="user-menu"
          role="menu"
          aria-label="계정 메뉴"
          className="absolute inset-x-0 bottom-full mb-2 flex flex-col gap-0.5 rounded-[14px] border border-line-2 bg-surface-3 p-1.5 shadow-[0_12px_30px_var(--shadow)]"
        >
          <Link
            role="menuitem"
            href={routes.member(me.id)}
            onClick={() => setOpen(false)}
            className="flex min-h-10 items-center gap-2.5 rounded-[10px] px-3 text-[13px] font-semibold text-text no-underline hover:bg-hover hover:text-text"
          >
            내 프로필
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={onLogout}
            disabled={logout.isPending}
            className="flex min-h-10 items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] font-semibold text-orange-text hover:bg-hover disabled:opacity-60"
          >
            <LogoutIcon size={16} />
            {logout.isPending ? '로그아웃 중…' : '로그아웃'}
          </button>
        </div>
      )}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'user-menu' : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-[14px] p-2 text-left text-text hover:bg-hover"
      >
        <Avatar
          src={me.avatar_url}
          name={me.nickname}
          className="shadow-[0_0_0_2px_var(--nav),0_0_0_4px_var(--accent)]"
        />
        <span className="flex min-w-0 flex-col leading-snug">
          <span className="truncate text-sm font-semibold">{me.nickname}</span>
          {eloText ? (
            <span className="truncate font-display text-xs text-muted">{eloText}</span>
          ) : (
            <span className="truncate text-xs text-muted">
              {me.role === 'admin' ? '운영진' : '멤버'}
              {me.discord_username ? ` · @${me.discord_username}` : ''}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

function MobileHeader() {
  // 요약을 받기 전·실패하면 기본 표시(GAME CLUB)
  const summary = useDashboardSummary();
  const sub = summary.data ? mobileSeasonText(summary.data.season) : undefined;
  return (
    <header className="flex items-center justify-between px-4 pb-3 pt-[18px] md:hidden">
      <Logo compact sub={sub} />
      <ThemeToggleButton />
    </header>
  );
}

function BottomTabs({ me, pathname }: { me: Me | undefined; pathname: string }) {
  const items = navItems(me);
  return (
    <nav
      aria-label="하단 탭"
      className="fixed inset-x-3 bottom-[max(18px,env(safe-area-inset-bottom))] z-40 grid grid-cols-5 rounded-[22px] border border-line-2 bg-surface-3 p-1.5 shadow-[0_12px_30px_var(--shadow)] md:hidden"
    >
      {items.map((item) => {
        const active = item.match(pathname);
        const disabled = item.href === '#';
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : undefined}
            className={cn(
              'flex min-h-[54px] flex-col items-center justify-center gap-[3px] rounded-2xl text-[11px] no-underline',
              active
                ? 'bg-accent font-bold text-on-accent hover:bg-accent hover:text-on-accent'
                : 'text-muted hover:text-text',
              disabled && 'pointer-events-none opacity-60',
            )}
          >
            <item.Icon size={20} strokeWidth={active ? 2 : 1.8} />
            {item.tabLabel}
          </Link>
        );
      })}
    </nav>
  );
}
