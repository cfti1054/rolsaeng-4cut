/**
 * 실제 PostgreSQL이 필요한 PrismaSyncStore 테스트. TEST_DATABASE_URL이 없으면 건너뛴다(skip).
 * 작성만 했고 이 PC에는 DB가 없어 실행하지 못했다. 실행 방법은 auth.db.e2e.spec.ts 머리말과 같다.
 * 주의: 각 테스트 전에 users(→ game_accounts CASCADE)를 비운다. 운영 스키마를 가리키지 말 것.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_KEY_TIER } from '../../src/jobs/sync-scheduler';
import { PrismaSyncStore } from '../../src/jobs/sync-store';
import { PrismaService } from '../../src/prisma/prisma.service';

const DB_URL = process.env.TEST_DATABASE_URL;
const MIN = 60_000;

describe.skipIf(!DB_URL)('[DB] PrismaSyncStore (PostgreSQL)', () => {
  let prisma: PrismaService;
  let store: PrismaSyncStore;
  const gameId: Record<string, string> = {};
  let n = 0;

  beforeAll(async () => {
    prisma = new PrismaService({ datasourceUrl: DB_URL });
    store = new PrismaSyncStore(prisma);
    for (const code of ['lol', 'tft', 'steam']) {
      const g = await prisma.game.upsert({ where: { code }, update: {}, create: { code, name: code } });
      gameId[code] = g.id;
    }
  });
  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  async function user(lastLoginAt: Date | null = new Date()) {
    n++;
    return prisma.user.create({ data: { nickname: `u${n}`, discordId: `dev-u${n}`, lastLoginAt } });
  }
  async function riot(
    userId: string,
    puuid: string,
    o: { primary?: boolean; lastSyncedAt?: Date | null; state?: 'idle' | 'queued' | 'running'; stateAt?: Date } = {},
  ) {
    const mk = (code: 'lol' | 'tft') =>
      prisma.gameAccount.create({
        data: {
          userId,
          gameId: gameId[code]!,
          externalId: puuid,
          displayName: 'T#KR1',
          verified: true,
          isPrimary: o.primary ?? true,
          lastSyncedAt: o.lastSyncedAt ?? null,
          syncState: o.state ?? 'idle',
          syncStateAt: o.stateAt ?? new Date(),
        },
      });
    return { lol: await mk('lol'), tft: await mk('tft') };
  }

  it('티어 대상: 55분 이내 동기화·비 idle 은 제외, 활동 멤버의 대표가 먼저', async () => {
    const now = Date.now();
    const active = await user(new Date());
    const inactive = await user(new Date(now - 30 * 24 * 60 * MIN));
    const a1 = await riot(active.id, 'FAKE-A1', { primary: false, lastSyncedAt: new Date(now - 120 * MIN) });
    const a2 = await riot(active.id, 'FAKE-A2', { primary: true, lastSyncedAt: new Date(now - 90 * MIN) });
    const b = await riot(inactive.id, 'FAKE-B', { primary: true, lastSyncedAt: null });
    await riot(active.id, 'FAKE-RECENT', { primary: false, lastSyncedAt: new Date(now - 10 * MIN) });
    await riot(active.id, 'FAKE-BUSY', { primary: false, state: 'running' });
    const targets = await store.selectTierTargets();
    expect(targets.map((t) => t.id)).toEqual([a2.lol.id, a1.lol.id, b.lol.id]);
    expect(targets.map((t) => t.activeMember)).toEqual([true, true, false]);
  });

  it('스팀 대상: last_synced_at 오래된 순(NULL 먼저)', async () => {
    const u1 = await user();
    const u2 = await user();
    const mk = (userId: string, id: string, at: Date | null) =>
      prisma.gameAccount.create({
        data: { userId, gameId: gameId.steam!, externalId: id, displayName: 's', verified: true, isPrimary: true, lastSyncedAt: at },
      });
    const old = await mk(u1.id, '76561190000000011', new Date(Date.now() - 5 * MIN));
    const never = await mk(u2.id, '76561190000000012', null);
    expect((await store.selectSteamTargets()).map((t) => t.id)).toEqual([never.id, old.id]);
  });

  it('작업자 잠금: idle·queued 는 잡고, 10분 안 running 은 못 잡고, 10분 넘은 running 은 다시 잡는다', async () => {
    const u = await user();
    const fresh = await riot(u.id, 'FAKE-F', { state: 'running', stateAt: new Date(Date.now() - 2 * MIN) });
    const stale = await riot(u.id, 'FAKE-S', { state: 'running', stateAt: new Date(Date.now() - 11 * MIN) });
    const queued = await riot(u.id, 'FAKE-Q', { state: 'queued' });
    const now = new Date();
    expect(await store.claim([fresh.lol.id, fresh.tft.id], now)).toBe(false);
    expect(await store.claim([stale.lol.id, stale.tft.id], now)).toBe(true);
    expect(await store.claim([queued.lol.id, queued.tft.id], now)).toBe(true);
    const row = await prisma.gameAccount.findUniqueOrThrow({ where: { id: stale.lol.id } });
    expect(row.syncState).toBe('running');
    expect(row.syncStateAt!.getTime()).toBe(now.getTime());
  });

  it('멈춘 행 정리: 10분 넘은 queued|running 만 queued 로, 쌍(tft)까지 sync_state_at=now', async () => {
    const u = await user();
    const now = new Date();
    const stuckRunning = await riot(u.id, 'FAKE-1', { state: 'running', stateAt: new Date(now.getTime() - 11 * MIN) });
    const stuckQueued = await riot(u.id, 'FAKE-2', { state: 'queued', stateAt: new Date(now.getTime() - 12 * MIN) });
    const fresh = await riot(u.id, 'FAKE-3', { state: 'running', stateAt: new Date(now.getTime() - 1 * MIN) });
    const idle = await riot(u.id, 'FAKE-4', { state: 'idle', stateAt: new Date(now.getTime() - 60 * MIN) });
    const stuck = await store.selectStuck(now);
    expect(stuck.map((s) => s.id).sort()).toEqual([stuckRunning.lol.id, stuckQueued.lol.id].sort());
    await store.requeueStuck(stuck.map((s) => s.id), now);
    const get = (id: string) => prisma.gameAccount.findUniqueOrThrow({ where: { id } });
    for (const r of [stuckRunning.lol, stuckRunning.tft, stuckQueued.lol, stuckQueued.tft]) {
      const row = await get(r.id);
      expect([row.syncState, row.syncStateAt!.getTime()]).toEqual(['queued', now.getTime()]);
    }
    expect((await get(fresh.lol.id)).syncState).toBe('running');
    expect((await get(idle.lol.id)).syncState).toBe('idle');
  });

  it('release: idle + 오류 기록, 성공 시 오류 null / 지워진 계정은 오류 없이 0행', async () => {
    const u = await user();
    const a = await riot(u.id, 'FAKE-R', { state: 'running' });
    const at = new Date();
    await store.release([{ id: a.lol.id, lastSyncedAt: at }, { id: a.tft.id }], 'PROVIDER_UNAVAILABLE', at);
    let row = await prisma.gameAccount.findUniqueOrThrow({ where: { id: a.lol.id } });
    expect([row.syncState, row.lastSyncError, row.lastSyncedAt?.getTime()]).toEqual(['idle', 'PROVIDER_UNAVAILABLE', at.getTime()]);
    await store.release([{ id: a.lol.id, lastSyncedAt: at }], null, at);
    row = await prisma.gameAccount.findUniqueOrThrow({ where: { id: a.lol.id } });
    expect([row.lastSyncError, row.lastSyncErrorAt]).toEqual([null, null]);
    await expect(store.release([{ id: '00000000-0000-4000-8000-000000000000' }], null, at)).resolves.toBeUndefined();
  });

  it('requeue(429): running → idle → queued', async () => {
    const u = await user();
    const a = await riot(u.id, 'FAKE-RQ', { state: 'running' });
    await store.requeue([a.lol.id, a.tft.id], new Date());
    expect((await prisma.gameAccount.findUniqueOrThrow({ where: { id: a.tft.id } })).syncState).toBe('queued');
  });

  it('티어 스냅샷 최신값·전적 upsert/trim·스팀 교체', async () => {
    const u = await user();
    const a = await riot(u.id, 'FAKE-D');
    const t0 = new Date('2026-10-28T00:00:00Z');
    await store.insertSnapshot(a.lol.id, 'RANKED_SOLO_5x5', { tier: 'GOLD', division: 'II', lp: 10, wins: 1, losses: 1 }, t0);
    await store.insertSnapshot(a.lol.id, 'RANKED_SOLO_5x5', { tier: 'GOLD', division: 'I', lp: 0, wins: 2, losses: 1 }, new Date(t0.getTime() + MIN));
    expect((await store.latestSnapshot(a.lol.id, 'RANKED_SOLO_5x5'))?.division).toBe('I');
    expect(await store.latestSnapshot(a.lol.id, 'RANKED_TFT')).toBeNull();
    for (let i = 0; i < 22; i++) {
      await store.upsertMatch(a.lol.id, { externalMatchId: `KR_${i}`, playedAt: new Date(t0.getTime() + i * MIN), win: true, summary: { i } });
    }
    await store.upsertMatch(a.lol.id, { externalMatchId: 'KR_0', playedAt: t0, win: false, summary: { i: 0 } });
    await store.trimMatches(a.lol.id, 20);
    expect(await prisma.recentMatch.count({ where: { gameAccountId: a.lol.id } })).toBe(20);
    expect((await store.existingMatchIds(a.lol.id, ['KR_0', 'KR_21'])).has('KR_21')).toBe(true);
    const s = await prisma.gameAccount.create({
      data: { userId: u.id, gameId: gameId.steam!, externalId: '76561190000000021', displayName: 's', verified: true, isPrimary: true },
    });
    await store.replaceSteamPlaytime(s.id, [{ appId: 1, appName: 'A', minutesTotal: 3, minutesRecent: 0 }, { appId: 2, appName: null, minutesTotal: 1, minutesRecent: 1 }], t0);
    await store.replaceSteamPlaytime(s.id, [{ appId: 2, appName: null, minutesTotal: 9, minutesRecent: 0 }], t0);
    const rows = await prisma.steamPlaytime.findMany({ where: { gameAccountId: s.id } });
    expect(rows.map((r) => [r.appId, r.minutesTotal])).toEqual([[2, 9]]);
  });

  it('advisory xact lock: 다른 트랜잭션이 같은 키를 잡고 있으면 fn 을 실행하지 않는다', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const gotLock = new Promise<void>((r) => (locked = r));
    const holder = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY_TIER})`;
      locked();
      await held;
    });
    await gotLock;
    let ran = false;
    expect(await store.withProducerLock(LOCK_KEY_TIER, async () => void (ran = true))).toBe(false);
    expect(ran).toBe(false);
    release();
    await holder;
    expect(await store.withProducerLock(LOCK_KEY_TIER, async () => void (ran = true))).toBe(true);
    expect(ran).toBe(true);
  });
});
