import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_MAIN_GAMES_MAX,
  BOT_ACTIVITY_FUTURE_TOLERANCE_SEC,
  BOT_ACTIVITY_MAX_AGE_DAYS,
  BOT_PRESENCE_STALE_AFTER_SEC,
  DASHBOARD_NOW_PLAYING_MAX,
  DashboardNowPlayingItem,
  type BotPresencePlaying,
} from '@gcd/shared';
import {
  buildActivityRanking,
  buildPlaytimeRanking,
  checkActivityEventTime,
  checkPresenceCapture,
  nowPlayingItems,
  pickMainGames,
  planActivityBatch,
  planMemberEvents,
  presenceState,
  type ActivityPlan,
} from './index';

const iso = (s: string) => new Date(s);
const NOW = iso('2026-10-31T21:00:00.000+09:00');
const at = (deltaMs: number) => new Date(NOW.getTime() + deltaMs);
const SEC = 1000;
const DAY = 86_400_000;
const PAST_LIMIT_MS = BOT_ACTIVITY_MAX_AGE_DAYS * DAY;
const FUTURE_MS = BOT_ACTIVITY_FUTURE_TOLERANCE_SEC * SEC;
/** checkPresenceCapture TOO_OLD 한도(BOT_PRESENCE_STALE_AFTER_SEC). FUTURE_MS와 값만 같은 별개 상수 */
const PRESENCE_PAST_MS = BOT_PRESENCE_STALE_AFTER_SEC * SEC;

/** 배열 순서를 결정적으로 뒤집고 섞는다(난수 없음) */
function permutations<T>(xs: readonly T[]): T[][] {
  const rev = [...xs].reverse();
  const rot = [...xs.slice(1), ...xs.slice(0, 1)];
  const evenOdd = [...xs.filter((_, i) => i % 2 === 0), ...xs.filter((_, i) => i % 2 === 1)];
  return [[...xs], rev, rot, evenOdd];
}

describe('상수(shared 값 확인)', () => {
  it('문서·계약 값', () => {
    expect(BOT_ACTIVITY_MAX_AGE_DAYS).toBe(7);
    expect(BOT_ACTIVITY_FUTURE_TOLERANCE_SEC).toBe(300);
    expect(BOT_PRESENCE_STALE_AFTER_SEC).toBe(300);
    expect(ACTIVITY_MAIN_GAMES_MAX).toBe(2);
    expect(DASHBOARD_NOW_PLAYING_MAX).toBe(5);
  });
});

describe('checkActivityEventTime', () => {
  it('과거 한도: 정확히 now − 7일 허용, 1ms 더 이르면 STARTED_AT_TOO_OLD', () => {
    expect(checkActivityEventTime({ startedAt: at(-PAST_LIMIT_MS), durationSec: 3600, now: NOW })).toBeNull();
    expect(checkActivityEventTime({ startedAt: at(-PAST_LIMIT_MS - 1), durationSec: 3600, now: NOW })).toBe(
      'STARTED_AT_TOO_OLD',
    );
    expect(checkActivityEventTime({ startedAt: at(-PAST_LIMIT_MS + 1), durationSec: 3600, now: NOW })).toBeNull();
  });

  it('미래 한도: 끝 시각이 정확히 now + 300초 허용, 1ms 넘으면 ENDS_IN_FUTURE', () => {
    // 시작 now − 3600초 + 300초, 길이 3600초 → 끝 = now + 300초
    expect(
      checkActivityEventTime({ startedAt: at(-3600 * SEC + FUTURE_MS), durationSec: 3600, now: NOW }),
    ).toBeNull();
    expect(
      checkActivityEventTime({ startedAt: at(-3600 * SEC + FUTURE_MS + 1), durationSec: 3600, now: NOW }),
    ).toBe('ENDS_IN_FUTURE');
    expect(
      checkActivityEventTime({ startedAt: at(-3600 * SEC + FUTURE_MS - 1), durationSec: 3600, now: NOW }),
    ).toBeNull();
  });

  it('chat(0초): 시작 시각 자체가 미래 한도와 비교된다', () => {
    expect(checkActivityEventTime({ startedAt: at(FUTURE_MS), durationSec: 0, now: NOW })).toBeNull();
    expect(checkActivityEventTime({ startedAt: at(FUTURE_MS + 1), durationSec: 0, now: NOW })).toBe('ENDS_IN_FUTURE');
  });

  it('TOO_OLD를 먼저 본다(아주 오래된 시작 + 86400초도 TOO_OLD)', () => {
    expect(checkActivityEventTime({ startedAt: at(-PAST_LIMIT_MS - 1), durationSec: 86_400, now: NOW })).toBe(
      'STARTED_AT_TOO_OLD',
    );
  });

  it('잘못된 입력 → RangeError', () => {
    expect(() => checkActivityEventTime({ startedAt: new Date('x'), durationSec: 1, now: NOW })).toThrow(RangeError);
    expect(() => checkActivityEventTime({ startedAt: NOW, durationSec: -1, now: NOW })).toThrow(RangeError);
    expect(() => checkActivityEventTime({ startedAt: NOW, durationSec: 1.5, now: NOW })).toThrow(RangeError);
  });
});

describe('planActivityBatch', () => {
  const users = new Map([
    ['111111111111111111', 'user-a'],
    ['222222222222222222', 'user-b'],
  ]);
  const ok = (key: string, discordId = '111111111111111111') => ({
    idempotencyKey: key,
    discordId,
    startedAt: at(-2 * 3600 * SEC),
    durationSec: 3600,
  });
  const plan = (events: Parameters<typeof planActivityBatch>[0]['events'], stored: string[] = []) =>
    planActivityBatch({ events, storedKeys: new Set(stored), userIdByDiscordId: users, now: NOW });

  it('정상 → insert(userId), 입력 순서·같은 길이', () => {
    const r = plan([ok('k1'), ok('k2', '222222222222222222')]);
    expect(r).toEqual<ActivityPlan[]>([
      { status: 'insert', userId: 'user-a' },
      { status: 'insert', userId: 'user-b' },
    ]);
  });

  it('배치 안 같은 키 3번: 첫째 insert, 둘째·셋째 duplicate', () => {
    expect(plan([ok('same'), ok('same'), ok('same')])).toEqual<ActivityPlan[]>([
      { status: 'insert', userId: 'user-a' },
      { status: 'duplicate' },
      { status: 'duplicate' },
    ]);
  });

  it('rejected 뒤 같은 키 정상 → insert', () => {
    const tooOld = { ...ok('k'), startedAt: at(-PAST_LIMIT_MS - 1) };
    expect(plan([tooOld, ok('k')])).toEqual<ActivityPlan[]>([
      { status: 'rejected', reason: 'STARTED_AT_TOO_OLD' },
      { status: 'insert', userId: 'user-a' },
    ]);
  });

  it('unlinked 뒤 같은 키 연동 회원 → insert', () => {
    expect(plan([ok('k', '999999999999999999'), ok('k')])).toEqual<ActivityPlan[]>([
      { status: 'unlinked' },
      { status: 'insert', userId: 'user-a' },
    ]);
  });

  it('판정 순서: stored 키 + 시각 초과 → duplicate', () => {
    const future = { ...ok('stored'), startedAt: at(FUTURE_MS + 1), durationSec: 1 };
    const old = { ...ok('stored2'), startedAt: at(-PAST_LIMIT_MS - 1) };
    expect(plan([future, old], ['stored', 'stored2'])).toEqual<ActivityPlan[]>([
      { status: 'duplicate' },
      { status: 'duplicate' },
    ]);
  });

  it('판정 순서: 이 요청 안 중복 + 미연동 → duplicate', () => {
    expect(plan([ok('k'), ok('k', '999999999999999999')])).toEqual<ActivityPlan[]>([
      { status: 'insert', userId: 'user-a' },
      { status: 'duplicate' },
    ]);
  });

  it('판정 순서: 시각 초과 + 미연동 → rejected', () => {
    const e = { ...ok('k', '999999999999999999'), startedAt: at(FUTURE_MS + 1), durationSec: 0 };
    expect(plan([e])).toEqual<ActivityPlan[]>([{ status: 'rejected', reason: 'ENDS_IN_FUTURE' }]);
  });

  it('빈 입력 → []', () => {
    expect(plan([])).toEqual([]);
  });

  it('입력을 바꾸지 않는다', () => {
    const events = [ok('a'), ok('a')];
    const stored = new Set<string>(['x']);
    const snapshot = JSON.stringify(events);
    planActivityBatch({ events, storedKeys: stored, userIdByDiscordId: users, now: NOW });
    expect(JSON.stringify(events)).toBe(snapshot);
    expect([...stored]).toEqual(['x']);
  });
});

describe('buildActivityRanking', () => {
  // r1(D232): totalSec = voiceSec. play·chat은 시간에 들어가지 않는다
  const rows = [
    { userId: 'u3', voiceSec: 3600, activeDays: 3 }, // 3600, 3일
    { userId: 'u1', voiceSec: 3600, activeDays: 3 }, // 3600, 3일 → u1 < u3
    { userId: 'u2', voiceSec: 3600, activeDays: 5 }, // 3600, 5일 → 3600 중 1위
    { userId: 'u4', voiceSec: 7200, activeDays: 1 }, // 7200 → 최상위
    { userId: 'u0', voiceSec: 0, activeDays: 4 }, // play·chat만 → 제외
    { userId: 'u5', voiceSec: 1, activeDays: 1 },
  ];

  it('동점 3단계: totalSec DESC → activeDays DESC → userId ASC, 0초 제외', () => {
    const r = buildActivityRanking(rows);
    expect(r.map((x) => [x.userId, x.rank, x.totalSec])).toEqual([
      ['u4', 1, 7200],
      ['u2', 2, 3600],
      ['u1', 3, 3600],
      ['u3', 4, 3600],
      ['u5', 5, 1],
    ]);
  });

  it('입력 순서를 섞어도 결과 동일', () => {
    const expected = buildActivityRanking(rows);
    for (const p of permutations(rows)) expect(buildActivityRanking(p)).toEqual(expected);
  });

  it('voiceSec 0이면 activeDays가 커도 제외(play·chat만 있는 회원)', () => {
    const r = buildActivityRanking([
      { userId: 'chat-only', voiceSec: 0, activeDays: 7 },
      { userId: 'voice', voiceSec: 60, activeDays: 1 },
    ]);
    expect(r.map((x) => x.userId)).toEqual(['voice']);
  });

  it('추가 필드 playSec는 totalSec·정렬에 들어가지 않는다(r1, D232)', () => {
    const r = buildActivityRanking([
      { userId: 'a', voiceSec: 100, playSec: 100000, activeDays: 1 },
      { userId: 'b', voiceSec: 200, playSec: 0, activeDays: 1 },
      { userId: 'c', voiceSec: 0, playSec: 99999, activeDays: 7 },
    ]);
    expect(r.map((x) => [x.userId, x.rank, x.totalSec, x.playSec])).toEqual([
      ['b', 1, 200, 0],
      ['a', 2, 100, 100000],
    ]);
  });

  it('추가 필드 scrimCount는 순위·totalSec에 영향 없고 그대로 통과(r2, D239)', () => {
    const r = buildActivityRanking([
      { userId: 'many-scrims', voiceSec: 10, activeDays: 1, scrimCount: 50 },
      { userId: 'no-scrims', voiceSec: 20, activeDays: 1, scrimCount: 0 },
      { userId: 'scrim-only', voiceSec: 0, activeDays: 3, scrimCount: 9 },
    ]);
    expect(r).toEqual([
      { userId: 'no-scrims', voiceSec: 20, activeDays: 1, scrimCount: 0, rank: 1, totalSec: 20 },
      { userId: 'many-scrims', voiceSec: 10, activeDays: 1, scrimCount: 50, rank: 2, totalSec: 10 },
    ]);
  });

  it('호출자 필드를 유지하고 입력을 바꾸지 않는다', () => {
    const input = [{ userId: 'u1', voiceSec: 10, activeDays: 1, nickname: 'a' }];
    const r = buildActivityRanking(input);
    expect(r[0]).toEqual({ userId: 'u1', voiceSec: 10, activeDays: 1, nickname: 'a', rank: 1, totalSec: 10 });
    expect(input[0]).not.toHaveProperty('rank');
  });

  it('userId 비교는 코드 단위(대문자 < 소문자)', () => {
    const r = buildActivityRanking([
      { userId: 'b', voiceSec: 1, activeDays: 1 },
      { userId: 'B', voiceSec: 1, activeDays: 1 },
    ]);
    expect(r.map((x) => x.userId)).toEqual(['B', 'b']);
  });

  it('빈 입력 → [], 음수·비정수 → RangeError', () => {
    expect(buildActivityRanking([])).toEqual([]);
    expect(() => buildActivityRanking([{ userId: 'u', voiceSec: -1, activeDays: 0 }])).toThrow(RangeError);
    expect(() => buildActivityRanking([{ userId: 'u', voiceSec: 1.5, activeDays: 0 }])).toThrow(RangeError);
  });
});

describe('pickMainGames', () => {
  const rows = [
    { gameId: 'g-tft', sortOrder: 2, sec: 600 },
    { gameId: 'g-lol', sortOrder: 1, sec: 600 },
    { gameId: 'g-z', sortOrder: 3, sec: 900 },
    { gameId: 'g-b', sortOrder: 3, sec: 900 },
    { gameId: 'g-0', sortOrder: 0, sec: 0 },
  ];

  it('동점 3단계: sec DESC → sortOrder ASC → gameId ASC, 기본 max 2', () => {
    expect(pickMainGames(rows).map((g) => g.gameId)).toEqual(['g-b', 'g-z']);
    expect(pickMainGames(rows, 10).map((g) => g.gameId)).toEqual(['g-b', 'g-z', 'g-lol', 'g-tft']);
  });

  it('0초 제외, max 0 → []', () => {
    expect(pickMainGames([{ gameId: 'x', sortOrder: 1, sec: 0 }])).toEqual([]);
    expect(pickMainGames(rows, 0)).toEqual([]);
  });

  it('입력 순서를 섞어도 결과 동일, 입력 불변', () => {
    const snapshot = JSON.stringify(rows);
    const expected = pickMainGames(rows, 10);
    for (const p of permutations(rows)) expect(pickMainGames(p, 10)).toEqual(expected);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe('buildPlaytimeRanking', () => {
  const rows = [
    { userId: 'u2', minutesTotal: 1000, minutesRecent: 50 },
    { userId: 'u1', minutesTotal: 1000, minutesRecent: 50 },
    { userId: 'u3', minutesTotal: 1000, minutesRecent: 90 },
    { userId: 'u4', minutesTotal: 2000, minutesRecent: 0 },
    { userId: 'u0', minutesTotal: 0, minutesRecent: 100 },
  ];

  it('동점 3단계: minutesTotal DESC → minutesRecent DESC → userId ASC, 0분 제외', () => {
    expect(buildPlaytimeRanking(rows).map((r) => [r.userId, r.rank])).toEqual([
      ['u4', 1],
      ['u3', 2],
      ['u1', 3],
      ['u2', 4],
    ]);
  });

  it('입력 순서를 섞어도 결과 동일', () => {
    const expected = buildPlaytimeRanking(rows);
    for (const p of permutations(rows)) expect(buildPlaytimeRanking(p)).toEqual(expected);
  });

  it('빈 입력 → []', () => {
    expect(buildPlaytimeRanking([])).toEqual([]);
  });
});

describe('planMemberEvents', () => {
  const A = '111111111111111111';
  const B = '222222222222222222';
  const users = (aSince: Date | null = null, bSince: Date | null = null) =>
    new Map([
      [A, { userId: 'user-a', guildMembershipAt: aSince }],
      [B, { userId: 'user-b', guildMembershipAt: bSince }],
    ]);

  it('퇴장 → 재입장(같은 요청): 둘 다 applied, 최종 join, revokeTokens false', () => {
    const leave = at(-60 * SEC);
    const join = at(-30 * SEC);
    const r = planMemberEvents({
      events: [
        { discordId: A, type: 'leave', occurredAt: leave },
        { discordId: A, type: 'join', occurredAt: join },
      ],
      users: users(),
      now: NOW,
    });
    expect(r.results).toEqual(['applied', 'applied']);
    expect(r.finals).toEqual([
      { userId: 'user-a', leftAt: null, guildMembershipAt: join, revokeTokens: false, eventIndexes: [0, 1] },
    ]);
  });

  it('같은 요청에 재입장이 앞에 와도 occurredAt 순으로 본다(최종 join)', () => {
    const r = planMemberEvents({
      events: [
        { discordId: A, type: 'join', occurredAt: at(-30 * SEC) },
        { discordId: A, type: 'leave', occurredAt: at(-60 * SEC) },
      ],
      users: users(),
      now: NOW,
    });
    expect(r.results).toEqual(['applied', 'applied']);
    expect(r.finals[0]).toMatchObject({ leftAt: null, revokeTokens: false, eventIndexes: [0, 1] });
  });

  it('뒤바뀜 1: 재입장이 먼저 반영되고 더 이른 퇴장이 나중 요청에 도착 → stale', () => {
    const joinAt = at(-30 * SEC);
    const r = planMemberEvents({
      events: [{ discordId: A, type: 'leave', occurredAt: at(-60 * SEC) }],
      users: users(joinAt),
      now: NOW,
    });
    expect(r.results).toEqual(['stale']);
    expect(r.finals).toEqual([]);
  });

  it('뒤바뀜 2: 퇴장 재전송(같은 occurredAt) → stale', () => {
    const leaveAt = at(-60 * SEC);
    const r = planMemberEvents({
      events: [{ discordId: A, type: 'leave', occurredAt: leaveAt }],
      users: users(new Date(leaveAt.getTime())),
      now: NOW,
    });
    expect(r.results).toEqual(['stale']);
    // 같은 요청 안 재전송도 둘째는 stale
    const r2 = planMemberEvents({
      events: [
        { discordId: A, type: 'leave', occurredAt: leaveAt },
        { discordId: A, type: 'leave', occurredAt: leaveAt },
      ],
      users: users(),
      now: NOW,
    });
    expect(r2.results).toEqual(['applied', 'stale']);
    expect(r2.finals[0]).toMatchObject({ leftAt: leaveAt, revokeTokens: true, eventIndexes: [0] });
  });

  it('뒤바뀜 3: 로그인(guild_membership_at = 로그인 시각) 뒤 그보다 이른 퇴장 → stale', () => {
    const loginAt = at(-10 * SEC);
    const r = planMemberEvents({
      events: [{ discordId: A, type: 'leave', occurredAt: at(-11 * SEC) }],
      users: users(loginAt),
      now: NOW,
    });
    expect(r.results).toEqual(['stale']);
  });

  it('퇴장 반영: leftAt = occurredAt, revokeTokens true', () => {
    const leaveAt = at(-5 * SEC);
    const r = planMemberEvents({
      events: [{ discordId: A, type: 'leave', occurredAt: leaveAt }],
      users: users(at(-DAY)),
      now: NOW,
    });
    expect(r.results).toEqual(['applied']);
    expect(r.finals).toEqual([
      { userId: 'user-a', leftAt: leaveAt, guildMembershipAt: leaveAt, revokeTokens: true, eventIndexes: [0] },
    ]);
  });

  it('미연동 → unlinked, 미래(now + 300초 + 1ms) → rejected, 정확히 now + 300초는 허용', () => {
    const r = planMemberEvents({
      events: [
        { discordId: '999999999999999999', type: 'leave', occurredAt: at(-1) },
        { discordId: A, type: 'leave', occurredAt: at(FUTURE_MS + 1) },
        { discordId: B, type: 'join', occurredAt: at(FUTURE_MS) },
        { discordId: '999999999999999999', type: 'join', occurredAt: at(FUTURE_MS + 1) },
      ],
      users: users(),
      now: NOW,
    });
    expect(r.results).toEqual(['unlinked', 'rejected', 'applied', 'rejected']);
    expect(r.finals.map((f) => f.userId)).toEqual(['user-b']);
  });

  it('rejected 이벤트는 판단 시각을 움직이지 않는다', () => {
    const r = planMemberEvents({
      events: [
        { discordId: A, type: 'join', occurredAt: at(FUTURE_MS + 1) },
        { discordId: A, type: 'leave', occurredAt: at(-1) },
      ],
      users: users(),
      now: NOW,
    });
    expect(r.results).toEqual(['rejected', 'applied']);
    expect(r.finals[0]).toMatchObject({ revokeTokens: true, eventIndexes: [1] });
  });

  it('finals는 userId ASC, results는 입력 순서', () => {
    const r = planMemberEvents({
      events: [
        { discordId: B, type: 'leave', occurredAt: at(-2) },
        { discordId: A, type: 'leave', occurredAt: at(-1) },
      ],
      users: users(),
      now: NOW,
    });
    expect(r.results).toEqual(['applied', 'applied']);
    expect(r.finals.map((f) => [f.userId, f.eventIndexes])).toEqual([
      ['user-a', [1]],
      ['user-b', [0]],
    ]);
  });

  it('빈 입력 → 빈 결과, 입력 Date 불변', () => {
    expect(planMemberEvents({ events: [], users: users(), now: NOW })).toEqual({ results: [], finals: [] });
    const t = at(-1);
    const before = t.getTime();
    const r = planMemberEvents({ events: [{ discordId: A, type: 'leave', occurredAt: t }], users: users(), now: NOW });
    r.finals[0]!.guildMembershipAt.setTime(0);
    expect(t.getTime()).toBe(before);
  });
});

describe('presenceState', () => {
  it('null → not_connected', () => {
    expect(presenceState({ capturedAt: null, now: NOW })).toBe('not_connected');
  });
  it('정확히 300초 전 live, 300초 + 1ms 전 stale', () => {
    expect(presenceState({ capturedAt: at(-BOT_PRESENCE_STALE_AFTER_SEC * SEC), now: NOW })).toBe('live');
    expect(presenceState({ capturedAt: at(-BOT_PRESENCE_STALE_AFTER_SEC * SEC - 1), now: NOW })).toBe('stale');
  });
  it('미래 시각도 live', () => {
    expect(presenceState({ capturedAt: at(DAY), now: NOW })).toBe('live');
  });
});

describe('checkPresenceCapture', () => {
  it('미래 경계: now + 300초 허용, +1ms IN_FUTURE', () => {
    expect(checkPresenceCapture({ capturedAt: at(FUTURE_MS), storedCapturedAt: null, now: NOW })).toBeNull();
    expect(checkPresenceCapture({ capturedAt: at(FUTURE_MS + 1), storedCapturedAt: null, now: NOW })).toBe('IN_FUTURE');
  });
  it('과거 경계: now − BOT_PRESENCE_STALE_AFTER_SEC 허용, −1ms TOO_OLD', () => {
    expect(checkPresenceCapture({ capturedAt: at(-PRESENCE_PAST_MS), storedCapturedAt: null, now: NOW })).toBeNull();
    expect(checkPresenceCapture({ capturedAt: at(-PRESENCE_PAST_MS - 1), storedCapturedAt: null, now: NOW })).toBe('TOO_OLD');
  });
  it('stored와 같거나 이르면 OLDER_THAN_STORED, 늦으면 null', () => {
    const stored = at(-10 * SEC);
    expect(checkPresenceCapture({ capturedAt: stored, storedCapturedAt: stored, now: NOW })).toBe('OLDER_THAN_STORED');
    expect(checkPresenceCapture({ capturedAt: at(-11 * SEC), storedCapturedAt: stored, now: NOW })).toBe(
      'OLDER_THAN_STORED',
    );
    expect(checkPresenceCapture({ capturedAt: at(-10 * SEC + 1), storedCapturedAt: stored, now: NOW })).toBeNull();
  });
  it('순서: IN_FUTURE·TOO_OLD가 OLDER_THAN_STORED보다 먼저', () => {
    expect(checkPresenceCapture({ capturedAt: at(FUTURE_MS + 1), storedCapturedAt: at(DAY), now: NOW })).toBe(
      'IN_FUTURE',
    );
    expect(checkPresenceCapture({ capturedAt: at(-PRESENCE_PAST_MS - 1), storedCapturedAt: at(0), now: NOW })).toBe('TOO_OLD');
  });
});

describe('nowPlayingItems', () => {
  const p = (name: string, count: number, game: BotPresencePlaying['game'] = null): BotPresencePlaying => ({
    name,
    game,
    steam_app_id: null,
    count,
  });

  it('count DESC → name ASC(코드 단위), 기본 max 5, 응답 스키마 통과', () => {
    const input = [
      p('b', 3),
      p('League of Legends', 8, 'lol'),
      p('a', 3),
      p('B', 3),
      p('PUBG: BATTLEGROUNDS', 4),
      p('z', 1),
      p('y', 2),
    ];
    const r = nowPlayingItems(input);
    expect(r.map((x) => x.name)).toEqual(['League of Legends', 'PUBG: BATTLEGROUNDS', 'B', 'a', 'b']);
    for (const item of r) expect(DashboardNowPlayingItem.parse(item)).toEqual(item);
  });

  it('같은 name을 합치지 않는다, max 지정', () => {
    expect(nowPlayingItems([p('x', 1), p('x', 1)], 10)).toHaveLength(2);
    expect(nowPlayingItems([p('x', 1), p('y', 1)], 1).map((x) => x.name)).toEqual(['x']);
  });

  it('빈 입력 → [], 입력 불변', () => {
    expect(nowPlayingItems([])).toEqual([]);
    const input = [p('b', 1), p('a', 2)];
    nowPlayingItems(input);
    expect(input.map((x) => x.name)).toEqual(['b', 'a']);
  });
});
