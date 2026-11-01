import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  GetMyPositionSuggestionsQuery,
  type GetMyPositionSuggestionsResponse,
  type GetUserProfileResponse,
  IdParam,
} from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { PositionSuggestions } from './position-suggestions.service';
import { ProfileService } from './profile.service';

@Controller()
@UseGuards(JwtGuard)
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly suggestions: PositionSuggestions,
  ) {}

  /** GET /users/:id/profile → 200 GetUserProfileResponse (로그인 멤버 누구나) */
  @Get(ApiPath.userProfile)
  get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IdParam)) params: IdParam,
  ): Promise<GetUserProfileResponse> {
    return this.profile.getProfile(user.id, params.id);
  }

  /** GET /me/position-suggestions?game= → 200 GetMyPositionSuggestionsResponse (요청자 본인 것만, 계약 20-5) */
  @Get(ApiPath.myPositionSuggestions)
  positionSuggestions(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GetMyPositionSuggestionsQuery)) query: GetMyPositionSuggestionsQuery,
  ): Promise<GetMyPositionSuggestionsResponse> {
    return this.suggestions.forUser(user.id, query.game);
  }
}
