import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiPath, GetCalendarQuery, type GetCalendarResponse } from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { CalendarService } from './calendar.service';

/** S6 후속 캘린더 읽기(계약 S6 23-2). 로그인 회원 전원(JWT 전용 — 봇 키는 401) */
@Controller()
@UseGuards(JwtGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  /** GET /calendar?month=&game= → 200 GetCalendarResponse */
  @Get(ApiPath.calendar)
  get(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(GetCalendarQuery)) q: GetCalendarQuery,
  ): Promise<GetCalendarResponse> {
    return this.calendar.get(user, q);
  }
}
