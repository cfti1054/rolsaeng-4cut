import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { kstDateKey } from '@gcd/core';
import { GAME_SEED } from '@gcd/shared';
import {
  Prisma,
  type ActivityLog,
  type ApiKey,
  type Badge,
  type BotPresence,
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
 * S5: api_keys(고유 key_hash), bot_presence(고유 source), activity_logs(고유 idempotency_key). (r2: discord_link_codes 없음, D237)
 * 관계 필터 `user: rankableUserWhere`(game_accounts·ratings·activity_logs). user.updateMany.
 * $queryRaw 추가(SQL 앞 주석 태그로 구분, 중첩 Prisma.sql은 펼쳐서 읽는다): 활동 INSERT … ON CONFLICT RETURNING,
 * 접속 현황 조건부 upsert RETURNING, 활동 집계 3종(합계·게임별은 SQL에 바인딩된 type 목록만 합산, SUM은 bigint로 돌려준다,
 * 내전 참여 수), 플레이타임 행·상위 app, `/steam-apps` 보유 게임·보유자 수, 이번 주 활동 멤버 수.
 * 원시 SQL의 순위 대상 조건은 `u.left_at IS NULL` 조각이 쿼리에 들어 있을 때만 적용한다(빠뜨리면 테스트가 잡는다).
 * 플레이타임 보유자 조건(D234)도 SQL에 그 문구(`ga.is_primary AND ga.verified`, `g.code = `, `sp.minutes_total > 0`)가 있을 때만 적용한다.
 * rawHooks[태그]: 그 원시 SQL을 실행하기 직전에 부른다(경합 흉내).
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

/** ILIKE 패턴(`\` 이스케이프) → 대소문자 무시 정규식 */
function likeToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '\\' && i + 1 < pattern.length) {
      out += (pattern[++i] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (c === '%') out += '.*';
    else if (c === '_') out += '.';
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'is');
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
  /** 태그(`gcd:activity-insert` 등) → 실행 직전 호출(경합 흉내) */
  rawHooks: Partial<Record<string, () => void>> = {};

  private readonly userRelation = { user: (row: Row) => this.users.find((u) => u.id === row.userId) as Row | undefined };

  // ---- S5 테이블 ----
  apiKey = new FakeTable<ApiKey & Row>(
    () => ({ name: undefined, keyHash: undefined, keyPrefix: undefined, scopes: [], lastUsedAt: null, revokedAt: null, createdById: null }),
    [{ target: ['key_hash'], fields: ['keyHash'] }],
  );

  botPresence = new FakeTable<BotPresence & Row>(
    () => ({ source: undefined, capturedAt: undefined, voiceMemberCount: 0, playing: [], apiKeyId: null, updatedAt: undefined }),
    [{ target: ['source'], fields: ['source'] }],
  );

  activityLog = new FakeTable<ActivityLog & Row>(
    () => ({ userId: undefined, type: undefined, gameId: null, startedAt: undefined, durationSec: 0, idempotencyKey: undefined, apiKeyId: null }),
    [{ target: ['idempotency_key'], fields: ['idempotencyKey'] }],
    { relations: this.userRelation },
  );

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
    { relations: this.userRelation },
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
      relations: this.userRelation,
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
      this.apiKey,
      this.botPresence,
      this.activityLog,
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
    const s5 = this.s5Query(Prisma.sql(strings, ...values));
    if (s5 !== undefined) return s5 as T;
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

  /** S5 원시 SQL. 해당 없으면 undefined */
  private s5Query(q: Prisma.Sql): unknown[] | undefined {
    const sql = q.sql;
    const v = q.values;
    const tag = /\/\* (gcd:[a-z-]+) \*\//.exec(sql)?.[1];
    if (tag) this.rawHooks[tag]?.();
    const rankable = sql.includes('u.left_at IS NULL');
    const userOk = (userId: unknown) => {
      const u = this.users.find((x) => x.id === userId);
      return u !== undefined && (!rankable || u.leftAt === null);
    };
    const inWindow = (d: Date, start: unknown, end: unknown) =>
      d.getTime() >= (start as Date).getTime() && d.getTime() < (end as Date).getTime();

    /** 플레이타임 보유자 행(D234). 각 조건은 SQL에 그 문구가 있을 때만 적용한다. 스팀 코드는 첫 바인딩 값 */
    const holderRows = () => {
      const primary = sql.includes('ga.is_primary AND ga.verified');
      const byCode = sql.includes('g.code = ');
      const positive = sql.includes('sp.minutes_total > 0');
      return this.steamPlaytime.rows.flatMap((sp) => {
        const ga = this.gameAccount.rows.find((a) => a.id === sp.gameAccountId);
        const game = ga ? this.game.rows.find((g) => g.id === ga.gameId) : undefined;
        if (!ga || !game || !userOk(ga.userId)) return [];
        if (byCode && game.code !== v[0]) return [];
        if (primary && !(ga.isPrimary && ga.verified)) return [];
        if (positive && !(sp.minutesTotal > 0)) return [];
        return [{ sp, ga }];
      });
    };
    const countByApp = (rows: { sp: SteamPlaytime }[]) => {
      const count = new Map<number, number>();
      for (const r of rows) count.set(r.sp.appId, (count.get(r.sp.appId) ?? 0) + 1);
      return count;
    };
    switch (tag) {
      case 'gcd:activity-insert': {
        const out: { idempotency_key: string }[] = [];
        for (let i = 0; i < v.length; i += 9) {
          const [id, userId, type, gameId, startedAt, durationSec, key, apiKeyId, createdAt] = v.slice(i, i + 9);
          if (this.activityLog.rows.some((r) => r.idempotencyKey === key)) continue;
          this.activityLog.insert({ id, userId, type, gameId, startedAt, durationSec, idempotencyKey: key, apiKeyId, createdAt });
          out.push({ idempotency_key: key as string });
        }
        return out;
      }
      case 'gcd:presence-upsert': {
        const [id, source, capturedAt, count, playing, apiKeyId, now] = v as [string, string, Date, number, string, string, Date];
        const cur = this.botPresence.rows.find((r) => r.source === source);
        if (!cur) {
          this.botPresence.insert({ id, source, capturedAt, voiceMemberCount: count, playing: JSON.parse(playing), apiKeyId, createdAt: now, updatedAt: now });
          return [{ id }];
        }
        if (!(cur.capturedAt.getTime() < capturedAt.getTime())) return [];
        Object.assign(cur, { capturedAt, voiceMemberCount: count, playing: JSON.parse(playing), apiKeyId, updatedAt: now });
        return [{ id: cur.id }];
      }
      case 'gcd:activity-totals': {
        // 값 순서: 합산 type 목록(ACTIVITY_RANKED_TYPES) → start → end → 집계 type 목록(ACTIVITY_COUNTED_TYPES, D240)
        const at = v.findIndex((x) => x instanceof Date);
        const types = v.slice(0, at);
        const [start, end] = v.slice(at, at + 2);
        const counted = v.slice(at + 2);
        const by = new Map<string, { voice: bigint; days: Set<string> }>();
        for (const r of this.activityLog.rows) {
          if (!inWindow(r.startedAt, start, end) || !userOk(r.userId) || !counted.includes(r.type)) continue;
          const g = by.get(r.userId) ?? { voice: 0n, days: new Set<string>() };
          if (types.includes(r.type)) g.voice += BigInt(r.durationSec);
          g.days.add(kstDateKey(r.startedAt));
          by.set(r.userId, g);
        }
        return [...by].map(([userId, g]) => ({ user_id: userId, voice_sec: g.voice, active_days: g.days.size }));
      }
      case 'gcd:activity-scrims': {
        // 값 순서: start, end, 순위에 든 user id…
        const [start, end, ...ids] = v;
        const want = new Set(ids as string[]);
        const notCancelled = sql.includes("s.status <> 'cancelled'");
        const joinedOnly = sql.includes("sp.status = 'joined'");
        const approvedOnly = sql.includes("r.status = 'approved'");
        const by = new Map<string, Set<string>>();
        for (const p of this.scrimPlayer.rows) {
          if (!want.has(p.userId) || !userOk(p.userId)) continue;
          if (joinedOnly && p.status !== 'joined') continue;
          const s = this.scrim.rows.find((x) => x.id === p.scrimId);
          if (!s || (notCancelled && s.status === 'cancelled')) continue;
          if (approvedOnly && !this.scrimResult.rows.some((r) => r.scrimId === s.id && r.status === 'approved')) continue;
          if (!inWindow(s.startedAt ?? s.scheduledAt, start, end)) continue;
          const set = by.get(p.userId) ?? new Set<string>();
          set.add(s.id);
          by.set(p.userId, set);
        }
        return [...by].map(([userId, set]) => ({ user_id: userId, scrim_count: set.size }));
      }
      case 'gcd:activity-games': {
        const [start, end, ...types] = v;
        const by = new Map<string, bigint>();
        for (const r of this.activityLog.rows) {
          if (!inWindow(r.startedAt, start, end) || !userOk(r.userId) || r.gameId === null || !types.includes(r.type)) continue;
          const k = `${r.userId}|${r.gameId}`;
          by.set(k, (by.get(k) ?? 0n) + BigInt(r.durationSec));
        }
        return [...by].map(([k, sec]) => {
          const [userId, gameId] = k.split('|');
          return { user_id: userId, game_id: gameId, sec };
        });
      }
      case 'gcd:active-members': {
        // 값 순서: start → end → 집계 type 목록(ACTIVITY_COUNTED_TYPES, D240)
        const [start, end, ...counted] = v;
        const ids = new Set(
          this.activityLog.rows
            .filter((r) => inWindow(r.startedAt, start, end) && userOk(r.userId) && counted.includes(r.type))
            .map((r) => r.userId),
        );
        return [{ count: ids.size }];
      }
      case 'gcd:playtime-rows':
      case 'gcd:playtime-top-apps': {
        const rows = holderRows();
        if (tag === 'gcd:playtime-rows') {
          return rows
            .filter((r) => r.sp.appId === v[1])
            .map(({ sp, ga }) => ({
              user_id: ga.userId,
              display_name: ga.displayName,
              minutes_total: sp.minutesTotal,
              minutes_recent: sp.minutesRecent,
              synced_at: sp.syncedAt,
              app_name: sp.appName,
            }));
        }
        return [...countByApp(rows)]
          .sort((a, b) => b[1] - a[1] || a[0] - b[0])
          .slice(0, Number(v[1]))
          .map(([appId, holders]) => ({ app_id: appId, holders }));
      }
      case 'gcd:steam-apps-owned': {
        // 값 순서: 스팀 코드 → (ILIKE 패턴) → LIMIT
        const rows = holderRows();
        const pattern = sql.includes('ILIKE') ? (v[1] as string) : null;
        const take = Number(v[v.length - 1]);
        const nameOf = (appId: number) =>
          rows
            .filter((r) => r.sp.appId === appId && r.sp.appName !== null && r.sp.appName !== '')
            .sort((a, b) => b.sp.syncedAt.getTime() - a.sp.syncedAt.getTime())[0]?.sp.appName ?? null;
        return [...countByApp(rows)]
          .map(([appId, count]) => ({ app_id: appId, owner_count: count, name: nameOf(appId) }))
          .filter((r) => r.name !== null && (pattern === null || likeToRegExp(pattern).test(r.name)))
          .sort((a, b) => b.owner_count - a.owner_count || a.app_id - b.app_id)
          .slice(0, take);
      }
      case 'gcd:steam-apps-owner-counts': {
        const ids = new Set(v.slice(1) as number[]);
        return [...countByApp(holderRows().filter((r) => ids.has(r.sp.appId)))].map(([appId, count]) => ({
          app_id: appId,
          owner_count: count,
        }));
      }
      default:
        return undefined;
    }
  }

  /** 테스트에서 호출 순서를 섞기 위한 지연(마이크로태스크 양보) */
  private async tick(): Promise<void> {
    await new Promise((r) => setImmediate(r));
  }

  user = {
    updateMany: async (args: { where?: Where; data: Partial<User> }): Promise<{ count: number }> => {
      await this.tick();
      let count = 0;
      for (const u of this.users) {
        if (!matchWhere(u as unknown as Row, args.where)) continue;
        for (const [k, val] of Object.entries(args.data)) {
          if (val !== undefined) (u as unknown as Record<string, unknown>)[k] = val;
        }
        u.updatedAt = new Date();
        count += 1;
      }
      return { count };
    },
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
        // S5 컬럼(architect가 typecheck용으로 추가. 동작은 backend가 채운다)
        leftAt: d.leftAt ?? null,
        guildMembershipAt: d.guildMembershipAt ?? null,
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
      if (d.discordId != null && this.users.some((u) => u.id !== row.id && u.discordId === d.discordId)) {
        throw uniqueError('discord_id');
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
