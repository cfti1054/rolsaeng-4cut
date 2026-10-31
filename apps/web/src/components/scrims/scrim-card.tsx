'use client';

import { steamAppHeaderImageUrl, TFT_MODE_LABEL, type ScrimSummary } from '@gcd/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, ConfirmDialog } from '@/components/ui/controls';
import { brand } from '@/lib/brand';
import { cn } from '@/lib/cn';
import { GAME_SCRIM_META, scrimGameTag } from '@/lib/games';
import { useDeleteScrim } from '@/lib/hooks/scrims';
import { routes } from '@/lib/routes';
import {
  isOpenStatus,
  kstClock,
  scrimCardAction,
  scrimCardBadge,
  scrimDayLabel,
  scrimNeedLine,
  scrimOptionTags,
  scrimOutcomeLine,
} from '@/lib/scrims';
import { CapacityPips, StatusPill } from './scrim-bits';

/** 옅은 배너색(라이트 토큰 banner-*)으로 왼쪽 글자 자리를 덮는다. */
const BANNER_WASH = {
  lol: 'from-banner-lol/80',
  tft: 'from-banner-tft/80',
  steam: 'from-banner-steam/80',
} as const;

const ACTION_CLASS = {
  primary: 'bg-accent text-on-accent hover:text-on-accent',
  secondary: 'bg-line-2 text-text hover:text-text',
  mine: 'bg-surface-2 text-accent-ink hover:text-accent-ink-hover',
} as const;

/**
 * 목록 카드(목업 Scrims article). 모든 버튼은 상세로 이동한다(D91).
 * preview면 링크 대신 글자만(작성 화면 미리보기).
 */
export function ScrimCard({ s, now, preview = false }: { s: ScrimSummary; now: number | null; preview?: boolean }) {
  const meta = GAME_SCRIM_META[s.game.code];
  const badge = scrimCardBadge(s);
  const need = scrimNeedLine(s);
  const outcome = scrimOutcomeLine(s);
  const action = scrimCardAction(s);
  const mine = isOpenStatus(s.status) && (s.my_status === 'joined' || s.my_status === 'waitlist');
  const day = now === null ? '' : scrimDayLabel(s.scheduled_at, now);
  const href = routes.scrim(s.id);
  const titleId = `scrim-${s.id}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-[20px] border bg-surface shadow-[inset_0_1px_0_var(--hi)]',
        mine ? 'border-accent/35' : 'border-line',
      )}
    >
      <div data-theme={s.steam_app ? 'dark' : 'light'} className={cn('relative h-[92px] overflow-hidden text-text', meta.banner)}>
        {s.steam_app ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={steamAppHeaderImageUrl(s.steam_app.app_id)}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover opacity-35"
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.gameBanner[s.game.code]} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-80" />
            <div aria-hidden="true" className={cn('absolute inset-0 bg-gradient-to-r via-transparent to-transparent', BANNER_WASH[s.game.code])} />
          </>
        )}
        <div className="absolute inset-0 flex items-start justify-between px-[18px] py-4">
          <span className={cn('font-display text-[13px] font-bold tracking-[0.12em]', meta.ink)}>{scrimGameTag(s.game.code, s.capacity)}</span>
          <StatusPill label={badge.label} tone={badge.tone} />
        </div>
        <time
          dateTime={s.scheduled_at}
          className="absolute bottom-3 left-[18px] font-display text-[22px] font-bold text-text"
        >
          {kstClock(s.scheduled_at)}
        </time>
      </div>

      <div className="flex flex-1 flex-col gap-3.5 px-[18px] pb-[18px] pt-4">
        <div className="flex flex-col gap-1">
          {preview ? (
            <span id={titleId} className="break-words text-base font-bold tracking-[-0.02em] text-text">
              {s.title || '제목을 입력해 주세요'}
            </span>
          ) : (
            <Link
              id={titleId}
              href={href}
              className="break-words text-base font-bold tracking-[-0.02em] text-text no-underline hover:text-text hover:underline"
            >
              {s.title}
            </Link>
          )}
          {s.steam_app && <span className="truncate text-[13px] font-semibold text-orange-ink">{s.steam_app.name}</span>}
          <span className="text-[13px] text-muted">
            {day && `${day} · `}방장 {s.host.nickname}
          </span>
        </div>

        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="진행 방식">
          {s.tft_mode && (
            <li className="rounded-lg border border-line-2 bg-surface-2 px-[9px] py-[3px] text-xs text-text-2">{TFT_MODE_LABEL[s.tft_mode]}</li>
          )}
          {scrimOptionTags(s.options).map((tag) => (
            <li key={tag} className="rounded-lg border border-line-2 bg-surface-2 px-[9px] py-[3px] text-xs text-text-2">
              {tag}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <div className="flex justify-between gap-2 text-[13px]">
            {outcome ? (
              <span
                className={cn(
                  'flex items-center gap-1.5 font-semibold',
                  outcome.team === 'blue' ? 'text-blue-ink' : outcome.team === 'orange' ? 'text-team-red-ink' : 'text-accent-ink',
                )}
              >
                {outcome.team && (
                  <span aria-hidden="true" className={cn('size-2 rounded-full', outcome.team === 'blue' ? 'bg-blue' : 'bg-team-red')} />
                )}
                {outcome.text}
              </span>
            ) : (
              <span className={need.emphasis ? 'text-orange-ink-2' : 'text-muted'}>{need.text}</span>
            )}
            <span className="font-display font-semibold" aria-label={`정원 ${s.capacity}명 중 ${s.joined_count}명 참가`}>
              {s.joined_count} / {s.capacity}
            </span>
          </div>
          <CapacityPips joined={s.joined_count} capacity={s.capacity} game={s.game.code} full={s.status === 'full'} />
        </div>

        {preview ? (
          <span
            aria-hidden="true"
            className={cn('mt-auto flex h-[46px] items-center justify-center rounded-[14px] text-sm font-bold', ACTION_CLASS.primary)}
          >
            참가하기
          </span>
        ) : (
          // 삭제(관리자)는 주 버튼 오른쪽에 같은 높이·모서리로 붙인다. 위에 따로 두면 mt-auto 때문에 카드마다 간격이 달라진다
          <div className="mt-auto flex gap-2">
            <Link
              href={href}
              aria-label={`${s.title} — ${action.label}`}
              className={cn(
                'flex h-[46px] min-w-0 flex-1 items-center justify-center rounded-[14px] text-sm font-bold no-underline',
                ACTION_CLASS[action.tone],
              )}
            >
              {action.label}
            </Link>
            {s.can_delete && <DeleteScrimButton id={s.id} title={s.title} size="lg" />}
          </div>
        )}
      </div>
    </article>
  );
}

export function DeleteScrimButton({
  id,
  title,
  className,
  size,
}: {
  id: string;
  title: string;
  className?: string;
  /** md = 상세 머리(링크 복사와 같은 40px), lg = 카드 하단(주 버튼과 같은 46px) */
  size?: 'md' | 'lg';
}) {
  const router = useRouter();
  const del = useDeleteScrim(id);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" size={size} onClick={() => setOpen(true)} className={className} aria-label={`${title} 삭제`}>
        삭제
      </Button>
      <ConfirmDialog
        open={open}
        title="내전을 삭제할까요?"
        description={`「${title}」 카드가 목록에서 사라집니다. 되돌릴 수 없어요.`}
        confirmLabel={del.isPending ? '지우는 중…' : '삭제'}
        pending={del.isPending}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          del.mutate(undefined, {
            onSuccess: () => {
              setOpen(false);
              if (window.location.pathname.endsWith(id)) router.push(routes.scrims());
            },
          });
        }}
      />
    </>
  );
}
