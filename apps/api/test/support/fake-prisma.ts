import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { GAME_SEED } from '@gcd/shared';
import {
  Prisma,
  type Badge,
  type Game,
  type GameAccount,
  type GameAccountSyncRequest,
  type RankSnapshot,
  type Rating,
  type RatingHistory,
  type RecentMatch,
  type RefreshToken,
  type RiotLinkVerification,
  type Scrim,
  type ScrimPlayer,
  type ScrimResult,
  type Season,
  type SeasonStanding,
  type SteamPlaytime,
  type User,
  type UserBadge,
} from '@prisma/client';
import { FakeTable, type Row, matchWhere } from './fake-table';

/**
 * DB 없이 auth·users 흐름을 검증하기 위한 인메모리 Prisma 대체.
 * 이 모듈들이 실제로 쓰는 호출만 구현한다(user: findUnique/create/update, refreshToken:
 * findUnique/findFirst/create/updateMany, $transaction(fn)).
 * S1: games·game_accounts·riot_link_verifications·game_account_sync_requests·rank_snapshots·recent_matches·
 * steam_playtime은 FakeTable(일반 구현, fake-table.ts). games는 GAME_SEED로 미리 채운다.
 * $executeRaw(advisory lock)는 호출만 기록한다(트랜잭션이 이미 직렬화돼 있음).
 * S2: scrims·scrim_players FakeTable(고유 (scrim_id, user_id)), games 정원 컬럼, user.findMany.
 * $queryRaw는 두 문장만 흉내 낸다: 내전 행 잠금(SELECT … FROM scrims WHERE id = ? FOR UPDATE → 행 또는 [])과
 * pg_try_advisory_xact_lock(→ [{ ok: advisoryAvailable }]). 호출은 rawCalls에 기록(잠금 순서 검사용).
 * 트랜잭션 안에서 다시 $transaction을 부르면(자동 마감처럼 바깥 잠금 트랜잭션 + 건별 트랜잭션) 같은 흐름으로 바로 실행한다.
 * S3: scrim_results(부분 고유 scrim_results_one_active_per_scrim (scrim_id) WHERE status IN (pending, approved)),
 * seasons, ratings(고유 (user_id, game_id, season_id)), rating_history(고유 (scrim_id, user_id)). createMany skipDuplicates 지원.
 * 시즌·사용자 advisory lock()은 호출만 기록한다(순서 검사용).
 * S4: season_standings(고유 (season_id, game_id, user_id)), badges(고유 code), user_badges(고유 (user_id, badge_id, season_id)).
 * $queryRaw 추가: 시즌 행 FOR SHARE·FOR NO KEY UPDATE(행 또는 []), 티어 랭킹 DISTINCT ON(계정별 최신 스냅샷).
 * ranking_caches는 RankingCacheStore 인터페이스 뒤에 있어 여기 없다(test/support/memory-ranking-cache.ts).
 * 고유 제약: game_accounts (game_id, external_id), 부분 고유 인덱스 (user_id, game_id) WHERE is_primary(문 단위 검사).
 * FK: game_accounts 삭제 시 rank_snapshots·recent_matches·steam_playtime Cascade, sync_requests SetNull.
 *
 * 한계(실제 DB e2e로 보완해야 함):
 * - 트랜잭션은 직렬화(뮤텍스) + 실패 시 스냅샷 복원. 격리 수준·행 잠금은 흉내 내지 않는다.
 * - where는 등호, null, { gt } 만 지원. select는 무시하고 행 전체를 돌려준다.
 */

type Where = Record<string, unknown>;

function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { gt?: unknown };
      if ('gt' in c) {
        if (v instanceof Date && c.gt instanceof Date) return v.getTime() > c.gt.getTime();
        return (v as number) > (c.gt as number);
      }
      throw new Error(`fake-prisma: 지원하지 않는 조건 ${k}=${JSON.stringify(cond)}`);
    }
    if (v instanceof Date && cond instanceof Date) return v.getTime() === cond.getTime();
    return v === cond;
  });
}

function uniqueError(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${target}`, {
    code: 'P2002',
    clientVersion: 'fake',
    meta: { target: [target] },
  });
}

function clone<T>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }));
}

export class FakePrisma {
  users: User[] = [];
  refreshTokens: RefreshToken[] = [];
  private txQueue: Promise<unknown> = Promise.resolve();
  /** $executeRaw·$queryRaw 호출 기록(advisory lock 키·내전 행 잠금 확인용) */
  rawCalls: { sql: string; values: unknown[] }[] = [];
  /** pg_try_advisory_xact_lock 결과(다른 인스턴스가 잠금을 쥔 상황 흉내) */
  advisoryAvailable = true;
  private readonly txContext = new AsyncLocalStorage<boolean>();

  // ---- S1 테이블 ----
  game = new FakeTable<Game & Row>(() => ({
    code: undefined,
    name: undefined,
    hasPositions: false,
    hasTeams: true,
    positions: [],
    sortOrder: 0,
    capacityMin: 2,
    capacityMax: 16,
    capacityDefault: 8,
    capacityStep: 1,
    startRequiresFull: false,
    requiresSteamApp: false,
  }));

  // ---- S2 테이블 ----
  scrim = new FakeTable<Scrim & Row>(() => ({
    gameId: undefined,
    hostId: undefined,
    title: undefined,
    scheduledAt: undefined,
    capacity: undefined,
    status: 'recruiting',
    rules: null,
    rated: true,
    autoBalance: true,
    usePositions: true,
    steamAppId: null,
    steamAppName: null,
    startedAt: null,
    cancelledAt: null,
    cancelReason: null,
    updatedAt: undefined,
  }));

  scrimPlayer = new FakeTable<ScrimPlayer & Row>(
    () => ({
      scrimId: undefined,
      userId: undefined,
      status: 'joined',
      position: null,
      preferredPositions: [],
      team: null,
      joinedAt: new Date(),
      noShowMarkedAt: null,
      noShowMarkedById: null,
      updatedAt: undefined,
    }),
    [{ target: ['scrim_id', 'user_id'], fields: ['scrimId', 'userId'] }],
  );

  // ---- S3 테이블 ----
  scrimResult = new FakeTable<ScrimResult & Row>(
    () => ({
      scrimId: undefined,
      status: 'pending',
      winnerTeam: null,
      placements: null,
      submittedById: undefined,
      approvedById: null,
      approvedAt: null,
      rejectReason: null,
      rejectedById: null,
      rejectedAt: null,
      updatedAt: undefined,
    }),
    [
      {
        target: 'scrim_results_one_active_per_scrim',
        fields: ['scrimId'],
        where: (r) => r.status === 'pending' || r.status === 'approved',
      },
    ],
  );

  season = new FakeTable<Season & Row>(() => ({ name: undefined, startsAt: undefined, endsAt: undefined, closedAt: null }));

  // ---- S4 테이블 ----
  seasonStanding = new FakeTable<SeasonStanding & Row>(
    () => ({ seasonId: undefined, gameId: undefined, userId: undefined, rank: undefined, elo: undefined, wins: undefined, losses: undefined }),
    [{ target: ['season_id', 'game_id', 'user_id'], fields: ['seasonId', 'gameId', 'userId'] }],
  );

  badge = new FakeTable<Badge & Row>(
    () => ({ code: undefined, name: undefined, description: null, condition: undefined }),
    [{ target: ['code'], fields: ['code'] }],
  );

  userBadge = new FakeTable<UserBadge & Row>(
    () => ({ userId: undefined, badgeId: undefined, seasonId: null, earnedAt: new Date() }),
    [{ target: ['user_id', 'badge_id', 'season_id'], fields: ['userId', 'badgeId', 'seasonId'] }],
  );

  rating = new FakeTable<Rating & Row>(
    () => ({
      userId: undefined,
      gameId: undefined,
      seasonId: undefined,
      elo: 1000,
      wins: 0,
      losses: 0,
      carriedFromSeasonId: null,
      updatedAt: undefined,
    }),
    [{ target: ['user_id', 'game_id', 'season_id'], fields: ['userId', 'gameId', 'seasonId'] }],
  );

  ratingHistory = new FakeTable<RatingHistory & Row>(
    () => ({
      userId: undefined,
      scrimId: undefined,
      scrimResultId: undefined,
      gameId: undefined,
      seasonId: undefined,
      eloBefore: undefined,
      eloAfter: undefined,
      kFactor: undefined,
    }),
    [{ target: ['scrim_id', 'user_id'], fields: ['scrimId', 'userId'] }],
  );

  rankSnapshot = new FakeTable<RankSnapshot & Row>(() => ({
    gameAccountId: undefined,
    queue: null,
    tier: undefined,
    division: null,
    lp: 0,
    wins: 0,
    losses: 0,
    capturedAt: new Date(),
  }));

  recentMatch = new FakeTable<RecentMatch & Row>(
    () => ({ gameAccountId: undefined, externalMatchId: undefined, playedAt: undefined, win: null, placement: null, summary: {} }),
    [{ target: ['game_account_id', 'external_match_id'], fields: ['gameAccountId', 'externalMatchId'] }],
  );

  steamPlaytime = new FakeTable<SteamPlaytime & Row>(
    () => ({
      gameAccountId: undefined,
      appId: undefined,
      appName: null,
      minutesTotal: 0,
      minutesRecent: 0,
      syncedAt: new Date(),
    }),
    [{ target: ['game_account_id', 'app_id'], fields: ['gameAccountId', 'appId'] }],
  );

  gameAccountSyncRequest = new FakeTable<GameAccountSyncRequest & Row>(() => ({
    userId: undefined,
    gameAccountId: null,
  }));

  riotLinkVerification = new FakeTable<RiotLinkVerification & Row>(() => ({
    userId: undefined,
    puuid: undefined,
    gameName: undefined,
    tagLine: undefined,
    iconId: undefined,
    status: 'pending',
    expiresAt: undefined,
    checkCount: 0,
    lastCheckedAt: null,
    verifiedAt: null,
    updatedAt: undefined,
  }));

  gameAccount = new FakeTable<GameAccount & Row>(
    () => ({
      userId: undefined,
      gameId: undefined,
      externalId: undefined,
      displayName: undefined,
      verified: false,
      isPrimary: false,
      verifiedAt: null,
      lastSyncedAt: null,
      lastSyncError: null,
      lastSyncErrorAt: null,
      syncState: 'idle',
      syncStateAt: null,
      matchesSyncedAt: null,
      updatedAt: undefined,
    }),
    [
      // Prisma가 @@unique 위반에 주는 형식(컬럼 배열)과 수동 부분 인덱스(이름)를 흉내 낸다 — 실제 형식은 DB e2e로 확인
      { target: ['game_id', 'external_id'], fields: ['gameId', 'externalId'] },
      {
        target: 'game_accounts_one_primary_per_user_game',
        fields: ['userId', 'gameId'],
        where: (r) => r.isPrimary === true,
      },
    ],
    {
      onDelete: (deleted) => {
        const ids = new Set(deleted.map((d) => d.id));
        this.rankSnapshot.rows = this.rankSnapshot.rows.filter((r) => !ids.has(r.gameAccountId));
        this.recentMatch.rows = this.recentMatch.rows.filter((r) => !ids.has(r.gameAccountId));
        this.steamPlaytime.rows = this.steamPlaytime.rows.filter((r) => !ids.has(r.gameAccountId));
        for (const s of this.gameAccountSyncRequest.rows) {
          if (s.gameAccountId && ids.has(s.gameAccountId)) s.gameAccountId = null;
        }
      },
    },
  );

  private get s1Tables(): FakeTable[] {
    return [
      this.game,
      this.gameAccount,
      this.riotLinkVerification,
      this.gameAccountSyncRequest,
      this.rankSnapshot,
      this.recentMatch,
      this.steamPlaytime,
      this.scrim,
      this.scrimPlayer,
      this.scrimResult,
      this.season,
      this.rating,
      this.ratingHistory,
      this.seasonStanding,
      this.badge,
      this.userBadge,
    ] as unknown as FakeTable[];
  }

  constructor() {
    for (const g of GAME_SEED) {
      this.game.insert({
        code: g.code,
        name: g.name,
        hasPositions: g.has_positions,
        hasTeams: g.has_teams,
        positions: [...g.positions],
        sortOrder: g.sort_order,
        capacityMin: g.capacity_min,
        capacityMax: g.capacity_max,
        capacityDefault: g.capacity_default,
        capacityStep: g.capacity_step,
        startRequiresFull: g.start_requires_full,
        requiresSteamApp: g.requires_steam_app,
      });
    }
  }

  /** 게임 코드 → games.id */
  gameId(code: string): string {
    const g = this.game.rows.find((r) => r.code === code);
    if (!g) throw new Error(`fake-prisma: game ${code} 없음`);
    return g.id;
  }

  async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number> {
    await this.tick();
    this.rawCalls.push({ sql: strings.join('?'), values });
    return 1;
  }

  async $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
    await this.tick();
    const sql = strings.join('?');
    this.rawCalls.push({ sql, values });
    if (/pg_try_advisory_xact_lock/.test(sql)) return [{ ok: this.advisoryAvailable }] as T;
    if (/FROM\s+scrims\s+WHERE\s+id\s*=.*FOR\s+UPDATE/s.test(sql)) {
      const r = this.scrim.rows.find((x) => x.id === values[0]);
      if (!r) return [] as T;
      return [
        {
          id: r.id,
          status: r.status,
          capacity: r.capacity,
          scheduled_at: new Date(r.scheduledAt.getTime()),
          host_id: r.hostId,
          use_positions: r.usePositions,
          game_id: r.gameId,
        },
      ] as T;
    }
    if (/FROM\s+seasons\s+WHERE\s+id\s*=.*FOR\s+SHARE/s.test(sql)) {
      const r = this.season.rows.find((x) => x.id === values[0]);
      return (r ? [{ closed_at: r.closedAt }] : []) as T;
    }
    if (/FROM\s+seasons\s+WHERE\s+id\s*=.*FOR\s+NO\s+KEY\s+UPDATE/s.test(sql)) {
      const r = this.season.rows.find((x) => x.id === values[0]);
      return (r ? [{ id: r.id, ends_at: r.endsAt, closed_at: r.closedAt }] : []) as T;
    }
    if (/SELECT\s+DISTINCT\s+ON\s+\(rs\.game_account_id\)/.test(sql)) {
      const [gameId, queue] = values;
      const accounts = new Set(
        this.gameAccount.rows.filter((a) => a.gameId === gameId && a.isPrimary && a.verified).map((a) => a.id),
      );
      const latest = new Map<string, RankSnapshot & Row>();
      for (const s of this.rankSnapshot.rows) {
        if (!accounts.has(s.gameAccountId) || s.queue !== queue) continue;
        const cur = latest.get(s.gameAccountId);
        const newer =
          !cur ||
          s.capturedAt.getTime() > cur.capturedAt.getTime() ||
          (s.capturedAt.getTime() === cur.capturedAt.getTime() && s.createdAt.getTime() > cur.createdAt.getTime());
        if (newer) latest.set(s.gameAccountId, s);
      }
      return [...latest.values()].map((s) => ({
        game_account_id: s.gameAccountId,
        tier: s.tier,
        division: s.division,
        lp: s.lp,
        wins: s.wins,
        losses: s.losses,
      })) as T;
    }
    throw new Error(`fake-prisma: 지원하지 않는 $queryRaw ${sql}`);
  }

  /** 테스트에서 호출 순서를 섞기 위한 지연(마이크로태스크 양보) */
  private async tick(): Promise<void> {
    await new Promise((r) => setImmediate(r));
  }

  user = {
    findMany: async (args: { where?: Where } = {}): Promise<User[]> => {
      await this.tick();
      return this.users.filter((u) => matchWhere(u as unknown as Row, args.where)).map((u) => ({ ...u }));
    },
    findUnique: async (args: { where: Where }): Promise<User | null> => {
      await this.tick();
      const row = this.users.find((u) => matches(u as unknown as Record<string, unknown>, args.where));
      return row ? { ...row } : null;
    },
    create: async (args: { data: Partial<User> & { nickname: string } }): Promise<User> => {
      await this.tick();
      const d = args.data;
      if (this.users.some((u) => u.nickname === d.nickname)) throw uniqueError('nickname');
      if (d.discordId && this.users.some((u) => u.discordId === d.discordId)) throw uniqueError('discord_id');
      const now = new Date();
      const row: User = {
        id: d.id ?? randomUUID(),
        email: d.email ?? null,
        nickname: d.nickname,
        role: d.role ?? 'member',
        discordId: d.discordId ?? null,
        discordUsername: d.discordUsername ?? null,
        discordGlobalName: d.discordGlobalName ?? null,
        discordAvatar: d.discordAvatar ?? null,
        discordGuildVerifiedAt: d.discordGuildVerifiedAt ?? null,
        nicknameConfirmedAt: d.nicknameConfirmedAt ?? null,
        lastLoginAt: d.lastLoginAt ?? null,
        notifyScrimStart: true,
        notifyResult: true,
        notifyWaitlist: true,
        notifyPatch: false,
        createdAt: d.createdAt ?? now,
        updatedAt: now,
      };
      this.users.push(row);
      return { ...row };
    },
    update: async (args: { where: { id: string }; data: Partial<User> }): Promise<User> => {
      await this.tick();
      const row = this.users.find((u) => u.id === args.where.id);
      if (!row) {
        throw new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'fake',
        });
      }
      const d = args.data;
      if (d.nickname !== undefined && this.users.some((u) => u.id !== row.id && u.nickname === d.nickname)) {
        throw uniqueError('nickname');
      }
      for (const [k, v] of Object.entries(d)) {
        if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = v;
      }
      row.updatedAt = new Date();
      return { ...row };
    },
  };

  refreshToken = {
    findUnique: async (args: { where: Where }): Promise<RefreshToken | null> => {
      await this.tick();
      const row = this.refreshTokens.find((t) => matches(t as unknown as Record<string, unknown>, args.where));
      return row ? { ...row } : null;
    },
    findFirst: async (args: { where: Where }): Promise<RefreshToken | null> => {
      await this.tick();
      const row = this.refreshTokens.find((t) => matches(t as unknown as Record<string, unknown>, args.where));
      return row ? { ...row } : null;
    },
    create: async (args: { data: Partial<RefreshToken> & Pick<RefreshToken, 'userId' | 'tokenHash' | 'familyId' | 'expiresAt'> }): Promise<RefreshToken> => {
      await this.tick();
      const d = args.data;
      if (this.refreshTokens.some((t) => t.tokenHash === d.tokenHash)) throw uniqueError('token_hash');
      const row: RefreshToken = {
        id: d.id ?? randomUUID(),
        userId: d.userId,
        tokenHash: d.tokenHash,
        familyId: d.familyId,
        expiresAt: d.expiresAt,
        revokedAt: d.revokedAt ?? null,
        replacedById: d.replacedById ?? null,
        userAgent: d.userAgent ?? null,
        createdAt: new Date(),
      };
      this.refreshTokens.push(row);
      return { ...row };
    },
    updateMany: async (args: { where: Where; data: Partial<RefreshToken> }): Promise<{ count: number }> => {
      await this.tick();
      let count = 0;
      for (const t of this.refreshTokens) {
        if (!matches(t as unknown as Record<string, unknown>, args.where)) continue;
        Object.assign(t, args.data);
        count += 1;
      }
      return { count };
    },
  };

  async $transaction<T>(fn: ((tx: this) => Promise<T>) | Promise<unknown>[]): Promise<T> {
    if (Array.isArray(fn)) return (await Promise.all(fn)) as T;
    // 바깥 트랜잭션 안의 트랜잭션: 같은 직렬화 흐름에서 바로 실행(대기열에 넣으면 교착)
    if (this.txContext.getStore()) return fn(this);
    const run = async (): Promise<T> => {
      const snapshot = {
        users: clone(this.users),
        tokens: clone(this.refreshTokens),
        s1: this.s1Tables.map((t) => t.snapshot()),
      };
      try {
        return await this.txContext.run(true, () => fn(this));
      } catch (err) {
        this.users = snapshot.users;
        this.refreshTokens = snapshot.tokens;
        this.s1Tables.forEach((t, i) => t.restore(snapshot.s1[i] as Row[]));
        throw err;
      }
    };
    const result = this.txQueue.then(run, run);
    this.txQueue = result.catch(() => undefined);
    return result;
  }

  async $disconnect(): Promise<void> {}
}
