import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RankingsModule } from '../rankings/rankings.module';
import { RatingsModule } from '../ratings/ratings.module';
import { ScrimsModule } from '../scrims/scrims.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * S4 홈 요약. ScrimsModule.forRoot()은 같은 구성이면 같은 객체를 돌려주므로 AppModule의 import와 한 인스턴스다(cron 중복 없음).
 */
@Module({
  imports: [RankingsModule, RatingsModule, ScrimsModule.forRoot()],
  controllers: [DashboardController],
  providers: [DashboardService, JwtGuard],
})
export class DashboardModule {}
