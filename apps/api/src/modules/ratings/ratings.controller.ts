import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  GetUserRatingHistoryParams,
  GetUserRatingHistoryQuery,
  type GetUserRatingHistoryResponse,
  type ListSeasonsResponse,
} from '@gcd/shared';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { RatingHistoryService } from './rating-history.service';
import { SeasonsService } from './seasons.service';

/** S3 시즌 목록·레이팅 그래프(계약 S3 4절). 로그인 멤버 누구나 */
@Controller()
@UseGuards(JwtGuard)
export class RatingsController {
  constructor(
    private readonly seasons: SeasonsService,
    private readonly history: RatingHistoryService,
  ) {}

  /** GET /seasons → 200 ListSeasonsResponse(next_cursor 항상 null, D120) */
  @Get(ApiPath.seasons)
  listSeasons(): Promise<ListSeasonsResponse> {
    return this.seasons.list();
  }

  /** GET /users/:id/rating-history?game=&season= → 200 GetUserRatingHistoryResponse(D118) */
  @Get(ApiPath.userRatingHistory)
  ratingHistory(
    @Param(new ZodValidationPipe(GetUserRatingHistoryParams)) params: GetUserRatingHistoryParams,
    @Query(new ZodValidationPipe(GetUserRatingHistoryQuery)) query: GetUserRatingHistoryQuery,
  ): Promise<GetUserRatingHistoryResponse> {
    return this.history.get(params.id, query);
  }
}
