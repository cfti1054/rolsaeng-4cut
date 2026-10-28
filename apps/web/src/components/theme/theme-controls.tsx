'use client';

import { MoonIcon, SunIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import type { ThemeMode } from '@/lib/theme/theme';
import { useTheme } from './use-theme';

/** 사이드바 라이트·다크 2버튼 세그먼트(목업 Main). 시스템 모드일 때는 둘 다 눌리지 않은 상태. */
export function ThemeSegment({ className }: { className?: string }) {
  const { mode, setMode } = useTheme();
  const opts: { id: Exclude<ThemeMode, 'system'>; label: string; Icon: typeof SunIcon }[] = [
    { id: 'light', label: '라이트', Icon: SunIcon },
    { id: 'dark', label: '다크', Icon: MoonIcon },
  ];
  return (
    <div
      role="group"
      aria-label="화면 테마"
      className={cn('grid grid-cols-2 gap-1 rounded-[14px] border border-line bg-surface-2 p-1', className)}
    >
      {opts.map(({ id, label, Icon }) => {
        const on = mode === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => setMode(id)}
            className={cn(
              'flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold',
              on ? 'bg-surface text-text shadow-seg' : 'bg-transparent text-muted',
            )}
          >
            <Icon size={16} strokeWidth={2} className={on ? 'text-accent-ink' : undefined} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** 모바일 헤더·로그인 화면의 아이콘 토글. 현재 해석값의 반대로 저장한다. */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolved, toggle, toggleLabel } = useTheme();
  return (
    <button
      type="button"
      aria-label={toggleLabel}
      title={toggleLabel}
      onClick={toggle}
      className={cn(
        'flex size-11 items-center justify-center rounded-[14px] border border-line bg-surface text-text',
        className,
      )}
    >
      {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
