import { Inject, Injectable } from '@nestjs/common';
import {
  activityPeriodWindow,
  buildActivityRanking,
  buildEloRanking,
  buildPlaytimeRanking,
  buildTierRanking,
  computeRankChange,
  formatKstMidnight,
  kstWeekWindow,
  pickMainGames,
  rollRankBaseline,
} from '@gcd/core';
import {
  ACTIVITY_COUNTED_TYPES,
  ACTIVITY_RANKED_TYPES,
  type ActivityGameRef,
  type ActivityPeriod,
  ActivityRankingCachePayload,
  EloRankingCachePayload,
  GameCode,
  PlaytimeRankingCachePayload,
  type RankValue,
  RankValue as RankValueSchema,
  RankingBaselineRanks,
  type ScrimUserRef,
  TierRankingCachePayload,
  type TierRankingGame,
} from '@gcd/shared';
import { type Game, Prisma } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { rankedQueueOf } from '../ratings/rating-seed';
import { discordAvatarUrl } from '../users/me.mapper';
import { RANKING_CACHE_STORE, type RankingCacheRow, type RankingCacheStore } from './ranking-cache.store';
import { activityRankingKey, eloRankingKey, playtimeRankingKey, tierRankingKey } from './ranking-keys';
import { playtimeHolderWhereSql, playtimeHoldersFromSql } from './playtime-holders';
import { rankableUserSql, rankableUserWhere } from './rankable-users';

/** 계산 대상 1개(계약 S4 7-1 표의 한 줄, S5 7절 활동·플레이타임) */
export type RankingTarget =
  | { kind: 'tier'; key: string; game: Pick<Game, 'id'> & { code: TierRankingGame } }
  | { kind: 'elo'; key: string; game: Pick<Game, 'id'> & { code: GameCode }; seasonId: string }
  | { kind: 'activity'; key: string; period: ActivityPeriod }
  | { kind: 'playtime'; key: string; appId: number };

export type RankingKind = RankingTarget['kind'];

export const tierTarget = (game: Pick<Game, 'id'> & { code: TierRankingGame }): RankingTarget => ({
  kind: 'tier',
  key: tierRankingKey(game.code),
  game,
});

export const eloTarget = (game: Pick<Game, 'id'> & { code: GameCode }, seasonId: string): RankingTarget => ({
  kind: 'elo',
  key: eloRankingKey(game.code, seasonId),
  game,
  seasonId,
});

export const activityTarget = (period: ActivityPeriod): RankingTarget => ({
  kind: 'activity',
  key: activityRankingKey(period),
  period,
});

export const playtimeTarget = (appId: number): RankingTarget => ({
  kind: 'playtime',
  key: playtimeRankingKey(appId),
  appId,
});

export { STEAM_GAME_CODE } from './playtime-holders';

type PayloadByKind = {
  tier: TierRankingCachePayload;
  elo: EloRankingCachePayload;
  activity: ActivityRankingCachePayload;
  playtime: PlaytimeRankingCachePayload;
};

const PAYLOAD_SCHEMA = {
  tier: TierRankingCachePayload,
  elo: EloRankingCachePayload,
  activity: ActivityRankingCachePayload,
  playtime: PlaytimeRankingCachePayload,
} as const;

type RankedEntry = { rank: number; user: ScrimUserRef };

/** 저장 JSON → payload. 형식이 맞지 않으면 null(배포로 필드가 바뀐 경우 = 캐시 없음 취급, shared rankings.ts) */
export function parseCachePayload<K extends RankingKind>(kind: K, payload: unknown): PayloadByKind[K] | null {
  const r = PAYLOAD_SCHEMA[kind].safeParse(payload);
  return r.success ? (r.data as PayloadByKind[K]) : null;
}

/** 저장 값 → 이전 순위·기준(7-2 2·3번 입력). 읽을 수 없으면 null(rollRankBaseline의 「자료 없음」) */
function priorRanks(target: RankingTarget, prior: RankingCacheRow | null) {
  const payload = prior ? parseCachePayload(target.kind, prior.payload) : null;
  const entries: readonly RankedEntry[] | null = payload ? payload.entries : null;
  const previousRanks = entries ? Object.fromEntries(entries.map((e) => [e.user.id, e.rank])) : null;
  const ranks = prior ? RankingBaselineRanks.safeParse(prior.baselineRanks) : null;
  const stored = prior && ranks?.success ? { periodStart: prior.baselinePeriodStart, ranks: ranks.data } : null;
  return { previousRanks, stored };
}

/** 원시 SQL 집계값(bigint·numeric·number) → number */
function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  return Number(v ?? 0);
}

/**
 * 랭킹 계산과 캐시 저장(계약 S4 7-2). 순위·점수는 core만 계산한다.
 * 캐시 entries는 모든 사용자에게 같은 공용 목록이다. 요청자별 값(me)은 RankingsReader가 응답 때 찾는다(D150).
 */
@Injectable()
export class RankingCalculator {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RANKING_CACHE_STORE) private readonly store: RankingCacheStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 계산 → 순위 변동 → 저장. 결과가 비어 있어도(플레이타임 보유자 0명 포함) 저장한다(S5 7-2, D235).
   * 순위 변동 기준 시작값: 티어·ELO·플레이타임 = 이번 KST 주(D153), 활동 = 그 기간 시작(D216).
   */
  async computeAndStore(target: RankingTarget, now: Date): Promise<RankingCacheRow> {
    const built = await this.build(target, now);
    const prior = await this.store.read(target.key);
    const { previousRanks, stored } = priorRanks(target, prior);
    const baseline = rollRankBaseline({ stored, previousRanks, weekStart: built.baselineStart });
    const withChange = built.entries.map((e) => ({ ...e, rank_change: computeRankChange(baseline.ranks[e.user.id], e.rank) }));
    const payload = PAYLOAD_SCHEMA[target.kind].parse({ ...built.meta, entries: withChange });
    const row = { payload, computedAt: now, baselinePeriodStart: baseline.periodStart, baselineRanks: baseline.ranks };
    await this.store.write(target.key, row);
    return { ...row, lastFailedAt: null };
  }

  private async build(
    target: RankingTarget,
    now: Date,
  ): Promise<{ entries: RankedEntry[]; meta: Record<string, unknown>; baselineStart: Date }> {
    const weekStart = kstWeekWindow(now).start;
    switch (target.kind) {
      case 'tier':
        return { entries: await this.tierEntries(target.game), meta: {}, baselineStart: weekStart };
      case 'elo':
        return { entries: await this.eloEntries(target.game, target.seasonId), meta: {}, baselineStart: weekStart };
      case 'activity': {
        const w = activityPeriodWindow(target.period, now);
        return {
          entries: await this.activityEntries(w),
          meta: {
            period: target.period,
            period_start: formatKstMidnight(w.start),
            period_end: formatKstMidnight(w.end),
            period_days: w.days,
            bot_connected: await this.botConnected(),
          },
          baselineStart: w.start,
        };
      }
      case 'playtime': {
        const built = await this.playtimeEntries(target.appId);
        return { entries: built.entries, meta: built.meta, baselineStart: weekStart };
      }
    }
  }

  /** D228: 봇이 활동 또는 접속 현황을 한 번이라도 보냈는가 */
  async botConnected(): Promise<boolean> {
    const log = await this.prisma.activityLog.findFirst({ select: { id: true } });
    if (log) return true;
    return (await this.prisma.botPresence.findFirst({ select: { id: true } })) !== null;
  }

  /** id 목록 → ScrimUserRef(공개 정보만, D38) */
  private async userRefs(ids: readonly string[]): Promise<Map<string, ScrimUserRef>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, nickname: true, discordId: true, discordAvatar: true },
    });
    return new Map(
      rows.map((u) => [u.id, { id: u.id, nickname: u.nickname, avatar_url: discordAvatarUrl(u.discordId, u.discordAvatar) }]),
    );
  }

  /**
   * 7-2 티어 entries. 대표(is_primary)·확인된 계정 + 그 큐 최신 스냅샷 1행. 스냅샷은 이력이 쌓이는 표라 DISTINCT ON으로 계정당 1행만 읽는다.
   * 형식 불량·UNRANKED는 제외한다.
   */
  private async tierEntries(game: Pick<Game, 'id'> & { code: TierRankingGame }) {
    const queue = rankedQueueOf(game);
    if (queue === null) return [];
    const accounts = await this.prisma.gameAccount.findMany({
      where: { gameId: game.id, isPrimary: true, verified: true, user: rankableUserWhere },
      select: { id: true, userId: true, displayName: true },
    });
    if (accounts.length === 0) return [];
    const snapshots = await this.prisma.$queryRaw<
      { game_account_id: string; tier: string; division: string | null; lp: number; wins: number; losses: number }[]
    >`
      SELECT DISTINCT ON (rs.game_account_id)
        rs.game_account_id::text AS game_account_id, rs.tier, rs.division, rs.lp, rs.wins, rs.losses
      FROM rank_snapshots rs
      JOIN game_accounts ga ON ga.id = rs.game_account_id
      WHERE ga.game_id = ${game.id}::uuid AND ga.is_primary AND ga.verified AND rs.queue = ${queue}
      ORDER BY rs.game_account_id, rs.captured_at DESC, rs.created_at DESC`;
    const rankByAccount = new Map<string, RankValue>();
    for (const s of snapshots) {
      const { game_account_id: id, ...value } = s;
      const parsed = RankValueSchema.safeParse(value);
      if (parsed.success) rankByAccount.set(id, parsed.data);
    }
    const users = await this.userRefs(accounts.map((a) => a.userId));
    const rows = accounts.flatMap((a) => {
      const rank = rankByAccount.get(a.id);
      const user = users.get(a.userId);
      return rank && user ? [{ ...rank, userId: a.userId, user, accountName: a.displayName }] : [];
    });
    return buildTierRanking(rows).map((r) => ({
      rank: r.rank,
      user: r.user,
      account_name: r.accountName,
      tier: r.tier,
      division: r.division,
      lp: r.lp,
      wins: r.wins,
      losses: r.losses,
      score: r.score,
    }));
  }

  /** 7-2 ELO entries. 노출 조건(최소 경기 수)은 core buildEloRanking */
  private async eloEntries(game: Pick<Game, 'id'>, seasonId: string) {
    const rows = await this.prisma.rating.findMany({
      where: { gameId: game.id, seasonId, user: rankableUserWhere },
      select: { userId: true, elo: true, wins: true, losses: true },
    });
    const ranked = buildEloRanking({ rows, minGames: this.config.ranking.eloMinGames });
    const users = await this.userRefs(ranked.map((r) => r.userId));
    return ranked.flatMap((r) => {
      const user = users.get(r.userId);
      return user
        ? [{ rank: r.rank, user, elo: r.elo, wins: r.wins, losses: r.losses, games: r.games, win_rate: r.winRate }]
        : [];
    });
  }

  /**
   * S5 7-1 활동 entries. 귀속은 started_at 하나(D212). 시간·주 게임 = ACTIVITY_RANKED_TYPES(음성만, D232),
   * 활동 일수는 ACTIVITY_COUNTED_TYPES(voice·chat, play 제외, D240)의 KST 날짜 수. 집계 행 자체를 COUNTED로 거른다
   * (RANKED ⊂ COUNTED라 voice_sec은 그대로이고, play만 한 회원은 voice 0이라 어차피 순위에 없다). SUM은 bigint라 Number로 바꾼다.
   * scrim_count(D239)는 참고 열: 순위가 정해진 뒤 순위에 든 회원만 세어 붙인다(정렬·포함 여부에 쓰지 않는다).
   */
  private async activityEntries(w: { start: Date; end: Date }) {
    const ranked = Prisma.join([...ACTIVITY_RANKED_TYPES]);
    const counted = Prisma.join([...ACTIVITY_COUNTED_TYPES]);
    const totals = await this.prisma.$queryRaw<{ user_id: string; voice_sec: unknown; active_days: unknown }[]>`
      /* gcd:activity-totals */
      SELECT al.user_id::text AS user_id,
        SUM(CASE WHEN al.type::text IN (${ranked}) THEN al.duration_sec ELSE 0 END) AS voice_sec,
        COUNT(DISTINCT (al.started_at AT TIME ZONE 'Asia/Seoul')::date)::int AS active_days
      FROM activity_logs al
      JOIN users u ON u.id = al.user_id AND ${rankableUserSql}
      WHERE al.started_at >= ${w.start} AND al.started_at < ${w.end}
        AND al.type::text IN (${counted})
      GROUP BY al.user_id`;
    if (totals.length === 0) return [];
    const perGame = await this.prisma.$queryRaw<{ user_id: string; game_id: string; sec: unknown }[]>`
      /* gcd:activity-games */
      SELECT al.user_id::text AS user_id, al.game_id::text AS game_id, SUM(al.duration_sec) AS sec
      FROM activity_logs al
      JOIN users u ON u.id = al.user_id AND ${rankableUserSql}
      WHERE al.started_at >= ${w.start} AND al.started_at < ${w.end}
        AND al.game_id IS NOT NULL AND al.type::text IN (${ranked})
      GROUP BY 1, 2`;
    const ranking = buildActivityRanking(
      totals.map((r) => ({ userId: r.user_id, voiceSec: num(r.voice_sec), activeDays: num(r.active_days) })),
    );
    if (ranking.length === 0) return [];
    const scrimCounts = await this.activityScrimCounts(
      w,
      ranking.map((r) => r.userId),
    );
    const games = await this.prisma.game.findMany();
    const gameById = new Map(games.map((g) => [g.id, g]));
    const gamesByUser = new Map<string, { gameId: string; sortOrder: number; sec: number }[]>();
    for (const g of perGame) {
      const game = gameById.get(g.game_id);
      if (!game) continue;
      const list = gamesByUser.get(g.user_id) ?? [];
      list.push({ gameId: g.game_id, sortOrder: game.sortOrder, sec: num(g.sec) });
      gamesByUser.set(g.user_id, list);
    }
    const users = await this.userRefs(ranking.map((r) => r.userId));
    return ranking.flatMap((r) => {
      const user = users.get(r.userId);
      if (!user) return [];
      const mainGames: ActivityGameRef[] = pickMainGames(gamesByUser.get(r.userId) ?? []).flatMap((m) => {
        const game = gameById.get(m.gameId);
        const code = GameCode.safeParse(game?.code);
        return game && code.success ? [{ code: code.data, name: game.name }] : [];
      });
      return [
        {
          rank: r.rank,
          user,
          total_sec: r.totalSec,
          voice_sec: r.voiceSec,
          active_days: r.activeDays,
          main_games: mainGames,
          scrim_count: scrimCounts.get(r.userId) ?? 0,
        },
      ];
    });
  }

  /**
   * S5 7-1 내전 참여 수(D239). 참가 확정(joined) + 승인된 결과가 있는 + 취소 아닌 내전,
   * 기간 귀속 = COALESCE(started_at, scheduled_at) ∈ [w.start, w.end). rated·게임은 따지지 않는다. 순위에 든 회원만 센다.
   */
  private async activityScrimCounts(w: { start: Date; end: Date }, userIds: readonly string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ user_id: string; scrim_count: unknown }[]>`
      /* gcd:activity-scrims */
      SELECT sp.user_id::text AS user_id, COUNT(DISTINCT s.id)::int AS scrim_count
      FROM scrim_players sp
      JOIN scrims s ON s.id = sp.scrim_id AND s.status <> 'cancelled'
      JOIN users u ON u.id = sp.user_id AND ${rankableUserSql}
      WHERE sp.status = 'joined'
        AND EXISTS (SELECT 1 FROM scrim_results r WHERE r.scrim_id = s.id AND r.status = 'approved')
        AND COALESCE(s.started_at, s.scheduled_at) >= ${w.start} AND COALESCE(s.started_at, s.scheduled_at) < ${w.end}
        AND sp.user_id IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY sp.user_id`;
    return new Map(rows.map((r) => [r.user_id, num(r.scrim_count)]));
  }

  /**
   * S5 7-2 플레이타임 entries. 보유자(playtime-holders.ts, D234)의 마지막 성공값(비공개로 바뀌어도 남는다, Q10).
   * 보유자가 없어도 빈 entries를 돌려주고 그대로 캐시에 저장한다(D235).
   */
  private async playtimeEntries(appId: number) {
    const rows = await this.prisma.$queryRaw<
      { user_id: string; display_name: string; minutes_total: unknown; minutes_recent: unknown; synced_at: Date; app_name: string | null }[]
    >`
      /* gcd:playtime-rows */
      SELECT ga.user_id::text AS user_id, ga.display_name, sp.minutes_total, sp.minutes_recent, sp.synced_at, sp.app_name
      FROM ${playtimeHoldersFromSql}
      WHERE ${playtimeHolderWhereSql} AND sp.app_id = ${appId}`;
    const byRecent = [...rows].sort((a, b) => b.synced_at.getTime() - a.synced_at.getTime());
    const name = byRecent.find((r) => r.app_name !== null && r.app_name.length > 0)?.app_name ?? null;
    const syncedAt = byRecent[0]?.synced_at ?? null;
    const ranking = buildPlaytimeRanking(
      rows.map((r) => ({
        userId: r.user_id,
        accountName: r.display_name,
        minutesTotal: num(r.minutes_total),
        minutesRecent: num(r.minutes_recent),
      })),
    );
    const users = await this.userRefs(ranking.map((r) => r.userId));
    const entries = ranking.flatMap((r) => {
      const user = users.get(r.userId);
      return user
        ? [{ rank: r.rank, user, account_name: r.accountName, minutes_total: r.minutesTotal, minutes_recent: r.minutesRecent }]
        : [];
    });
    return {
      entries,
      meta: { app: { app_id: appId, name }, playtime_synced_at: syncedAt ? syncedAt.toISOString() : null },
    };
  }

  /** 7절 갱신 대상 playtime app: 보유자(D234) 수 상위 RANKING_PLAYTIME_APPS_MAX(동점 app_id ASC) */
  async topPlaytimeApps(limit: number): Promise<number[]> {
    const rows = await this.prisma.$queryRaw<{ app_id: number; holders: unknown }[]>`
      /* gcd:playtime-top-apps */
      SELECT sp.app_id, COUNT(*)::int AS holders
      FROM ${playtimeHoldersFromSql}
      WHERE ${playtimeHolderWhereSql}
      GROUP BY sp.app_id
      ORDER BY holders DESC, sp.app_id ASC
      LIMIT ${limit}`;
    return rows.map((r) => num(r.app_id));
  }
}
