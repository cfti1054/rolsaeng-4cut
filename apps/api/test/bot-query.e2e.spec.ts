/**
 * S5 GET /bot/users/lookup(6-3)·GET /bot/scrims/upcoming(6-4). DB 없이 FakePrisma.
 */
import { GetBotUpcomingScrimsResponse, GetBotUserLookupResponse } from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eloRankingKey } from '../src/modules/rankings/ranking-keys';
import { call, expectError, expectNoExternalIds } from './support/s1-helpers';
import { login, refresher, seedAccount, seedRating, seedSeason } from './support/s4-helpers';
import { bot, linkedMember, seedApiKey } from './support/s5-helpers';
import { TEST_WEB_ORIGIN, type TestApp, createTestApp } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-10-31T12:00:00.000Z';

async function lookup(app: TestApp, key: string, discordId: string): Promise<GetBotUserLookupResponse> {
  const res = await bot(app, 'GET', `/bot/users/lookup?discord_id=${discordId}`, key);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  expectNoExternalIds(text);
  return GetBotUserLookupResponse.strict().parse(JSON.parse(text));
}

async function upcoming(app: TestApp, key: string, q = ''): Promise<GetBotUpcomingScrimsResponse> {
  const res = await bot(app, 'GET', `/bot/scrims/upcoming${q}`, key);
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  return GetBotUpcomingScrimsResponse.strict().parse(JSON.parse(text));
}

describe('GET /bot/users/lookup', () => {
  it('연결된 회원 없음 404, discord_id 형식 오류 400, scope 403', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t, { scopes: ['bot:users:read'] });
    await expectError(await bot(t, 'GET', '/bot/users/lookup?discord_id=999999999999999999', k.raw), 404, 'NOT_FOUND');
    await expectError(await bot(t, 'GET', '/bot/users/lookup?discord_id=dev-alice', k.raw), 400, 'VALIDATION_FAILED');
    await expectError(await bot(t, 'GET', '/bot/users/lookup', k.raw), 400, 'VALIDATION_FAILED');
    const other = seedApiKey(t, { scopes: ['bot:activity'] });
    await expectError(await bot(t, 'GET', '/bot/users/lookup?discord_id=999999999999999999', other.raw), 403, 'API_KEY_SCOPE_MISSING');
  });

  it('탈퇴 회원도 찾는다(left_at), 대표·확인된 라이엇 티어(언랭·부계정·미확인 제외), 현재 시즌 ratings + 캐시 rank', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const u = await linkedMember(t, '나감', { leftAt: new Date('2026-10-30T00:00:00.000Z') });
    const stay = await linkedMember(t, '남음');
    const lolAcc = seedAccount(t, u.id, { game: 'lol', name: '본계#KR1', tier: 'DIAMOND', division: 'II', lp: 45 });
    t.prisma.gameAccount.rows.find((a) => a.id === lolAcc.id)!.lastSyncedAt = new Date('2026-10-31T00:00:00.000Z');
    seedAccount(t, u.id, { game: 'tft', name: '본계#KR1', tier: 'UNRANKED', division: null });
    seedAccount(t, u.id, { game: 'lol', name: '부계#KR1', primary: false, tier: 'CHALLENGER', division: null });
    const season = seedSeason(t, '시즌', '2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    seedRating(t, u.id, season.id, { elo: 1100, wins: 6, losses: 1 });
    seedRating(t, stay.id, season.id, { game: 'tft', elo: 1050, wins: 5, losses: 0 });
    seedRating(t, u.id, season.id, { game: 'tft', elo: 990, wins: 0, losses: 1 });

    const r = await lookup(t, k.raw, u.discordId);
    expect(r.user).toEqual({
      id: u.id,
      nickname: '나감',
      avatar_url: null,
      discord_id: u.discordId,
      profile_url: `${TEST_WEB_ORIGIN}/members/${u.id}`,
      role: 'member',
      joined_at: expect.any(String),
      left_at: '2026-10-30T00:00:00.000Z',
    });
    expect(r.tiers).toEqual([
      { game: 'lol', account_name: '본계#KR1', tier: 'DIAMOND', division: 'II', lp: 45, synced_at: '2026-10-31T00:00:00.000Z' },
    ]);
    expect(r.season?.id).toBe(season.id);
    // 캐시 없음 → rank null(조회가 계산을 일으키지 않는다)
    expect(r.ratings.map((x) => [x.game, x.elo, x.wins, x.losses, x.rank])).toEqual([
      ['lol', 1100, 6, 1, null],
      ['tft', 990, 0, 1, null],
    ]);
    expect(t.rankingCache.writes).toEqual([]);
    // 캐시가 생긴 뒤: 남은 회원의 rank. 탈퇴 회원은 순위 대상이 아니라 null
    await refresher(t).runOnce();
    expect(t.rankingCache.rows.has(eloRankingKey('lol', season.id))).toBe(true);
    expect((await lookup(t, k.raw, u.discordId)).ratings.map((x) => x.rank)).toEqual([null, null]);
    expect((await lookup(t, k.raw, stay.discordId)).ratings).toEqual([{ game: 'tft', elo: 1050, wins: 5, losses: 0, rank: 1 }]);
  });

  it('시즌 없음 → season null, ratings []', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const u = await linkedMember(t, 'a');
    const r = await lookup(t, k.raw, u.discordId);
    expect(r).toMatchObject({ season: null, ratings: [], tiers: [] });
    expect(r.user.left_at).toBeNull();
  });
});

describe('GET /bot/scrims/upcoming', () => {
  function scrim(app: TestApp, hostId: string, o: { at: number; status?: string; title?: string }) {
    return app.prisma.scrim.insert({
      gameId: app.prisma.gameId('lol'),
      hostId,
      title: o.title ?? '내전',
      scheduledAt: new Date(new Date(NOW).getTime() + o.at * 60_000),
      capacity: 10,
      status: o.status ?? 'recruiting',
    });
  }
  const join = (app: TestApp, scrimId: string, userId: string, status = 'joined') =>
    app.prisma.scrimPlayer.insert({ scrimId, userId, status });

  it('범위 [now, now + within_min), recruiting·full만, scheduled_at → id 순, 기본 60분, within_min 검증', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t, { scopes: ['bot:scrims:read'] });
    const h = await linkedMember(t, '방장');
    const s0 = scrim(t, h.id, { at: 0, title: '정각' });
    scrim(t, h.id, { at: -1, title: '이미 시작' });
    const s30 = scrim(t, h.id, { at: 29.99, status: 'full', title: '29분' });
    scrim(t, h.id, { at: 30, title: '30분' });
    scrim(t, h.id, { at: 10, status: 'playing', title: '진행 중' });
    scrim(t, h.id, { at: 10, status: 'cancelled', title: '취소' });
    const r = await upcoming(t, k.raw, '?within_min=30');
    expect(r.items.map((i) => i.id)).toEqual([s0.id, s30.id]);
    expect(r.next_cursor).toBeNull();
    expect(r.generated_at).toBe(new Date(NOW).toISOString());
    expect((await upcoming(t, k.raw)).items).toHaveLength(3); // 기본 60분: 정각·29분·30분
    for (const q of ['?within_min=0', '?within_min=1441', '?within_min=abc']) {
      await expectError(await bot(t, 'GET', `/bot/scrims/upcoming${q}`, k.raw), 400, 'VALIDATION_FAILED');
    }
  });

  it('notify_discord_ids: joined·연동·알림 켬·탈퇴 아님만, 중복 없음·오름차순. 인원 수·url·host', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const h = await linkedMember(t, '방장', { discordId: '300000000000000000' });
    const s = scrim(t, h.id, { at: 20 });
    const a = await linkedMember(t, 'a', { discordId: '200000000000000000' });
    const off = await linkedMember(t, '알림끔', { notifyScrimStart: false });
    const gone = await linkedMember(t, '나감', { leftAt: new Date('2026-10-30T00:00:00.000Z') });
    const w = await linkedMember(t, '대기');
    const dev = await login(t, 'dev');
    const cancelled = await linkedMember(t, '취소함');
    for (const u of [h.id, a.id, off.id, gone.id, dev.userId]) join(t, s.id, u);
    join(t, s.id, w.id, 'waitlist');
    join(t, s.id, cancelled.id, 'cancelled');
    const [item] = (await upcoming(t, k.raw, '?within_min=30')).items;
    expect(item).toMatchObject({
      id: s.id,
      url: `${TEST_WEB_ORIGIN}/scrims/${s.id}`,
      status: 'recruiting',
      capacity: 10,
      joined_count: 5,
      waitlist_count: 1,
      host: { id: h.id, discord_id: h.discordId, profile_url: `${TEST_WEB_ORIGIN}/members/${h.id}` },
      game: { code: 'lol' },
    });
    expect(item?.notify_discord_ids).toEqual(['200000000000000000', '300000000000000000']);
  });

  it('JWT로는 접근 불가', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    await expectError(await call(t, 'GET', '/bot/scrims/upcoming', me.token), 401, 'API_KEY_INVALID');
  });
});
