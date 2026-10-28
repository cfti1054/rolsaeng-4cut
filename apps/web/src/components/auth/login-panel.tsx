'use client';

import { DevLoginRequest, UserRole, type OAuthLoginErrorCode } from '@gcd/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { AlertIcon, CheckIcon, DiscordIcon, XIcon } from '@/components/ui/icons';
import { Eyebrow } from '@/components/ui/primitives';
import { startDiscordLogin } from '@/lib/api/auth';
import { API_MOCK } from '@/lib/api';
import { isApiError } from '@/lib/api/client';
import { errorMessage } from '@/lib/errors';
import { useDevLogin } from '@/lib/hooks/auth';
import { routes } from '@/lib/routes';
import { AuthSteps } from './steps';

const SCOPES = [
  { text: '디스코드 ID · 사용자명 · 프로필 이미지', ok: true },
  { text: '롤생네컷 서버 가입 여부와 서버 닉네임', ok: true },
  { text: '이메일 주소 (알림용, 선택)', ok: true },
  { text: '메시지 내용 · 비밀번호 · 다른 서버 활동', ok: false },
];

/** ?error= 코드별 제목. 본문은 lib/errors.ts 문구 */
const ERROR_TITLES: Record<OAuthLoginErrorCode, string> = {
  OAUTH_NOT_CONFIGURED: '로그인을 쓸 수 없어요',
  OAUTH_STATE_INVALID: '로그인을 다시 시작해 주세요',
  OAUTH_DENIED: '로그인이 취소됐어요',
  OAUTH_PROVIDER_ERROR: '디스코드 연결 실패',
  DISCORD_NOT_GUILD_MEMBER: '서버 멤버만 입장할 수 있어요',
  INTERNAL_ERROR: '로그인 중 문제가 생겼어요',
};

export function LoginPanel({
  error,
  redirect,
  devLoginEnabled,
}: {
  error: OAuthLoginErrorCode | undefined;
  redirect: string;
  devLoginEnabled: boolean;
}) {
  const [leaving, setLeaving] = useState(false);
  // 뒤로 가기(bfcache)로 돌아오면 버튼을 다시 살린다
  useEffect(() => {
    const onShow = () => setLeaving(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const onDiscord = () => {
    setLeaving(true);
    startDiscordLogin(redirect);
  };

  return (
    <>
      <AuthSteps current={1} />
      <div className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-2">
          <Eyebrow>SIGN IN</Eyebrow>
          <h2 className="m-0 text-[28px] font-bold tracking-[-0.03em]">디스코드로 입장하기</h2>
          <p className="m-0 text-sm leading-[1.7] text-muted">
            별도 비밀번호 없이 디스코드 계정으로 로그인해요. 처음이라면 자동으로 가입됩니다.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="flex gap-3 rounded-2xl border border-orange/40 bg-orange/10 px-4 py-3.5 text-[13px] leading-relaxed"
          >
            <AlertIcon className="mt-0.5 shrink-0 text-orange-text" />
            <span className="flex flex-col gap-0.5">
              <span className="font-bold text-warn-text">{ERROR_TITLES[error]}</span>
              <span className="text-warn-text-2">{errorMessage(error)}</span>
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={onDiscord}
          disabled={leaving}
          aria-busy={leaving}
          className="flex h-14 items-center justify-center gap-3 rounded-2xl bg-discord text-base font-bold text-on-discord shadow-[0_10px_24px_color-mix(in_oklab,var(--brand-discord)_25%,transparent)] disabled:opacity-70"
        >
          <DiscordIcon />
          {leaving ? '디스코드로 이동 중…' : 'Discord로 로그인'}
        </button>

        <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4">
          <span className="text-[13px] font-bold">롤생네컷이 받는 정보</span>
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
            {SCOPES.map((s) => (
              <li key={s.text} className={`flex items-center gap-2.5 text-[13px] ${s.ok ? 'text-text-2' : 'text-faint'}`}>
                {s.ok ? (
                  <CheckIcon size={14} className="text-accent-ink" />
                ) : (
                  <XIcon size={14} className="text-faint" />
                )}
                <span className="sr-only">{s.ok ? '받음:' : '받지 않음:'}</span>
                {s.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="m-0 text-xs leading-[1.7] text-faint">
          롤생네컷 디스코드 서버 멤버만 입장할 수 있어요. 라이엇 · 스팀 연동은 로그인 후{' '}
          <Link href={routes.settings()} className="no-underline">
            설정
          </Link>
          에서 합니다.
        </p>

        {API_MOCK && (
          <p className="m-0 rounded-xl border border-dashed border-line-3 px-3 py-2 text-xs text-faint">
            목 모드(NEXT_PUBLIC_API_MOCK=true): 디스코드 왕복 없이 가짜 계정으로 로그인합니다.
          </p>
        )}

        {devLoginEnabled && <DevLoginForm redirect={redirect} />}
      </div>
    </>
  );
}

/** 개발 전용 로그인(계약 5-8). NEXT_PUBLIC_AUTH_DEV_LOGIN=true일 때만 보인다. */
function DevLoginForm({ redirect }: { redirect: string }) {
  const router = useRouter();
  const devLogin = useDevLogin();
  const [username, setUsername] = useState('dev_user');
  const [role, setRole] = useState<UserRole>('member');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = DevLoginRequest.safeParse({ username, role });
    if (!parsed.success) {
      setFieldError('소문자 · 숫자 · 밑줄 2–32자로 입력해 주세요.');
      return;
    }
    setFieldError(null);
    devLogin.mutate(parsed.data, {
      onSuccess: (res) =>
        router.replace(res.user.needs_nickname_confirmation ? routes.welcome(redirect) : redirect),
    });
  };

  const serverError = devLogin.error
    ? isApiError(devLogin.error)
      ? devLogin.error.code === 'NOT_FOUND'
        ? 'API에서 개발 로그인이 꺼져 있어요(AUTH_DEV_LOGIN).'
        : errorMessage(devLogin.error.code)
      : errorMessage('NETWORK_ERROR')
    : null;

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="dev-login-title"
      className="flex flex-col gap-3 rounded-2xl border border-dashed border-violet/50 bg-violet/5 p-4"
    >
      <span id="dev-login-title" className="flex items-center gap-2 text-[13px] font-bold">
        <span className="rounded-md bg-violet/15 px-1.5 py-0.5 font-display text-[11px] font-semibold text-violet-text">
          DEV
        </span>
        개발 전용 로그인
      </span>
      <div className="flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-text-2">
          username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={fieldError ? true : undefined}
            className="h-10 rounded-[10px] border border-line-3 bg-bg px-3 text-sm text-text outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-text-2">
          role
          <select
            value={role}
            onChange={(e) => setRole(UserRole.parse(e.target.value))}
            className="h-10 rounded-[10px] border border-line-3 bg-bg px-2 text-sm text-text"
          >
            {UserRole.options.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(fieldError || serverError) && (
        <span role="alert" className="text-xs text-orange-text">
          {fieldError ?? serverError}
        </span>
      )}
      <button
        type="submit"
        disabled={devLogin.isPending}
        className="h-10 rounded-[10px] border border-line-3 bg-surface text-[13px] font-semibold text-text disabled:opacity-60"
      >
        {devLogin.isPending ? '로그인 중…' : '개발 사용자로 로그인'}
      </button>
    </form>
  );
}
