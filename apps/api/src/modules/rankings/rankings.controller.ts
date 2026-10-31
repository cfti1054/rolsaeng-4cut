import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  GetActivityRankingQuery,
  type GetActivityRankingResponse,
  GetEloRankingQuery,
  type GetEloRankingResponse,
  GetPlaytimeRankingQuery,
  type GetPlaytimeRankingResponse,
  GetTierRankingQuery,
  type GetTierRankingResponse,
} from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { RankingsReader } from './rankings-reader.service';

/** S4 티어·내전 ELO 랭킹(계약 S4 4절), S5 활동·플레이타임 랭킹(S5 4-1). 로그인 멤버 누구나 */
@Controller()
@UseGuards(JwtGuard)
export class RankingsController {
  constructor(private readonly reader: RankingsReader) {}

  /** GET /rankings/tier?game= → 200 GetTierRankingResponse */
  @Get(ApiPath.rankingsTier)
  tier(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GetTierRankingQuery)) query: GetTierRankingQuery,
  ): Promise<GetTierRankingResponse> {
    return this.reader.tier(user.id, query.game);
  }

  /** GET /rankings/elo?game=&season= → 200 GetEloRankingResponse */
  @Get(ApiPath.rankingsElo)
  elo(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GetEloRankingQuery)) query: GetEloRankingQuery,
  ): Promise<GetEloRankingResponse> {
    return this.reader.elo(user.id, query);
  }

  /** GET /rankings/activity?period= → 200 GetActivityRankingResponse */
  @Get(ApiPath.rankingsActivity)
  activity(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GetActivityRankingQuery)) query: GetActivityRankingQuery,
  ): Promise<GetActivityRankingResponse> {
    return this.reader.activity(query.period, user.id);
  }

  /** GET /rankings/playtime?app_id= → 200 GetPlaytimeRankingResponse */
  @Get(ApiPath.rankingsPlaytime)
  playtime(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GetPlaytimeRankingQuery)) query: GetPlaytimeRankingQuery,
  ): Promise<GetPlaytimeRankingResponse> {
    return this.reader.playtime(query.app_id, user.id);
  }
}
