import { Inject, Injectable, Logger } from '@nestjs/common';
import { activityPeriodWindow, computeWinRate, isRankingStale, latestStartedSeason, resolveSeasonAt } from '@gcd/core';
import {
  type ActivityPeriod,
  type ActivityRankingCachePayload,
  type EloRankingEntry,
  GetActivityRankingResponse,
  GetPlaytimeRankingResponse,
  type PlaytimeRankingCachePayload,
  type TierRankingEntry,
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
import {
  RankingCalculator,
  type RankingTarget,
  activityTarget,
  eloTarget,
  parseCachePayload,
  playtimeTarget,
  tierTarget,
} from './ranking-calculator.service';
import { eloRankingKey } from './ranking-keys';

type SeasonRow = Pick<Season, 'id' | 'startsAt' | 'closedAt'>;

/** 4-2 표 한 줄의 계산 결과. 대시보드 top_rankers가 같은 값을 쓴다 */
export type EloRankingView = {
  entries: EloRankingEntry[];
  isFinal: boolean;
  syncedAt: Date | null;
  stale: boolean;
};

/** 티어 캐시 읽기 결과(웹 GET /rankings/tier와 봇 GET /bot/rankings/tier가 같은 값을 쓴다, D215) */
export type TierRankingView = { entries: TierRankingEntry[]; syncedAt: Date; stale: boolean };

/** 웹 기본 규칙으로 고른 ELO 시즌과 그 출처. season이 null이거나 시작 전이면 view null */
export type EloDefaultView = { season: Season | null; view: EloRankingView | null };

export type ActivityRankingView = { payload: ActivityRankingCachePayload; syncedAt: Date; stale: boolean };

/** 플레이타임 캐시 값. 보유자가 없어도 빈 결과가 캐시에 저장되므로 항상 값이 있다(S5 7-2, D235) */
export type PlaytimeRankingView = {
  appId: number;
  cached: { payload: PlaytimeRankingCachePayload; syncedAt: Date; stale: boolean };
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

  /**
   * 캐시 행 읽기만. 없으면 null. 형식이 깨진 값도 없음으로 본다(로그).
   * accept가 false를 돌려주는 값(활동: 기간이 바뀐 payload, S5 7-1)도 없음으로 본다.
   */
  private async readValid(
    target: Pick<RankingTarget, 'key' | 'kind'>,
    accept: (payload: unknown) => boolean = () => true,
  ): Promise<RankingCacheRow | null> {
    const row = await this.store.read(target.key);
    if (!row) return null;
    const payload = parseCachePayload(target.kind, row.payload);
    if (payload === null) {
      this.log.warn(`랭킹 캐시 형식 불일치, 없음으로 취급: ${target.key}`);
      return null;
    }
    if (!accept(payload)) return null;
    return row;
  }

  /**
   * 7-3 읽기: 캐시 → 없으면 첫 계산(키별 단일 실행). 계산은 빈 결과도 저장하므로 항상 행이 있다(D235).
   * 첫 계산 실패는 INTERNAL_ERROR.
   */
  private async readOrCompute(
    target: RankingTarget,
    now: Date,
    accept?: (payload: unknown) => boolean,
  ): Promise<RankingCacheRow> {
    const row = await this.readValid(target, accept);
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

  /** 티어 캐시 값(웹·봇 공용) */
  async tierView(game: TierRankingGame): Promise<TierRankingView> {
    const now = this.clock.now();
    const row = await this.gameByCode(game);
    const cached = await this.readOrCompute(tierTarget({ id: row.id, code: game }), now);
    return {
      entries: parseCachePayload('tier', cached.payload)?.entries ?? [],
      syncedAt: cached.computedAt,
      stale: isRankingStale({ computedAt: cached.computedAt, lastFailedAt: cached.lastFailedAt, now }),
    };
  }

  /** GET /rankings/tier */
  async tier(viewerId: string, game: TierRankingGame): Promise<GetTierRankingResponse> {
    const view = await this.tierView(game);
    return GetTierRankingResponse.parse({
      items: view.entries.slice(0, RANKING_ITEMS_MAX),
      next_cursor: null,
      game,
      total: view.entries.length,
      me: view.entries.find((e) => e.user.id === viewerId) ?? null,
      synced_at: view.syncedAt.toISOString(),
      stale: view.stale,
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

  /** 웹 기본 규칙(season 생략): 현재 시즌, 없으면 가장 최근 시작 시즌. 봇 GET /bot/rankings/elo가 같은 규칙을 쓴다 */
  async eloDefaultView(gameCode: GameCode): Promise<EloDefaultView> {
    const now = this.clock.now();
    const game = await this.gameByCode(gameCode);
    const all = await this.seasons.all();
    const season = resolveSeasonAt(all, now) ?? latestStartedSeason(all, now);
    if (!season || season.startsAt.getTime() > now.getTime()) return { season, view: null };
    return { season, view: await this.eloView({ id: game.id, code: gameCode }, season, now) };
  }

  /** GET /rankings/elo */
  async elo(viewerId: string, q: GetEloRankingQuery): Promise<GetEloRankingResponse> {
    const now = this.clock.now();
    const game = await this.gameByCode(q.game);
    const base = { next_cursor: null, game: q.game, min_games: this.config.ranking.eloMinGames };
    let season: Season | null;
    let view: EloRankingView | null;
    if (q.season !== undefined) {
      season = await this.prisma.season.findUnique({ where: { id: q.season } });
      if (!season) throw new AppError('NOT_FOUND');
      view =
        season.startsAt.getTime() > now.getTime() ? null : await this.eloView({ id: game.id, code: q.game }, season, now);
    } else {
      ({ season, view } = await this.eloDefaultView(q.game));
    }
    if (!season || !view) {
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

  /**
   * 활동 캐시 값(S5 7-1). payload의 period_start가 지금 기간 시작과 다르면 캐시 없음으로 보고 동기 계산한다
   * (기간이 바뀐 직후 지난 기간 순위를 이번 기간처럼 보이지 않는다, D216). 그 계산이 실패하면 500.
   */
  async activityView(period: ActivityPeriod): Promise<ActivityRankingView> {
    const now = this.clock.now();
    const startMs = activityPeriodWindow(period, now).start.getTime();
    const accept = (p: unknown) => Date.parse((p as ActivityRankingCachePayload).period_start) === startMs;
    const cached = await this.readOrCompute(activityTarget(period), now, accept);
    const payload = parseCachePayload('activity', cached.payload);
    if (!payload) throw new AppError('INTERNAL_ERROR', undefined, { message: `활동 랭킹 캐시 없음: ${period}` });
    return {
      payload,
      syncedAt: cached.computedAt,
      stale: isRankingStale({ computedAt: cached.computedAt, lastFailedAt: cached.lastFailedAt, now }),
    };
  }

  /** GET /rankings/activity */
  async activity(period: ActivityPeriod, viewerId: string | null): Promise<GetActivityRankingResponse> {
    const { payload, syncedAt, stale } = await this.activityView(period);
    const { entries, ...meta } = payload;
    return GetActivityRankingResponse.parse({
      ...meta,
      items: entries.slice(0, RANKING_ITEMS_MAX),
      next_cursor: null,
      total: entries.length,
      me: viewerId === null ? null : (entries.find((e) => e.user.id === viewerId) ?? null),
      synced_at: syncedAt.toISOString(),
      stale,
    });
  }

  /**
   * 플레이타임 캐시 값(S5 7-2). 보유자가 없어도 빈 결과 캐시를 읽는다(D235, 5분 안 재계산 없음).
   * 캐시 없음 = 첫 계산 실패 → INTERNAL_ERROR(다른 kind와 같다)
   */
  async playtimeView(appId: number): Promise<PlaytimeRankingView> {
    const now = this.clock.now();
    const cached = await this.readOrCompute(playtimeTarget(appId), now);
    const payload = parseCachePayload('playtime', cached.payload);
    if (!payload) throw new AppError('INTERNAL_ERROR', undefined, { message: `플레이타임 랭킹 캐시 없음: ${appId}` });
    return {
      appId,
      cached: {
        payload,
        syncedAt: cached.computedAt,
        stale: isRankingStale({ computedAt: cached.computedAt, lastFailedAt: cached.lastFailedAt, now }),
      },
    };
  }

  /** GET /rankings/playtime */
  async playtime(appId: number, viewerId: string | null): Promise<GetPlaytimeRankingResponse> {
    const { cached } = await this.playtimeView(appId);
    const { entries, app, playtime_synced_at } = cached.payload;
    return GetPlaytimeRankingResponse.parse({
      items: entries.slice(0, RANKING_ITEMS_MAX),
      next_cursor: null,
      app,
      total: entries.length,
      me: viewerId === null ? null : (entries.find((e) => e.user.id === viewerId) ?? null),
      synced_at: cached.syncedAt.toISOString(),
      stale: cached.stale,
      playtime_synced_at,
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
