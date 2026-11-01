/**
 * 내전 모집·참가·대기열·시작·자동 마감 순수 함수(계약 S2 5절·7절).
 * 시각·설정값은 모두 인자로 받는다(core는 시계·env를 읽지 않는다).
 */
import { SCRIM_MIN_PLAYERS_TO_START, type ScrimStatus } from '@gcd/shared';
import { DAY_MS, MINUTE_MS } from './config';

export type WaitlistRow = { id: string; joinedAt: Date };
export type OpenScrimStatus = 'recruiting' | 'full';

function assertValidDate(d: Date, name: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RangeError(`${name}: 올바른 Date가 아님`);
  }
}

function assertCount(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 0) {
    throw new RangeError(`${name}: 0 이상의 정수여야 함 (${v})`);
  }
}

/**
 * 대기열 순서(D85): joinedAt 오름차순, 같으면 id 문자열 오름차순. 입력 배열은 바꾸지 않는다.
 * id 비교는 로캘 무관 코드 유닛 비교(DB `ORDER BY id`의 UUID 순서와 같은 소문자 hex 기준).
 */
export function orderWaitlist<T extends WaitlistRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const d = a.joinedAt.getTime() - b.joinedAt.getTime();
    if (d !== 0) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** 새 참가 신청 배치: joinedCount < capacity → joined, 아니면 waitlist */
export function placeNewParticipant(joinedCount: number, capacity: number): 'joined' | 'waitlist' {
  return joinedCount < capacity ? 'joined' : 'waitlist';
}

/** 모집 중 상태: joinedCount ≥ capacity → full, 아니면 recruiting */
export function statusForJoinedCount(joinedCount: number, capacity: number): OpenScrimStatus {
  return joinedCount >= capacity ? 'full' : 'recruiting';
}

/**
 * 참가 취소·정원 변경 뒤 대기열 승격과 다음 상태(5-3 6단계, 5-4 4단계).
 * 빈 자리 = max(0, capacity − joinedCount)만큼 orderWaitlist 앞에서 승격.
 * joinedCount > capacity면 RangeError(D79: 정원을 joined 수 아래로 줄일 수 없다).
 */
export function planRosterAfterChange(input: {
  capacity: number;
  joinedCount: number;
  waitlist: readonly WaitlistRow[];
}): { promoteIds: string[]; nextStatus: OpenScrimStatus } {
  const { capacity, joinedCount, waitlist } = input;
  assertCount(capacity, 'capacity');
  assertCount(joinedCount, 'joinedCount');
  if (joinedCount > capacity) {
    throw new RangeError(`joinedCount(${joinedCount})가 capacity(${capacity})보다 큼`);
  }
  const free = Math.max(0, capacity - joinedCount);
  const promoteIds = orderWaitlist(waitlist)
    .slice(0, free)
    .map((r) => r.id);
  return {
    promoteIds,
    nextStatus: statusForJoinedCount(joinedCount + promoteIds.length, capacity),
  };
}

/**
 * 희망 포지션 검증(D82).
 * - usePositions: 1–2개(1지망 필수, 2지망 선택), 모두 gamePositions 안, 중복 없음.
 * - 그 외: 빈 배열만 허용.
 */
export function validatePreferredPositions(
  input: readonly string[],
  gamePositions: readonly string[],
  usePositions: boolean,
): { ok: true } | { ok: false; message: string } {
  if (!usePositions) {
    return input.length === 0 ? { ok: true } : { ok: false, message: '이 내전은 포지션을 받지 않아요' };
  }
  if (input.length === 0) return { ok: false, message: '1지망 포지션을 골라 주세요' };
  if (input.length > 2) return { ok: false, message: '희망 포지션은 최대 2개(1지망·2지망)까지 고를 수 있어요' };
  const allowed = new Set(gamePositions);
  for (const p of input) {
    if (!allowed.has(p)) return { ok: false, message: `이 게임에 없는 포지션이에요: ${p}` };
  }
  if (new Set(input).size !== input.length) {
    return { ok: false, message: '1지망과 2지망은 서로 달라야 해요' };
  }
  return { ok: true };
}

/** 시작 시각 검사: scheduledAt ≤ now → not_future, scheduledAt > now + maxDaysAhead일 → too_far */
export function validateScrimSchedule(
  scheduledAt: Date,
  now: Date,
  maxDaysAhead: number,
): 'ok' | 'not_future' | 'too_far' {
  assertValidDate(scheduledAt, 'scheduledAt');
  assertValidDate(now, 'now');
  const s = scheduledAt.getTime();
  const n = now.getTime();
  if (s <= n) return 'not_future';
  if (s > n + maxDaysAhead * DAY_MS) return 'too_far';
  return 'ok';
}

/** 정원 범위: 정수 && min ≤ capacity ≤ max && (capacity − min)이 step의 배수(step 생략 = 1) */
export function isCapacityInRange(capacity: number, range: { min: number; max: number; step?: number }): boolean {
  const step = range.step ?? 1;
  return Number.isInteger(capacity) && capacity >= range.min && capacity <= range.max && (capacity - range.min) % step === 0;
}

/**
 * 시작 가능 여부(D78, D96): 꽉 차야 시작하는 게임(games.start_requires_full, 롤)은 joined = capacity,
 * 그 외는 SCRIM_MIN_PLAYERS_TO_START(2)명 이상.
 */
export function canStartScrim(input: { requiresFull: boolean; capacity: number; joinedCount: number }): boolean {
  if (input.requiresFull) return input.joinedCount === input.capacity;
  return input.joinedCount >= SCRIM_MIN_PLAYERS_TO_START;
}

/**
 * 자동 마감 판정(5-5): 모집 중(recruiting·full)이고 now ≥ scheduledAt + autoCloseAfterMin분일 때만
 * canStart → 'start', 아니면 'cancel'. 그 외 null(건너뜀).
 */
export function decideOverdueScrim(input: {
  status: ScrimStatus;
  scheduledAt: Date;
  now: Date;
  autoCloseAfterMin: number;
  canStart: boolean;
}): 'start' | 'cancel' | null {
  const { status, scheduledAt, now, autoCloseAfterMin, canStart } = input;
  assertValidDate(scheduledAt, 'scheduledAt');
  assertValidDate(now, 'now');
  if (status !== 'recruiting' && status !== 'full') return null;
  if (now.getTime() < scheduledAt.getTime() + autoCloseAfterMin * MINUTE_MS) return null;
  return canStart ? 'start' : 'cancel';
}

/**
 * 포지션별 남은 자리(목업 「서폿 1 · 정글 1 구함」).
 * - 빈 자리(capacity − firstChoices.length) ≤ 0 → [].
 * - positions가 비었거나 capacity가 positions.length로 나누어떨어지지 않으면 [].
 * - 포지션당 정원 = capacity / positions.length, raw_p = max(0, 그 값 − 1지망이 그 포지션인 수).
 * - Σ raw_p > 빈 자리 → [](D100: 1지망 쏠림으로 「탑 2 · 정글 2 …」가 실제 빈 자리보다 많아 보이는 것을 막는다.
 *   포지션별 min(raw, 빈 자리) 자르기로는 합계가 여전히 넘으므로 쓰지 않는다. 카드는 「N자리 남음」으로 표시).
 * - 그 외 raw_p ≥ 1만 positions 순서로.
 * 불변식: 결과 count 합계 ≤ 빈 자리(따라서 각 count ≤ 빈 자리).
 * firstChoices의 null(1지망 없음)과 positions 밖 값은 자리 수에는 들어가지만 어느 포지션도 줄이지 않는다.
 */
export function computeOpenPositions(
  positions: readonly string[],
  capacity: number,
  firstChoices: readonly (string | null)[],
): { position: string; count: number }[] {
  const open = capacity - firstChoices.length;
  if (open <= 0) return [];
  if (positions.length === 0 || capacity % positions.length !== 0) return [];
  const perPosition = capacity / positions.length;
  const taken = new Map<string, number>();
  for (const c of firstChoices) {
    if (c !== null) taken.set(c, (taken.get(c) ?? 0) + 1);
  }
  const result: { position: string; count: number }[] = [];
  let total = 0;
  for (const p of positions) {
    const count = perPosition - (taken.get(p) ?? 0);
    if (count >= 1) {
      result.push({ position: p, count });
      total += count;
    }
  }
  return total > open ? [] : result;
}

/** 참가 마감(D92): now ≥ scheduledAt */
export function isJoinClosed(scheduledAt: Date, now: Date): boolean {
  assertValidDate(scheduledAt, 'scheduledAt');
  assertValidDate(now, 'now');
  return now.getTime() >= scheduledAt.getTime();
}
