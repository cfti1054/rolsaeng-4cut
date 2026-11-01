/**
 * S5 POST /bot/member-events(계약 6-6), 로그인 left_at 복구, 퇴장 회원의 순위 제외(rankableUserWhere·rankableUserSql).
 * DB 없이 FakePrisma. 실제 advisory lock 경합은 test/db/bot.db.e2e.spec.ts.
 */
import {
  AUTH_COOKIE,
  GetActivityRankingResponse,
  GetDashboardSummaryResponse,
  GetEloRankingResponse,
  GetPlaytimeRankingResponse,
  GetTierRankingResponse,
  PostBotMemberEventsResponse,
} from '@gcd/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, expectError } from './support/s1-helpers';
import { closer, login, seedAccount, seedRating, seedSeason } from './support/s4-helpers';
import { bot, linkedMember, seedActivity, seedApiKey, seedSteam } from './support/s5-helpers';
import { DEFAULT_DISCORD_USER, type TestApp, createTestApp, findSetCookie } from './support/test-app';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
  vi.restoreAllMocks();
});

const NOW = '2026-10-31T12:00:00.000Z'; // 토요일 21:00 KST
const at = (minAgo: number, base = NOW) => new Date(new Date(base).getTime() - minAgo * 60_000).toISOString();

async function send(app: TestApp, key: string, events: unknown[]): Promise<PostBotMemberEventsResponse> {
  const res = await bot(app, 'POST', '/bot/member-events', key, { events });
  const text = await res.text();
  expect({ status: res.status, text }).toMatchObject({ status: 200 });
  return PostBotMemberEventsResponse.strict().parse(JSON.parse(text));
}

function seedToken(app: TestApp, userId: string, revokedAt: Date | null = null) {
  app.prisma.refreshTokens.push({
    id: crypto.randomUUID(),
    userId,
    tokenHash: crypto.randomUUID(),
    familyId: crypto.randomUUID(),
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    revokedAt,
    replacedById: null,
    userAgent: null,
    createdAt: new Date(NOW),
  });
}

const userRow = (app: TestApp, id: string) => app.prisma.users.find((u) => u.id === id);

describe('POST /bot/member-events', () => {
  it('퇴장 → left_at = occurred_at, 미폐기 리프레시 토큰 전부 revoked(이미 폐기된 것은 그대로), 재전송 stale', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t, { scopes: ['bot:members'] });
    const u = await linkedMember(t, 'a');
    const keep = new Date('2026-10-01T00:00:00.000Z');
    seedToken(t, u.id);
    seedToken(t, u.id);
    seedToken(t, u.id, keep);
    const ev = { discord_id: u.discordId, type: 'leave', occurred_at: at(5) };
    const r = await send(t, k.raw, [ev]);
    expect(r.results).toEqual([{ discord_id: u.discordId, type: 'leave', status: 'applied' }]);
    expect(userRow(t, u.id)).toMatchObject({ leftAt: new Date(at(5)), guildMembershipAt: new Date(at(5)) });
    const tokens = t.prisma.refreshTokens.filter((x) => x.userId === u.id);
    expect(tokens.map((x) => x.revokedAt)).toEqual([new Date(NOW), new Date(NOW), keep]);
    // 재전송
    expect((await send(t, k.raw, [ev])).results[0]?.status).toBe('stale');
  });

  it('퇴장 → 재입장(같은 요청): 둘 다 applied, 최종 left_at null, 토큰 폐기 안 함', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const u = await linkedMember(t, 'a');
    seedToken(t, u.id);
    const r = await send(t, k.raw, [
      { discord_id: u.discordId, type: 'join', occurred_at: at(1) },
      { discord_id: u.discordId, type: 'leave', occurred_at: at(10) },
    ]);
    expect(r.results.map((x) => x.status)).toEqual(['applied', 'applied']);
    expect(userRow(t, u.id)).toMatchObject({ leftAt: null, guildMembershipAt: new Date(at(1)) });
    expect(t.prisma.refreshTokens[0]?.revokedAt).toBeNull();
  });

  it('재입장이 먼저 도착하고 그보다 이른 퇴장이 나중에 도착 → 퇴장 stale', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const u = await linkedMember(t, 'a');
    await send(t, k.raw, [{ discord_id: u.discordId, type: 'join', occurred_at: at(1) }]);
    const r = await send(t, k.raw, [{ discord_id: u.discordId, type: 'leave', occurred_at: at(10) }]);
    expect(r.results[0]?.status).toBe('stale');
    expect(userRow(t, u.id)?.leftAt).toBeNull();
  });

  it('미연동 → unlinked, 미래(occurred_at > now + 300초) → rejected, 300초 정확히는 applied, 결과는 요청 순서', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const a = await linkedMember(t, 'a');
    const b = await linkedMember(t, 'b');
    const future = new Date(new Date(NOW).getTime() + 300_000);
    const r = await send(t, k.raw, [
      { discord_id: '999999999999999999', type: 'leave', occurred_at: at(1) },
      { discord_id: a.discordId, type: 'leave', occurred_at: new Date(future.getTime() + 1).toISOString() },
      { discord_id: b.discordId, type: 'leave', occurred_at: future.toISOString() },
    ]);
    expect(r.results.map((x) => [x.discord_id, x.status])).toEqual([
      ['999999999999999999', 'unlinked'],
      [a.discordId, 'rejected'],
      [b.discordId, 'applied'],
    ]);
    expect(userRow(t, a.id)?.leftAt).toBeNull();
  });

  it('잠금 전 다른 요청이 더 새 값을 씀(조건부 update 0행) → 그 사용자 이벤트 stale, 토큰 폐기 안 함', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const u = await linkedMember(t, 'a');
    seedToken(t, u.id);
    const orig = t.prisma.user.updateMany;
    vi.spyOn(t.prisma.user, 'updateMany').mockImplementationOnce(async (args) => {
      const row = t ? userRow(t, u.id) : undefined;
      if (row) row.guildMembershipAt = new Date(at(0));
      return orig(args);
    });
    const r = await send(t, k.raw, [{ discord_id: u.discordId, type: 'leave', occurred_at: at(3) }]);
    expect(r.results[0]?.status).toBe('stale');
    expect(userRow(t, u.id)?.leftAt).toBeNull();
    expect(t.prisma.refreshTokens[0]?.revokedAt).toBeNull();
    // 사용자 잠금 키(membership:{id})
    expect(t.prisma.rawCalls.some((c) => c.values.includes(`membership:${u.id}`))).toBe(true);
  });

  it('형식 오류 400: 모르는 필드, 모르는 type, 오프셋 없는 시각, 101건', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const k = seedApiKey(t);
    const ev = { discord_id: '123456789012345678', type: 'leave', occurred_at: at(1) };
    for (const events of [
      [{ ...ev, x: 1 }],
      [{ ...ev, type: 'kick' }],
      [{ ...ev, occurred_at: '2026-10-31T20:00:00' }],
      Array.from({ length: 101 }, () => ev),
    ]) {
      await expectError(await bot(t, 'POST', '/bot/member-events', k.raw, { events }), 400, 'VALIDATION_FAILED');
    }
  });
});

describe('로그인 길드 검사 통과 → left_at 복구(6-6 마지막 문단)', () => {
  async function discordLogin(app: TestApp) {
    const start = await fetch(`${app.base}/auth/discord?redirect=%2Fscrims`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
    const cookie = (findSetCookie(start, AUTH_COOKIE.oauthState) ?? '').split(';')[0] ?? '';
    const cb = await fetch(`${app.base}/auth/discord/callback?code=c&state=${encodeURIComponent(state)}`, {
      redirect: 'manual',
      headers: { Cookie: cookie },
    });
    expect(cb.status).toBe(302);
  }

  it('퇴장 회원이 로그인 → left_at null, guild_membership_at = 로그인 시각. 그 뒤 도착한 더 이른 퇴장은 stale', async () => {
    t = await createTestApp();
    const k = seedApiKey(t);
    const before = Date.now();
    const u = await linkedMember(t, '돌아옴', { discordId: DEFAULT_DISCORD_USER.id, leftAt: new Date(before - 3_600_000) });
    const row = userRow(t, u.id);
    if (row) row.guildMembershipAt = new Date(before - 3_600_000);
    await discordLogin(t);
    expect(userRow(t, u.id)?.leftAt).toBeNull();
    expect(userRow(t, u.id)?.guildMembershipAt?.getTime()).toBeGreaterThanOrEqual(before);
    const r = await send(t, k.raw, [{ discord_id: u.discordId, type: 'leave', occurred_at: new Date(before - 60_000).toISOString() }]);
    expect(r.results[0]?.status).toBe('stale');
    expect(userRow(t, u.id)?.leftAt).toBeNull();
  });

  it('guild_membership_at이 now보다 뒤(시계 차이)면 그대로 둔다 / DISCORD_GUILD_ID가 비면 두 컬럼을 건드리지 않는다', async () => {
    t = await createTestApp();
    const future = new Date(Date.now() + 3_600_000);
    const u = await linkedMember(t, 'a', { discordId: DEFAULT_DISCORD_USER.id, leftAt: new Date(Date.now() - 60_000) });
    const row = userRow(t, u.id);
    if (row) row.guildMembershipAt = future;
    await discordLogin(t);
    expect(userRow(t, u.id)).toMatchObject({ guildMembershipAt: future });
    expect(userRow(t, u.id)?.leftAt).not.toBeNull();
    await t.close();

    t = await createTestApp({ env: { DISCORD_GUILD_ID: '' } });
    const left = new Date(Date.now() - 60_000);
    const v = await linkedMember(t, 'b', { discordId: DEFAULT_DISCORD_USER.id, leftAt: left });
    await discordLogin(t);
    expect(userRow(t, v.id)).toMatchObject({ leftAt: left, guildMembershipAt: null });
  });

  it('새 회원 로그인(길드 검사 통과) → left_at null, guild_membership_at 기록', async () => {
    t = await createTestApp();
    await discordLogin(t);
    const u = t.prisma.users.find((x) => x.discordId === DEFAULT_DISCORD_USER.id);
    expect(u?.leftAt).toBeNull();
    expect(u?.guildMembershipAt).toBeInstanceOf(Date);
  });
});

describe('퇴장 회원은 순위 대상에서 빠진다(rankableUserWhere = { leftAt: null }, D220)', () => {
  it('티어·ELO·활동·플레이타임 랭킹, 홈 이번 주 활동 멤버, 시즌 종료 standings에서 제외. 로그인·프로필은 그대로', async () => {
    t = await createTestApp({ fixedClock: NOW });
    const me = await login(t, 'me');
    const stay = await linkedMember(t, '남음');
    const gone = await linkedMember(t, '나감', { leftAt: new Date('2026-10-30T00:00:00.000Z') });
    const season = seedSeason(t, '시즌', '2026-10-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z');
    for (const u of [stay, gone]) {
      seedAccount(t, u.id, { tier: 'GOLD', division: 'I' });
      seedRating(t, u.id, season.id, { wins: 5, losses: 0, elo: 1100 });
      seedActivity(t, u.id, { startedAt: '2026-10-30T12:00:00.000Z', game: 'lol' });
      seedSteam(t, u.id, [{ appId: 578080, total: 600 }]);
    }
    // play만 한 남은 회원: 활동 랭킹·이번 주 활동 멤버 어디에도 들지 않는다(D240)
    const playOnly = await linkedMember(t, '플레이만');
    seedActivity(t, playOnly.id, { type: 'play', startedAt: '2026-10-30T12:00:00.000Z', game: 'lol', durationSec: 3600 });
    const names = (items: { user: { nickname: string } }[]) => items.map((i) => i.user.nickname);
    const get = async (p: string) => {
      const res = await call(t as TestApp, 'GET', p, me.token);
      expect(res.status).toBe(200);
      return res.json();
    };
    expect(names(GetTierRankingResponse.parse(await get('/rankings/tier?game=lol')).items)).toEqual(['남음']);
    expect(names(GetEloRankingResponse.parse(await get('/rankings/elo?game=lol')).items)).toEqual(['남음']);
    expect(names(GetActivityRankingResponse.parse(await get('/rankings/activity?period=week')).items)).toEqual(['남음']);
    expect(names(GetActivityRankingResponse.parse(await get('/rankings/activity?period=month')).items)).toEqual(['남음']);
    expect(names(GetPlaytimeRankingResponse.parse(await get('/rankings/playtime?app_id=578080')).items)).toEqual(['남음']);
    const summary = GetDashboardSummaryResponse.parse(await get('/dashboard/summary'));
    expect(summary.community.active_members).toEqual({ state: 'ready', count: 1 });
    // 프로필은 그대로 보인다
    expect((await call(t, 'GET', `/users/${gone.id}/profile`, me.token)).status).toBe(200);

    // 시즌 종료
    t.clock.set('2027-01-01T01:00:00.000Z');
    await closer(t).runOnce();
    const standings = t.prisma.seasonStanding.rows.filter((r) => r.seasonId === season.id);
    expect(standings.map((r) => r.userId)).toEqual([stay.id]);
  });
});
