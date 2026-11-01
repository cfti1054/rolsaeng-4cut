'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { z } from 'zod';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { Button, ConfirmDialog } from './controls';
import { Eyebrow } from './primitives';

/**
 * S6 폼 공통 조각(목업 Admin NOTICE 입력칸·Settings 스위치). 색은 토큰 클래스만, 버튼은 모두 Button.
 */

export const INPUT_CLASS =
  'h-12 w-full rounded-[14px] border border-line-3 bg-bg px-4 text-sm text-text placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-60';
export const TEXTAREA_CLASS =
  'min-h-[120px] w-full resize-y rounded-[14px] border border-line-3 bg-bg px-4 py-3 text-sm leading-relaxed text-text placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-60';
export const SELECT_CLASS =
  'h-11 rounded-xl border border-line-3 bg-surface-2 px-3 text-[13px] text-text disabled:cursor-not-allowed disabled:opacity-60';

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-text-2', className)}>
      {label}
      {children}
      {error ? <span className="text-xs font-normal text-orange-text">{error}</span> : hint ? <span className="text-xs font-normal text-faint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT_CLASS, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(TEXTAREA_CLASS, props.className)} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(SELECT_CLASS, props.className)} />;
}

/** 체크박스 한 줄(목업 「디스코드에도 알림 (봇 연동 후)」) */
export function CheckboxRow({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cn('flex min-h-11 items-center gap-2 text-[13px] text-muted', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[18px] shrink-0 accent-accent"
      />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** 스위치 행(목업 Settings NOTIFICATIONS) */
export function SwitchRow({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <Button
      size="custom"
      variant="plain"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className="flex min-h-[62px] w-full items-center justify-between gap-4 rounded-[14px] border border-line bg-surface-2 px-4 py-2 text-left text-text"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted">{desc}</span>
      </span>
      <span aria-hidden="true" className={cn('flex h-[26px] w-[46px] shrink-0 items-center rounded-full p-[3px]', checked ? 'justify-end bg-accent' : 'justify-start bg-line-3')}>
        <span className={cn('size-5 rounded-full', checked ? 'bg-on-accent' : 'bg-faint')} />
      </span>
    </Button>
  );
}

/** 필터 칩 묶음(라디오 그룹처럼 하나만 선택) */
export function FilterChips<T extends string | null>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o === value;
        return (
          <Button
            key={String(o)}
            size="sm"
            variant="plain"
            aria-pressed={on}
            onClick={() => onChange(o)}
            className={cn('min-h-9 rounded-full border px-3.5 font-semibold', on ? 'border-accent/50 bg-accent/12 text-accent-ink' : 'border-line-2 bg-surface-2 text-muted hover:text-text')}
          >
            {render(o)}
          </Button>
        );
      })}
    </div>
  );
}

/** 카드 머리(목업 공통: 눈썹 글자 + 제목 + 오른쪽 부가) */
export function PanelHead({ eyebrow, title, id, right }: { eyebrow: string; title: ReactNode; id?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className="m-0 text-lg font-bold">
          {title}
        </h2>
      </div>
      {right}
    </div>
  );
}

/** API 오류 → 화면 문구(code 기준, VALIDATION_FAILED는 details를 덧붙인다) */
export function apiErrorText(err: unknown): string {
  if (!isApiError(err)) return errorMessage('NETWORK_ERROR');
  if (err.code === 'VALIDATION_FAILED' && err.details?.length) {
    return `${errorMessage('VALIDATION_FAILED')} (${err.details.map((d) => d.message).join(', ')})`;
  }
  return errorMessage(err.code);
}

/**
 * 사유 입력 확인 대화상자(반려·되돌리기). schema = shared 사유 스키마(길이 규칙의 출처).
 * 확인하면 onConfirm(사유). 닫히면 입력을 비운다.
 */
export function ReasonDialog({
  open,
  title,
  description,
  label,
  placeholder,
  min,
  max,
  schema,
  confirmLabel,
  confirmVariant = 'danger',
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  label: string;
  placeholder?: string;
  min: number;
  max: number;
  schema: z.ZodType<string, string>;
  confirmLabel: string;
  confirmVariant?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const id = useId();
  const parsed = schema.safeParse(text);
  const close = () => {
    setText('');
    onClose();
  };
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={
        <div className="flex flex-col gap-3">
          {description && <div>{description}</div>}
          <label htmlFor={id} className="flex flex-col gap-2">
            <span>{label}</span>
            <textarea
              id={id}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={max + 20}
              rows={3}
              className="w-full resize-y rounded-xl border border-line-3 bg-surface px-3 py-2 text-sm text-text"
              placeholder={placeholder}
            />
            <span className={cn('text-xs', text && !parsed.success ? 'text-orange-text' : 'text-faint')}>
              {min}–{max}자
            </span>
          </label>
          {error && (
            <p role="alert" className="m-0 text-xs text-orange-text">
              {error}
            </p>
          )}
        </div>
      }
      confirmLabel={confirmLabel}
      confirmVariant={confirmVariant}
      confirmDisabled={!parsed.success}
      pending={pending}
      onClose={close}
      onConfirm={() => parsed.success && onConfirm(parsed.data)}
    />
  );
}
