'use client';

import { AdminAuditAction } from '@gcd/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/controls';
import { PanelHead, SelectInput } from '@/components/ui/form';
import { ChevronIcon } from '@/components/ui/icons';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { AUDIT_ACTION_LABEL } from '@/lib/admin';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { useAdminAuditLogs } from '@/lib/hooks/admin';

/** 감사 로그 탭(목업 없음, 계약 S6 10·13절). 행을 펼치면 details JSON */
export function AdminAuditTab() {
  const [action, setAction] = useState<AdminAuditAction | null>(null);
  const q = useAdminAuditLogs(action);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card aria-labelledby="audit-title">
      <PanelHead
        eyebrow="AUDIT LOG"
        title="감사 로그"
        id="audit-title"
        right={
          <SelectInput aria-label="행위 필터" value={action ?? ''} onChange={(e) => setAction(e.target.value ? AdminAuditAction.parse(e.target.value) : null)}>
            <option value="">전체 행위</option>
            {AdminAuditAction.options.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABEL[a]}
              </option>
            ))}
          </SelectInput>
        }
      />
      {q.isPending ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : q.isError ? (
        <ErrorState message={isApiError(q.error) ? errorMessage(q.error.code) : errorMessage('NETWORK_ERROR')} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState mark="LOG" title="기록이 없어요" />
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {items.map((a) => (
              <li key={a.id}>
                <details className="group rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                    <time dateTime={a.created_at} className="shrink-0 font-display text-xs text-faint">
                      {formatFull(a.created_at)}
                    </time>
                    <span className="shrink-0 rounded-md bg-chip px-1.5 py-0.5 text-[11px] font-bold text-text-2">{AUDIT_ACTION_LABEL[a.action]}</span>
                    <span className="min-w-0 flex-[1_1_200px] break-words text-[13px]">{a.summary}</span>
                    <span className="shrink-0 text-xs text-muted">{a.actor?.nickname ?? '알 수 없음'}</span>
                    <ChevronIcon dir="down" size={16} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
                  </summary>
                  <pre className="m-0 mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-bg p-3 font-mono text-xs text-text-2">
                    {JSON.stringify(a.details, null, 2)}
                  </pre>
                </details>
              </li>
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
