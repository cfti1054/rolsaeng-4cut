import { DASHBOARD_TOP_RANKERS_LIMIT, RATING_START_ELO, type DashboardMe, type DashboardRecentResult, type DashboardSeason, type DashboardTopRankers, type ProfileBadge, type ScrimSummary } from '@gcd/shared';
import { formatYearMonth } from './format';
import { TEAM_LABEL } from './scrim-results';

/**
 * S4 홈·사이드바·뱃지 표시 로직(순수 함수). 계약 10절.
 * 최소 경기 수는 응답(rating_policy)만 쓴다(D101). 시즌 시작 점수는 고정 상수 RATING_START_ELO.
 */

/** 사이드바 시즌 진행 칸 수(목업) */
export const SEASON_PIPS = 12;
/** 홈 TOP 랭커를 모바일에서 그리는 수(목업 MobileHome) */
export const MOBILE_TOP_RANKERS = 3;

/** `D-34`, 마지막 날 `D-DAY` */
export function seasonDayText(daysLeft: number): string {
  return daysLeft === 0 ? 'D-DAY' : `D-${daysLeft}`;
}

/** 진행 칸. 앞에서 몇 칸을 채울지 */
export function seasonFilledPips(progress: number): number {
  return Math.round(progress * SEASON_PIPS);
}

/** 시즌마다 전원 RATING_START_ELO로 새로 시작한다(계약 20절 D183) */
export function seasonResetText(): string {
  return `종료 시 모두 ${RATING_START_ELO}점으로 초기화`;
}

export const SEASON_WAITING_TITLE = '다음 시즌 준비 중';
export const SEASON_WAITING_NOTE = '첫 내전 결과가 승인되면 시작돼요';

/**
 * 프로필 레이팅 카드의 값이 없을 때. scrim.ratings는 현재 시즌만이라, 시즌이 없는 동안(D143)에는 기록이 있어도 비어 있다.
 * 이때 「기록 없음」이라고 하지 않고 시즌 상태를 말한다(D168). 시즌이 한 번도 없던 경우에도 맞게 「종료」라고 단정하지 않는다.
 */
export function ratingEmptyText(scrim: { season: { name: string } | null } | null): { value: string; sub: string } {
  if (!scrim) return { value: '내전 기록 없음', sub: '아직 반영된 내전이 없어요' };
  if (!scrim.season) return { value: SEASON_WAITING_TITLE, sub: '현재 진행 중인 시즌이 없어요' };
  return { value: '내전 기록 없음', sub: scrim.season.name };
}

/** 모바일 머리 「시즌 2 · D-34」. season null → 「다음 시즌 준비 중」 */
export function mobileSeasonText(season: Pick<DashboardSeason, 'name' | 'days_left'> | null): string {
  return season ? `${season.name} · ${seasonDayText(season.days_left)}` : SEASON_WAITING_TITLE;
}

/** 사용자 카드 「ELO 1421 · #3」, rank null → 「ELO 1421」, me null → null(기존 표시) */
export function userEloText(me: Pick<DashboardMe, 'elo' | 'rank'> | null): string | null {
  if (!me) return null;
  return me.rank === null ? `ELO ${me.elo}` : `ELO ${me.elo} · #${me.rank}`;
}

/** 「롤 협곡 · 5 vs 5」, 팀이 없거나 홀수 정원이면 「롤체 · 8인」 */
export function scrimCapacityText(label: string, s: { capacity: number; game: { has_teams: boolean } }): string {
  if (s.game.has_teams && s.capacity % 2 === 0) return `${label} · ${s.capacity / 2} vs ${s.capacity / 2}`;
  return `${label} · ${s.capacity}인`;
}

/** 「외 {N}명 참가 중」. 아바타로 다 보이면 null */
export function othersJoinedText(joinedCount: number, shown: number): string | null {
  const rest = joinedCount - shown;
  return rest > 0 ? `외 ${rest}명 참가 중` : null;
}

/** 카운트다운 남은 초. 시작 시각이 지났거나 시각을 아직 모르면 null(화면 「곧 시작」) */
export function secondsUntil(iso: string, now: number | null): number | null {
  if (now === null) return null;
  const sec = Math.floor((Date.parse(iso) - now) / 1000);
  return sec > 0 ? sec : null;
}

/** 모집 줄 인원 막대(%) */
export function joinedPercent(s: Pick<ScrimSummary, 'joined_count' | 'capacity'>): number {
  return Math.min(100, Math.round((s.joined_count / s.capacity) * 100));
}

/** TOP 랭커 제목. is_final이면 시즌 이름을 붙인다 */
export function topRankersTitle(t: Pick<DashboardTopRankers, 'is_final' | 'season'> | null, limit: number = DASHBOARD_TOP_RANKERS_LIMIT): string {
  const head = t?.is_final ? `${t.season.name} 최종 ELO` : '시즌 ELO';
  return `${head} TOP ${limit}`;
}

/** 막대 폭(%) = elo ÷ 1위 elo */
export function eloBarPercent(elo: number, topElo: number): number {
  if (topElo <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((elo / topElo) * 100)));
}

export type ResultPillTone = 'pending' | 'applied' | 'none';

/** 상태 알약: pending 「승인 대기」, applied 「최대 16점 변동」·「반영 완료」(패배 배율로 승패 폭이 달라 ±로 쓰지 않는다), skipped·not_rated 「미반영」 */
export function recentResultStatus(r: Pick<DashboardRecentResult, 'result_status' | 'rating_status' | 'elo_swing'>): { text: string; tone: ResultPillTone } {
  if (r.result_status === 'pending') return { text: '승인 대기', tone: 'pending' };
  if (r.rating_status === 'applied') return { text: r.elo_swing === null ? '반영 완료' : `최대 ${r.elo_swing}점 변동`, tone: 'applied' };
  return { text: '미반영', tone: 'none' };
}

/** 결과 막대. 팀 게임은 양쪽 이름(승자에 WIN), 개인 순위는 1위 이름 */
export function recentResultOutcome(r: Pick<DashboardRecentResult, 'outcome'>):
  | { kind: 'team'; blue: string; orange: string; winner: 'blue' | 'orange' }
  | { kind: 'solo'; left: string; right: string } {
  const { winner_team: team, winner } = r.outcome;
  if (team) {
    return {
      kind: 'team',
      blue: team === 'blue' ? `${TEAM_LABEL.blue.tag} WIN` : TEAM_LABEL.blue.tag,
      orange: team === 'orange' ? `${TEAM_LABEL.orange.tag} WIN` : TEAM_LABEL.orange.tag,
      winner: team,
    };
  }
  return { kind: 'solo', left: '1위', right: winner?.nickname ?? '기록 없음' };
}

// -----------------------------------------------------------------------------
// 프로필 뱃지
// -----------------------------------------------------------------------------

export interface BadgeView {
  /** `#1`. 시즌 뱃지가 아니면 null(이름만) */
  mark: string | null;
  place: 1 | 2 | 3 | null;
  /** 「시즌 1 · 리그 오브 레전드 시즌 1위」 */
  title: string;
  /** `2026.06`. 시즌 뱃지 earned_at은 ends_at(배타적, 다음 달 1일 00:00)이라 끝나는 달로 보이게 1ms 앞 시각의 월을 쓴다 */
  when: string;
}

export function badgeView(b: ProfileBadge): BadgeView {
  const place = b.place === 1 || b.place === 2 || b.place === 3 ? b.place : null;
  return {
    mark: place === null ? null : `#${place}`,
    place,
    title: b.season ? `${b.season.name} · ${b.name}` : b.name,
    when: formatYearMonth(new Date(Date.parse(b.earned_at) - 1).toISOString()),
  };
}
