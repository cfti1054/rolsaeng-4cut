import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CalendarModule } from '../calendar/calendar.module';
import { RankingsModule } from '../rankings/rankings.module';
import { ScrimsModule } from '../scrims/scrims.module';
import { AdminApiKeysService } from './admin-api-keys.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';
import { AdminMembersService } from './admin-members.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminReviewService } from './admin-review.service';
import { AdminSeasonsService } from './admin-seasons.service';

/**
 * S6 관리자 도구(계약 S6 4-2, 12절). 랭킹 캐시 요약은 RankingsModule의 RANKING_CACHE_STORE, 내전 직렬화·노쇼 정책은 ScrimsModule.
 * ScrimsModule.forRoot()은 AppModule과 같은 객체(인스턴스·cron 중복 없음). 「다가오는 일정」은 CalendarModule의 CalendarService(23-8-4).
 */
@Module({
  imports: [RankingsModule, ScrimsModule.forRoot(), CalendarModule],
  controllers: [AdminController],
  providers: [
    JwtGuard,
    RolesGuard,
    AdminOverviewService,
    AdminReviewService,
    AdminMembersService,
    AdminApiKeysService,
    AdminSeasonsService,
    AdminAuditService,
  ],
})
export class AdminModule {}
