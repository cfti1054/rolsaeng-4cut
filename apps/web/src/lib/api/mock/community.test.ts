import { activityPeriodWindow, kstWeekWindow } from '@gcd/core';
import {
  ApiPath,
  BOT_PRESENCE_STALE_AFTER_SEC,
  DevLoginResponse,
  GetActivityRankingResponse,
  GetDashboardSummaryResponse,
  GetPlaytimeRankingResponse,
  GetUserProfileResponse,
  SearchSteamAppsResponse,
  fillPath,
  pickDefaultPlaytimeAppId,
} from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { createMockBackend, type MockDb } from './backend';
import {
  MOCK_PLAYTIME_ZERO_APP,
  activityResponse,
  mockActivityLogs,
  mockCommunity,
  mockScrimJoins,
  type MockActivityLog,
  type MockBotScenario,
  type MockScrimSource,
} from './community';
import type { MockRankingScenario } from './rankings';
import { MOCK_SCRIM_USERS } from './scrims';

const NOW = Date.parse('2026-10-31T12:00:00.000Z'); // 토 21:00 KST

async function setup(o: { bot?: MockBotScenario | null; scenario?: MockRankingScenario | null; username?: string } = {}) {
  let db: MockDb | null = null;
  let now = NOW;
  const mock = createMockBackend({
    storage: { get: () => db, set: (d) => (db = d) },
    cookies: { hasRefresh: () => true, setRefresh: () => {}, clearRefresh: () => {} },
    now: () => now,
    accessTtlSec: 86_400 * 3,
    s1: { origin: () => 'http://localhost:3000' },
    s2: { rankings: { scenario: () => o.scenario ?? null, bot: () => o.bot ?? null } },
  });
  const api = createApiClient({ fetch: mock.fetch });
  const res = await api.request(ApiPath.authDevLogin, DevLoginResponse, { method: 'POST', body: { username: o.username ?? 'host_kim' }, auth: false });
  api.setSession(res);
  return {
    me: res.user,
    db: () => db,
    activity: (period = 'week') => api.request(`${ApiPath.rankingsActivity}?period=${period}`, GetActivityRankingResponse),
    playtime: (id: number | string) => api.request(`${ApiPath.rankingsPlaytime}?app_id=${id}`, GetPlaytimeRankingResponse),
    apps: () => api.request(ApiPath.steamApps, SearchSteamAppsResponse),
    summary: () => api.request(ApiPath.dashboardSummary, GetDashboardSummaryResponse),
    profile: (id: string) => api.request(fillPath(ApiPath.userProfile, { id }), GetUserProfileResponse),
    signInDiscord: () => mock.discordSignIn(),
    raw: (path: string) => mock.fetch(`http://localhost/api/v1${path}`, { method: 'GET' }),
  };
}

describe('S5 목: 활동 랭킹', () => {
  it('이번 주: 기간·순위·정렬·보조 값', async () => {
    const t = await setup();
    const r = await t.activity('week');
    const w = activityPeriodWindow('week', new Date(NOW));
    expect(Date.parse(r.period_start)).toBe(w.start.getTime());
    expect(Date.parse(r.period_end)).toBe(w.end.getTime());
    expect(r.period_start.endsWith('+09:00')).toBe(true);
    expect(r.period_days).toBe(7);
    expect(r.bot_connected).toBe(true);
    expect(r.items.length).toBeGreaterThan(3);
    expect(r.items.map((e) => e.rank)).toEqual(r.items.map((_, i) => i + 1));
    for (let i = 1; i < r.items.length; i++) expect(r.items[i - 1]!.total_sec).toBeGreaterThanOrEqual(r.items[i]!.total_sec);
    for (const e of r.items) {
      // 음성만(D232): total = voice, play_sec 필드 없음
      expect(e.total_sec).toBe(e.voice_sec);
      expect('play_sec' in e).toBe(false);
      expect(e.active_days).toBeLessThanOrEqual(r.period_days);
    }
    expect(r.items.some((e) => e.rank_change !== null)).toBe(true);
    expect(r.total).toBe(r.items.length);
  });
  it('이번 달: 10월 31일', async () => {
    const r = await (await setup()).activity('month');
    expect(r.period_days).toBe(31);
    expect(r.period_start).toBe('2026-10-01T00:00:00.000+09:00');
  });
  it('채팅만 한 멤버는 순위에 없다(시간 0)', async () => {
    const t = await setup();
    const r = await t.activity('month');
    expect(r.items.some((e) => e.user.nickname === '체스왕')).toBe(false);
  });
  it('play 이벤트는 시간·주 게임·활동 일수 어디에도 들어가지 않는다(D240)', async () => {
    const t = await setup();
    const r = await t.activity('month');
    const w = activityPeriodWindow('month', new Date(NOW));
    const ids = [t.me.id, ...MOCK_SCRIM_USERS.map((u) => u.id)];
    const logs = mockActivityLogs(ids, NOW).filter((l) => l.startedAt >= w.start.getTime() && l.startedAt < w.end.getTime());
    expect(logs.some((l) => l.type === 'play')).toBe(true);
    for (const e of r.items) {
      const mine = logs.filter((l) => l.userId === e.user.id);
      const voice = mine.filter((l) => l.type === 'voice').reduce((a, l) => a + l.durationSec, 0);
      expect(e.total_sec).toBe(voice);
      const counted = mine.filter((l) => l.type === 'voice' || l.type === 'chat');
      const days = new Set(counted.map((l) => new Date(l.startedAt + 9 * 3600_000).toISOString().slice(0, 10))).size;
      expect(e.active_days).toBe(days);
      const voiceGames = new Set(mine.filter((l) => l.type === 'voice' && l.game).map((l) => l.game));
      for (const g of e.main_games) expect(voiceGames.has(g.code)).toBe(true);
    }
  });
  it('scrim_count = 목 내전 자료의 승인·joined·기간 참가 수, 정렬과 무관', async () => {
    const t = await setup();
    const r = await t.activity('month');
    const w = activityPeriodWindow('month', new Date(NOW));
    const joins = mockScrimJoins(t.db()!.s2!);
    for (const e of r.items) {
      const n = joins.filter((j) => j.userId === e.user.id && j.startAt >= w.start.getTime() && j.startAt < w.end.getTime()).length;
      expect(e.scrim_count).toBe(n);
    }
    // 순서는 total_sec만 따른다
    for (let i = 1; i < r.items.length; i++) expect(r.items[i - 1]!.total_sec).toBeGreaterThanOrEqual(r.items[i]!.total_sec);
    expect((await (await setup({ scenario: 'empty' })).activity('month')).items.every((e) => e.scrim_count === 0)).toBe(true);
  });
  it('끝나지 않은 세션은 만들지 않는다', () => {
    const logs = mockActivityLogs(['a', 'b', 'c'], NOW);
    expect(logs.every((l) => l.startedAt + l.durationSec * 1000 <= NOW)).toBe(true);
    expect(logs.filter((l) => l.type === 'chat').every((l) => l.durationSec === 0)).toBe(true);
  });
  it('none → bot_connected false, empty_period → true + 빈 목록', async () => {
    const none = await (await setup({ bot: 'none' })).activity();
    expect(none).toMatchObject({ bot_connected: false, items: [], total: 0, me: null });
    const ep = await setup({ bot: 'empty_period' });
    expect(await ep.activity('week')).toMatchObject({ bot_connected: true, items: [] });
    expect(await ep.activity('month')).toMatchObject({ bot_connected: true, items: [] });
  });
  it('period 잘못된 값 → VALIDATION_FAILED, 생략 → week', async () => {
    const t = await setup();
    await expect(t.activity('year')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('rankings 시나리오: stale·error·me_outside', async () => {
    expect((await (await setup({ scenario: 'stale' })).activity()).stale).toBe(true);
    await expect((await setup({ scenario: 'error' })).activity()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    const mo = await setup({ scenario: 'me_outside' });
    const r = await mo.activity('month');
    if (r.me) expect(r.items.some((e) => e.user.id === mo.me.id)).toBe(false);
  });
});

describe('S5 목: 플레이타임 랭킹', () => {
  it('/steam-apps(q 없음) 모든 항목: owner_count ≥ 1이고 플레이타임 순위 인원과 같다(D234)', async () => {
    const t = await setup();
    const apps = await t.apps();
    expect(apps.items.length).toBeGreaterThan(0);
    expect(pickDefaultPlaytimeAppId(apps.items)).toBe(apps.items[0]!.app_id);
    for (const a of apps.items) {
      expect(a.owner_count).toBeGreaterThanOrEqual(1);
      expect((await t.playtime(a.app_id)).total).toBe(a.owner_count);
    }
    expect(apps.items.some((a) => a.app_id === MOCK_PLAYTIME_ZERO_APP)).toBe(false);
  });
  it('보유 게임 첫 항목: 순위·동기화 시각', async () => {
    const t = await setup();
    const apps = await t.apps();
    const r = await t.playtime(apps.items[0]!.app_id);
    expect(r.app).toEqual({ app_id: apps.items[0]!.app_id, name: apps.items[0]!.name });
    expect(r.items.length).toBe(apps.items[0]!.owner_count);
    for (let i = 1; i < r.items.length; i++) expect(r.items[i - 1]!.minutes_total).toBeGreaterThanOrEqual(r.items[i]!.minutes_total);
    expect(r.playtime_synced_at).toBe('2026-10-31T05:02:00.000+09:00');
    expect(r.synced_at).not.toBeNull();
  });
  it('보유자 없는 게임(0분 보유)·모르는 게임 → 빈 응답, synced_at은 값(D235)', async () => {
    const t = await setup();
    for (const id of [MOCK_PLAYTIME_ZERO_APP, 123456]) {
      const r = await t.playtime(id);
      expect(r).toMatchObject({ items: [], total: 0, me: null, stale: false, playtime_synced_at: null, app: { app_id: id, name: null } });
      expect(r.synced_at).not.toBeNull();
    }
    const st = await (await setup({ scenario: 'stale' })).playtime(123456);
    expect(st.stale).toBe(true);
    expect(st.synced_at).not.toBeNull();
  });
  it('app_id 없음·형식 오류 → VALIDATION_FAILED', async () => {
    const t = await setup();
    await expect(t.playtime('abc')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(t.playtime(0)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
  it('rankings=empty → 스팀 보유 게임 목록 빔', async () => {
    expect((await (await setup({ scenario: 'empty' })).apps()).items).toEqual([]);
  });
});

describe('S5 목: 홈 community', () => {
  it('live(기본): 음성 숫자, 활동 멤버, 지금 플레이 중 최대 5·count 내림차순', async () => {
    const t = await setup();
    const c = (await t.summary()).community;
    expect(c.voice).toMatchObject({ state: 'live', member_count: 23 });
    expect(c.active_members.state).toBe('ready');
    expect(c.now_playing?.items.length).toBe(5);
    const counts = c.now_playing!.items.map((i) => i.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
  it('활동 멤버 수 = 이번 KST 주 voice·chat 기록이 있는 사람 수(play 제외, D240)', async () => {
    const t = await setup();
    const c = (await t.summary()).community;
    const w = kstWeekWindow(new Date(NOW));
    const ids = [t.me.id, ...MOCK_SCRIM_USERS.map((u) => u.id)];
    const expected = new Set(
      mockActivityLogs(ids, NOW)
        .filter((l) => l.type !== 'play' && l.startedAt >= w.start.getTime() && l.startedAt < w.end.getTime())
        .map((l) => l.userId),
    ).size;
    expect(c.active_members).toEqual({ state: 'ready', count: expected });
    // 채팅만 한 멤버도 센다 → 시간 순위 인원보다 크거나 같다
    expect(expected).toBeGreaterThanOrEqual((await t.activity('week')).total);
  });
  it('stale: 숫자 없음 + captured_at, 지금 플레이 중 없음', async () => {
    const c = (await (await setup({ bot: 'stale' })).summary()).community;
    expect(c.voice.state).toBe('stale');
    expect(c.voice.member_count).toBeNull();
    expect(NOW - Date.parse(c.voice.captured_at!)).toBeGreaterThan(BOT_PRESENCE_STALE_AFTER_SEC * 1000);
    expect(c.now_playing).toBeNull();
  });
  it('no_playing·none·empty_period', async () => {
    expect((await (await setup({ bot: 'no_playing' })).summary()).community).toMatchObject({ voice: { state: 'live' }, now_playing: null });
    expect((await (await setup({ bot: 'none' })).summary()).community).toEqual({
      voice: { state: 'not_connected', member_count: null, captured_at: null },
      active_members: { state: 'not_connected', count: null },
      now_playing: null,
    });
    expect((await (await setup({ bot: 'empty_period' })).summary()).community.active_members).toEqual({ state: 'ready', count: 0 });
  });
});

describe('S5 목: 내전 참여 수 규칙(mockScrimJoins)', () => {
  const at = (iso: string) => Date.parse(iso);
  const src: MockScrimSource = {
    scrims: [
      { id: 's1', status: 'finished', scheduled_at: '2026-10-27T11:00:00.000Z', started_at: '2026-10-27T11:30:00.000Z' },
      { id: 's2', status: 'finished', scheduled_at: '2026-10-28T11:00:00.000Z', started_at: null },
      { id: 's3', status: 'cancelled', scheduled_at: '2026-10-28T11:00:00.000Z', started_at: '2026-10-28T11:00:00.000Z' },
      { id: 's4', status: 'playing', scheduled_at: '2026-10-29T11:00:00.000Z', started_at: '2026-10-29T11:00:00.000Z' },
    ],
    players: [
      { scrim_id: 's1', user_id: 'a', status: 'joined' },
      { scrim_id: 's1', user_id: 'b', status: 'waitlist' },
      { scrim_id: 's1', user_id: 'c', status: 'cancelled' },
      { scrim_id: 's1', user_id: 'd', status: 'no_show' },
      { scrim_id: 's2', user_id: 'a', status: 'joined' },
      { scrim_id: 's3', user_id: 'a', status: 'joined' },
      { scrim_id: 's4', user_id: 'a', status: 'joined' },
    ],
    results: [
      { scrim_id: 's1', status: 'rejected' },
      { scrim_id: 's1', status: 'approved' },
      { scrim_id: 's2', status: 'approved' },
      { scrim_id: 's3', status: 'approved' },
      { scrim_id: 's4', status: 'pending' },
    ],
  };
  it('joined + 승인 결과 + 취소 아님만, 시각 = started_at ?? scheduled_at', () => {
    expect(mockScrimJoins(src)).toEqual([
      { userId: 'a', scrimId: 's1', startAt: at('2026-10-27T11:30:00.000Z') },
      { userId: 'a', scrimId: 's2', startAt: at('2026-10-28T11:00:00.000Z') },
    ]);
  });
});

describe('S5 목: 디스코드 연동(GET /me만, D238)', () => {
  it('연동 코드 경로는 목에 없다', async () => {
    const t = await setup();
    for (const p of ['/me/discord-link', '/me/discord-link/code']) expect((await t.raw(p)).status).toBe(404);
  });
  it('개발 로그인 → 프로필 discord_linked false(isLinkedDiscordId)', async () => {
    const t = await setup();
    expect(t.me.discord_id?.startsWith('dev-')).toBe(true);
    expect((await t.profile(t.me.id)).user.discord_linked).toBe(false);
  });
  it('디스코드 로그인(snowflake) → discord_linked true', async () => {
    const t = await setup();
    const u = t.signInDiscord();
    expect((await t.profile(u.id)).user.discord_linked).toBe(true);
  });
});

describe('S5 목: play 제외(D240)', () => {
  // 2026-10-31(토) 21:00 KST 기준. 이번 주 = 10-26(월)부터
  const at = (iso: string) => Date.parse(iso);
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const P = '00000000-0000-4000-8000-00000000000c';
  const ref = (id: string) => ({ id, nickname: id, avatar_url: null });
  const me = { id: '00000000-0000-4000-8000-0000000000ff' } as Parameters<typeof activityResponse>[0]['me'];
  const logs: MockActivityLog[] = [
    // a: 음성 1일 + 다른 날 play만 → 활동 일수 1
    { userId: A, type: 'voice', game: 'lol', startedAt: at('2026-10-27T11:00:00.000Z'), durationSec: 3600 },
    { userId: A, type: 'play', game: 'steam', startedAt: at('2026-10-28T11:00:00.000Z'), durationSec: 7200 },
    // b: 음성 + 채팅 다른 날 → 2일
    { userId: B, type: 'voice', game: 'tft', startedAt: at('2026-10-27T11:00:00.000Z'), durationSec: 1800 },
    { userId: B, type: 'chat', game: null, startedAt: at('2026-10-29T03:00:00.000Z'), durationSec: 0 },
    // p: play만 → 순위·활동 멤버 모두 없음
    { userId: P, type: 'play', game: 'steam', startedAt: at('2026-10-27T11:00:00.000Z'), durationSec: 36_000 },
    { userId: P, type: 'play', game: 'steam', startedAt: at('2026-10-29T11:00:00.000Z'), durationSec: 36_000 },
  ];
  const ranking = (l: readonly MockActivityLog[]) =>
    activityResponse({
      period: 'week',
      now: NOW,
      logs: l,
      presence: true,
      me,
      userRef: ref,
      cache: { synced_at: new Date(NOW).toISOString(), stale: false },
      meOutside: false,
      scrimJoins: [],
    });

  it('play만 한 날은 활동 일수에 들지 않는다', () => {
    const r = ranking(logs);
    expect(r.items.find((e) => e.user.id === A)).toMatchObject({ total_sec: 3600, active_days: 1 });
    expect(r.items.find((e) => e.user.id === B)).toMatchObject({ total_sec: 1800, active_days: 2 });
    expect(r.items.find((e) => e.user.id === A)!.main_games.map((g) => g.code)).toEqual(['lol']);
  });
  it('play만 한 멤버는 활동 순위·total·me에 없다', () => {
    const r = ranking(logs);
    expect(r.items.some((e) => e.user.id === P)).toBe(false);
    expect(r.total).toBe(2);
    expect(ranking(logs.filter((l) => l.userId === P)).items).toEqual([]);
  });
  it('play만 한 멤버는 홈 「이번 주 활동 멤버」에서 빠진다', () => {
    expect(mockCommunity({ bot: 'live', now: NOW, logs }).active_members).toEqual({ state: 'ready', count: 2 });
    // play 기록만 있어도 봇은 연결된 것으로 본다(수신·저장은 한다) → 0명
    const onlyPlay = logs.filter((l) => l.userId === P);
    expect(mockCommunity({ bot: 'live', now: NOW, logs: onlyPlay }).active_members).toEqual({ state: 'ready', count: 0 });
    expect(ranking(onlyPlay).bot_connected).toBe(true);
  });
  it('목 생성기는 play 이벤트를 계속 만든다', () => {
    expect(mockActivityLogs(['a', 'b', 'c', 'd'], NOW).some((l) => l.type === 'play')).toBe(true);
  });
});
