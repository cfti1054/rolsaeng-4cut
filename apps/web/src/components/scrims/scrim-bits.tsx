'use client';

import type { GameCode, ScrimRestriction } from '@gcd/shared';
import type { ReactNode } from 'react';
import { Notice } from '@/components/ui/controls';
import { isApiError } from '@/lib/api/client';
import { cn } from '@/lib/cn';
import { errorMessage, errorMessageWithRetry } from '@/lib/errors';
import { GAME_SCRIM_META, positionLabel, scrimGameTag } from '@/lib/games';
import { useMyScrimRestriction } from '@/lib/hooks/scrims';
import {
  kstMonthDayTime,
  restrictionPolicyText,
  restrictionText,
  scrimBannedUntilFromRetry,
  type BadgeTone,
} from '@/lib/scrims';

/** 목업 상태 알약(「모집 중」「정원 마감」). 색 + 글자로 구분(색만으로 구분하지 않음) */
export function StatusPill({ label, tone, className }: { label: string; tone: BadgeTone; className?: string }) {
  const toneClass: Record<BadgeTone, string> = {
    accent: 'bg-accent text-on-accent',
    orange: 'bg-orange text-on-accent',
    cyan: 'bg-cyan text-on-accent',
    violet: 'bg-violet text-on-accent',
    neutral: 'bg-chip text-text-2',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', toneClass[tone], className)}>
      {label}
    </span>
  );
}

/** 게임 태그(「LEAGUE · 5V5」) */
export function GameTag({ game, capacity, boxed = false }: { game: GameCode; capacity: number; boxed?: boolean }) {
  const meta = GAME_SCRIM_META[game];
  return (
    <span
      className={cn(
        'font-display text-xs font-bold tracking-[0.12em]',
        boxed ? cn('rounded-lg px-2.5 py-1', meta.tile) : cn('text-[13px]', meta.ink),
      )}
    >
      {scrimGameTag(game, capacity)}
    </span>
  );
}

/** 인원 칸(목업 pips). 20칸이 넘으면 막대 하나로 */
export function CapacityPips({ joined, capacity, game, full }: { joined: number; capacity: number; game: GameCode; full: boolean }) {
  const fill = full ? 'bg-orange' : GAME_SCRIM_META[game].dot;
  if (capacity > 20) {
    return (
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-sm bg-line-2">
        <div className={cn('h-full', fill)} style={{ width: `${Math.min(100, (joined / capacity) * 100)}%` }} />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="flex gap-[3px]">
      {Array.from({ length: capacity }, (_, i) => (
        <span key={i} className={cn('h-2 flex-1 rounded-[2px]', i < joined ? fill : 'bg-line-2')} />
      ))}
    </div>
  );
}

/** 포지션 칩(1지망 강조, 2지망 흐리게) */
export function PositionChips({ positions }: { positions: readonly string[] }) {
  if (positions.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="rounded-md border border-line-2 bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-2" title="1지망">
        {positionLabel(positions[0]!)}
      </span>
      {positions[1] && (
        <span className="text-[11px] text-faint" title="2지망">
          {positionLabel(positions[1])}
        </span>
      )}
    </span>
  );
}

/** 섹션 머리(목업 「ROSTER / 참가자」) */
export function SectionHead({ eyebrow, title, right, id }: { eyebrow: string; title: string; right?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-[11px] font-semibold tracking-[0.16em] text-faint">{eyebrow}</span>
        <h2 id={id} className="m-0 text-lg font-bold">
          {title}
        </h2>
      </div>
      {right}
    </div>
  );
}

/** 내전 API 오류 문구. SCRIM_BANNED는 해제 시각을 붙인다(조회값 우선, 없으면 Retry-After) */
export function scrimErrorText(err: unknown, restriction?: ScrimRestriction | null): string {
  if (!isApiError(err)) return errorMessage('NETWORK_ERROR');
  if (err.code === 'SCRIM_BANNED') {
    const until = restriction?.until ?? scrimBannedUntilFromRetry(err.retryAfterSec, Date.now());
    return until ? `${errorMessage('SCRIM_BANNED')} ${kstMonthDayTime(until)}에 풀려요.` : errorMessage('SCRIM_BANNED');
  }
  if (err.code === 'VALIDATION_FAILED' && err.details?.length) {
    return `${errorMessage('VALIDATION_FAILED')} (${err.details.map((d) => d.message).join(', ')})`;
  }
  return errorMessageWithRetry(err.code, err.retryAfterSec);
}

/** 노쇼 제한 배너(목록·작성 화면). 제한이 아니면 아무것도 그리지 않는다 */
export function RestrictionBanner({ restriction }: { restriction: ScrimRestriction | undefined }) {
  if (!restriction) return null;
  const text = restrictionText(restriction);
  if (!text) return null;
  return (
    <div role="status">
      <Notice title={text}>{restrictionPolicyText(restriction)}</Notice>
    </div>
  );
}

/** 제한 조회 + 배너 문구 묶음 */
export function useRestriction() {
  const q = useMyScrimRestriction();
  const r = q.data;
  return { query: q, restriction: r, restricted: r?.restricted === true };
}
