import { SEASON_BADGE_PLACES, autoSeasonName, type AdminSeasonPhase, type SeasonBadgePlace } from '@gcd/shared';
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

export type CalendarQuarter = {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  name: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * at이 속한 한국 시간 달력 분기. 1분기 1월 1일, 2분기 4월 1일, 3분기 7월 1일, 4분기 10월 1일 0시.
 * 끝은 다음 분기 시작(포함하지 않음). 이름 `2026년 4분기`.
 */
export function calendarQuarterOf(at: Date): CalendarQuarter {
  assertValidDate(at, 'at');
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const quarter = (Math.floor(kst.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  const startMonth = (quarter - 1) * 3;
  const startsAt = new Date(Date.UTC(year, startMonth, 1) - KST_OFFSET_MS);
  const endsAt = new Date(Date.UTC(year, startMonth + 3, 1) - KST_OFFSET_MS);
  return { year, quarter, name: `${year}년 ${quarter}분기`, startsAt, endsAt };
}

/**
 * 결과 승인으로 만드는 분기. at을 포함하는 기간이 이미 있으면 RangeError.
 * 기본은 그 시각의 달력 분기 전체. 이미 있는 기간과 겹치면, 직전 끝 또는 다음 시작에 맞춰 자른다.
 */
export function planCalendarQuarter(input: { seasons: readonly SeasonLike[]; at: Date }): { name: string; startsAt: Date; endsAt: Date } {
  const { seasons, at } = input;
  assertValidDate(at, 'at');
  if (resolveSeasonAt(seasons, at) !== null) {
    throw new RangeError('at이 이미 어떤 분기에 속함');
  }
  const quarter = calendarQuarterOf(at);
  const t = at.getTime();
  let start = quarter.startsAt.getTime();
  let end = quarter.endsAt.getTime();
  for (const s of seasons) {
    const e = s.endsAt.getTime();
    const st = s.startsAt.getTime();
    if (e <= t && e > start) start = e;
    if (st > t && st < end) end = st;
  }
  if (!(start <= t && t < end)) {
    throw new RangeError('분기 구간을 만들 수 없음');
  }
  return { name: quarter.name, startsAt: new Date(start), endsAt: new Date(end) };
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

// =============================================================================
// S6 시즌 관리(계약 S6 11절, D268–D271). 단계는 저장 컬럼이 아니라 now 기준 파생값.
// =============================================================================

/** shared AdminSeasonPhase와 같은 값 */
export type SeasonPhase = AdminSeasonPhase;
type SeasonWithClose = SeasonLike & { closedAt: Date | null };

/** closedAt 있음 → closed(시각 무관) / now < startsAt → upcoming / now < endsAt → current / 그 외 ended */
export function seasonPhase(season: SeasonWithClose, now: Date): SeasonPhase {
  assertValidDate(season.startsAt, 'startsAt');
  assertValidDate(season.endsAt, 'endsAt');
  assertValidDate(now, 'now');
  if (season.closedAt != null) return 'closed';
  const t = now.getTime();
  if (t < season.startsAt.getTime()) return 'upcoming';
  if (t < season.endsAt.getTime()) return 'current';
  return 'ended';
}

/** 11-1 표: name 항상 / startsAt upcoming / endsAt upcoming·current / delete upcoming */
export function seasonEditable(phase: SeasonPhase): { name: boolean; startsAt: boolean; endsAt: boolean; delete: boolean } {
  switch (phase) {
    case 'upcoming':
      return { name: true, startsAt: true, endsAt: true, delete: true };
    case 'current':
      return { name: true, startsAt: false, endsAt: true, delete: false };
    case 'ended':
    case 'closed':
      return { name: true, startsAt: false, endsAt: false, delete: false };
    default:
      throw new RangeError(`phase: 알 수 없는 값 (${String(phase)})`);
  }
}

export type SeasonWriteIssue =
  | { kind: 'not_editable'; field: 'starts_at' | 'ends_at' | 'delete' }
  | { kind: 'invalid'; path: 'starts_at' | 'ends_at'; message: string }
  | { kind: 'overlap'; seasonId: string };

function assertNonNegativeMs(v: number, name: string): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    throw new RangeError(`${name}: 0 이상의 유한한 숫자여야 함 (${v})`);
  }
}

/**
 * 시즌 생성·수정 검사(11-1·11-2). target null = 생성. next = 수정 후 값(안 바꾼 필드는 현재 값).
 * changed = 요청에 있고 값이 다른 필드(생성이면 무시하고 둘 다 바뀐 것으로 본다).
 * - not_editable: 단계상 허용하지 않는 필드 변경(starts_at → ends_at 순)
 * - invalid: (생성 또는 upcoming의 starts_at 변경) starts_at ≥ now + minLeadMs /
 *   (기간 변경 시) ends_at > starts_at, 길이 minLengthMs–maxLengthMs(양끝 포함) / (current의 ends_at 변경) ends_at ≥ now + minLeadMs
 * - overlap: 기간 변경 시 target을 뺀 시즌과 [start, end) 반열림 교집합이 있음. startsAt ASC, id ASC
 * 반환 순서: not_editable 전부 → invalid 전부 → overlap. 이름만 바꾸면 []
 */
export function validateSeasonWrite(input: {
  seasons: readonly SeasonWithClose[];
  target: SeasonWithClose | null;
  next: { startsAt: Date; endsAt: Date };
  changed: { startsAt: boolean; endsAt: boolean };
  now: Date;
  policy: { minLeadMs: number; minLengthMs: number; maxLengthMs: number };
}): SeasonWriteIssue[] {
  const { seasons, target, next, now, policy } = input;
  assertValidDate(next.startsAt, 'next.startsAt');
  assertValidDate(next.endsAt, 'next.endsAt');
  assertValidDate(now, 'now');
  assertNonNegativeMs(policy.minLeadMs, 'policy.minLeadMs');
  assertNonNegativeMs(policy.minLengthMs, 'policy.minLengthMs');
  assertNonNegativeMs(policy.maxLengthMs, 'policy.maxLengthMs');
  if (policy.maxLengthMs < policy.minLengthMs) {
    throw new RangeError('policy: maxLengthMs가 minLengthMs보다 작음');
  }

  const creating = target === null;
  const changed = creating ? { startsAt: true, endsAt: true } : input.changed;
  const phase: SeasonPhase = creating ? 'upcoming' : seasonPhase(target, now);
  const editable = seasonEditable(phase);
  const nowMs = now.getTime();
  const start = next.startsAt.getTime();
  const end = next.endsAt.getTime();

  const notEditable: SeasonWriteIssue[] = [];
  if (changed.startsAt && !editable.startsAt) notEditable.push({ kind: 'not_editable', field: 'starts_at' });
  if (changed.endsAt && !editable.endsAt) notEditable.push({ kind: 'not_editable', field: 'ends_at' });

  const invalid: SeasonWriteIssue[] = [];
  if (phase === 'upcoming' && changed.startsAt && start < nowMs + policy.minLeadMs) {
    invalid.push({ kind: 'invalid', path: 'starts_at', message: '시작 시각은 지금부터 일정 시간 뒤여야 해요' });
  }
  const periodChanged = changed.startsAt || changed.endsAt;
  if (periodChanged) {
    if (end <= start) {
      invalid.push({ kind: 'invalid', path: 'ends_at', message: '끝 시각은 시작 시각보다 뒤여야 해요' });
    } else if (end - start < policy.minLengthMs || end - start > policy.maxLengthMs) {
      invalid.push({ kind: 'invalid', path: 'ends_at', message: '시즌 길이가 허용 범위를 벗어났어요' });
    }
  }
  if (phase === 'current' && changed.endsAt && end < nowMs + policy.minLeadMs) {
    invalid.push({ kind: 'invalid', path: 'ends_at', message: '진행 중 시즌의 새 끝 시각은 지금부터 일정 시간 뒤여야 해요' });
  }

  const overlap: SeasonWriteIssue[] = [];
  if (periodChanged) {
    seasons
      .filter((s) => (creating || s.id !== target.id) && s.startsAt.getTime() < end && start < s.endsAt.getTime())
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .forEach((s) => overlap.push({ kind: 'overlap', seasonId: s.id }));
  }

  return [...notEditable, ...invalid, ...overlap];
}

/** 삭제 검사(D271): upcoming만 [], 그 외 [{ not_editable, delete }] */
export function validateSeasonDelete(season: SeasonWithClose, now: Date): SeasonWriteIssue[] {
  return seasonEditable(seasonPhase(season, now)).delete ? [] : [{ kind: 'not_editable', field: 'delete' }];
}
