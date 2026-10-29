import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiPath, type GetUserProfileResponse, IdParam } from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { ProfileService } from './profile.service';

@Controller()
@UseGuards(JwtGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  /** GET /users/:id/profile → 200 GetUserProfileResponse (로그인 멤버 누구나) */
  @Get(ApiPath.userProfile)
  get(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(IdParam)) params: IdParam,
  ): Promise<GetUserProfileResponse> {
    return this.profile.getProfile(user.id, params.id);
  }
}
