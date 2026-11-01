import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiPath, type GetDashboardSummaryResponse } from '@gcd/shared';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { DashboardService } from './dashboard.service';

/** S4 홈 요약(계약 S4 4-3, 8절). 로그인 멤버 누구나 */
@Controller()
@UseGuards(JwtGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** GET /dashboard/summary → 200 GetDashboardSummaryResponse */
  @Get(ApiPath.dashboardSummary)
  summary(@CurrentUser() user: AuthUser): Promise<GetDashboardSummaryResponse> {
    return this.dashboard.summary(user);
  }
}
