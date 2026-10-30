import { Inject, Injectable } from '@nestjs/common';
import { computeSkill, resolveSeasonAt, tierSeedRating } from '@gcd/core';
import type { Game, Prisma, Season } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { loadTierSeeds } from './rating-seed';

type Db = Pick<Prisma.TransactionClient, 'season' | 'rating' | 'ratingHistory' | 'gameAccount' | 'rankSnapshot'>;

/** 참가자 1명의 실력값 입력과 결과(계약 S3 4-1 players[].skill, 5-2 4번) */
export type SkillInput = {
  userId: string;
  /** 현재 시즌 ratings.elo(행·시즌 없으면 null) */
  seasonElo: number | null;
  /** (user, game) rating_history 수(모든 시즌, D106) */
  gamesPlayed: number;
  tierSeed: number;
  /** core computeSkill */
  skill: number;
  /** seasonElo ?? tierSeed */
  rating: number;
  /** gamesPlayed < SCRIM_ELO_NEW_PLAYER_GAMES */
  isNew: boolean;
};

/** (user, game) rating_history 수를 한 번에(groupBy 1회) */
export async function countRatedGames(
  db: Pick<Prisma.TransactionClient, 'ratingHistory'>,
  gameId: string,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>(userIds.map((id) => [id, 0]));
  if (userIds.length === 0) return out;
  const rows = await db.ratingHistory.groupBy({
    by: ['userId'],
    where: { userId: { in: [...userIds] }, gameId },
    _count: { _all: true },
  });
  for (const r of rows) out.set(r.userId, r._count._all);
  return out;
}

/**
 * 상세 skill·is_new, 밸런스 입력 공용(계약 S3 10절 「참가자 skill 입력 모으기」).
 * 시즌 1회 + ratings 1회 + 이력 수 1회 + 시드(계정 1회 + 스냅샷 1회). 시즌을 만들지 않는다.
 */
@Injectable()
export class RatingInputsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async forUsers(
    game: Pick<Game, 'id' | 'code'>,
    userIds: readonly string[],
    now: Date,
    db: Db = this.prisma,
  ): Promise<Map<string, SkillInput>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, SkillInput>();
    if (ids.length === 0) return out;
    const season: Season | null = resolveSeasonAt(await db.season.findMany(), now);
    const ratings = season
      ? await db.rating.findMany({ where: { userId: { in: ids }, gameId: game.id, seasonId: season.id } })
      : [];
    const eloByUser = new Map(ratings.map((r) => [r.userId, r.elo]));
    const games = await countRatedGames(db, game.id, ids);
    const seeds = await loadTierSeeds(db, game, ids);
    for (const userId of ids) {
      const seasonElo = eloByUser.get(userId) ?? null;
      const gamesPlayed = games.get(userId) ?? 0;
      const tierSeed = seeds.get(userId) ?? tierSeedRating(null);
      out.set(userId, {
        userId,
        seasonElo,
        gamesPlayed,
        tierSeed,
        skill: computeSkill({ seasonElo, gamesPlayed, tierSeed }),
        rating: seasonElo ?? tierSeed,
        isNew: gamesPlayed < this.config.rating.newPlayerGames,
      });
    }
    return out;
  }
}
