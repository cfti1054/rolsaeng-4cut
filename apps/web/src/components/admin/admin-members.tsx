'use client';

import { ADMIN_MEMBER_QUERY_MAX_LENGTH, AdminMemberSort, type AdminMemberItem, type UserRole } from '@gcd/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, ConfirmDialog } from '@/components/ui/controls';
import { PanelHead, SelectInput } from '@/components/ui/form';
import { LockIcon, SearchIcon } from '@/components/ui/icons';
import { Avatar, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { MEMBER_SORT_LABEL, ROLE_LOCKED_TEXT, memberStatusText } from '@/lib/admin';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatYearMonth } from '@/lib/format';
import { useAdminMembers, useChangeMemberRole } from '@/lib/hooks/admin';
import { useMyScrimRestriction } from '@/lib/hooks/scrims';
import { routes } from '@/lib/routes';
import type { ToastFn } from './admin-view';

/** 검색어 입력 뒤 요청까지 기다리는 시간(계약 S6 13절 「300ms debounce」) */
const SEARCH_DEBOUNCE_MS = 300;

const ROLE_LABEL: Record<UserRole, string> = { admin: '운영진', member: '멤버' };
/** 「~으로/~로」 조사(받침 있는 운영진 → 으로, 멤버 → 로) */
const ROLE_TO: Record<UserRole, string> = { admin: '운영진으로', member: '멤버로' };
const STATUS_TONE = {
  ok: { fg: 'text-text-2', dot: 'bg-cyan' },
  warn: { fg: 'text-orange-ink-2', dot: 'bg-orange' },
  off: { fg: 'text-faint', dot: 'bg-line-4' },
} as const;

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));

/** 멤버 탭(목업 Admin MEMBERS) */
export function AdminMembersTab({ meId, onToast }: { meId: string; onToast: ToastFn }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState<UserRole | null>(null);
  const [sort, setSort] = useState<AdminMemberSort>('joined_desc');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);
  const list = useAdminMembers({ q, role, sort });
  // NO-SHOW 열 기간은 서버 노쇼 정책(window_days, D101)
  const policy = useMyScrimRestriction().data?.policy;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card aria-labelledby="members-title" className="px-3 pb-3 md:px-3">
      <div className="flex flex-col gap-3 px-2.5">
        <PanelHead eyebrow="MEMBERS" title="멤버 관리" id="members-title" />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-11 w-[240px] max-w-full items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 text-faint">
            <SearchIcon size={16} />
            <input
              type="search"
              aria-label="멤버 검색"
              placeholder="닉네임·디스코드 검색"
              value={text}
              maxLength={ADMIN_MEMBER_QUERY_MAX_LENGTH}
              onChange={(e) => setText(e.target.value)}
              className="w-full min-w-0 border-0 bg-transparent text-sm text-text outline-none"
            />
          </label>
          <SelectInput aria-label="역할 필터" value={role ?? ''} onChange={(e) => setRole((e.target.value || null) as UserRole | null)}>
            <option value="">전체 역할</option>
            <option value="admin">운영진</option>
            <option value="member">멤버</option>
          </SelectInput>
          <SelectInput aria-label="정렬" value={sort} onChange={(e) => setSort(AdminMemberSort.parse(e.target.value))}>
            {AdminMemberSort.options.map((s) => (
              <option key={s} value={s}>
                {MEMBER_SORT_LABEL[s]}
              </option>
            ))}
          </SelectInput>
        </div>
      </div>
      {list.isPending ? (
        <div className="flex flex-col gap-1.5 px-2.5" aria-busy="true" aria-label="멤버 불러오는 중">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="px-2.5">
          <ErrorState message={errText(list.error)} onRetry={() => void list.refetch()} />
        </div>
      ) : items.length === 0 ? (
        <div className="px-2.5">
          <EmptyState mark="?" title={q ? `「${q}」와 맞는 멤버가 없어요` : '멤버가 없어요'} />
        </div>
      ) : (
        <>
          {/* sr-only가 스크롤러 밖으로 새어 문서 폭을 늘리지 않게 relative */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-x-0 border-spacing-y-1 text-sm">
              <thead>
                <tr className="text-left font-display text-[11px] tracking-[0.14em] text-faint">
                  <th className="px-3.5 py-2 font-semibold">MEMBER</th>
                  <th className="px-3.5 py-2 font-semibold">ROLE</th>
                  <th className="px-3.5 py-2 font-semibold">LINKED</th>
                  <th className="px-3.5 py-2 text-right font-semibold">SCRIMS</th>
                  <th className="px-3.5 py-2 text-right font-semibold">{policy ? `NO-SHOW ${policy.window_days}D` : 'NO-SHOW'}</th>
                  <th className="px-3.5 py-2 font-semibold">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <MemberRow key={m.user.id} m={m} isMe={m.user.id === meId} onToast={onToast} />
                ))}
              </tbody>
            </table>
          </div>
          {list.hasNextPage && (
            <Button className="self-center" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {list.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
            </Button>
          )}
        </>
      )}
    </Card>
  );
}

function MemberRow({ m, isMe, onToast }: { m: AdminMemberItem; isMe: boolean; onToast: ToastFn }) {
  const change = useChangeMemberRole();
  const [next, setNext] = useState<UserRole | null>(null);
  const st = memberStatusText(m);
  const tone = STATUS_TONE[st.tone];
  const locked = m.role_locked;
  const disabled = isMe || locked || change.isPending;
  const cell = 'px-3.5 py-3';
  return (
    <tr className="bg-surface-2">
      <td className={cn(cell, 'rounded-l-xl')}>
        <div className="flex items-center gap-3">
          <Avatar src={m.user.avatar_url} name={m.user.nickname} size={32} />
          <span className="flex min-w-0 flex-col">
            <Link href={routes.member(m.user.id)} className="truncate font-semibold text-text no-underline hover:text-text hover:underline">
              {m.user.nickname}
              {isMe && <span className="ml-1 text-xs font-normal text-faint">(나)</span>}
            </Link>
            <span className="text-xs text-faint">가입 {formatYearMonth(m.joined_at)}</span>
          </span>
        </div>
      </td>
      <td className={cell}>
        <span className="flex items-center gap-1.5">
          <SelectInput
            aria-label={`${m.user.nickname} 역할`}
            value={m.role}
            disabled={disabled}
            title={locked ? ROLE_LOCKED_TEXT : isMe ? '내 역할은 바꿀 수 없어요' : undefined}
            onChange={(e) => setNext(e.target.value as UserRole)}
            className={cn('h-9 rounded-full px-3 text-xs font-bold', m.role === 'admin' ? 'border-accent/30 bg-accent/10 text-accent-ink' : 'bg-chip text-muted')}
          >
            <option value="member">{ROLE_LABEL.member}</option>
            <option value="admin">{ROLE_LABEL.admin}</option>
          </SelectInput>
          {locked && (
            <span title={ROLE_LOCKED_TEXT} className="text-faint">
              <LockIcon size={14} />
              <span className="sr-only">{ROLE_LOCKED_TEXT}</span>
            </span>
          )}
        </span>
      </td>
      <td className={cn(cell, 'text-[13px] text-text-2')}>{m.discord_linked && m.discord_username ? `@${m.discord_username}` : <span className="text-faint">미연동</span>}</td>
      <td className={cn(cell, 'text-right font-display font-semibold')}>{m.scrim_count}</td>
      <td className={cn(cell, 'text-right font-display font-bold', m.no_show_30d > 0 ? 'text-orange-ink-2' : 'text-text')}>{m.no_show_30d}</td>
      <td className={cn(cell, 'rounded-r-xl')}>
        <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold', tone.fg)}>
          <span aria-hidden="true" className={cn('size-[7px] rounded-full', tone.dot)} />
          {st.text}
        </span>
        <ConfirmDialog
          open={next !== null}
          title={`${m.user.nickname}님 역할을 바꿀까요?`}
          description={
            next === 'admin'
              ? '운영진이 되면 결과 승인·노쇼 표시·공지 작성 등 관리자 화면을 쓸 수 있어요.'
              : '멤버로 바꾸면 다음 요청부터 관리자 화면을 쓸 수 없어요.'
          }
          confirmLabel={next ? `${ROLE_TO[next]} 변경` : '변경'}
          confirmVariant={next === 'admin' ? 'primary' : 'danger'}
          pending={change.isPending}
          onClose={() => setNext(null)}
          onConfirm={() =>
            next &&
            change.mutate(
              { id: m.user.id, role: next },
              {
                onSuccess: () => onToast({ message: `${m.user.nickname}님 역할을 ${ROLE_TO[next]} 바꿨어요.`, tone: 'success' }),
                onError: (e) => onToast({ message: errText(e), tone: 'error' }),
                onSettled: () => setNext(null),
              },
            )
          }
        />
      </td>
    </tr>
  );
}
