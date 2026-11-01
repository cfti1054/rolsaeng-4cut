'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, type ReactNode } from 'react';
import { Button, Toast } from '@/components/ui/controls';
import { ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { ADMIN_TAB_LABEL, rankingCacheText } from '@/lib/admin';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { isForbidden, useAdminOverview } from '@/lib/hooks/admin';
import { useMe } from '@/lib/hooks/auth';
import { ADMIN_TABS, routes, type AdminTab } from '@/lib/routes';
import { AdminApiKeysTab } from './admin-api-keys';
import { AdminAuditTab } from './admin-audit';
import { AdminMembersTab } from './admin-members';
import { AdminNewsTab } from './admin-news';
import { AdminResultsTab } from './admin-results';
import { AdminSeasonsTab } from './admin-seasons';

export type ToastState = { message: string; tone: 'success' | 'error' } | null;
export type ToastFn = (t: NonNullable<ToastState>) => void;

/**
 * /admin(목업 Admin, 계약 S6 13절·D273). 탭 6개(쿼리 ?tab=, 기본 results).
 * 권한: me.role이 admin이 아니면 FORBIDDEN 상태. 운영진 API가 403이면(강등 직후, D263) 훅이 ['me']를 다시 읽고 같은 상태를 그린다.
 * 목업 있는 블록: 결과·노쇼(통계 4칸·APPROVAL QUEUE·NO-SHOW), 멤버(MEMBERS), 공지·소식(NOTICE). 나머지는 목업 없음(기존 카드·표 패턴).
 */
export function AdminView() {
  const me = useMe();
  const sp = useSearchParams();
  const router = useRouter();
  const raw = sp.get('tab');
  const tab: AdminTab = (ADMIN_TABS as readonly string[]).includes(raw ?? '') ? (raw as AdminTab) : 'results';
  const isAdmin = me.data?.role === 'admin';
  const overview = useAdminOverview(isAdmin);
  const [toast, setToast] = useState<ToastState>(null);
  const onToast = useCallback<ToastFn>((t) => setToast(t), []);
  const closeToast = useCallback(() => setToast(null), []);

  if (me.isPending) return <Skeleton className="h-[420px] rounded-[20px]" />;
  if (!me.data) return null; // /me 실패는 앱 셸이 보여 준다
  if (!isAdmin || isForbidden(overview.error)) {
    return (
      <>
        <Head />
        <ErrorState message={errorMessage('FORBIDDEN')} />
      </>
    );
  }

  const cache = overview.data ? rankingCacheText(overview.data.ranking_cache) : null;
  return (
    <>
      <Head>
        {cache && (
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-muted">
            <span aria-hidden="true" className={cn('size-[7px] rounded-full', cache.warn ? 'bg-orange' : 'bg-accent')} />
            {cache.text}
            {cache.warn && <span className="sr-only">(갱신 실패 있음)</span>}
          </span>
        )}
      </Head>
      <nav aria-label="관리자 메뉴" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {ADMIN_TABS.map((t) => (
          <Button
            key={t}
            size="custom"
            variant="plain"
            aria-current={t === tab ? 'page' : undefined}
            onClick={() => router.replace(routes.admin(t), { scroll: false })}
            className={cn(
              'flex h-10 shrink-0 items-center whitespace-nowrap rounded-xl border px-3.5 text-[13px] font-semibold',
              t === tab ? 'border-accent/50 bg-accent/12 text-accent-ink' : 'border-line-2 bg-surface text-muted hover:text-text',
            )}
          >
            {ADMIN_TAB_LABEL[t]}
          </Button>
        ))}
      </nav>
      {tab === 'results' && <AdminResultsTab overview={overview} onToast={onToast} />}
      {tab === 'members' && <AdminMembersTab meId={me.data.id} onToast={onToast} />}
      {tab === 'news' && <AdminNewsTab onToast={onToast} />}
      {tab === 'seasons' && <AdminSeasonsTab />}
      {tab === 'api-keys' && <AdminApiKeysTab onToast={onToast} />}
      {tab === 'audit' && <AdminAuditTab />}
      <Toast message={toast?.message ?? null} tone={toast?.tone} onClose={closeToast} />
    </>
  );
}

function Head({ children }: { children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <Eyebrow className="text-xs">ADMIN</Eyebrow>
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">관리자</h1>
        <p className="m-0 text-sm text-muted">결과 승인, 노쇼 처리, 멤버 관리를 한 화면에서 합니다. 운영진(admin)만 볼 수 있어요.</p>
      </div>
      {children}
    </header>
  );
}
