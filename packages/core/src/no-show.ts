/**
 * 노쇼 제한 판정(문서 7-4, 계약 S2 5-6·7절, D83).
 *
 * 규칙
 * - 노쇼 표시 시각 m마다 구간 (m − window, m] 안의 노쇼가 threshold 이상이면 m은 「제한 발동」.
 * - 해제 시각 until = 가장 늦은 발동 m + restriction. now < until이면 제한 중(now = until이면 해제).
 * - 「일」은 24시간 단위 이동 구간(KST 날짜 경계 아님).
 * - now보다 뒤인 표시 시각은 무시한다(시계 오차).
 */
import { DAY_MS } from './config';

export type NoShowPolicy = { threshold: number; windowDays: number; restrictionDays: number };

export type ScrimRestrictionState = {
  restricted: boolean;
  /** 해제 시각. 제한 중이 아니면 null */
  until: Date | null;
  /** (now − window, now] 안의 노쇼 수 */
  recentCount: number;
  /** now 이하 가장 늦은 노쇼 표시 시각 */
  lastNoShowAt: Date | null;
};

function assertValidDate(d: Date, name: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RangeError(`${name}: 올바른 Date가 아님`);
  }
}

function assertPolicy(policy: NoShowPolicy): void {
  const { threshold, windowDays, restrictionDays } = policy;
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new RangeError(`policy.threshold: 1 이상의 정수여야 함 (${threshold})`);
  }
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new RangeError(`policy.windowDays: 1 이상의 정수여야 함 (${windowDays})`);
  }
  if (!Number.isInteger(restrictionDays) || restrictionDays < 1) {
    throw new RangeError(`policy.restrictionDays: 1 이상의 정수여야 함 (${restrictionDays})`);
  }
}

/**
 * 노쇼 제한 상태. 입력 순서는 상관없다.
 */
export function computeScrimRestriction(
  noShowMarkedAt: readonly Date[],
  now: Date,
  policy: NoShowPolicy,
): ScrimRestrictionState {
  assertValidDate(now, 'now');
  assertPolicy(policy);
  noShowMarkedAt.forEach((d, i) => assertValidDate(d, `noShowMarkedAt[${i}]`));

  const nowMs = now.getTime();
  const windowMs = policy.windowDays * DAY_MS;
  const restrictionMs = policy.restrictionDays * DAY_MS;

  const marks = noShowMarkedAt
    .map((d) => d.getTime())
    .filter((t) => t <= nowMs)
    .sort((a, b) => a - b);

  // 발동 판정: 정렬된 marks에서 m = marks[i]일 때 (m − window, m] 개수.
  // 같은 시각이 여러 개면 모두 m 이하이므로, i 대신 같은 값의 마지막 인덱스까지 센다.
  let latestTrigger: number | null = null;
  let lo = 0;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]!;
    let hi = i;
    while (hi + 1 < marks.length && marks[hi + 1] === m) hi++;
    while (marks[lo]! <= m - windowMs) lo++;
    const count = hi - lo + 1;
    if (count >= policy.threshold) latestTrigger = m;
  }

  let until: Date | null = null;
  if (latestTrigger !== null && nowMs < latestTrigger + restrictionMs) {
    until = new Date(latestTrigger + restrictionMs);
  }

  const recentCount = marks.filter((t) => t > nowMs - windowMs).length;
  const last = marks.length > 0 ? marks[marks.length - 1]! : null;

  return {
    restricted: until !== null,
    until,
    recentCount,
    lastNoShowAt: last === null ? null : new Date(last),
  };
}

/**
 * DB 조회 하한: now − (windowDays + restrictionDays)일.
 * 이 시각 **초과**인 노쇼만 넘겨도 restricted·until·recentCount는 전체 입력과 같다
 * (아직 유효한 발동 m은 m > now − restriction이고, 그 집계 구간은 m − window 초과).
 * lastNoShowAt은 하한 이전 노쇼만 있는 경우 null이 된다(안내용 값이라 허용, 보고서 해석 참고).
 */
export function noShowLookbackStart(now: Date, policy: NoShowPolicy): Date {
  assertValidDate(now, 'now');
  assertPolicy(policy);
  return new Date(now.getTime() - (policy.windowDays + policy.restrictionDays) * DAY_MS);
}

/**
 * 운영진 노쇼 표시 기한(D83): now ≤ scheduledAt + windowDays일. 정정(해제)에는 쓰지 않는다.
 */
export function isNoShowMarkWindowOpen(scheduledAt: Date, now: Date, windowDays: number): boolean {
  assertValidDate(scheduledAt, 'scheduledAt');
  assertValidDate(now, 'now');
  return now.getTime() <= scheduledAt.getTime() + windowDays * DAY_MS;
}
