import { Inject, Injectable } from '@nestjs/common';
import { computeWinRate, latestStartedSeason, resolveSeasonAt } from '@gcd/core';
import {
  GetUserRatingHistoryResponse,
  type GetUserRatingHistoryQuery,
  RATING_HISTORY_POINTS_MAX,
  type RatingSummary,
} from '@gcd/shared';
import type { Rating } from '@prisma/client';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { SeasonsService, seasonRef } from './seasons.service';

export function ratingSummary(r: Pick<Rating, 'elo' | 'wins' | 'losses'>): RatingSummary {
  return { elo: r.elo, wins: r.wins, losses: r.losses, games: r.wins + r.losses, win_rate: computeWinRate(r.wins, r.losses) };
}

/**
 * GET /users/:id/rating-history(계약 S3 4-1 마지막, D118). 그래프 데이터셋: 최근 100점을 오래된 순으로.
 * season 생략 → resolveSeasonAt(now) → latestStartedSeason(now) → 없으면 빈 응답. 없는 season id → NOT_FOUND.
 */
@Injectable()
export class RatingHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seasons: SeasonsService,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async get(userId: string, q: GetUserRatingHistoryQuery): Promise<GetUserRatingHistoryResponse> {
    const now = this.clock.now();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('NOT_FOUND');
    const game = await this.prisma.game.findUnique({ where: { code: q.game } });
    if (!game) throw new AppError('INTERNAL_ERROR', undefined, { message: `games 시드 없음: ${q.game}` });

    let season;
    if (q.season !== undefined) {
      season = await this.prisma.season.findUnique({ where: { id: q.season } });
      if (!season) throw new AppError('NOT_FOUND');
    } else {
      const all = await this.seasons.all();
      season = resolveSeasonAt(all, now) ?? latestStartedSeason(all, now);
    }
    if (!season) {
      return GetUserRatingHistoryResponse.parse({ game: q.game, season: null, rating: null, points: [], truncated: false });
    }

    const rows = await this.prisma.ratingHistory.findMany({
      where: { userId, gameId: game.id, seasonId: season.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RATING_HISTORY_POINTS_MAX + 1,
    });
    const truncated = rows.length > RATING_HISTORY_POINTS_MAX;
    const points = rows.slice(0, RATING_HISTORY_POINTS_MAX).reverse();
    const scrims = points.length
      ? await this.prisma.scrim.findMany({ where: { id: { in: [...new Set(points.map((p) => p.scrimId))] } } })
      : [];
    const titles = new Map(scrims.map((s) => [s.id, s.title]));
    const rating = await this.prisma.rating.findFirst({ where: { userId, gameId: game.id, seasonId: season.id } });

    return GetUserRatingHistoryResponse.parse({
      game: q.game,
      season: seasonRef(season),
      rating: rating ? ratingSummary(rating) : null,
      points: points.map((p) => ({
        scrim_id: p.scrimId,
        scrim_title: titles.get(p.scrimId) ?? '',
        at: p.createdAt.toISOString(),
        elo_before: p.eloBefore,
        elo_after: p.eloAfter,
        delta: p.eloAfter - p.eloBefore,
      })),
      truncated,
    });
  }
}
