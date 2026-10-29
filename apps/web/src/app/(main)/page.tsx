'use client';

import Link from 'next/link';
import { Card, EmptyState, Eyebrow, Skeleton } from '@/components/ui/primitives';
import { brand } from '@/lib/brand';
import { useMe } from '@/lib/hooks/auth';
import { routes } from '@/lib/routes';

const dateFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' });

/** 홈(빈 상태). 다음 내전·요약·모집 목록은 S2·S4에서 채운다. */
export default function HomePage() {
  const me = useMe();
  const today = dateFmt
    .formatToParts(new Date())
    .filter((p) => p.type !== 'literal')
    .map((p) => p.value.toUpperCase());
  return (
    <>
      <header className="flex flex-col gap-1.5">
        <Eyebrow className="text-xs">
          <span suppressHydrationWarning>{`${today[0]} · ${today[1]} ${today[2]}`}</span>
        </Eyebrow>
        <h1 className="m-0 text-[26px] font-bold tracking-[-0.03em] md:text-[30px]">
          {me.data ? (
            <>안녕하세요, {me.data.nickname}님</>
          ) : (
            <Skeleton className="h-9 w-64" />
          )}
        </h1>
      </header>

      <section
        aria-label="다음 내전"
        data-theme="dark"
        className="relative overflow-hidden rounded-3xl border border-hero-line bg-hero px-6 py-8 text-text md:px-8"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.homeBanner} alt="" className="absolute inset-0 size-full object-cover object-[70%_center]" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-hero via-hero/85 to-hero/20" />
        <div className="relative flex max-w-md flex-col gap-3">
          <span className="self-start rounded-lg bg-accent px-2.5 py-1 font-display text-xs font-bold tracking-[0.14em] text-on-accent">
            NEXT MATCH
          </span>
          <h2 className="m-0 text-2xl font-bold tracking-[-0.03em]">아직 잡힌 내전이 없어요</h2>
          <p className="m-0 text-sm leading-relaxed text-muted">
            내전 모집과 참가 기능이 열리면 가장 가까운 내전이 여기에 표시돼요.
          </p>
        </div>
      </section>

      <Card aria-label="요약">
        <EmptyState
          mark="S0"
          image={brand.emptyWaiting}
          title="대시보드를 준비하고 있어요"
          description={
            <>
              내 레이팅, 티어, 이번 주 활동 요약은 게임 계정 연동과 랭킹 기능이 열리면 보여 드려요. 지금은{' '}
              <Link href={routes.settings()}>설정</Link>에서 화면 테마를 고를 수 있어요.
            </>
          }
        />
      </Card>
    </>
  );
}
