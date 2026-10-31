import {
  ACTIVITY_MAIN_GAMES_MAX,
  BOT_ACTIVITY_FUTURE_TOLERANCE_SEC,
  BOT_ACTIVITY_MAX_AGE_DAYS,
  BOT_PRESENCE_STALE_AFTER_SEC,
  DASHBOARD_NOW_PLAYING_MAX,
  type BotActivityRejectReason,
  type BotMemberEventType,
  type BotPresencePlaying,
  type DashboardNowPlayingItem,
} from '@gcd/shared';
import { DAY_MS } from './config';
import { assertValidDate } from './time';

// =============================================================================
// S5 봇 활동·접속 현황·서버 입퇴장(계약 S5 6절·7절·8절·9-2). I/O 없음. 시각은 인자로 받는다.
// 문자열 동점 비교는 localeCompare가 아닌 코드 단위 비교(<, >)다. 실행 환경 로캘에 따라 순서가 바뀌지 않게 한다.
// =============================================================================

/** 봇 시각 허용 오차(초) → ms. 활동 끝 시각, 입퇴장 occurred_at, 접속 현황 captured_at이 같은 값을 쓴다 */
const FUTURE_TOLERANCE_MS = BOT_ACTIVITY_FUTURE_TOLERANCE_SEC * 1000;
/** 접속 현황 과거 한도(TOO_OLD) = BOT_PRESENCE_STALE_AFTER_SEC(계약 9-2 checkPresenceCapture, presenceState와 같은 상수) */
const PRESENCE_PAST_TOLERANCE_MS = BOT_PRESENCE_STALE_AFTER_SEC * 1000;

function compareCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function assertNonNegativeInt(v: number, name: string): void {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name}: 0 이상의 정수여야 함 (${v})`);
}

/**
 * 활동 이벤트 시각 판정(6-2 표, D211).
 * startedAt < now − 7일 → STARTED_AT_TOO_OLD(먼저 본다), startedAt + durationSec초 > now + 300초 → ENDS_IN_FUTURE.
 * 경계와 같으면 허용(null).
 */
export function checkActivityEventTime(input: {
  startedAt: Date;
  durationSec: number;
  now: Date;
}): BotActivityRejectReason | null {
  const { startedAt, durationSec, now } = input;
  assertValidDate(startedAt, 'startedAt');
  assertValidDate(now, 'now');
  assertNonNegativeInt(durationSec, 'durationSec');
  const t = startedAt.getTime();
  const n = now.getTime();
  if (t < n - BOT_ACTIVITY_MAX_AGE_DAYS * DAY_MS) return 'STARTED_AT_TOO_OLD';
  if (t + durationSec * 1000 > n + FUTURE_TOLERANCE_MS) return 'ENDS_IN_FUTURE';
  return null;
}

/** 이벤트 1건 처리 계획. backend는 insert 행만 INSERT … ON CONFLICT DO NOTHING 한다 */
export type ActivityPlan =
  | { status: 'insert'; userId: string }
  | { status: 'duplicate' | 'unlinked' }
  | { status: 'rejected'; reason: BotActivityRejectReason };

/**
 * POST /bot/activity 일괄 판정(6-2). 결과는 입력 순서·같은 길이.
 * 이벤트마다: 이 요청 안 앞 insert와 같은 키 → duplicate / storedKeys에 있음 → duplicate /
 * checkActivityEventTime → rejected / 회원 없음 → unlinked / 그 외 insert.
 * rejected·unlinked 키는 저장하지 않으므로 「이 요청 안 중복」에 쓰지 않는다(뒤의 같은 키가 정상이면 insert).
 */
export function planActivityBatch(input: {
  events: readonly { idempotencyKey: string; discordId: string; startedAt: Date; durationSec: number }[];
  storedKeys: ReadonlySet<string>;
  userIdByDiscordId: ReadonlyMap<string, string>;
  now: Date;
}): ActivityPlan[] {
  const { events, storedKeys, userIdByDiscordId, now } = input;
  assertValidDate(now, 'now');
  const insertedKeys = new Set<string>();
  return events.map((e): ActivityPlan => {
    if (insertedKeys.has(e.idempotencyKey) || storedKeys.has(e.idempotencyKey)) return { status: 'duplicate' };
    const reason = checkActivityEventTime({ startedAt: e.startedAt, durationSec: e.durationSec, now });
    if (reason !== null) return { status: 'rejected', reason };
    const userId = userIdByDiscordId.get(e.discordId);
    if (userId === undefined) return { status: 'unlinked' };
    insertedKeys.add(e.idempotencyKey);
    return { status: 'insert', userId };
  });
}

/**
 * 활동 랭킹(7-1, r1 D232: 음성만). totalSec = voiceSec, 0인 행 제외(play·chat만 있는 회원 포함).
 * totalSec DESC → activeDays DESC → userId ASC, rank 1..(공동 순위 없음).
 * 입력의 다른 필드(playSec, scrimCount 등)는 그대로 통과시키고 합·정렬에 쓰지 않는다.
 */
export function buildActivityRanking<T extends { userId: string; voiceSec: number; activeDays: number }>(
  rows: readonly T[],
): (T & { rank: number; totalSec: number })[] {
  return rows
    .map((row) => {
      assertNonNegativeInt(row.voiceSec, 'voiceSec');
      assertNonNegativeInt(row.activeDays, 'activeDays');
      return { row, totalSec: row.voiceSec };
    })
    .filter((x) => x.totalSec > 0)
    .sort(
      (a, b) =>
        b.totalSec - a.totalSec ||
        b.row.activeDays - a.row.activeDays ||
        compareCodeUnit(a.row.userId, b.row.userId),
    )
    .map(({ row, totalSec }, i) => ({ ...row, totalSec, rank: i + 1 }));
}

/** 회원의 주 게임(7-1). sec > 0, sec DESC → sortOrder ASC → gameId ASC, 앞 max개(기본 ACTIVITY_MAIN_GAMES_MAX) */
export function pickMainGames<G extends { gameId: string; sortOrder: number; sec: number }>(
  rows: readonly G[],
  max: number = ACTIVITY_MAIN_GAMES_MAX,
): G[] {
  assertNonNegativeInt(max, 'max');
  return rows
    .filter((g) => g.sec > 0)
    .sort((a, b) => b.sec - a.sec || a.sortOrder - b.sortOrder || compareCodeUnit(a.gameId, b.gameId))
    .slice(0, max)
    .map((g) => ({ ...g }));
}

/** 플레이타임 랭킹(7-2). minutesTotal 0 제외, minutesTotal DESC → minutesRecent DESC → userId ASC */
export function buildPlaytimeRanking<T extends { userId: string; minutesTotal: number; minutesRecent: number }>(
  rows: readonly T[],
): (T & { rank: number })[] {
  return rows
    .filter((row) => {
      assertNonNegativeInt(row.minutesTotal, 'minutesTotal');
      assertNonNegativeInt(row.minutesRecent, 'minutesRecent');
      return row.minutesTotal > 0;
    })
    .slice()
    .sort(
      (a, b) =>
        b.minutesTotal - a.minutesTotal ||
        b.minutesRecent - a.minutesRecent ||
        compareCodeUnit(a.userId, b.userId),
    )
    .map((row, i) => ({ ...row, rank: i + 1 }));
}

export type MemberEventStatus = 'applied' | 'stale' | 'unlinked' | 'rejected';
export type MemberEventFinal = {
  userId: string;
  leftAt: Date | null;
  guildMembershipAt: Date;
  revokeTokens: boolean;
  eventIndexes: number[];
};

/**
 * 서버 입장·퇴장 판정(6-6, D220·D230).
 * - occurredAt > now + 300초 → rejected. 회원 없음 → unlinked.
 * - 같은 회원 이벤트는 occurredAt ASC(같으면 요청 순서)로 보고, 판단 시각(처음엔 guildMembershipAt, null이면 없음)보다
 *   늦으면 applied + 판단 시각 갱신, 같거나 이르면 stale.
 * - finals: applied가 있는 회원만 userId ASC. 마지막 applied가 최종 상태(leave → leftAt = occurredAt·revokeTokens,
 *   join → leftAt null). eventIndexes = 그 회원 applied 이벤트의 입력 위치 오름차순.
 */
export function planMemberEvents(input: {
  events: readonly { discordId: string; type: BotMemberEventType; occurredAt: Date }[];
  users: ReadonlyMap<string, { userId: string; guildMembershipAt: Date | null }>;
  now: Date;
}): { results: MemberEventStatus[]; finals: MemberEventFinal[] } {
  const { events, users, now } = input;
  assertValidDate(now, 'now');
  const limit = now.getTime() + FUTURE_TOLERANCE_MS;
  const results: MemberEventStatus[] = new Array(events.length);
  const byUser = new Map<string, { since: Date | null; indexes: number[] }>();

  events.forEach((e, i) => {
    assertValidDate(e.occurredAt, `events.${i}.occurredAt`);
    if (e.occurredAt.getTime() > limit) {
      results[i] = 'rejected';
      return;
    }
    const user = users.get(e.discordId);
    if (user === undefined) {
      results[i] = 'unlinked';
      return;
    }
    if (user.guildMembershipAt !== null) assertValidDate(user.guildMembershipAt, 'guildMembershipAt');
    const group = byUser.get(user.userId) ?? { since: user.guildMembershipAt, indexes: [] };
    group.indexes.push(i);
    byUser.set(user.userId, group);
  });

  const finals: MemberEventFinal[] = [];
  for (const [userId, group] of byUser) {
    const ordered = [...group.indexes].sort(
      (a, b) => events[a]!.occurredAt.getTime() - events[b]!.occurredAt.getTime() || a - b,
    );
    let current = group.since === null ? null : group.since.getTime();
    let last: number | null = null;
    const applied: number[] = [];
    for (const i of ordered) {
      const t = events[i]!.occurredAt.getTime();
      if (current === null || t > current) {
        results[i] = 'applied';
        current = t;
        last = i;
        applied.push(i);
      } else {
        results[i] = 'stale';
      }
    }
    if (last !== null) {
      const e = events[last]!;
      const at = new Date(e.occurredAt.getTime());
      finals.push({
        userId,
        leftAt: e.type === 'leave' ? new Date(at.getTime()) : null,
        guildMembershipAt: at,
        revokeTokens: e.type === 'leave',
        eventIndexes: applied.sort((a, b) => a - b),
      });
    }
  }
  finals.sort((a, b) => compareCodeUnit(a.userId, b.userId));
  return { results, finals };
}

/** 홈 음성 접속 카드 상태(8절). null → not_connected, now − capturedAt ≤ BOT_PRESENCE_STALE_AFTER_SEC → live(미래 시각도 live), 그 외 stale */
export function presenceState(input: { capturedAt: Date | null; now: Date }): 'live' | 'stale' | 'not_connected' {
  const { capturedAt, now } = input;
  assertValidDate(now, 'now');
  if (capturedAt === null) return 'not_connected';
  assertValidDate(capturedAt, 'capturedAt');
  return now.getTime() - capturedAt.getTime() <= BOT_PRESENCE_STALE_AFTER_SEC * 1000 ? 'live' : 'stale';
}

/**
 * PUT /bot/presence 수용 판정(6-7). 순서: capturedAt > now + BOT_ACTIVITY_FUTURE_TOLERANCE_SEC → IN_FUTURE,
 * < now − BOT_PRESENCE_STALE_AFTER_SEC → TOO_OLD, storedCapturedAt 있고 capturedAt ≤ stored → OLDER_THAN_STORED, 그 외 null(수용).
 */
export function checkPresenceCapture(input: {
  capturedAt: Date;
  storedCapturedAt: Date | null;
  now: Date;
}): 'IN_FUTURE' | 'TOO_OLD' | 'OLDER_THAN_STORED' | null {
  const { capturedAt, storedCapturedAt, now } = input;
  assertValidDate(capturedAt, 'capturedAt');
  assertValidDate(now, 'now');
  const t = capturedAt.getTime();
  const n = now.getTime();
  if (t > n + FUTURE_TOLERANCE_MS) return 'IN_FUTURE';
  if (t < n - PRESENCE_PAST_TOLERANCE_MS) return 'TOO_OLD';
  if (storedCapturedAt !== null) {
    assertValidDate(storedCapturedAt, 'storedCapturedAt');
    if (t <= storedCapturedAt.getTime()) return 'OLDER_THAN_STORED';
  }
  return null;
}

/**
 * 「지금 플레이 중」 행(8절). count DESC → name ASC(코드 단위) → 앞 max개(기본 DASHBOARD_NOW_PLAYING_MAX).
 * 같은 name이 여럿이어도 합치지 않는다(봇 책임). count·name이 모두 같으면 입력 순서(안정 정렬).
 */
export function nowPlayingItems(
  playing: readonly BotPresencePlaying[],
  max: number = DASHBOARD_NOW_PLAYING_MAX,
): DashboardNowPlayingItem[] {
  assertNonNegativeInt(max, 'max');
  return playing
    .map((p) => ({ name: p.name, game: p.game, steam_app_id: p.steam_app_id, count: p.count }))
    .sort((a, b) => b.count - a.count || compareCodeUnit(a.name, b.name))
    .slice(0, max);
}
