import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  GetEloRankingQuery,
  type GetEloRankingResponse,
  GetTierRankingQuery,
  type GetTierRankingResponse,
} from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { RankingsReader } from './rankings-reader.service';

/** S4 티어·내전 ELO 랭킹(계약 S4 4절). 로그인 멤버 누구나 */
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
}
