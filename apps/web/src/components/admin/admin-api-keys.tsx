'use client';

import { API_KEY_NAME_MAX_LENGTH, ApiKeyScope, CreateApiKeyRequest, type AdminApiKeyItem } from '@gcd/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, ConfirmDialog, InlineError } from '@/components/ui/controls';
import { CheckboxRow, Field, PanelHead, TextInput, apiErrorText } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { API_KEY_SCOPE_LABEL, apiKeyPrefixText } from '@/lib/admin';
import { isApiError } from '@/lib/api/client';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatFull } from '@/lib/format';
import { useAdminApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/hooks/admin';
import type { ToastFn } from './admin-view';

const errText = (e: unknown) => (isApiError(e) ? errorMessage(e.code) : errorMessage('NETWORK_ERROR'));
const ALL_SCOPES = ApiKeyScope.options;

/** API 키 탭(목업 없음, 계약 S6 12-4·13절). 원문은 발급 응답에서 한 번만 보여 준다 */
export function AdminApiKeysTab({ onToast }: { onToast: ToastFn }) {
  const q = useAdminApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<ApiKeyScope>>(() => new Set(ALL_SCOPES));
  const [raw, setRaw] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AdminApiKeyItem | null>(null);
  const parsed = CreateApiKeyRequest.safeParse({ name, scopes: ALL_SCOPES.filter((s) => scopes.has(s)) });
  const toggle = (s: ApiKeyScope, on: boolean) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(s);
      else next.delete(s);
      return next;
    });

  return (
    <>
      <Card aria-labelledby="key-form-title">
        <PanelHead eyebrow="API KEYS" title="봇 API 키 발급" id="key-form-title" />
        <Field label="이름" hint="어디에 쓰는 키인지 적어 두면 나중에 폐기할 때 알아보기 쉬워요">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={API_KEY_NAME_MAX_LENGTH} placeholder="예: 디스코드 봇 (운영)" />
        </Field>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 text-[13px] font-semibold text-text-2">권한(scope)</legend>
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {ALL_SCOPES.map((s) => (
              <CheckboxRow key={s} checked={scopes.has(s)} onChange={(v) => toggle(s, v)}>
                <span className="text-text-2">{API_KEY_SCOPE_LABEL[s]}</span> <code className="font-display text-xs text-faint">{s}</code>
              </CheckboxRow>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!parsed.success || create.isPending}
            onClick={() =>
              parsed.success &&
              create.mutate(parsed.data, {
                onSuccess: (res) => {
                  setRaw(res.key);
                  setName('');
                  setScopes(new Set(ALL_SCOPES));
                },
              })
            }
          >
            {create.isPending ? '발급하는 중…' : '키 발급'}
          </Button>
        </div>
        {create.isError && <InlineError>{apiErrorText(create.error)}</InlineError>}
      </Card>

      <Card aria-labelledby="key-list-title">
        <PanelHead eyebrow="KEYS" title="발급된 키" id="key-list-title" />
        {q.isPending ? (
          <Skeleton className="h-32 rounded-2xl" />
        ) : q.isError ? (
          <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState mark="KEY" title="발급된 키가 없어요" />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {q.data.items.map((k) => (
              <li key={k.id} className={cn('flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3', k.revoked_at && 'opacity-70')}>
                <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-sm font-bold">{k.name}</span>
                    <code className="font-display text-xs text-muted">{apiKeyPrefixText(k.key_prefix)}</code>
                    {k.revoked_at ? <Badge>폐기됨</Badge> : <Badge tone="cyan">사용 중</Badge>}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <span key={s} title={s} className="rounded-md bg-chip px-1.5 py-0.5 text-[11px] text-text-2">
                        {API_KEY_SCOPE_LABEL[s]}
                      </span>
                    ))}
                  </span>
                  <span className="text-xs text-faint">
                    {k.created_by ? `${k.created_by.nickname} 발급` : 'CLI 발급'} · {formatFull(k.created_at)} · 마지막 사용 {k.last_used_at ? formatFull(k.last_used_at) : '없음'}
                    {k.revoked_at && ` · 폐기 ${formatFull(k.revoked_at)}`}
                  </span>
                </div>
                {!k.revoked_at && (
                  <Button size="sm" variant="danger" onClick={() => setRevoking(k)} disabled={revoke.isPending}>
                    폐기
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RawKeyDialog
        raw={raw}
        onClose={() => {
          // 원문은 발급 응답에만 있다 → 닫으면 화면 상태와 mutation 결과(메모리) 모두에서 지운다
          setRaw(null);
          create.reset();
        }}
        onToast={onToast}
      />
      <ConfirmDialog
        open={revoking !== null}
        title="키를 폐기할까요?"
        description={`「${revoking?.name ?? ''}」 키로 들어오는 봇 요청이 바로 거부돼요. 되돌릴 수 없어요.`}
        confirmLabel="폐기"
        pending={revoke.isPending}
        onClose={() => setRevoking(null)}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => onToast({ message: '키를 폐기했어요.', tone: 'success' }),
            onError: (e) => onToast({ message: errText(e), tone: 'error' }),
            onSettled: () => setRevoking(null),
          })
        }
      />
    </>
  );
}

/** 원문 키 대화상자: 닫으면 원문을 버린다(다시 볼 수 없다) */
function RawKeyDialog({ raw, onClose, onToast }: { raw: string | null; onClose: () => void; onToast: ToastFn }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (raw && !d.open) d.showModal();
    if (!raw && d.open) d.close();
  }, [raw]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-[min(520px,calc(100vw-32px))] rounded-[20px] border border-line-2 bg-surface-3 p-0 text-text shadow-[0_12px_30px_var(--shadow)] backdrop:bg-shadow"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="m-0 text-lg font-bold">
          새 API 키
        </h2>
        <p className="m-0 text-[13px] text-warn-text">닫으면 다시 볼 수 없어요. 지금 복사해 봇 설정에 넣어 주세요.</p>
        <code className="block break-all rounded-xl border border-line-3 bg-bg px-3 py-3 font-display text-sm">{raw}</code>
        <div className="flex justify-end gap-2">
          <Button
            onClick={() =>
              raw &&
              void copyText(raw).then((ok) => onToast({ message: ok ? '키를 복사했어요.' : '복사하지 못했어요. 직접 선택해 복사해 주세요.', tone: ok ? 'success' : 'error' }))
            }
          >
            복사
          </Button>
          <Button variant="primary" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </dialog>
  );
}
