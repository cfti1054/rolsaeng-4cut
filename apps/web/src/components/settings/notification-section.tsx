'use client';

import type { NotificationSettings } from '@gcd/shared';
import { InlineError, Notice } from '@/components/ui/controls';
import { SwitchRow, apiErrorText } from '@/components/ui/form';
import { Card, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/lib/hooks/notification-settings';

/** 두 항목만(D259). notify_result·notify_waitlist는 발송 경로가 없어 그리지 않는다 */
const ROWS: { key: keyof Pick<NotificationSettings, 'scrim_start' | 'patch'>; label: string; desc: string }[] = [
  { key: 'scrim_start', label: '참가한 내전 시작 30분 전', desc: '디스코드 연동 시 DM' },
  { key: 'patch', label: '새 패치 요약', desc: '롤, 롤체 패치 노트 요약이 올라오면' },
];

/**
 * 「알림」 섹션(목업 Settings NOTIFICATIONS, 계약 S6 9·13절). 토글은 즉시 저장(낙관적 갱신, 실패하면 되돌림).
 * discord_linked false면 안내만 덧붙이고 토글은 그대로 동작한다.
 */
export function NotificationSection() {
  const q = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  return (
    <Card aria-labelledby="notify-title">
      <div className="flex flex-col gap-1">
        <Eyebrow>NOTIFICATIONS</Eyebrow>
        <h2 id="notify-title" className="m-0 text-lg font-bold">
          알림
        </h2>
      </div>
      {q.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="알림 설정 불러오는 중">
          <Skeleton className="h-[62px] rounded-[14px]" />
          <Skeleton className="h-[62px] rounded-[14px]" />
        </div>
      ) : q.isError ? (
        <ErrorState message={isApiError(q.error) ? errorMessage(q.error.code) : errorMessage('NETWORK_ERROR')} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          {!q.data.discord_linked && <Notice tone="info" title="디스코드로 로그인한 회원만 DM을 받아요" />}
          {ROWS.map((r) => (
            <SwitchRow
              key={r.key}
              label={r.label}
              desc={r.desc}
              checked={q.data[r.key]}
              disabled={update.isPending}
              onChange={() => update.mutate({ [r.key]: !q.data[r.key] })}
            />
          ))}
          {update.isError && <InlineError>{`저장하지 못해 이전 값으로 되돌렸어요. ${apiErrorText(update.error)}`}</InlineError>}
        </div>
      )}
    </Card>
  );
}
