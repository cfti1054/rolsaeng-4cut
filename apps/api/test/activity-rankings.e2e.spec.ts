/**
 * S5 GET /rankings/activity·/rankings/playtime(계약 7절)과 GET /bot/rankings/:type(6-5).
 * DB 없이 FakePrisma + MemoryRankingCache. 집계 SQL(bigint·AT TIME ZONE)은 test/db/bot.db.e2e.spec.ts.
 */
import {
  GetActivityRankingResponse,
  GetBotRankingResponse,
  GetPlaytimeRankingResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RankingCalculator } from '../src/modules/rankings/ranking-calculator.service';
import { activityRankingKey, playtimeRankingKey, tierRankingKey } from '../src/modules/rankings/ranking-keys';
import { call, expectError } from './support/s1-helpers';
import { login, refresher, seedAccount, seedRating, seedSeason } from './support/s4-helpers';
import { bot, linkedMember, seedActivity, seedApiKey, seedScrimWithResult, seedSteam } from './support/s5-helpers';
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-10-31T12:00:00.000Z'; // 토요일 21:00 KST. 주 = 10-26(월)~, 달 = 10월
const WEEK_START = '2026-10-25T15:00:00.000Z';
const MONTH_START = '2026-09-30T15:00:00.000Z';
const NEXT_MONTH = '2026-10-31T15:00:00.000Z';
const PUBG = 578080;

async function activity(app: TestApp, token: string, period = 'week'): Promise<GetActivityRankingResponse> {
  const res = await call(app, 'GET', `/rankings/activity?period=${period}`, token);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  expect(text).not.toMatch(/discord_id|email|api_key/i);
  return GetActivityRankingResponse.strict().parse(JSON.parse(text));
}

async function playtime(app: TestApp, token: string, appId: number | string): Promise<GetPlaytimeRankingResponse> {
  const res = await call(app, 'GET', `/rankings/playtime?app_id=${appId}`, token);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  expect(text).not.toMatch(/discord_id|email|7656119\d{10}/i);
  return GetPlaytimeRankingResponse.strict().parse(JSON.parse(text));
}

async function botRanking(app: TestApp, key: string, path: string): Promise<GetBotRankingResponse> {
  const res = await bot(app, 'GET', path, key);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  return GetBotRankingResponse.strict().parse(JSON.parse(text));
}

/** 중첩 Prisma.sql(Prisma.join 등)의 바인딩 값. 아니면 [] */
const nestedValues = (v: unknown): unknown[] =>
  typeof v === 'object' && v !== null && Array.isArray((v as { values?: unknown }).values) ? (v as { values: unknown[] }).values : [];

const brief = (r: { items: { rank: number; user: { nickname: string } }[] }) => r.items.map((i) => [i.rank, i.user.nickname]);

describe('GET /rankings/activity', () => {
  it('인증 401, period 잘못 400, 생략하면 week', async () => {
    t = await createTestApp({ fixedClock: NOW });
    expect((await call(t, 'GET', '/rankings/activity')).status).toBe(401);
    const me = await login(t, 'me');
    await expectError(await call(t, 'GET', '/rankings/activity?period=day', me.token), 400, 'VALIDATION_FAILED');
    const r = GetActivityRankingResponse.parse(await (await call(t, 'GET', '/rankings/activity', me.token)).json());
    expect(r.period).toBe('week');
  });

  it('봇 미연결: bot_connected false·빈 목록 / 기간 밖 기록만 있으면 bot_connected true·빈 목록', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const r = await activity(t, me.token);
    expect(r).toMatchObject({
      period: 'week',
      period_start: '2026-10-26T00:00:00.000+09:00',
      period_end: '2026-11-02T00:00:00.000+09:00',
      period_days: 7,
      bot_connected: false,
      items: [],
      total: 0,
      me: null,
      next_cursor: null,
      synced_at: new Date(NOW).toISOString(),
      stale: false,
    });
    const a = await linkedMember(t, 'a');
    seedActivity(t, a.id, { startedAt: '2026-10-01T00:00:00.000Z' });
    t.rankingCache.rows.clear();
    expect(await activity(t, me.token)).toMatchObject({ bot_connected: true, items: [] });
  });

  it('주 경계: 월요일 00:00 KST 포함·직전 1ms 제외·다음 주 시작 제외. 시간 = voice만, chat은 일수에만, play는 어디에도 안 셈(D240), 동점 3단계', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const [a, b, c, d] = [await linkedMember(t, 'a'), await linkedMember(t, 'b'), await linkedMember(t, 'c'), await linkedMember(t, 'd')];
    const g = await linkedMember(t, 'g');
    const ws = new Date(WEEK_START).getTime();
    seedActivity(t, a.id, { type: 'voice', startedAt: WEEK_START, durationSec: 3000 });
    seedActivity(t, a.id, { type: 'play', startedAt: '2026-10-28T12:00:00.000Z', durationSec: 600, game: 'lol' });
    seedActivity(t, a.id, { type: 'voice', startedAt: new Date(ws - 1).toISOString(), durationSec: 99_999 });
    // b: 같은 3600초, 활동 일수 3(chat 하루 포함) → a(2일)보다 위
    seedActivity(t, b.id, { type: 'voice', startedAt: '2026-10-27T00:00:00.000Z', durationSec: 1800 });
    seedActivity(t, b.id, { type: 'voice', startedAt: '2026-10-28T00:00:00.000Z', durationSec: 1800 });
    seedActivity(t, b.id, { type: 'chat', startedAt: '2026-10-29T00:00:00.000Z' });
    // c: chat만 → 순위 없음
    seedActivity(t, c.id, { type: 'chat', startedAt: '2026-10-29T00:00:00.000Z' });
    // d: 다음 주 시작 시각(구간 밖)
    seedActivity(t, d.id, { type: 'voice', startedAt: '2026-11-01T15:00:00.000Z', durationSec: 10 });
    // g: play만(D232) → 음성 0이라 순위 없음
    seedActivity(t, g.id, { type: 'play', startedAt: '2026-10-28T12:00:00.000Z', durationSec: 86_400, game: 'steam' });
    const r = await activity(t, me.token);
    // a의 play 600초(10-28)는 시간에도 활동 일수에도 들어가지 않는다(3000초, 1일, D240)
    expect(r.items.map((i) => [i.rank, i.user.nickname, i.total_sec, i.voice_sec, i.active_days])).toEqual([
      [1, 'b', 3600, 3600, 3],
      [2, 'a', 3000, 3000, 1],
    ]);
    // play만 한 g, chat만 한 c는 음성 0이라 순위에 없다
    expect(r.items.some((i) => i.user.id === g.id || i.user.id === c.id)).toBe(false);
    expect(r.items.every((i) => !('play_sec' in i))).toBe(true);
    expect(r.total).toBe(2);
    // 같은 시간·같은 일수면 user id ASC
    const [e, f] = [await linkedMember(t, 'e'), await linkedMember(t, 'f')];
    for (const u of [e, f]) seedActivity(t, u.id, { startedAt: '2026-10-30T00:00:00.000Z', durationSec: 10 });
    t.rankingCache.rows.clear();
    const r2 = await activity(t, me.token);
    const ids = r2.items.filter((i) => i.total_sec === 10).map((i) => i.user.id);
    expect(ids).toEqual([e.id, f.id].sort());
  });

  it('월: 1일 00:00 KST부터 다음 달 1일 전까지, period_days 31, KST 날짜로 일수(UTC 날짜가 달라도 같은 날)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    seedActivity(t, a.id, { startedAt: MONTH_START, durationSec: 100 }); // 10-01 00:00 KST
    seedActivity(t, a.id, { startedAt: '2026-10-01T14:59:59.999Z', durationSec: 100 }); // 같은 KST 날짜
    seedActivity(t, a.id, { startedAt: new Date(new Date(MONTH_START).getTime() - 1).toISOString(), durationSec: 5000 });
    seedActivity(t, a.id, { startedAt: NEXT_MONTH, durationSec: 5000 });
    const r = await activity(t, me.token, 'month');
    expect(r).toMatchObject({
      period: 'month',
      period_start: '2026-10-01T00:00:00.000+09:00',
      period_end: '2026-11-01T00:00:00.000+09:00',
      period_days: 31,
    });
    expect(r.items.map((i) => [i.total_sec, i.active_days])).toEqual([[200, 1]]);
  });

  it('main_games: 음성 시간 큰 순 최대 2개, 같으면 sort_order, play·chat·게임 없음 제외', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    seedActivity(t, a.id, { type: 'voice', game: 'steam', startedAt: '2026-10-28T00:00:00.000Z', durationSec: 500 });
    // play lol 9999초: 음성 기준이면 lol은 100초라 3위 → main_games에 없다(D232)
    seedActivity(t, a.id, { type: 'play', game: 'lol', startedAt: '2026-10-28T00:00:00.000Z', durationSec: 9999 });
    seedActivity(t, a.id, { type: 'voice', game: 'tft', startedAt: '2026-10-28T00:00:00.000Z', durationSec: 500 });
    seedActivity(t, a.id, { type: 'voice', game: 'lol', startedAt: '2026-10-28T00:00:00.000Z', durationSec: 100 });
    seedActivity(t, a.id, { type: 'voice', game: null, startedAt: '2026-10-28T00:00:00.000Z', durationSec: 9000 });
    seedActivity(t, b.id, { type: 'chat', game: 'lol', startedAt: '2026-10-28T00:00:00.000Z' });
    seedActivity(t, b.id, { type: 'voice', game: null, startedAt: '2026-10-28T00:00:00.000Z', durationSec: 1 });
    const r = await activity(t, me.token);
    const sortOf = (code: string) => t?.prisma.game.rows.find((g) => g.code === code)?.sortOrder ?? 0;
    const expected = ['steam', 'tft'].sort((x, y) => sortOf(x) - sortOf(y));
    expect(r.items.find((i) => i.user.id === a.id)?.main_games.map((g) => g.code)).toEqual(expected);
    expect(r.items.find((i) => i.user.id === b.id)?.main_games).toEqual([]);
  });

  it('캐시: 두 번째 요청은 다시 계산하지 않는다. me = 요청자 행', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const row = t.prisma.users.find((u) => u.id === me.userId);
    seedActivity(t, me.userId, { startedAt: '2026-10-28T00:00:00.000Z' });
    expect(row).toBeDefined();
    const first = await activity(t, me.token);
    expect(first.me?.user.id).toBe(me.userId);
    await activity(t, me.token);
    expect(t.rankingCache.writes).toEqual([activityRankingKey('week')]);
  });

  it('기간이 바뀐 읽기 = 재계산(지난주 payload를 이번 주로 보이지 않음), rank_change = 지난주 마지막 순위 대비', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    seedActivity(t, a.id, { startedAt: '2026-10-28T00:00:00.000Z', durationSec: 100 });
    seedActivity(t, b.id, { startedAt: '2026-10-28T00:00:00.000Z', durationSec: 200 });
    expect(brief(await activity(t, me.token))).toEqual([
      [1, 'b'],
      [2, 'a'],
    ]);
    // 다음 주 월요일 00:00 KST + 1분. 캐시는 아직 지난주 값
    t.clock.set('2026-11-01T15:01:00.000Z');
    seedActivity(t, a.id, { startedAt: '2026-11-01T15:00:30.000Z', durationSec: 50 });
    const r = await activity(t, me.token);
    expect(r.period_start).toBe('2026-11-02T00:00:00.000+09:00');
    expect(r.synced_at).toBe('2026-11-01T15:01:00.000Z');
    expect(r.items.map((i) => [i.rank, i.user.nickname, i.total_sec, i.rank_change])).toEqual([[1, 'a', 50, 1]]);
    // 같은 주 안 다음 계산은 기준(지난주 최종)을 유지
    t.clock.advance(5 * 60_000);
    seedActivity(t, b.id, { startedAt: '2026-11-01T15:02:00.000Z', durationSec: 500 });
    await refresher(t).runOnce();
    const r2 = await activity(t, me.token);
    expect(r2.items.map((i) => [i.user.nickname, i.rank_change])).toEqual([
      ['b', 0],
      ['a', 0],
    ]);
  });

  it('빈 캐시 첫 계산 실패 → 500, 기간이 바뀐 읽기의 재계산 실패도 500(지난 기간 값을 내리지 않는다)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    t.rankingCache.failWrites.add(activityRankingKey('week'));
    await expectError(await call(t, 'GET', '/rankings/activity', me.token), 500, 'INTERNAL_ERROR');
    t.rankingCache.failWrites.clear();
    await activity(t, me.token);
    t.clock.set('2026-11-01T15:01:00.000Z');
    t.rankingCache.failWrites.add(activityRankingKey('week'));
    await expectError(await call(t, 'GET', '/rankings/activity', me.token), 500, 'INTERNAL_ERROR');
  });

  it('play만 한 날은 활동 일수에 없고, chat만 한 날은 있다(D240). play 행은 저장돼 있다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    seedActivity(t, a.id, { type: 'voice', startedAt: '2026-10-27T00:00:00.000Z', durationSec: 100 });
    seedActivity(t, a.id, { type: 'play', startedAt: '2026-10-28T00:00:00.000Z', durationSec: 5000, game: 'steam' });
    seedActivity(t, a.id, { type: 'play', startedAt: '2026-10-29T00:00:00.000Z', durationSec: 5000, game: 'lol' });
    seedActivity(t, a.id, { type: 'chat', startedAt: '2026-10-30T00:00:00.000Z' });
    const r = await activity(t, me.token);
    expect(r.items.map((i) => [i.user.nickname, i.total_sec, i.active_days, i.main_games])).toEqual([['a', 100, 2, []]]);
    expect(t.prisma.activityLog.rows.filter((x) => x.userId === a.id && x.type === 'play')).toHaveLength(2);
  });

  it('집계 SQL 3종(합계·게임별·내전 수)이 돈다. type 목록은 ACTIVITY_RANKED_TYPES·ACTIVITY_COUNTED_TYPES 바인딩(문자열을 박지 않음)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    seedActivity(t, a.id, { startedAt: '2026-10-28T00:00:00.000Z', game: 'lol' });
    await activity(t, me.token);
    const calls = t.prisma.rawCalls.filter((c) => c.sql.includes('gcd:activity-'));
    expect(calls.map((c) => /gcd:[a-z-]+/.exec(c.sql)?.[0])).toEqual(['gcd:activity-totals', 'gcd:activity-games', 'gcd:activity-scrims']);
    for (const c of calls.slice(0, 2)) {
      expect(c.sql).not.toMatch(/'voice'|'play'|'chat'/);
      expect(c.values.some((v) => nestedValues(v).includes('voice'))).toBe(true);
    }
    // 합계(활동 일수)는 COUNTED(voice·chat)도 바인딩한다. play는 어디에도 바인딩되지 않는다(D240)
    const totalsValues = (calls[0]?.values ?? []).flatMap((v) => nestedValues(v));
    expect(totalsValues).toContain('chat');
    expect(calls.flatMap((c) => c.values.flatMap((v) => nestedValues(v)))).not.toContain('play');
  });
});

describe('활동 랭킹 scrim_count(D239)', () => {
  const IN_WEEK = '2026-10-28T11:00:00.000Z'; // 수요일 20:00 KST

  it('joined + 승인 결과 + 취소 아님만 센다. waitlist·cancelled·no_show 참가, pending·rejected만 있는 결과, 취소 내전 제외. rated·게임 무관', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const [a, b, c, d] = [await linkedMember(t, 'a'), await linkedMember(t, 'b'), await linkedMember(t, 'c'), await linkedMember(t, 'd')];
    for (const u of [a, b, c, d]) seedActivity(t, u.id, { startedAt: IN_WEEK, durationSec: 1000 });
    const host = a.id;
    // 1: 승인, 4명 각자 다른 참가 상태
    seedScrimWithResult(t, {
      hostId: host,
      players: [{ userId: a.id }, { userId: b.id, status: 'waitlist' }, { userId: c.id, status: 'cancelled' }, { userId: d.id, status: 'no_show' }],
      scheduledAt: IN_WEEK,
      startedAt: IN_WEEK,
    });
    // 2: 반려 후 승인(승인 1건 이상) + 친선 + 스팀 게임 → a 셈
    seedScrimWithResult(t, { hostId: host, players: [{ userId: a.id }], scheduledAt: IN_WEEK, startedAt: IN_WEEK, results: ['rejected', 'approved'], rated: false, game: 'steam' });
    // 3: 결과 대기만 / 4: 반려만 / 5: 취소 내전(승인 결과가 있어도) → 세지 않음
    seedScrimWithResult(t, { hostId: host, players: [{ userId: a.id }, { userId: b.id }], scheduledAt: IN_WEEK, startedAt: IN_WEEK, results: ['pending'] });
    seedScrimWithResult(t, { hostId: host, players: [{ userId: a.id }, { userId: b.id }], scheduledAt: IN_WEEK, startedAt: IN_WEEK, results: ['rejected'] });
    seedScrimWithResult(t, { hostId: host, players: [{ userId: a.id }, { userId: b.id }], scheduledAt: IN_WEEK, startedAt: IN_WEEK, status: 'cancelled' });
    const r = await activity(t, me.token);
    const count = Object.fromEntries(r.items.map((i) => [i.user.nickname, i.scrim_count]));
    expect(count).toEqual({ a: 2, b: 0, c: 0, d: 0 });
  });

  it('기간 귀속 = COALESCE(started_at, scheduled_at): 일요일 23:59 KST 시작은 지난주, 월요일 00:00 KST는 이번 주, started_at 없으면 예정 시각', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    seedActivity(t, a.id, { startedAt: IN_WEEK, durationSec: 1000 });
    const ws = Date.parse(WEEK_START);
    const lastSunday2359 = new Date(ws - 60_000).toISOString();
    // 예정은 이번 주지만 실제 시작이 지난주 일요일 23:59 → 지난주
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }], scheduledAt: WEEK_START, startedAt: lastSunday2359 });
    // 예정은 지난주지만 실제 시작이 월요일 00:00 KST → 이번 주
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }], scheduledAt: lastSunday2359, startedAt: WEEK_START });
    // started_at 없음: 예정 시각으로 귀속(이번 주 1, 지난주 1)
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }], scheduledAt: IN_WEEK, startedAt: null });
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }], scheduledAt: lastSunday2359, startedAt: null });
    // 다음 주 시작 시각(구간 끝)은 제외
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }], scheduledAt: '2026-11-01T15:00:00.000Z', startedAt: '2026-11-01T15:00:00.000Z' });
    const r = await activity(t, me.token);
    expect(r.items.map((i) => [i.user.nickname, i.scrim_count])).toEqual([['a', 2]]);
    const m = await activity(t, me.token, 'month');
    expect(m.items.map((i) => [i.user.nickname, i.scrim_count])).toEqual([['a', 4]]);
  });

  it('내전만 있고 음성 0인 회원은 순위에 없다. scrim_count는 정렬에 영향 없다(내전이 많아도 음성이 적으면 아래)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const [a, b, c] = [await linkedMember(t, 'a'), await linkedMember(t, 'b'), await linkedMember(t, 'c')];
    seedActivity(t, a.id, { startedAt: IN_WEEK, durationSec: 100 });
    seedActivity(t, b.id, { startedAt: IN_WEEK, durationSec: 5000 });
    seedActivity(t, c.id, { type: 'chat', startedAt: IN_WEEK });
    for (let i = 0; i < 3; i++) {
      seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }, { userId: c.id }], scheduledAt: IN_WEEK, startedAt: IN_WEEK });
    }
    const r = await activity(t, me.token);
    expect(r.items.map((i) => [i.rank, i.user.nickname, i.total_sec, i.scrim_count])).toEqual([
      [1, 'b', 5000, 0],
      [2, 'a', 100, 3],
    ]);
    // 내전 수 쿼리는 순위에 든 회원만 묻는다
    const call = t.prisma.rawCalls.find((x) => x.sql.includes('gcd:activity-scrims'));
    const asked = nestedValues(call?.values.at(-1));
    expect([...asked].sort()).toEqual([a.id, b.id].sort());
  });

  it('탈퇴 회원은 순위에 없어 세지 않는다. 내전 수 SQL도 순위 대상 조건을 쓴다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    const gone = await linkedMember(t, 'gone', { leftAt: new Date('2026-10-30T00:00:00.000Z') });
    for (const u of [a, gone]) seedActivity(t, u.id, { startedAt: IN_WEEK, durationSec: 100 });
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }, { userId: gone.id }], scheduledAt: IN_WEEK, startedAt: IN_WEEK });
    const r = await activity(t, me.token);
    expect(r.items.map((i) => [i.user.nickname, i.scrim_count])).toEqual([['a', 1]]);
  });
});

describe('GET /rankings/playtime', () => {
  it('app_id 누락·0·문자 400', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    for (const q of ['', '?app_id=0', '?app_id=abc', '?app_id=-1']) {
      await expectError(await call(t, 'GET', `/rankings/playtime${q}`, me.token), 400, 'VALIDATION_FAILED');
    }
  });

  it('보유자 없음(D235) → 빈 결과를 캐시에 저장, synced_at = 계산 시각, 5분 안 두 번째 요청은 SQL을 다시 돌리지 않는다', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    // 부계정·0분만 있으면 보유자 0명
    const a = await linkedMember(t, 'a');
    seedSteam(t, a.id, [{ appId: PUBG, total: 0 }]);
    const empty = {
      items: [],
      next_cursor: null,
      app: { app_id: PUBG, name: null },
      total: 0,
      me: null,
      synced_at: new Date(NOW).toISOString(),
      stale: false,
      playtime_synced_at: null,
    };
    expect(await playtime(t, me.token, PUBG)).toEqual(empty);
    expect(t.rankingCache.writes).toEqual([playtimeRankingKey(PUBG)]);
    const rowsSql = () => t?.prisma.rawCalls.filter((c) => c.sql.includes('gcd:playtime-rows')).length;
    expect(rowsSql()).toBe(1);
    t.clock.advance(4 * 60_000);
    expect(await playtime(t, me.token, PUBG)).toEqual(empty);
    expect(rowsSql()).toBe(1);
    expect(t.rankingCache.writes).toEqual([playtimeRankingKey(PUBG)]);
  });

  it('대표·확인된 스팀 계정만, minutes 0 제외, 동점(total → recent → id), 이름·동기화 시각, 비공개로 바뀌어도 값 유지', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    const c = await linkedMember(t, 'c');
    const d = await linkedMember(t, 'd');
    const e = await linkedMember(t, 'e');
    const accA = seedSteam(t, a.id, [{ appId: PUBG, total: 6000, recent: 1200, name: null, syncedAt: '2026-10-30T20:00:00.000Z' }], {
      displayName: '에이',
    });
    seedSteam(t, b.id, [{ appId: PUBG, total: 6000, recent: 60, name: 'PUBG: BATTLEGROUNDS', syncedAt: '2026-10-29T20:00:00.000Z' }]);
    seedSteam(t, c.id, [{ appId: PUBG, total: 0 }]);
    seedSteam(t, d.id, [{ appId: PUBG, total: 9999 }], { verified: false });
    seedSteam(t, e.id, [{ appId: PUBG, total: 9999 }], { primary: false });
    const row = t.prisma.gameAccount.rows.find((x) => x.id === accA.id);
    if (row) row.lastSyncError = 'STEAM_PROFILE_PRIVATE';
    const r = await playtime(t, me.token, PUBG);
    expect(r.items.map((i) => [i.rank, i.user.nickname, i.account_name, i.minutes_total, i.minutes_recent, i.rank_change])).toEqual([
      [1, 'a', '에이', 6000, 1200, null],
      [2, 'b', 'steamer', 6000, 60, null],
    ]);
    expect(r.app).toEqual({ app_id: PUBG, name: 'PUBG: BATTLEGROUNDS' });
    expect(r.playtime_synced_at).toBe('2026-10-30T20:00:00.000Z');
    expect(r.synced_at).toBe(new Date(NOW).toISOString());
    expect(t.rankingCache.writes).toEqual([playtimeRankingKey(PUBG)]);
  });

  it('주기 작업: 보유 상위 app만 갱신, 대상 밖 app은 요청 때 계산 → 다음 주기 삭제 → 다음 요청에 다시 계산', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    seedSteam(t, a.id, [{ appId: PUBG, total: 100 }, { appId: 730, total: 50 }]);
    seedSteam(t, b.id, [{ appId: PUBG, total: 300 }]);
    const calc = t.app.get(RankingCalculator);
    expect(await calc.topPlaytimeApps(50)).toEqual([PUBG, 730]);
    expect(await calc.topPlaytimeApps(1)).toEqual([PUBG]);
    await refresher(t).runOnce();
    expect(t.rankingCache.rows.has(playtimeRankingKey(PUBG))).toBe(true);
    expect(t.rankingCache.rows.has(playtimeRankingKey(730))).toBe(true);
    // 보유자가 사라진 app(그리고 대상 밖에서 요청된 app)
    t.prisma.steamPlaytime.rows = t.prisma.steamPlaytime.rows.filter((r) => r.appId !== 730);
    seedSteam(t, (await linkedMember(t, 'c')).id, [{ appId: 440, total: 10 }]);
    vi.spyOn(calc, 'topPlaytimeApps').mockResolvedValue([PUBG]);
    await playtime(t, me.token, 440);
    expect(t.rankingCache.rows.has(playtimeRankingKey(440))).toBe(true);
    await refresher(t).runOnce();
    expect(t.rankingCache.rows.has(playtimeRankingKey(440))).toBe(false);
    expect(t.rankingCache.rows.has(playtimeRankingKey(730))).toBe(false);
    const again = await playtime(t, me.token, 440);
    expect(again.items).toHaveLength(1);
    expect(t.rankingCache.rows.has(playtimeRankingKey(440))).toBe(true);
    // 보유자 0인 app(D235): 요청 → 빈 결과 저장 → 다음 주기 삭제 → 다음 요청에 다시 계산
    const NONE = 999_999;
    expect((await playtime(t, me.token, NONE)).synced_at).toBe(t.clock.now().toISOString());
    expect(t.rankingCache.rows.has(playtimeRankingKey(NONE))).toBe(true);
    t.clock.advance(5 * 60_000);
    await refresher(t).runOnce();
    expect(t.rankingCache.rows.has(playtimeRankingKey(NONE))).toBe(false);
    const recomputed = await playtime(t, me.token, NONE);
    expect(recomputed).toMatchObject({ items: [], total: 0, synced_at: t.clock.now().toISOString() });
    expect(t.rankingCache.writes.filter((k) => k === playtimeRankingKey(NONE))).toHaveLength(2);
  });

  it('rank_change는 주간 기준(D153)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    seedSteam(t, a.id, [{ appId: PUBG, total: 100 }]);
    const accB = seedSteam(t, b.id, [{ appId: PUBG, total: 50 }]);
    await playtime(t, me.token, PUBG);
    t.clock.set('2026-11-02T00:00:00.000Z'); // 다음 주
    const sp = t.prisma.steamPlaytime.rows.find((r) => r.gameAccountId === accB.id);
    if (sp) sp.minutesTotal = 500;
    await refresher(t).runOnce();
    const r = await playtime(t, me.token, PUBG);
    expect(r.items.map((i) => [i.user.nickname, i.rank_change])).toEqual([
      ['b', 1],
      ['a', -1],
    ]);
  });
});

describe('GET /bot/rankings/:type', () => {
  it('type·쿼리 검증 400(path type), scope 403', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t, { scopes: ['bot:rankings:read'] });
    const body = await expectError(await bot(t, 'GET', '/bot/rankings/kda', k.raw), 400, 'VALIDATION_FAILED');
    expect(body.details?.map((d) => d.path)).toEqual(['type']);
    for (const p of [
      '/bot/rankings/tier',
      '/bot/rankings/tier?game=steam',
      '/bot/rankings/elo',
      '/bot/rankings/activity?period=year',
      '/bot/rankings/playtime',
      '/bot/rankings/elo?game=lol&limit=26',
      '/bot/rankings/elo?game=lol&limit=0',
    ]) {
      await expectError(await bot(t, 'GET', p, k.raw), 400, 'VALIDATION_FAILED');
    }
    const noScope = seedApiKey(t, { scopes: ['bot:activity', 'bot:members'] });
    await expectError(await bot(t, 'GET', '/bot/rankings/elo?game=lol', noScope.raw), 403, 'API_KEY_SCOPE_MISSING');
  });

  it('4종이 웹과 같은 캐시 값·limit·discord_id·detail·web_url을 준다(웹 응답에는 discord_id 없음)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const k = seedApiKey(t);
    const season = seedSeason(t, '시즌 1', '2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    const users = [];
    for (const [i, n] of ['a', 'b', 'c'].entries()) {
      const u = await linkedMember(t, n);
      users.push(u);
      seedAccount(t, u.id, i === 0 ? { tier: 'MASTER', division: null, lp: 120 } : { tier: 'DIAMOND', division: 'II', lp: 45 - i });
      seedRating(t, u.id, season.id, { elo: 1200 - i * 10, wins: 22 - i, losses: 9 });
      seedActivity(t, u.id, { startedAt: '2026-10-28T00:00:00.000Z', durationSec: 3000 - i });
      seedSteam(t, u.id, [{ appId: PUBG, total: 6000 - i, recent: 1100, name: 'PUBG' }]);
    }

    const tier = await botRanking(t, k.raw, '/bot/rankings/tier?game=lol&limit=2');
    expect(tier).toMatchObject({ type: 'tier', unit: 'tier_score', total: 3, stale: false, web_url: `${TEST_WEB_ORIGIN}/rankings?tab=tier&game=lol` });
    expect(tier.context).toEqual({ game: 'lol', season: null, is_final: false, period: null, period_start: null, period_end: null, app: null });
    expect(tier.items.map((i) => [i.rank, i.user.nickname, i.detail])).toEqual([
      [1, 'a', 'Master · 120 LP'],
      [2, 'b', 'Diamond II · 44 LP'],
    ]);
    expect(tier.items[0]?.user).toEqual({
      id: users[0]?.id,
      nickname: 'a',
      avatar_url: null,
      discord_id: users[0]?.discordId,
      profile_url: `${TEST_WEB_ORIGIN}/members/${users[0]?.id}`,
    });
    const webTier = await (await call(t, 'GET', '/rankings/tier?game=lol', me.token)).text();
    expect(webTier).not.toContain('discord_id');
    expect(JSON.parse(webTier).items.map((i: { score: number }) => i.score)).toEqual(
      expect.arrayContaining(tier.items.map((i) => i.value)),
    );

    const elo = await botRanking(t, k.raw, '/bot/rankings/elo?game=lol');
    expect(elo).toMatchObject({ unit: 'elo', total: 3, web_url: `${TEST_WEB_ORIGIN}/rankings?tab=elo&game=lol` });
    expect(elo.context).toMatchObject({ game: 'lol', season: { id: season.id, name: '시즌 1' }, is_final: false });
    expect(elo.items.map((i) => [i.value, i.detail])).toEqual([
      [1200, '22승 9패'],
      [1190, '21승 9패'],
      [1180, '20승 9패'],
    ]);

    const act = await botRanking(t, k.raw, '/bot/rankings/activity');
    expect(act).toMatchObject({ unit: 'seconds', web_url: `${TEST_WEB_ORIGIN}/rankings?tab=activity&period=week` });
    expect(act.context).toMatchObject({ period: 'week', period_start: '2026-10-26T00:00:00.000+09:00', period_end: '2026-11-02T00:00:00.000+09:00' });
    expect(act.items.map((i) => [i.value, i.detail])[0]).toEqual([3000, '7일 중 1일 활동']);
    const webAct = await activity(t, me.token);
    expect(act.items.map((i) => i.value)).toEqual(webAct.items.map((i) => i.total_sec));

    const pt = await botRanking(t, k.raw, `/bot/rankings/playtime?app_id=${PUBG}&limit=1`);
    expect(pt).toMatchObject({ unit: 'minutes', total: 3, web_url: `${TEST_WEB_ORIGIN}/rankings?tab=playtime&app_id=${PUBG}` });
    expect(pt.context.app).toEqual({ app_id: PUBG, name: 'PUBG' });
    expect(pt.items.map((i) => [i.value, i.detail])).toEqual([[6000, '최근 2주 18시간']]);

    // 같은 캐시 행: 봇 요청은 새 키를 만들지 않았고, 웹 요청 뒤에도 계산이 다시 일어나지 않는다
    const writes = [...t.rankingCache.writes];
    await activity(t, me.token);
    await playtime(t, me.token, PUBG);
    expect(t.rankingCache.writes).toEqual(writes);
    expect(writes).toContain(tierRankingKey('lol'));
  });

  it('activity value = 음성 초(play 제외, D232), detail 활동 일수도 play 제외(D240), 내전 수(0회면 생략, D239)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    seedActivity(t, a.id, { startedAt: '2026-10-28T00:00:00.000Z', durationSec: 3000 });
    // 10-29는 play만 → 활동 일수에 안 든다(D240)
    seedActivity(t, a.id, { type: 'play', game: 'steam', startedAt: '2026-10-29T00:00:00.000Z', durationSec: 50_000 });
    seedActivity(t, b.id, { startedAt: '2026-10-28T00:00:00.000Z', durationSec: 100 });
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }], scheduledAt: '2026-10-28T11:00:00.000Z', startedAt: '2026-10-28T11:00:00.000Z' });
    seedScrimWithResult(t, { hostId: a.id, players: [{ userId: a.id }], scheduledAt: '2026-10-29T11:00:00.000Z', startedAt: '2026-10-29T11:00:00.000Z' });
    const act = await botRanking(t, k.raw, '/bot/rankings/activity');
    expect(act.items.map((i) => [i.user.nickname, i.value, i.detail])).toEqual([
      ['a', 3000, '7일 중 1일 활동 · 내전 2회'],
      ['b', 100, '7일 중 1일 활동'],
    ]);
  });

  it('elo 시즌 없음 → items [], season null, synced_at null / playtime 보유자 없음 → app.name null, synced_at = 계산 시각(D235)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const elo = await botRanking(t, k.raw, '/bot/rankings/elo?game=lol');
    expect(elo).toMatchObject({ items: [], total: 0, synced_at: null, stale: false });
    expect(elo.context.season).toBeNull();
    const pt = await botRanking(t, k.raw, `/bot/rankings/playtime?app_id=${PUBG}`);
    expect(pt).toMatchObject({ items: [], total: 0, synced_at: new Date(NOW).toISOString(), stale: false });
    expect(pt.context.app).toEqual({ app_id: PUBG, name: null });
  });

  it('빈 캐시 첫 계산 실패 → 500(웹과 같음)', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    t.rankingCache.failWrites.add(activityRankingKey('month'));
    await expectError(await bot(t, 'GET', '/bot/rankings/activity?period=month', k.raw), 500, 'INTERNAL_ERROR');
  });
});
