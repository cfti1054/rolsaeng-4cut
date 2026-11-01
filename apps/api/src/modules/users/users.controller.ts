import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiPath,
  type GetMeResponse,
  type GetMyNotificationSettingsResponse,
  UpdateMeRequest,
  type UpdateMeResponse,
  UpdateMyNotificationSettingsRequest,
  type UpdateMyNotificationSettingsResponse,
} from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { UsersService } from './users.service';

@Controller()
@UseGuards(JwtGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** GET /me → 200 GetMeResponse */
  @Get(ApiPath.me)
  getMe(@CurrentUser() user: AuthUser): Promise<GetMeResponse> {
    return this.users.getMe(user.id);
  }

  /** PATCH /me { nickname } → 200 UpdateMeResponse */
  @Patch(ApiPath.me)
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateMeRequest)) body: UpdateMeRequest,
  ): Promise<UpdateMeResponse> {
    return this.users.updateMe(user.id, body);
  }

  /** S6 GET /me/notification-settings → 200 GetMyNotificationSettingsResponse(계약 S6 9절) */
  @Get(ApiPath.myNotificationSettings)
  getNotificationSettings(@CurrentUser() user: AuthUser): Promise<GetMyNotificationSettingsResponse> {
    return this.users.getNotificationSettings(user.id);
  }

  /** S6 PATCH /me/notification-settings → 200 UpdateMyNotificationSettingsResponse. 보낸 항목만 바꾼다 */
  @Patch(ApiPath.myNotificationSettings)
  updateNotificationSettings(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateMyNotificationSettingsRequest)) body: UpdateMyNotificationSettingsRequest,
  ): Promise<UpdateMyNotificationSettingsResponse> {
    return this.users.updateNotificationSettings(user.id, body);
  }
}
