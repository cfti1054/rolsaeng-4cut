import { RATING_START_ELO } from '@gcd/shared';
import type { ReactNode } from 'react';
import { ThemeToggleButton } from '@/components/theme/theme-controls';
import { Eyebrow } from '@/components/ui/primitives';
import { brand } from '@/lib/brand';

const FEATURES = [
  {
    mark: '5V5',
    tile: 'bg-cyan/15 text-cyan-ink',
    title: '팀 자동 밸런스',
    desc: '티어와 내전 레이팅으로 126가지 조합 중 최적 3안',
  },
  {
    mark: 'ELO',
    tile: 'bg-accent/10 text-accent-ink',
    title: '서버 자체 내전 랭킹',
    desc: `운영진 승인 결과만 반영 · 시즌마다 ${RATING_START_ELO}점에서 새로 시작`,
  },
  {
    mark: 'API',
    tile: 'bg-violet/15 text-violet-ink',
    title: '라이엇 · 스팀 연동',
    desc: '티어, 최근 전적, 플레이타임 자동 동기화',
  },
];

/** 목업 Login: 왼쪽 소개 패널(lg 이상) + 오른쪽 로그인/닉네임 확인 단계 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <section
        aria-label="롤생네컷 소개"
        data-theme="dark"
        className="relative hidden min-h-[640px] flex-[1_1_520px] flex-col gap-10 overflow-hidden border-r border-hero-line bg-hero px-12 py-10 text-text lg:flex"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.loginHero} alt="" className="absolute inset-0 size-full object-cover object-[center_30%]" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-hero via-hero/88 to-hero/25" />

        <div className="relative flex items-center gap-3">
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-bold tracking-[-0.02em]">롤생네컷</span>
            <Eyebrow>GAME CLUB</Eyebrow>
          </span>
        </div>

        <div className="relative flex max-w-[460px] flex-col gap-4">
          <span className="self-start rounded-lg bg-accent px-2.5 py-1 font-display text-xs font-bold tracking-[0.14em] text-on-accent">
            LOL · TFT · STEAM
          </span>
          <h1 className="m-0 text-[44px] font-bold leading-[1.15] tracking-[-0.04em]">
            내전 모집부터
            <br />
            서버 랭킹까지,
            <br />
            한곳에서.
          </h1>
          <p className="m-0 text-[15px] leading-[1.7] text-muted">
            롤 · 롤체 · 스팀 게임방 멤버의 티어와 내전 레이팅을 모아 보고, 팀을 자동으로 나눠 바로 내전을
            시작하세요.
          </p>
        </div>

        <ul className="relative mt-auto flex max-w-[420px] list-none flex-col gap-2.5 p-0">
          {FEATURES.map((f) => (
            <li key={f.mark} className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface/90 px-4 py-3.5 backdrop-blur-sm">
              <span
                aria-hidden="true"
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl font-display text-xs font-bold ${f.tile}`}
              >
                {f.mark}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-bold">{f.title}</span>
                <span className="text-xs text-muted">{f.desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <main className="flex min-w-0 flex-[1_1_480px] flex-col px-6 pb-12 pt-6 md:pt-8">
        <div className="flex items-center justify-between lg:justify-end">
          <span className="flex items-center gap-2.5 lg:hidden">
            <span className="flex flex-col leading-tight">
              <span className="text-base font-bold">롤생네컷</span>
              <Eyebrow className="text-[10px]">GAME CLUB</Eyebrow>
            </span>
          </span>
          <ThemeToggleButton />
        </div>
        <div className="relative mt-4 h-36 overflow-hidden rounded-[20px] border border-hero-line lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.splash} alt="" className="size-full object-cover object-[center_28%]" />
        </div>
        <div className="flex flex-1 items-center justify-center pt-4">
          <div className="flex w-full max-w-[420px] flex-col gap-[22px]">{children}</div>
        </div>
      </main>
    </div>
  );
}
