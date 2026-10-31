import { SEASON_BADGE_PLACES, autoSeasonName, type SeasonBadgePlace } from '@gcd/shared';
import { DAY_MS, KST_OFFSET_MS } from './config';
import { buildEloRanking } from './ranking';

// =============================================================================
// S3 시즌(계약 S3 6절·7-5, D116). 구간은 반열림 [startsAt, endsAt). 시각은 인자로 받는다.
// =============================================================================

export type SeasonLike = { id: string; startsAt: Date; endsAt: Date };

function assertValidDate(d: Date, name: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RangeError(`${name}: 올바른 Date가 아님`);
  }
}

/** startsAt 최신 우선, 같으면 id 문자열 작은 것 */
function pickLatestStart<T extends SeasonLike>(list: readonly T[]): T | null {
  let best: T | null = null;
  for (const s of list) {
    if (
      best === null ||
      s.startsAt.getTime() > best.startsAt.getTime() ||
      (s.startsAt.getTime() === best.startsAt.getTime() && s.id < best.id)
    ) {
      best = s;
    }
  }
  return best;
}

/** at이 속한 시즌(startsAt ≤ at < endsAt). 여럿이면 startsAt 최신, 같으면 id ASC. 없으면 null */
export function resolveSeasonAt<T extends SeasonLike>(seasons: readonly T[], at: Date): T | null {
  assertValidDate(at, 'at');
  const t = at.getTime();
  return pickLatestStart(seasons.filter((s) => s.startsAt.getTime() <= t && t < s.endsAt.getTime()));
}

/** startsAt ≤ at인 시즌 중 startsAt 최신(같으면 id ASC). 그래프 기본 시즌 대체용 */
export function latestStartedSeason<T extends SeasonLike>(seasons: readonly T[], at: Date): T | null {
  assertValidDate(at, 'at');
  const t = at.getTime();
  return pickLatestStart(seasons.filter((s) => s.startsAt.getTime() <= t));
}

/** d의 KST 달 1일 00:00:00.000 KST */
export function kstMonthStart(d: Date): Date {
  assertValidDate(d, 'd');
  const kst = new Date(d.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1) - KST_OFFSET_MS);
}

/**
 * KST 달력 기준 월 더하기. 일이 그 달 말일을 넘으면 말일로 자르고 시각(KST)은 유지.
 * 예: 2027-01-31 10:00 KST + 1 → 2027-02-28 10:00 KST. months는 정수(음수 허용).
 */
export function addKstMonths(d: Date, months: number): Date {
  assertValidDate(d, 'd');
  if (!Number.isInteger(months)) throw new RangeError(`months: 정수여야 함 (${months})`);
  const kstMs = d.getTime() + KST_OFFSET_MS;
  const timeOfDay = ((kstMs % DAY_MS) + DAY_MS) % DAY_MS;
  const kst = new Date(kstMs);
  const total = kst.getUTCFullYear() * 12 + kst.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(kst.getUTCDate(), lastDay);
  const dayStart = Date.UTC(y, m, day);
  return new Date(dayStart + timeOfDay - KST_OFFSET_MS);
}

/**
 * 자동 시즌 계획(6절 1–4). at을 포함하는 시즌이 이미 있으면 RangeError.
 * 1. prev = endsAt ≤ at 중 endsAt 최대. start = prev ? prev.endsAt : kstMonthStart(at)
 * 2. end = addKstMonths(start, lengthMonths). end ≤ at이면 start를 직전 끝 이후 첫 KST 달 1일 00:00으로 맞춘 뒤
 *    start = end로 넘겨 반복(빈 시즌은 만들지 않음, D139)
 * 3. next = startsAt > at 중 startsAt 최소. end > next.startsAt이면 end = next.startsAt
 * 4. name = autoSeasonName(seasons.length + 1)
 */
export function planAutoSeason(input: {
  seasons: readonly SeasonLike[];
  at: Date;
  lengthMonths: number;
}): { name: string; startsAt: Date; endsAt: Date } {
  const { seasons, at, lengthMonths } = input;
  assertValidDate(at, 'at');
  if (!Number.isInteger(lengthMonths) || lengthMonths < 1) {
    throw new RangeError(`lengthMonths: 1 이상의 정수 (${lengthMonths})`);
  }
  if (resolveSeasonAt(seasons, at) !== null) {
    throw new RangeError('at이 이미 어떤 시즌에 속함');
  }
  const t = at.getTime();

  let prevEnd: number | null = null;
  let nextStart: number | null = null;
  for (const s of seasons) {
    const e = s.endsAt.getTime();
    const st = s.startsAt.getTime();
    if (e <= t && (prevEnd === null || e > prevEnd)) prevEnd = e;
    if (st > t && (nextStart === null || st < nextStart)) nextStart = st;
  }

  let start = prevEnd !== null ? new Date(prevEnd) : kstMonthStart(at);
  let end = addKstMonths(start, lengthMonths);
  if (end.getTime() <= t) {
    const monthStart = kstMonthStart(start);
    if (monthStart.getTime() !== start.getTime()) start = addKstMonths(monthStart, 1);
    end = addKstMonths(start, lengthMonths);
  }
  while (end.getTime() <= t) {
    start = end;
    end = addKstMonths(start, lengthMonths);
  }
  if (nextStart !== null && end.getTime() > nextStart) end = new Date(nextStart);

  return { name: autoSeasonName(seasons.length + 1), startsAt: start, endsAt: end };
}

// =============================================================================
// S4 시즌 종료·표시(계약 S4 6절, D141–D145). 레이팅 이월(소프트 리셋)은 없다(20절 D183):
// 새 시즌 행은 모두 RATING_START_ELO(@gcd/shared)로 시작한다.
// =============================================================================

/** 종료 작업 대상(6-3 2번): closedAt 없음 && endsAt + graceMs ≤ now. endsAt ASC, id ASC. 입력을 바꾸지 않는다 */
export function selectSeasonsToClose<T extends SeasonLike & { closedAt: Date | null }>(
  seasons: readonly T[],
  now: Date,
  graceMs: number,
): T[] {
  assertValidDate(now, 'now');
  if (!Number.isFinite(graceMs) || graceMs < 0) {
    throw new RangeError(`graceMs: 0 이상의 유한한 숫자여야 함 (${graceMs})`);
  }
  const t = now.getTime();
  return seasons
    .filter((s) => s.closedAt == null && s.endsAt.getTime() + graceMs <= t)
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 최종 순위(D145): minGames 이상만, 순위 규칙은 buildEloRanking과 같다 */
export function computeSeasonStandings(input: {
  rows: readonly { userId: string; elo: number; wins: number; losses: number }[];
  minGames: number;
}): { userId: string; rank: number; elo: number; wins: number; losses: number }[] {
  return buildEloRanking(input).map(({ userId, rank, elo, wins, losses }) => ({ userId, rank, elo, wins, losses }));
}

/** 시즌 뱃지 지급 대상(6-4): 순위 1·2·3. 순위 오름차순으로 돌려준다 */
export function computeSeasonBadges(
  standings: readonly { userId: string; rank: number }[],
): { userId: string; place: SeasonBadgePlace }[] {
  const places: readonly number[] = SEASON_BADGE_PLACES;
  return standings
    .filter((s) => places.includes(s.rank))
    .map((s) => ({ userId: s.userId, place: s.rank as SeasonBadgePlace }))
    .sort((a, b) => a.place - b.place || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

const kstDayNumber = (ms: number): number => Math.floor((ms + KST_OFFSET_MS) / DAY_MS);

/** 남은 일수: (endsAt − 1ms)의 KST 날짜 − now의 KST 날짜, 최소 0. 마지막 날과 끝난 뒤는 0 */
export function seasonDaysLeft(endsAt: Date, now: Date): number {
  assertValidDate(endsAt, 'endsAt');
  assertValidDate(now, 'now');
  return Math.max(0, kstDayNumber(endsAt.getTime() - 1) - kstDayNumber(now.getTime()));
}

/** 시즌 진행률: 0–1로 자르고 소수 셋째 자리 반올림. 길이가 0 이하인 구간도 나누지 않고 0 또는 1을 돌려준다 */
export function seasonProgress(season: { startsAt: Date; endsAt: Date }, now: Date): number {
  assertValidDate(season.startsAt, 'startsAt');
  assertValidDate(season.endsAt, 'endsAt');
  assertValidDate(now, 'now');
  const start = season.startsAt.getTime();
  const end = season.endsAt.getTime();
  const t = now.getTime();
  if (t <= start) return 0;
  if (t >= end) return 1;
  return Math.round(((t - start) / (end - start)) * 1000) / 1000;
}
