import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { AlertIcon } from './icons';

/** 목업 공통: Chakra Petch 대문자 눈썹 글자(MENU, SETTINGS, SIGN IN ...) */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('font-display text-[11px] font-semibold tracking-[0.16em] text-faint', className)}>
      {children}
    </span>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <Eyebrow className="text-xs">{eyebrow}</Eyebrow>
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">{title}</h1>
      </div>
      {children}
    </header>
  );
}

/** 목업 카드 섹션: surface 배경, line 테두리, 22px 둥근 모서리, 윗면 하이라이트 */
export function Card({ children, className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={cn('flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-5 shadow-[inset_0_1px_0_var(--hi)] md:p-6', className)}
    >
      {children}
    </section>
  );
}

export function EmptyState({
  mark,
  title,
  description,
  action,
}: {
  mark: string;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[18px] border border-dashed border-line-3 bg-surface-2 px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-[14px] bg-accent/10 font-display text-sm font-bold text-accent-ink"
      >
        {mark}
      </span>
      <p className="m-0 text-base font-bold">{title}</p>
      <p className="m-0 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-[16px] border border-orange/40 bg-orange/10 px-4 py-3 text-sm text-warn-text"
    >
      <AlertIcon className="shrink-0 text-orange-text" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-9 rounded-[10px] border border-line-3 bg-surface px-3 text-[13px] font-semibold text-text"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded-md bg-surface-2', className)} />;
}

/** 원형 아바타. 이미지가 없으면 닉네임 첫 글자 */
export function Avatar({ src, name, size = 38, className }: { src: string | null; name: string; size?: number; className?: string }) {
  const initial = Array.from(name.trim())[0] ?? '?';
  return src ? (
    // 디스코드 CDN 이미지. next/image 원격 도메인 설정 없이 쓰기 위해 img 사용
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn('shrink-0 rounded-full object-cover', className)}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-blue/20 font-bold text-blue-ink', className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initial}
    </span>
  );
}

/** 전체 화면 로딩(세션 확인 중) */
export function FullScreenLoading({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh items-center justify-center gap-3 text-sm text-muted">
      <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line-3 border-t-accent" />
      {label}
    </div>
  );
}
