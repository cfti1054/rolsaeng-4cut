'use client';

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { AlertIcon, CheckIcon, XIcon } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'border-0 bg-accent text-on-accent font-bold',
  secondary: 'border border-line-3 bg-surface-2 text-text font-semibold',
  ghost: 'border border-transparent bg-transparent text-muted font-semibold hover:text-text',
  danger: 'border border-orange/40 bg-orange/10 text-orange-text font-semibold',
};

/** 목업 버튼: 높이 40(보조) / 46(주요), 둥근 12–14px */
export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg' }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-[13px] disabled:cursor-not-allowed disabled:opacity-50',
        size === 'lg' ? 'h-[46px] rounded-[14px] px-5 text-sm' : 'h-10 rounded-xl px-3.5',
        VARIANT[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

/** 작은 알약 배지(「대표」「소유 확인」「게임 정보 비공개」) */
export function Badge({ tone = 'neutral', children, icon }: { tone?: 'accent' | 'cyan' | 'orange' | 'neutral'; children: ReactNode; icon?: 'check' }) {
  const toneClass = {
    accent: 'bg-accent/15 text-accent-ink',
    cyan: 'bg-cyan/14 text-cyan-ink',
    orange: 'bg-orange/14 text-orange-text',
    neutral: 'bg-chip text-text-2',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-[5px] text-xs font-bold', toneClass)}>
      {icon === 'check' && <CheckIcon size={12} />}
      {children}
    </span>
  );
}

/** 카드 안 경고·안내 상자(목업 스팀 비공개 안내) */
export function Notice({
  tone = 'warn',
  title,
  children,
  action,
}: {
  tone?: 'warn' | 'info';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[14px] border p-3.5',
        tone === 'warn' ? 'border-orange/30 bg-orange/6' : 'border-line-2 bg-surface',
      )}
    >
      <AlertIcon size={20} className={cn('mt-px shrink-0', tone === 'warn' ? 'text-orange' : 'text-muted')} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={cn('text-sm font-bold', tone === 'warn' ? 'text-warn-text' : 'text-text')}>{title}</span>
        {children && (
          <span className={cn('text-[13px] leading-relaxed', tone === 'warn' ? 'text-warn-text-2' : 'text-muted')}>{children}</span>
        )}
        {action && <div className="mt-1 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** 인라인 오류 한 줄(폼·카드 안) */
export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 flex items-start gap-2 text-[13px] leading-relaxed text-orange-text">
      <AlertIcon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * 확인 대화상자(네이티브 <dialog> showModal: 포커스 가두기·Esc 닫기를 브라우저가 처리).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'danger',
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** 되돌릴 수 없는 작업은 danger(기본), 진행 버튼(내전 시작 등)은 primary */
  confirmVariant?: 'danger' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[min(420px,calc(100vw-32px))] rounded-[20px] border border-line-2 bg-surface-3 p-0 text-text shadow-[0_12px_30px_var(--shadow)] backdrop:bg-shadow"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={titleId} className="m-0 text-lg font-bold">
          {title}
        </h2>
        <div className="text-[13px] leading-relaxed text-muted">{description}</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={pending}>
            {pending ? '처리 중…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** 화면 아래 잠깐 뜨는 알림. 모바일은 하단 탭 위로 띄운다 */
export function Toast({
  message,
  tone = 'success',
  onClose,
  durationMs = 6000,
}: {
  message: string | null;
  tone?: 'success' | 'error';
  onClose: () => void;
  durationMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [message, onClose, durationMs]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-28 z-50 flex justify-center md:bottom-8">
      {message && (
        <div
          role={tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex max-w-[520px] items-start gap-3 rounded-[16px] border bg-surface-3 px-4 py-3 text-sm shadow-[0_12px_30px_var(--shadow)]',
            tone === 'error' ? 'border-orange/40 text-warn-text' : 'border-accent/40 text-text',
          )}
        >
          {tone === 'error' ? (
            <AlertIcon size={18} className="mt-px shrink-0 text-orange-text" />
          ) : (
            <CheckIcon size={16} className="mt-0.5 shrink-0 text-accent-ink" />
          )}
          <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
          <button type="button" aria-label="알림 닫기" onClick={onClose} className="-m-1 p-1 text-muted hover:text-text">
            <XIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
