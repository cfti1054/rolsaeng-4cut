import { Inject, Injectable, Logger } from '@nestjs/common';
import { computeWinRate, isRankingStale, latestStartedSeason, resolveSeasonAt } from '@gcd/core';
import {
  type EloRankingEntry,
  type GameCode,
  type GetEloRankingQuery,
  GetEloRankingResponse,
  GetTierRankingResponse,
  RANKING_ITEMS_MAX,
  type TierRankingGame,
} from '@gcd/shared';
import type { Game, Season } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SeasonsService, seasonRef } from '../ratings/seasons.service';
import { discordAvatarUrl } from '../users/me.mapper';
import { RANKING_CACHE_STORE, type RankingCacheRow, type RankingCacheStore } from './ranking-cache.store';
import { RankingCalculator, type RankingTarget, eloTarget, parseCachePayload, tierTarget } from './ranking-calculator.service';
import { eloRankingKey } from './ranking-keys';

type SeasonRow = Pick<Season, 'id' | 'startsAt' | 'closedAt'>;

/** 4-2 표 한 줄의 계산 결과. 대시보드 top_rankers가 같은 값을 쓴다 */
export type EloRankingView = {
  entries: EloRankingEntry[];
  isFinal: boolean;
  syncedAt: Date | null;
  stale: boolean;
};

/**
 * 랭킹 읽기(계약 S4 7-3, 4-1, 4-2). 값이 있으면 오래됐어도 다시 계산하지 않는다(D148).
 * 첫 계산은 빈 캐시일 때만, 인스턴스 안에서 키별 단일 실행. 실패는 INTERNAL_ERROR.
 */
@Injectable()
export class RankingsReader {
  private readonly log = new Logger('RankingsReader');
  private readonly inflight = new Map<string, Promise<RankingCacheRow>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonsService,
    private readonly calculator: RankingCalculator,
    @Inject(RANKING_CACHE_STORE) private readonly store: RankingCacheStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  private async gameByCode(code: GameCode): Promise<Game> {
    const game = await this.prisma.game.findUnique({ where: { code } });
    if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: `games 시드 없음: ${code}` });
    return game;
  }

  /** 캐시 행 읽기만. 없으면 null. 형식이 깨진 값도 없음으로 본다(로그) */
  private async readValid(target: Pick<RankingTarget, 'key' | 'kind'>): Promise<RankingCacheRow | null> {
    const row = await this.store.read(target.key);
    if (!row) return null;
    if (parseCachePayload(target.kind, row.payload) === null) {
      this.log.warn(`랭킹 캐시 형식 불일치, 없음으로 취급: ${target.key}`);
      return null;
    }
    return row;
  }

  /** 7-3 읽기: 캐시 → 없으면 첫 계산(키별 단일 실행) */
  private async readOrCompute(target: RankingTarget, now: Date): Promise<RankingCacheRow> {
    const row = await this.readValid(target);
    if (row) return row;
    const running = this.inflight.get(target.key);
    if (running) return running;
    const started = this.calculator
      .computeAndStore(target, now)
      .catch((err: unknown) => {
        this.log.error(`랭킹 첫 계산 실패 ${target.key}: ${err instanceof Error ? err.message : 'unknown'}`);
        throw new AppError('INTERNAL_ERROR', undefined, { cause: err });
      })
      .finally(() => this.inflight.delete(target.key));
    this.inflight.set(target.key, started);
    return started;
  }

  /** GET /rankings/tier */
  async tier(viewerId: string, game: TierRankingGame): Promise<GetTierRankingResponse> {
    const now = this.clock.now();
    const row = await this.gameByCode(game);
    const cached = await this.readOrCompute(tierTarget({ id: row.id, code: game }), now);
    const entries = parseCachePayload('tier', cached.payload)?.entries ?? [];
    return GetTierRankingResponse.parse({
      items: entries.slice(0, RANKING_ITEMS_MAX),
      next_cursor: null,
      game,
      total: entries.length,
      me: entries.find((e) => e.user.id === viewerId) ?? null,
      synced_at: cached.computedAt.toISOString(),
      stale: isRankingStale({ computedAt: cached.computedAt, lastFailedAt: cached.lastFailedAt, now }),
    });
  }

  /** 4-2 표의 출처 선택. season은 시작한 시즌만(시작 전·null은 호출자가 거른다) */
  async eloView(game: Pick<Game, 'id'> & { code: GameCode }, season: SeasonRow, now: Date): Promise<EloRankingView> {
    if (season.closedAt !== null) {
      return { entries: await this.standings(game.id, season.id), isFinal: true, syncedAt: season.closedAt, stale: false };
    }
    const cached = await this.readOrCompute(eloTarget(game, season.id), now);
    return {
      entries: parseCachePayload('elo', cached.payload)?.entries ?? [],
      isFinal: false,
      syncedAt: cached.computedAt,
      stale: isRankingStale({ computedAt: cached.computedAt, lastFailedAt: cached.lastFailedAt, now }),
    };
  }

  /** 닫힌 시즌 최종 순위. 탈퇴로 빠진 행의 순위는 다시 매기지 않는다(4-2) */
  private async standings(gameId: string, seasonId: string): Promise<EloRankingEntry[]> {
    const rows = await this.prisma.seasonStanding.findMany({
      where: { gameId, seasonId },
      orderBy: [{ rank: 'asc' }],
    });
    if (rows.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, nickname: true, discordId: true, discordAvatar: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.flatMap((r) => {
      const u = byId.get(r.userId);
      if (!u) return [];
      return [
        {
          rank: r.rank,
          user: { id: u.id, nickname: u.nickname, avatar_url: discordAvatarUrl(u.discordId, u.discordAvatar) },
          elo: r.elo,
          wins: r.wins,
          losses: r.losses,
          games: r.wins + r.losses,
          win_rate: computeWinRate(r.wins, r.losses) as number,
          rank_change: null,
        },
      ];
    });
  }

  /** GET /rankings/elo */
  async elo(viewerId: string, q: GetEloRankingQuery): Promise<GetEloRankingResponse> {
    const now = this.clock.now();
    const game = await this.gameByCode(q.game);
    const base = { next_cursor: null, game: q.game, min_games: this.config.ranking.eloMinGames };
    let season: Season | null;
    if (q.season !== undefined) {
      season = await this.prisma.season.findUnique({ where: { id: q.season } });
      if (!season) throw new AppError('NOT_FOUND');
    } else {
      const all = await this.seasons.all();
      season = resolveSeasonAt(all, now) ?? latestStartedSeason(all, now);
    }
    if (!season || season.startsAt.getTime() > now.getTime()) {
      return GetEloRankingResponse.parse({
        ...base,
        items: [],
        season: season ? seasonRef(season) : null,
        is_final: false,
        total: 0,
        me: null,
        synced_at: null,
        stale: false,
      });
    }
    const view = await this.eloView({ id: game.id, code: q.game }, season, now);
    return GetEloRankingResponse.parse({
      ...base,
      items: view.entries.slice(0, RANKING_ITEMS_MAX),
      season: seasonRef(season),
      is_final: view.isFinal,
      total: view.entries.length,
      me: view.entries.find((e) => e.user.id === viewerId) ?? null,
      synced_at: view.syncedAt?.toISOString() ?? null,
      stale: view.stale,
    });
  }

  /** 캐시에 있는 내 ELO 행. 읽기 전용: 프로필·사이드바 조회가 계산을 일으키지 않는다(D148) */
  async eloEntryOf(game: GameCode, seasonId: string, userId: string): Promise<EloRankingEntry | null> {
    const row = await this.readValid({ kind: 'elo', key: eloRankingKey(game, seasonId) });
    if (!row) return null;
    return parseCachePayload('elo', row.payload)?.entries.find((e) => e.user.id === userId) ?? null;
  }

  /** 프로필 ratings[].rank(4-4). 없으면 null */
  async eloRankOf(game: GameCode, seasonId: string, userId: string): Promise<number | null> {
    return (await this.eloEntryOf(game, seasonId, userId))?.rank ?? null;
  }
}
