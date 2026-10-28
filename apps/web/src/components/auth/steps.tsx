import { cn } from '@/lib/cn';

const STEPS = ['1 · 디스코드 로그인', '2 · 닉네임 확인'];

/** 가입 단계 표시(목업 Login 상단 막대 2개) */
export function AuthSteps({ current }: { current: 1 | 2 }) {
  return (
    <ol aria-label="가입 단계" className="m-0 grid list-none grid-cols-2 gap-2 p-0">
      {STEPS.map((label, i) => {
        const lit = i < current;
        return (
          <li key={label} aria-current={i + 1 === current ? 'step' : undefined} className="flex flex-col gap-2">
            <span className={cn('h-1 rounded-sm', lit ? 'bg-accent' : 'bg-line-2')} />
            <span className={cn('text-xs font-semibold', lit ? 'text-text' : 'text-faint')}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
