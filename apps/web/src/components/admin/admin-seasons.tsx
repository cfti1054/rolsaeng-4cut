'use client';

import {
  SEASON_EDIT_MIN_LEAD_SEC,
  SEASON_LENGTH_MAX_DAYS,
  SEASON_LENGTH_MIN_DAYS,
  SEASON_NAME_MAX_LENGTH,
  SeasonName,
  type AdminSeasonItem,
  type AdminSeasonPhase,
} from '@gcd/shared';
import { useState } from 'react';
import { Badge, Button, ConfirmDialog, InlineError } from '@/components/ui/controls';
import { Field, PanelHead, TextInput, apiErrorText } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { SEASON_PHASE_LABEL, isoToKstLocalInput, kstLocalInputToIso, seasonEndConfirmText, seasonPatch } from '@/lib/admin';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { useAdminSeasons, useCreateSeason, useDeleteSeason, useUpdateSeason } from '@/lib/hooks/admin';
import type { ToastFn } from './admin-view';

const PHASE_TONE: Record<AdminSeasonPhase, 'accent' | 'cyan' | 'orange' | 'neutral'> = {
  upcoming: 'cyan',
  current: 'accent',
  ended: 'orange',
  closed: 'neutral',
};

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));
const RULE_TEXT = `시작은 지금부터 ${SEASON_EDIT_MIN_LEAD_SEC / 3600}시간 뒤부터, 길이는 ${SEASON_LENGTH_MIN_DAYS}–${SEASON_LENGTH_MAX_DAYS}일, 다른 시즌과 겹치면 안 돼요. 시각은 한국 시간이에요.`;

/** 시즌 탭(목업 없음, 계약 S6 11·13절). 입력칸 잠금은 서버 editable 그대로 */
export function AdminSeasonsTab({ onToast }: { onToast: ToastFn }) {
  const q = useAdminSeasons();
  const [editing, setEditing] = useState<AdminSeasonItem | null>(null);
  const [deleting, setDeleting] = useState<AdminSeasonItem | null>(null);
  const del = useDeleteSeason();
  return (
    <>
      <Card aria-labelledby="season-form-title">
        <PanelHead eyebrow="SEASON" title={editing ? `시즌 수정 · ${editing.name}` : '새 시즌'} id="season-form-title" />
        <p className="m-0 text-[13px] text-muted">{RULE_TEXT}</p>
        <SeasonForm key={editing?.id ?? 'new'} editing={editing} onDone={() => setEditing(null)} onToast={onToast} />
      </Card>
      <Card aria-labelledby="season-list-title">
        <PanelHead eyebrow="SEASONS" title="시즌 목록" id="season-list-title" />
        {q.isPending ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : q.isError ? (
          <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState mark="S" title="시즌이 없어요" description="첫 결과가 승인되면 자동으로 만들어지고, 위에서 직접 만들 수도 있어요." />
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[680px] border-separate border-spacing-x-0 border-spacing-y-1 text-sm">
              <thead>
                <tr className="text-left font-display text-[11px] tracking-[0.14em] text-faint">
                  <th className="px-3.5 py-2 font-semibold">NAME</th>
                  <th className="px-3.5 py-2 font-semibold">PERIOD</th>
                  <th className="px-3.5 py-2 font-semibold">PHASE</th>
                  <th className="px-3.5 py-2 text-right font-semibold">GAMES</th>
                  <th className="px-3.5 py-2" />
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((s) => (
                  <tr key={s.id} className="bg-surface-2">
                    <td className="rounded-l-xl px-3.5 py-3 font-semibold">{s.name}</td>
                    <td className="px-3.5 py-3 font-display text-[13px] text-text-2">
                      {formatFull(s.starts_at)} – {formatFull(s.ends_at)}
                    </td>
                    <td className="px-3.5 py-3">
                      <Badge tone={PHASE_TONE[s.phase]}>{SEASON_PHASE_LABEL[s.phase]}</Badge>
                    </td>
                    <td className="px-3.5 py-3 text-right font-display font-semibold">{s.rated_games}</td>
                    <td className="rounded-r-xl px-3.5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => setEditing(s)}>
                          수정
                        </Button>
                        {s.editable.delete && (
                          <Button size="sm" variant="danger" onClick={() => setDeleting(s)} disabled={del.isPending}>
                            삭제
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={deleting !== null}
        title="시즌을 삭제할까요?"
        description={`시작 전 시즌 「${deleting?.name ?? ''}」을(를) 삭제해요. 기록은 감사 로그에 남아요.`}
        confirmLabel="삭제"
        pending={del.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => onToast({ message: '시즌을 삭제했어요.', tone: 'success' }),
            onError: (e) => onToast({ message: errText(e), tone: 'error' }),
            onSettled: () => {
              if (editing?.id === deleting.id) setEditing(null);
              setDeleting(null);
            },
          })
        }
      />
    </>
  );
}

function SeasonForm({ editing, onDone, onToast }: { editing: AdminSeasonItem | null; onDone: () => void; onToast: ToastFn }) {
  const [name, setName] = useState(editing?.name ?? '');
  const [start, setStart] = useState(editing ? isoToKstLocalInput(editing.starts_at) : '');
  const [end, setEnd] = useState(editing ? isoToKstLocalInput(editing.ends_at) : '');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const create = useCreateSeason();
  const update = useUpdateSeason();
  const m = editing ? update : create;
  const lock = editing?.editable ?? { name: true, starts_at: true, ends_at: true, delete: true };
  const startsAt = kstLocalInputToIso(start);
  const endsAt = kstLocalInputToIso(end);
  const nameOk = SeasonName.safeParse(name).success;
  const patch = editing ? seasonPatch(editing, { name, starts_at: lock.starts_at ? startsAt : null, ends_at: lock.ends_at ? endsAt : null }) : null;
  const ready = editing ? nameOk && Object.keys(patch!).length > 0 : nameOk && !!startsAt && !!endsAt;

  const send = () => {
    const done = (msg: string) => {
      onToast({ message: msg, tone: 'success' });
      onDone();
      if (!editing) {
        setName('');
        setStart('');
        setEnd('');
      }
    };
    if (editing) update.mutate({ id: editing.id, body: patch! }, { onSuccess: () => done('시즌을 수정했어요.'), onSettled: () => setConfirmEnd(false) });
    else create.mutate({ name, starts_at: startsAt!, ends_at: endsAt! }, { onSuccess: () => done('새 시즌을 만들었어요.') });
  };
  const submit = () => {
    if (!ready) return;
    // 진행 중 시즌의 끝 변경은 종료 처리 시각이 바뀌므로 한 번 더 확인한다
    if (editing?.phase === 'current' && patch?.ends_at) setConfirmEnd(true);
    else send();
  };
  const locked = (on: boolean) => (on ? undefined : '이 단계에서는 바꿀 수 없어요');
  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="이름" hint={locked(lock.name)}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={SEASON_NAME_MAX_LENGTH} placeholder="예: 시즌 3" disabled={!lock.name} />
        </Field>
        <Field label="시작(한국 시간)" hint={locked(lock.starts_at)}>
          <TextInput type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} disabled={!lock.starts_at} />
        </Field>
        <Field label="끝(한국 시간)" hint={locked(lock.ends_at)}>
          <TextInput type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!lock.ends_at} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        {editing && (
          <Button variant="ghost" onClick={onDone} disabled={m.isPending}>
            취소
          </Button>
        )}
        <Button variant="primary" onClick={submit} disabled={!ready || m.isPending}>
          {m.isPending ? '저장하는 중…' : editing ? '저장' : '시즌 만들기'}
        </Button>
      </div>
      {m.isError && <InlineError>{apiErrorText(m.error)}</InlineError>}
      <ConfirmDialog
        open={confirmEnd}
        title="진행 중 시즌의 끝을 바꿀까요?"
        description={patch?.ends_at ? seasonEndConfirmText(patch.ends_at) : ''}
        confirmLabel="저장"
        confirmVariant="primary"
        pending={update.isPending}
        onClose={() => setConfirmEnd(false)}
        onConfirm={send}
      />
    </>
  );
}
