import type { RankValue, RankedQueue } from '@gcd/shared';
import { Injectable } from '@nestjs/common';
import { SYNC_STATE_STALE_MS } from '@gcd/shared';
import { PrismaService } from '../prisma/prisma.service';

/** 동기화 작업자가 보는 계정 행 */
export type SyncAccountRow = {
  id: string;
  userId: string;
  externalId: string;
  displayName: string;
  isPrimary: boolean;
};

/** 라이엇 ID 하나의 lol·tft 행 쌍 또는 스팀 행 하나 */
export type SyncTarget =
  | { provider: 'riot'; lol: SyncAccountRow | null; tft: SyncAccountRow | null }
  | { provider: 'steam'; steam: SyncAccountRow };

export type RowRelease = { id: string; lastSyncedAt?: Date; matchesSyncedAt?: Date };

export type MatchRow = {
  externalMatchId: string;
  playedAt: Date;
  win: boolean;
  summary: Record<string, unknown>;
};

export type SteamGameRow = { appId: number; appName: string | null; minutesTotal: number; minutesRecent: number };

/** 동기화 대상 선택 한 건 */
export type ProducerTarget = { id: string; kind: 'riot-tier' | 'steam-playtime'; activeMember: boolean };

/**
 * 작업자·생산자가 DB를 만지는 유일한 경계. 테스트는 인메모리 구현으로 대체한다.
 * 라이엇 lol·tft 두 행의 sync_state는 항상 함께 바꾼다(계약 6-1).
 */
export interface SyncStore {
  loadTarget(gameAccountId: string): Promise<SyncTarget | null>;
  /** queued|idle → running. 다른 작업자가 10분 안에 running으로 잡았으면 false */
  claim(ids: string[], now: Date): Promise<boolean>;
  /** running → idle + 결과 기록. error가 null이면 last_sync_error/_at 도 null */
  release(rows: RowRelease[], error: string | null, now: Date): Promise<void>;
  /** 429 재등록(내가 방금 잡은 running 행): running → idle → queued, 두 단계. 멈춘 행 정리는 requeueStuck */
  requeue(ids: string[], now: Date): Promise<void>;
  updateDisplayName(ids: string[], name: string): Promise<void>;
  latestSnapshot(gameAccountId: string, queue: RankedQueue): Promise<RankValue | null>;
  insertSnapshot(gameAccountId: string, queue: RankedQueue, rank: RankValue, capturedAt: Date): Promise<void>;
  existingMatchIds(gameAccountId: string, matchIds: string[]): Promise<Set<string>>;
  upsertMatch(gameAccountId: string, match: MatchRow): Promise<void>;
  trimMatches(gameAccountId: string, keep: number): Promise<void>;
  replaceSteamPlaytime(gameAccountId: string, games: SteamGameRow[], syncedAt: Date): Promise<void>;

  // --- 생산자 ---
  /** 작업별 advisory lock을 얻은 경우에만 fn 실행(트랜잭션 단위 잠금이라 커넥션 풀과 무관) */
  withProducerLock(lockKey: number, fn: () => Promise<void>): Promise<boolean>;
  selectTierTargets(): Promise<ProducerTarget[]>;
  selectSteamTargets(): Promise<ProducerTarget[]>;
  /** 멈춘 행(queued|running 이고 sync_state_at 이 10분 넘게 지남)의 대표 id(lol 또는 steam) */
  selectStuck(now: Date): Promise<{ id: string; kind: 'riot-full' | 'steam-playtime' }[]>;
  /** in-process 모드 시작 시: 메모리 큐가 비었으므로 queued 로 남은 행의 대표 id(상태는 바꾸지 않는다) */
  selectQueued(): Promise<{ id: string; kind: 'riot-full' | 'steam-playtime' }[]>;
  /**
   * 멈춘 행 재등록(queued→queued / running→queued, 계약 D59). 한 번의 조건부 update:
   * WHERE sync_state IN (queued,running) AND sync_state_at < now-10분. 같은 라이엇 ID 의 tft 행 포함.
   */
  requeueStuck(ids: string[], now: Date): Promise<void>;
}

export const SYNC_STORE = Symbol('SYNC_STORE');

/** 작업자 잠금·정리 기준(계약 6-1) */
export const STUCK_AFTER_MS = SYNC_STATE_STALE_MS;

type RawIdRow = { id: string; active: boolean | null };

@Injectable()
export class PrismaSyncStore implements SyncStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadTarget(gameAccountId: string): Promise<SyncTarget | null> {
    const row = await this.prisma.gameAccount.findUnique({
      where: { id: gameAccountId },
      include: { game: { select: { code: true } } },
    });
    if (!row) return null;
    const toRow = (r: typeof row): SyncAccountRow => ({
      id: r.id,
      userId: r.userId,
      externalId: r.externalId,
      displayName: r.displayName,
      isPrimary: r.isPrimary,
    });
    if (row.game.code === 'steam') return { provider: 'steam', steam: toRow(row) };
    const pair = await this.prisma.gameAccount.findMany({
      where: { userId: row.userId, externalId: row.externalId, game: { code: { in: ['lol', 'tft'] } } },
      include: { game: { select: { code: true } } },
    });
    const lol = pair.find((p) => p.game.code === 'lol');
    const tft = pair.find((p) => p.game.code === 'tft');
    return { provider: 'riot', lol: lol ? toRow(lol) : null, tft: tft ? toRow(tft) : null };
  }

  async claim(ids: string[], now: Date): Promise<boolean> {
    const staleBefore = new Date(now.getTime() - STUCK_AFTER_MS);
    const res = await this.prisma.gameAccount.updateMany({
      where: {
        id: { in: ids },
        OR: [{ syncState: { in: ['idle', 'queued'] } }, { syncStateAt: { lt: staleBefore } }],
      },
      data: { syncState: 'running', syncStateAt: now },
    });
    return res.count > 0;
  }

  async release(rows: RowRelease[], error: string | null, now: Date): Promise<void> {
    await this.prisma.$transaction(
      rows.map((r) =>
        this.prisma.gameAccount.updateMany({
          // 계정이 해제됐으면 0행 — 오류 아님
          where: { id: r.id },
          data: {
            syncState: 'idle',
            syncStateAt: now,
            lastSyncError: error,
            lastSyncErrorAt: error === null ? null : now,
            ...(r.lastSyncedAt ? { lastSyncedAt: r.lastSyncedAt } : {}),
            ...(r.matchesSyncedAt ? { matchesSyncedAt: r.matchesSyncedAt } : {}),
          },
        }),
      ),
    );
  }

  async requeue(ids: string[], now: Date): Promise<void> {
    await this.prisma.gameAccount.updateMany({
      where: { id: { in: ids }, syncState: 'running' },
      data: { syncState: 'idle', syncStateAt: now },
    });
    await this.prisma.gameAccount.updateMany({
      where: { id: { in: ids }, syncState: 'idle' },
      data: { syncState: 'queued', syncStateAt: now },
    });
  }

  async updateDisplayName(ids: string[], name: string): Promise<void> {
    await this.prisma.gameAccount.updateMany({ where: { id: { in: ids } }, data: { displayName: name } });
  }

  async latestSnapshot(gameAccountId: string, queue: RankedQueue): Promise<RankValue | null> {
    const s = await this.prisma.rankSnapshot.findFirst({
      where: { gameAccountId, queue },
      orderBy: { capturedAt: 'desc' },
    });
    if (!s) return null;
    return {
      tier: s.tier as RankValue['tier'],
      division: s.division as RankValue['division'],
      lp: s.lp,
      wins: s.wins,
      losses: s.losses,
    };
  }

  async insertSnapshot(gameAccountId: string, queue: RankedQueue, rank: RankValue, capturedAt: Date): Promise<void> {
    await this.prisma.rankSnapshot.create({
      data: {
        gameAccountId,
        queue,
        tier: rank.tier,
        division: rank.division,
        lp: rank.lp,
        wins: rank.wins,
        losses: rank.losses,
        capturedAt,
      },
    });
  }

  async existingMatchIds(gameAccountId: string, matchIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.recentMatch.findMany({
      where: { gameAccountId, externalMatchId: { in: matchIds } },
      select: { externalMatchId: true },
    });
    return new Set(rows.map((r) => r.externalMatchId));
  }

  async upsertMatch(gameAccountId: string, m: MatchRow): Promise<void> {
    const summary = m.summary as object;
    await this.prisma.recentMatch.upsert({
      where: { gameAccountId_externalMatchId: { gameAccountId, externalMatchId: m.externalMatchId } },
      create: { gameAccountId, externalMatchId: m.externalMatchId, playedAt: m.playedAt, win: m.win, summary },
      update: { playedAt: m.playedAt, win: m.win, summary },
    });
  }

  async trimMatches(gameAccountId: string, keep: number): Promise<void> {
    const extra = await this.prisma.recentMatch.findMany({
      where: { gameAccountId },
      orderBy: { playedAt: 'desc' },
      skip: keep,
      select: { id: true },
    });
    if (extra.length === 0) return;
    await this.prisma.recentMatch.deleteMany({ where: { id: { in: extra.map((e) => e.id) } } });
  }

  async replaceSteamPlaytime(gameAccountId: string, games: SteamGameRow[], syncedAt: Date): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.steamPlaytime.deleteMany({ where: { gameAccountId } }),
      this.prisma.steamPlaytime.createMany({
        data: games.map((g) => ({ gameAccountId, ...g, syncedAt })),
      }),
    ]);
  }

  async withProducerLock(lockKey: number, fn: () => Promise<void>): Promise<boolean> {
    let acquired = false;
    // 세션 잠금은 커넥션 풀에서 해제가 다른 커넥션으로 갈 수 있어, 트랜잭션 잠금으로 같은 효과를 낸다.
    await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${lockKey}) AS ok`;
        if (!rows[0]?.ok) return;
        acquired = true;
        await fn();
      },
      { timeout: 5 * 60 * 1000, maxWait: 10_000 },
    );
    return acquired;
  }

  async selectTierTargets(): Promise<ProducerTarget[]> {
    // 계약 6-2 SQL. lol 행 기준(tft 행은 작업자가 같은 라이엇 ID 쌍으로 처리)
    const rows = await this.prisma.$queryRaw<RawIdRow[]>`
      SELECT ga.id::text AS id,
             (u.last_login_at >= now() - interval '7 days'
              OR EXISTS (SELECT 1 FROM scrim_players sp WHERE sp.user_id = u.id AND sp.joined_at >= now() - interval '7 days')
              OR EXISTS (SELECT 1 FROM activity_logs al WHERE al.user_id = u.id AND al.started_at >= now() - interval '7 days')
             ) AS active
      FROM game_accounts ga
      JOIN games g ON g.id = ga.game_id AND g.code = 'lol'
      JOIN users u ON u.id = ga.user_id
      WHERE ga.verified AND ga.sync_state = 'idle'
        AND (ga.last_synced_at IS NULL OR ga.last_synced_at < now() - interval '55 minutes')
      ORDER BY
        CASE WHEN (u.last_login_at >= now() - interval '7 days'
                   OR EXISTS (SELECT 1 FROM scrim_players sp WHERE sp.user_id = u.id AND sp.joined_at >= now() - interval '7 days')
                   OR EXISTS (SELECT 1 FROM activity_logs al WHERE al.user_id = u.id AND al.started_at >= now() - interval '7 days'))
             THEN 0 ELSE 1 END,
        ga.is_primary DESC,
        ga.last_synced_at ASC NULLS FIRST`;
    return rows.map((r) => ({ id: r.id, kind: 'riot-tier' as const, activeMember: r.active === true }));
  }

  async selectSteamTargets(): Promise<ProducerTarget[]> {
    const rows = await this.prisma.$queryRaw<RawIdRow[]>`
      SELECT ga.id::text AS id, false AS active
      FROM game_accounts ga
      JOIN games g ON g.id = ga.game_id AND g.code = 'steam'
      WHERE ga.verified
      ORDER BY ga.last_synced_at ASC NULLS FIRST`;
    return rows.map((r) => ({ id: r.id, kind: 'steam-playtime' as const, activeMember: false }));
  }

  async selectStuck(now: Date): Promise<{ id: string; kind: 'riot-full' | 'steam-playtime' }[]> {
    return this.findPrimaryRows({
      syncState: { in: ['queued', 'running'] },
      syncStateAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
    });
  }

  async selectQueued(): Promise<{ id: string; kind: 'riot-full' | 'steam-playtime' }[]> {
    return this.findPrimaryRows({ syncState: 'queued' });
  }

  private async findPrimaryRows(where: object): Promise<{ id: string; kind: 'riot-full' | 'steam-playtime' }[]> {
    const rows = await this.prisma.gameAccount.findMany({
      where: { ...where, game: { code: { in: ['lol', 'steam'] } } }, // tft 행은 lol 행과 한 쌍
      select: { id: true, game: { select: { code: true } } },
    });
    return rows.map((r) => ({ id: r.id, kind: r.game.code === 'steam' ? ('steam-playtime' as const) : ('riot-full' as const) }));
  }

  async requeueStuck(ids: string[], now: Date): Promise<void> {
    // lol 행 id만 받으므로 같은 라이엇 ID의 tft 행까지 포함해 되돌린다
    const rows = await this.prisma.gameAccount.findMany({
      where: { id: { in: ids } },
      select: { userId: true, externalId: true },
    });
    const pairs = rows.length
      ? await this.prisma.gameAccount.findMany({
          where: { OR: rows.map((r) => ({ userId: r.userId, externalId: r.externalId })) },
          select: { id: true },
        })
      : [];
    // 멈춘 행 전용 전이는 반드시 sync_state_at 조건부 update 로만 실행한다
    await this.prisma.gameAccount.updateMany({
      where: {
        id: { in: pairs.map((p) => p.id) },
        syncState: { in: ['queued', 'running'] },
        syncStateAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) },
      },
      data: { syncState: 'queued', syncStateAt: now },
    });
  }
}
