/**
 * S5 봇 API·활동/플레이타임 집계 DB e2e — 실제 PostgreSQL 필요. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 * 계약 S5 14절 backend 6번: 같은 키 동시 INSERT, 접속 현황 조건부 upsert 순서 역전, 집계 SQL bigint 변환, AT TIME ZONE 날짜 수.
 * r2(D237): 연동 코드 동시성 테스트는 기능 제거로 삭제. D239 내전 수 SQL, D234 `/steam-apps` 보유자 SQL을 추가했다.
 * FakePrisma로는 행 잠금·ON CONFLICT·타입 변환·ARRAY_AGG FILTER 문법을 확인할 수 없다.
 * 실행 방법은 season-close.db.e2e.spec.ts와 같다(마이그레이션 적용한 별도 스키마). 운영 스키마를 가리키지 말 것.
 */
import { randomUUID } from 'node:crypto';
import { type ActivityRankingCachePayload, GAME_SEED, type PlaytimeRankingCachePayload } from '@gcd/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../../src/common/clock';
import { BotActivityService } from '../../src/modules/bot/bot-activity.service';
import { BotPresenceService } from '../../src/modules/bot/bot-presence.service';
import type { SteamApi } from '../../src/integrations/contracts';
import { SteamAppsService } from '../../src/modules/games/steam-apps.service';
import { PrismaRankingCacheStore } from '../../src/modules/rankings/ranking-cache.store';
import { RankingCalculator, activityTarget, playtimeTarget } from '../../src/modules/rankings/ranking-calculator.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { testConfig } from '../support/test-app';

const DB_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('[DB] S5 봇 API e2e (PostgreSQL)', () => {
  let prisma: PrismaService;
  const clock: Clock & { t: Date } = { t: new Date('2026-10-31T12:00:00.000Z'), now: () => new Date(clock.t.getTime()) };
  let activity: BotActivityService;
  let presence: BotPresenceService;
  let steamApps: SteamAppsService;
  let lolId: string;
  let steamId: string;
  let calculator: RankingCalculator;
  let apiKeyId: string;

  beforeAll(async () => {
    prisma = new PrismaService({ datasources: { db: { url: DB_URL as string } } });
    const config = testConfig({ DATABASE_URL: DB_URL });
    activity = new BotActivityService(prisma, clock);
    presence = new BotPresenceService(prisma, clock);
    calculator = new RankingCalculator(prisma, new PrismaRankingCacheStore(prisma), config);
    // 상점 호출 없는 경로(q 없음)만 쓴다
    steamApps = new SteamAppsService(prisma, {} as SteamApi, clock);
    const ids: Record<string, string> = {};
    for (const code of ['lol', 'steam'] as const) {
      const g = GAME_SEED.find((x) => x.code === code);
      ids[code] = (
        await prisma.game.upsert({
          where: { code },
          update: {},
          create: {
            code,
            name: g?.name ?? code,
            hasPositions: g?.has_positions ?? false,
            hasTeams: g?.has_teams ?? false,
            hasResults: g?.has_results ?? true,
            positions: [...(g?.positions ?? [])],
            sortOrder: g?.sort_order ?? 0,
          },
        })
      ).id;
    }
    lolId = ids.lol as string;
    steamId = ids.steam as string;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    clock.t = new Date('2026-10-31T12:00:00.000Z');
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE activity_logs, bot_presence, ranking_caches, refresh_tokens, api_keys, scrim_results, scrim_players, scrims, steam_playtime, game_accounts, users CASCADE',
    );
    apiKeyId = (await prisma.apiKey.create({ data: { name: 'db-test', keyHash: randomUUID(), keyPrefix: 'dbtest00', scopes: [] } })).id;
  });

  const event = (key: string, discordId: string) => ({
    idempotency_key: key,
    discord_id: discordId,
    type: 'voice' as const,
    game: 'lol' as const,
    started_at: '2026-10-31T20:00:00+09:00',
    duration_sec: 600,
  });

  it('같은 idempotency_key 동시 2요청 → 행 1개, 결과는 created 1 + duplicate 1', async () => {
    await prisma.user.create({ data: { nickname: 'a', discordId: '123456789012345678' } });
    const [r1, r2] = await Promise.all([
      activity.record({ events: [event('same', '123456789012345678')] }, apiKeyId),
      activity.record({ events: [event('same', '123456789012345678')] }, apiKeyId),
    ]);
    expect([r1.results[0]?.status, r2.results[0]?.status].sort()).toEqual(['created', 'duplicate']);
    expect(await prisma.activityLog.count({ where: { idempotencyKey: 'same' } })).toBe(1);
    expect((await prisma.activityLog.findFirst())?.apiKeyId).toBe(apiKeyId);
  });

  it('접속 현황 조건부 upsert: 새 값 → 옛 값 순서로 와도 새 값이 남는다(OLDER_THAN_STORED)', async () => {
    const newer = await presence.put({ captured_at: '2026-10-31T20:59:30+09:00', voice_member_count: 9, playing: [] }, apiKeyId);
    const older = await presence.put({ captured_at: '2026-10-31T20:59:00+09:00', voice_member_count: 1, playing: [] }, apiKeyId);
    expect(newer).toEqual({ accepted: true, reason: null });
    expect(older).toEqual({ accepted: false, reason: 'OLDER_THAN_STORED' });
    const rows = await prisma.botPresence.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'default', voiceMemberCount: 9, apiKeyId });
  });

  it('활동 집계: SUM(bigint) → number(int 범위 초과 포함), AT TIME ZONE Asia/Seoul 날짜 수', async () => {
    clock.t = new Date('2026-10-02T03:00:00.000Z');
    const u = await prisma.user.create({ data: { nickname: 'big', discordId: '523456789012345678' } });
    // 10-01 23:59 KST와 10-02 00:00 KST(UTC로는 같은 10-01) → 2일
    await prisma.activityLog.createMany({
      data: [
        { userId: u.id, type: 'voice', startedAt: new Date('2026-10-01T14:59:00.000Z'), durationSec: 60, idempotencyKey: 'd1' },
        { userId: u.id, type: 'chat', startedAt: new Date('2026-10-01T15:00:00.000Z'), durationSec: 0, idempotencyKey: 'd2' },
      ],
    });
    // 겹친 음성 세션 25,000건 × 86,400초 = 2,160,000,000 > 2^31 − 1 (r1: 시간은 voice만, D232)
    await prisma.$executeRawUnsafe(`
      INSERT INTO activity_logs (id, user_id, type, started_at, duration_sec, idempotency_key, created_at)
      SELECT gen_random_uuid(), '${u.id}'::uuid, 'voice'::activity_type, '2026-10-01T16:00:00Z'::timestamptz, 86400, 'bulk-' || g, now()
      FROM generate_series(1, 25000) AS g`);
    // play는 시간에도 활동 일수에도 들어가지 않는다(D240). p2는 다른 KST 날짜(10-05)지만 일수는 2 그대로
    await prisma.activityLog.createMany({
      data: [
        { userId: u.id, type: 'play', startedAt: new Date('2026-10-01T16:00:00.000Z'), durationSec: 86_400, idempotencyKey: 'p1' },
        { userId: u.id, type: 'play', startedAt: new Date('2026-10-05T03:00:00.000Z'), durationSec: 86_400, idempotencyKey: 'p2' },
      ],
    });
    // play만 한 회원은 집계 행 자체가 없다(D240, ACTIVITY_COUNTED_TYPES 바인딩이 enum 캐스트와 함께 실행되는지 확인)
    const playOnly = await prisma.user.create({ data: { nickname: 'playonly', discordId: '923456789012345601' } });
    await prisma.activityLog.create({
      data: { userId: playOnly.id, type: 'play', startedAt: new Date('2026-10-01T16:00:00.000Z'), durationSec: 86_400, idempotencyKey: 'p3' },
    });
    const row = await calculator.computeAndStore(activityTarget('month'), clock.now());
    const payload = row.payload as ActivityRankingCachePayload;
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({ voice_sec: 2_160_000_060, total_sec: 2_160_000_060, active_days: 2, scrim_count: 0 });
    expect(payload.entries[0]).not.toHaveProperty('play_sec');
    expect(typeof payload.entries[0]?.total_sec).toBe('number');
  });

  it('내전 수 SQL(D239): enum 비교·EXISTS·COALESCE 기간·uuid IN 목록이 실제로 실행되고 규칙대로 센다', async () => {
    const a = await prisma.user.create({ data: { nickname: 'sa', discordId: '623456789012345678' } });
    const b = await prisma.user.create({ data: { nickname: 'sb', discordId: '723456789012345678' } });
    const at = new Date('2026-10-28T11:00:00.000Z');
    for (const u of [a, b]) {
      await prisma.activityLog.create({ data: { userId: u.id, type: 'voice', startedAt: at, durationSec: 100, idempotencyKey: `v-${u.id}` } });
    }
    const scrim = async (o: { status?: 'finished' | 'cancelled'; startedAt: Date | null; scheduledAt?: Date; players: [string, 'joined' | 'waitlist'][]; result?: 'approved' | 'pending' }) => {
      const s = await prisma.scrim.create({
        data: { gameId: lolId, hostId: a.id, title: 't', scheduledAt: o.scheduledAt ?? at, capacity: 10, status: o.status ?? 'finished', startedAt: o.startedAt },
      });
      for (const [userId, status] of o.players) await prisma.scrimPlayer.create({ data: { scrimId: s.id, userId, status } });
      await prisma.scrimResult.create({ data: { scrimId: s.id, status: o.result ?? 'approved', submittedById: a.id, winnerTeam: 'blue' } });
    };
    await scrim({ startedAt: at, players: [[a.id, 'joined'], [b.id, 'waitlist']] });
    await scrim({ startedAt: null, players: [[a.id, 'joined'], [b.id, 'joined']] }); // scheduled_at 귀속
    await scrim({ startedAt: at, players: [[a.id, 'joined']], result: 'pending' });
    await scrim({ startedAt: at, players: [[a.id, 'joined']], status: 'cancelled' });
    await scrim({ startedAt: new Date('2026-10-25T14:59:00.000Z'), scheduledAt: at, players: [[a.id, 'joined']] }); // 지난주 일요일 23:59 KST
    const row = await calculator.computeAndStore(activityTarget('week'), clock.now());
    const entries = (row.payload as ActivityRankingCachePayload).entries;
    expect(Object.fromEntries(entries.map((e) => [e.user.nickname, e.scrim_count]))).toEqual({ sa: 2, sb: 1 });
  });

  it('플레이타임 보유자 SQL(D234·D235): /steam-apps 보유 게임 이름·수, 보유자 0 app도 빈 결과 저장', async () => {
    const mk = async (nickname: string, discordId: string, o: { primary?: boolean; verified?: boolean } = {}) => {
      const u = await prisma.user.create({ data: { nickname, discordId } });
      const ga = await prisma.gameAccount.create({
        data: { userId: u.id, gameId: steamId, externalId: `7656119${discordId.slice(0, 10)}`, displayName: nickname, isPrimary: o.primary ?? true, verified: o.verified ?? true },
      });
      return ga.id;
    };
    const g1 = await mk('p1', '823456789012345678');
    const g2 = await mk('p2', '923456789012345678');
    const g3 = await mk('p3', '133456789012345678', { verified: false });
    await prisma.steamPlaytime.createMany({
      data: [
        { gameAccountId: g1, appId: 578080, appName: 'Old Name', minutesTotal: 10, syncedAt: new Date('2026-10-20T00:00:00.000Z') },
        { gameAccountId: g2, appId: 578080, appName: 'PUBG_100%', minutesTotal: 20, syncedAt: new Date('2026-10-30T00:00:00.000Z') },
        { gameAccountId: g1, appId: 730, appName: null, minutesTotal: 5, syncedAt: new Date('2026-10-30T00:00:00.000Z') },
        { gameAccountId: g3, appId: 440, appName: 'TF2', minutesTotal: 50, syncedAt: new Date('2026-10-30T00:00:00.000Z') },
      ],
    });
    const owned = await steamApps.search('');
    expect(owned.items).toEqual([{ app_id: 578080, name: 'PUBG_100%', owner_count: 2 }]); // 730 이름 없음, 440 미확인
    const none = await calculator.computeAndStore(playtimeTarget(440), clock.now());
    expect(none.payload as PlaytimeRankingCachePayload).toEqual({ app: { app_id: 440, name: null }, playtime_synced_at: null, entries: [] });
    expect(await prisma.rankingCache.count()).toBe(1);
  });
});
