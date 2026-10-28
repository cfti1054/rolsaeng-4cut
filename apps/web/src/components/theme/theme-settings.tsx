'use client';

import type { KeyboardEvent } from 'react';
import { Card, Eyebrow } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import type { ResolvedTheme, ThemeMode } from '@/lib/theme/theme';
import { useTheme } from './use-theme';

const OPTIONS: { id: ThemeMode; title: string; desc: string }[] = [
  { id: 'light', title: '라이트', desc: '밝은 배경 · 낮 시간용' },
  { id: 'dark', title: '다크', desc: '기본값 · 눈부심이 적어요' },
  { id: 'system', title: '시스템 설정', desc: '기기 설정을 따라 자동 전환' },
];

/**
 * 설정 「화면 테마」 섹션(목업 Settings). 3개 라디오 카드.
 * 미리보기는 목업의 고정 hex 대신 data-theme을 단 요소 안에서 토큰으로 그린다
 * → 선택한 테마와 무관하게 각 카드가 자기 테마 색을 보여 준다.
 */
export function ThemeSettingsSection() {
  const { mode, resolved, setMode } = useTheme();
  // 라디오 그룹 키보드 규칙: 화살표로 이동·선택, Tab 정지점은 선택된 카드 하나
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    if (!next) return;
    setMode(next.id);
    const group = e.currentTarget.parentElement;
    group?.querySelector<HTMLButtonElement>(`[data-mode="${next.id}"]`)?.focus();
  };
  return (
    <Card aria-labelledby="theme-title">
      <div className="flex flex-col gap-1">
        <Eyebrow>APPEARANCE</Eyebrow>
        <h2 id="theme-title" className="m-0 text-lg font-bold">
          화면 테마
        </h2>
        <p className="m-0 text-[13px] text-muted">
          이 기기에 저장되며, 사이드바의 라이트 · 다크 버튼으로도 바꿀 수 있어요.
        </p>
      </div>
      <div role="radiogroup" aria-labelledby="theme-title" className="flex flex-wrap gap-3">
        {OPTIONS.map((opt, index) => {
          const on = mode === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-mode={opt.id}
              tabIndex={on ? 0 : -1}
              onClick={() => setMode(opt.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                'flex min-w-0 flex-[1_1_200px] flex-col gap-3 rounded-[18px] border-2 bg-surface-2 p-3 text-left text-text',
                on ? 'border-accent' : 'border-line-2',
              )}
            >
              {opt.id === 'system' ? <SplitPreview /> : <Preview theme={opt.id} />}
              <span className="flex items-center justify-between gap-2 px-1 pb-0.5">
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold">{opt.title}</span>
                  <span className="text-xs text-muted">
                    {opt.desc}
                    {opt.id === 'system' && on ? ` · 지금 ${resolved === 'dark' ? '다크' : '라이트'}` : ''}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'size-5 shrink-0 rounded-full border-2',
                    on ? 'border-accent bg-accent' : 'border-line-2 bg-transparent',
                  )}
                />
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** 미니 대시보드 그림. data-theme 속성으로 그 테마의 토큰을 쓴다(색 직접 지정 없음). */
function Preview({ theme }: { theme: ResolvedTheme }) {
  return (
    <span
      aria-hidden="true"
      data-theme={theme}
      className="flex h-[92px] overflow-hidden rounded-xl border border-line-2 bg-bg"
    >
      <span className="flex w-[26%] flex-col gap-[5px] border-r border-line-2 bg-nav px-[7px] py-2.5">
        <span className="size-3.5 rounded bg-accent" />
        <span className="h-1 rounded-sm bg-line-2" />
        <span className="h-1 rounded-sm bg-line-2" />
        <span className="h-1 rounded-sm bg-line-2" />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2.5">
        <span className="h-1.5 w-3/5 rounded-[3px] bg-text" />
        <span className="flex flex-1 items-end rounded-[7px] border border-line-2 bg-surface p-1.5">
          <span className="h-[9px] w-[34px] rounded bg-accent" />
        </span>
      </span>
    </span>
  );
}

function SplitPreview() {
  return (
    <span aria-hidden="true" className="relative block h-[92px] overflow-hidden rounded-xl">
      <span className="absolute inset-0 [clip-path:polygon(0_0,62%_0,38%_100%,0_100%)]">
        <Preview theme="light" />
      </span>
      <span className="absolute inset-0 [clip-path:polygon(62%_0,100%_0,100%_100%,38%_100%)]">
        <Preview theme="dark" />
      </span>
    </span>
  );
}
