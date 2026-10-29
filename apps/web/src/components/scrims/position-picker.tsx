'use client';

import { useId } from 'react';
import { cn } from '@/lib/cn';
import { positionLabel } from '@/lib/games';

/**
 * 1지망(필수)·2지망(선택) 포지션 고르기(D82). 값은 games.positions 코드.
 * 라디오 그룹 두 개. 2지망은 1지망과 같은 값을 고를 수 없고 「없음」을 둔다.
 */
export function PositionPicker({
  positions,
  first,
  second,
  onChange,
  disabled = false,
  errorId,
}: {
  positions: readonly string[];
  first: string | null;
  second: string | null;
  onChange: (first: string | null, second: string | null) => void;
  disabled?: boolean;
  errorId?: string;
}) {
  const firstLabel = useId();
  const secondLabel = useId();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span id={firstLabel} className="text-[13px] font-semibold text-text-2">
          1지망 <span className="font-normal text-faint">(필수)</span>
        </span>
        <div role="radiogroup" aria-labelledby={firstLabel} aria-describedby={errorId} className="flex flex-wrap gap-2">
          {positions.map((p) => (
            <Choice
              key={p}
              label={positionLabel(p)}
              checked={first === p}
              disabled={disabled}
              onClick={() => onChange(p, second === p ? null : second)}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span id={secondLabel} className="text-[13px] font-semibold text-text-2">
          2지망 <span className="font-normal text-faint">(선택)</span>
        </span>
        <div role="radiogroup" aria-labelledby={secondLabel} className="flex flex-wrap gap-2">
          <Choice label="없음" checked={second === null} disabled={disabled} onClick={() => onChange(first, null)} subtle />
          {positions.map((p) => (
            <Choice
              key={p}
              label={positionLabel(p)}
              checked={second === p}
              disabled={disabled || first === p}
              onClick={() => onChange(first, p)}
              subtle
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Choice({
  label,
  checked,
  disabled,
  onClick,
  subtle = false,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-10 min-w-[64px] rounded-xl border px-3.5 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40',
        checked
          ? subtle
            ? 'border-accent/60 bg-accent/10 text-accent-ink'
            : 'border-accent bg-accent text-on-accent'
          : 'border-line-3 bg-surface-2 text-text-2 hover:text-text',
      )}
    >
      {label}
    </button>
  );
}
