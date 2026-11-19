'use client';

import type { AdminMemberItem, ScrimDetail } from '@gcd/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, InlineError } from '@/components/ui/controls';
import { SearchIcon } from '@/components/ui/icons';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useAdminMembers } from '@/lib/hooks/admin';
import { useAddScrimPlayer } from '@/lib/hooks/scrims';
import { toPreferredPositions } from '@/lib/scrims';
import { PositionPicker } from './position-picker';
import { scrimErrorText } from './scrim-bits';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * 운영진이 로스터 「빈 자리」에서 멤버를 골라 참가자로 등록하는 대화상자(POST /scrims/:id/players).
 * 이미 참가·대기 중인 멤버와 탈퇴한 멤버는 목록에서 뺀다.
 */
export function AddPlayerDialog({
  s,
  onClose,
  onAdded,
}: {
  s: ScrimDetail;
  onClose: () => void;
  onAdded: (nickname: string, waitlisted: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<AdminMemberItem['user'] | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const add = useAddScrimPlayer(s.id);
  const list = useAdminMembers({ q, role: null, sort: 'nickname_asc' });

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const usePositions = s.options.use_positions;
  const inScrim = new Set([...s.players.map((p) => p.user.id), ...s.waitlist.map((w) => w.user.id)]);
  const items = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((m) => m.status !== 'left' && !inScrim.has(m.user.id));
  const canSubmit = picked !== null && (!usePositions || first !== null) && !add.isPending;

  const submit = () => {
    if (!picked || !canSubmit) return;
    add.mutate(
      { user_id: picked.id, preferred_positions: usePositions ? toPreferredPositions(first, second) : [] },
      {
        onSuccess: (d) => {
          const waitlisted = d.waitlist.some((w) => w.user.id === picked.id);
          onAdded(picked.nickname, waitlisted);
          ref.current?.close();
        },
      },
    );
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] overflow-y-auto rounded-[20px] border border-line-2 bg-surface-3 p-0 text-text shadow-[0_12px_30px_var(--shadow)] backdrop:bg-shadow"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 id={titleId} className="m-0 text-lg font-bold">
            참가자 직접 등록
          </h2>
          <p className="m-0 text-[13px] text-muted">
            운영진이 멤버를 빈 자리에 넣어요. 노쇼 제한 중인 멤버도 등록할 수 있어요. ({s.joined_count} / {s.capacity})
          </p>
        </div>

        {picked ? (
          <div className="flex items-center gap-2.5 rounded-[14px] border border-line-2 bg-surface-2 px-3 py-2.5">
            <Avatar src={picked.avatar_url} name={picked.nickname} size={30} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{picked.nickname}</span>
            <Button
              variant="ghost"
              className="h-8 px-2.5 text-xs"
              disabled={add.isPending}
              onClick={() => {
                setPicked(null);
                add.reset();
              }}
            >
              다시 고르기
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="flex h-11 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 text-faint">
              <SearchIcon size={16} />
              <input
                type="search"
                aria-label="멤버 검색"
                placeholder="닉네임·디스코드 검색"
                value={text}
                autoFocus
                onChange={(e) => setText(e.target.value)}
                className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm text-text outline-none"
              />
            </label>
            <div role="listbox" aria-label="멤버 목록" className="flex max-h-[280px] flex-col overflow-y-auto rounded-[14px] border border-line">
              {list.isPending ? (
                <div className="flex flex-col gap-2 p-3">
                  <Skeleton className="h-9 rounded-lg" />
                  <Skeleton className="h-9 rounded-lg" />
                </div>
              ) : list.isError ? (
                <p className="m-0 p-3 text-sm text-muted">멤버 목록을 불러오지 못했어요.</p>
              ) : items.length === 0 ? (
                <p className="m-0 p-3 text-sm text-muted">{q ? '검색 결과가 없어요.' : '등록할 수 있는 멤버가 없어요.'}</p>
              ) : (
                <>
                  {items.map((m) => (
                    <button
                      key={m.user.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => setPicked(m.user)}
                      className="flex min-h-[46px] items-center gap-2.5 border-0 border-b border-line bg-transparent px-3 text-left text-text last:border-b-0 hover:bg-surface-2"
                    >
                      <Avatar src={m.user.avatar_url} name={m.user.nickname} size={28} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.user.nickname}</span>
                      {m.status === 'restricted' && <Badge tone="orange">노쇼 제한</Badge>}
                    </button>
                  ))}
                  {list.hasNextPage && (
                    <button
                      type="button"
                      disabled={list.isFetchingNextPage}
                      onClick={() => void list.fetchNextPage()}
                      className="h-10 border-0 bg-transparent text-xs font-semibold text-accent-ink"
                    >
                      {list.isFetchingNextPage ? '불러오는 중…' : '더 보기'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {picked && usePositions && (
          <div className={cn('flex flex-col gap-2 rounded-2xl border border-line-2 bg-surface-2 p-4')}>
            <span className="text-sm font-bold">희망 포지션</span>
            <PositionPicker
              positions={s.game.positions}
              first={first}
              second={second}
              disabled={add.isPending}
              onChange={(f, sec) => {
                setFirst(f);
                setSecond(sec);
              }}
            />
          </div>
        )}

        {add.isError && <InlineError>{scrimErrorText(add.error)}</InlineError>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => ref.current?.close()} disabled={add.isPending}>
            닫기
          </Button>
          <Button variant="primary" onClick={submit} disabled={!canSubmit}>
            {add.isPending ? '등록 중…' : '등록'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
