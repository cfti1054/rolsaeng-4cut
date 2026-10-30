import { autoSeasonName } from '@gcd/shared';
import { DAY_MS, KST_OFFSET_MS } from './config';

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
