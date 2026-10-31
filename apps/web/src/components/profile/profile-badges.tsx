import type { ProfileBadge } from '@gcd/shared';
import { cn } from '@/lib/cn';
import { badgeView } from '@/lib/dashboard';

/** 순위별 색 토큰(글자 `#1`과 함께 쓴다) */
const PLACE_TONE = { 1: 'text-gold-text', 2: 'text-silver-text', 3: 'text-bronze-text' } as const;

/** 프로필 BADGES(목업 Profile, 계약 10절). []·null → 빈 문구. 시즌 뱃지가 아니면 코드 없이 이름만 */
export function ProfileBadges({ badges }: { badges: readonly ProfileBadge[] | null }) {
  if (!badges || badges.length === 0) {
    return <p className="m-0 rounded-2xl border border-dashed border-line-3 bg-surface-2 px-4 py-8 text-center text-sm text-muted">아직 받은 뱃지가 없어요</p>;
  }
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0">
      {badges.map((b) => {
        const v = badgeView(b);
        return (
          <li key={b.id} title={b.description ?? undefined} className="flex flex-col items-center gap-2 rounded-2xl border border-line-2 bg-surface-2 px-2.5 py-4 text-center">
            {v.mark && v.place && (
              <svg aria-hidden="true" width="48" height="52" viewBox="0 0 48 52" className={PLACE_TONE[v.place]}>
                <path d="M24 2 46 14v24L24 50 2 38V14z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="2" />
                <text x="24" y="31" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor" className="font-display">
                  {v.mark}
                </text>
              </svg>
            )}
            <span className={cn('text-[13px] font-semibold', !v.mark && 'py-1')}>{v.title}</span>
            <span className="font-display text-[11px] text-faint">{v.when}</span>
          </li>
        );
      })}
    </ul>
  );
}
