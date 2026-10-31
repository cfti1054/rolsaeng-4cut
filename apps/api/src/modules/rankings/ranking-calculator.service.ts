import { Inject, Injectable } from '@nestjs/common';
import {
  buildEloRanking,
  buildTierRanking,
  computeRankChange,
  kstWeekWindow,
  rollRankBaseline,
} from '@gcd/core';
import {
  EloRankingCachePayload,
  type GameCode,
  type RankValue,
  RankValue as RankValueSchema,
  RankingBaselineRanks,
  type ScrimUserRef,
  TierRankingCachePayload,
  type TierRankingGame,
} from '@gcd/shared';
import type { Game } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { rankedQueueOf } from '../ratings/rating-seed';
import { discordAvatarUrl } from '../users/me.mapper';
import { RANKING_CACHE_STORE, type RankingCacheRow, type RankingCacheStore } from './ranking-cache.store';
import { eloRankingKey, tierRankingKey } from './ranking-keys';
import { rankableUserWhere } from './rankable-users';

/** 계산 대상 1개(계약 S4 7-1 표의 한 줄) */
export type RankingTarget =
  | { kind: 'tier'; key: string; game: Pick<Game, 'id'> & { code: TierRankingGame } }
  | { kind: 'elo'; key: string; game: Pick<Game, 'id'> & { code: GameCode }; seasonId: string };

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

type RankedEntry = { rank: number; user: ScrimUserRef };

/** 저장 JSON → entries. 형식이 맞지 않으면 null(배포로 필드가 바뀐 경우 = 캐시 없음 취급, shared rankings.ts) */
export function parseCachePayload(kind: 'tier', payload: unknown): TierRankingCachePayload | null;
export function parseCachePayload(kind: 'elo', payload: unknown): EloRankingCachePayload | null;
export function parseCachePayload(
  kind: RankingTarget['kind'],
  payload: unknown,
): TierRankingCachePayload | EloRankingCachePayload | null;
export function parseCachePayload(
  kind: RankingTarget['kind'],
  payload: unknown,
): TierRankingCachePayload | EloRankingCachePayload | null {
  const r = kind === 'tier' ? TierRankingCachePayload.safeParse(payload) : EloRankingCachePayload.safeParse(payload);
  return r.success ? r.data : null;
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

  async computeAndStore(target: RankingTarget, now: Date): Promise<RankingCacheRow> {
    const entries = target.kind === 'tier' ? await this.tierEntries(target.game) : await this.eloEntries(target.game, target.seasonId);
    const prior = await this.store.read(target.key);
    const { previousRanks, stored } = priorRanks(target, prior);
    const baseline = rollRankBaseline({ stored, previousRanks, weekStart: kstWeekWindow(now).start });
    const withChange = entries.map((e) => ({ ...e, rank_change: computeRankChange(baseline.ranks[e.user.id], e.rank) }));
    const payload =
      target.kind === 'tier'
        ? TierRankingCachePayload.parse({ entries: withChange })
        : EloRankingCachePayload.parse({ entries: withChange });
    const row = { payload, computedAt: now, baselinePeriodStart: baseline.periodStart, baselineRanks: baseline.ranks };
    await this.store.write(target.key, row);
    return { ...row, lastFailedAt: null };
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
}
