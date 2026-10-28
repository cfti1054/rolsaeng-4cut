'use client';

import { NICKNAME_MAX_LENGTH, type Me } from '@gcd/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Avatar, ErrorState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { useLogout, useMe, useUpdateMe } from '@/lib/hooks/auth';
import { checkNickname, NICKNAME_RULE_HINT } from '@/lib/nickname';
import { routes } from '@/lib/routes';
import { AuthSteps } from './steps';

/**
 * 첫 로그인 닉네임 확인(계약 5-7).
 * 1) useMe가 토큰이 없으면 POST /auth/refresh로 부팅한다(실패 → /login).
 * 2) 이미 확인한 사용자면 redirect로 보낸다.
 * 3) 「시작하기」 → PATCH /me { nickname } → redirect. 「뒤로」 → POST /auth/logout → /login.
 */
export function WelcomePanel({ redirect }: { redirect: string }) {
  const router = useRouter();
  const me = useMe();
  const alreadyConfirmed = me.data?.needs_nickname_confirmation === false;

  useEffect(() => {
    if (alreadyConfirmed) router.replace(redirect);
  }, [alreadyConfirmed, redirect, router]);

  return (
    <>
      <AuthSteps current={2} />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Eyebrow>WELCOME</Eyebrow>
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.03em]">처음 오셨네요</h2>
          <p className="m-0 text-sm leading-[1.7] text-muted">
            커뮤니티에서 쓸 닉네임을 확인해 주세요. 디스코드 서버 닉네임을 기본값으로 가져왔어요.
          </p>
        </div>
        {me.data && !alreadyConfirmed ? (
          <NicknameForm me={me.data} redirect={redirect} />
        ) : me.isError && !(isApiError(me.error) && me.error.status === 401) ? (
          <ErrorState
            message={isApiError(me.error) ? errorMessage(me.error.code) : errorMessage('NETWORK_ERROR')}
            onRetry={() => void me.refetch()}
          />
        ) : (
          <div role="status" aria-label="계정 정보를 불러오는 중" className="flex flex-col gap-5">
            <Skeleton className="h-[78px] w-full rounded-2xl" />
            <Skeleton className="h-[92px] w-full rounded-2xl" />
            <Skeleton className="h-[50px] w-full rounded-[14px]" />
          </div>
        )}
      </div>
    </>
  );
}

function NicknameForm({ me, redirect }: { me: Me; redirect: string }) {
  const router = useRouter();
  const update = useUpdateMe();
  const logout = useLogout();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const [value, setValue] = useState(me.nickname);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const check = checkNickname(value);
  const fieldError = serverError ?? (touched && !check.ok ? check.message : null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!check.ok) return;
    setServerError(null);
    update.mutate(
      { nickname: check.value },
      {
        onSuccess: () => router.replace(redirect),
        onError: (err) => {
          if (!isApiError(err)) return setServerError(errorMessage('NETWORK_ERROR'));
          if (err.code === 'NICKNAME_TAKEN') return setServerError('이미 다른 멤버가 쓰는 닉네임이에요. 다른 이름을 골라 주세요.');
          if (err.code === 'VALIDATION_FAILED') {
            const d = err.details?.find((x) => x.path === 'nickname');
            return setServerError(d ? `닉네임 규칙에 맞지 않아요. (${NICKNAME_RULE_HINT})` : errorMessage(err.code));
          }
          setServerError(errorMessage(err.code));
        },
      },
    );
  };

  const onBack = () => logout.mutate(undefined, { onSettled: () => router.replace(routes.login()) });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5">
        {me.avatar_url ? (
          <Avatar src={me.avatar_url} name={me.nickname} size={48} />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-discord/20 text-lg font-bold text-blue-ink"
          >
            {Array.from(me.discord_username ?? me.nickname)[0]?.toUpperCase()}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[15px] font-bold">{me.discord_username ?? me.nickname}</span>
          <span className="text-xs text-muted">
            디스코드 계정{me.discord_guild_verified_at ? ' · 서버 멤버 확인됨' : ''}
          </span>
        </span>
        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent-ink">연결됨</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="flex items-baseline justify-between text-[13px] font-semibold text-text-2">
          닉네임
          <span
            aria-hidden="true"
            className={cn(
              'font-display text-xs font-medium',
              check.ok || !touched ? 'text-faint' : 'text-orange-text',
            )}
          >
            {check.ok ? check.value.length : check.length}/{NICKNAME_MAX_LENGTH}
          </span>
        </label>
        <input
          id={inputId}
          type="text"
          autoComplete="nickname"
          placeholder="새벽감자"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setServerError(null);
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={`${hintId}${fieldError ? ` ${errorId}` : ''}`}
          className={cn(
            'h-12 w-full rounded-[14px] border bg-bg px-4 text-[15px] text-text outline-none',
            fieldError ? 'border-orange' : 'border-line-3 focus:border-accent-ink',
          )}
        />
        {fieldError ? (
          <span id={errorId} role="alert" className="text-xs text-orange-text">
            {fieldError}
          </span>
        ) : null}
        <span id={hintId} className="text-xs text-faint">
          {NICKNAME_RULE_HINT} · 나중에 설정에서 바꿀 수 있어요
        </span>
        {check.ok && check.normalized ? (
          <span className="text-xs text-muted">
            앞뒤 공백은 지우고 연속 공백은 하나로 줄여 「<span className="whitespace-pre font-semibold text-text">{check.value}</span>」로
            저장돼요.
          </span>
        ) : null}
      </div>

      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={onBack}
          disabled={logout.isPending || update.isPending}
          className="h-[50px] rounded-[14px] border border-line-3 bg-transparent px-[18px] text-sm font-semibold text-text disabled:opacity-60"
        >
          뒤로
        </button>
        <button
          type="submit"
          disabled={update.isPending || logout.isPending}
          aria-busy={update.isPending}
          className="flex h-[50px] flex-1 items-center justify-center rounded-[14px] bg-accent text-[15px] font-bold text-on-accent disabled:opacity-70"
        >
          {update.isPending ? '저장 중…' : '시작하기'}
        </button>
      </div>
    </form>
  );
}
