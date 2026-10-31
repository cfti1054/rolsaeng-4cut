import { type DynamicModule, Module } from '@nestjs/common';
import { sharedScheduleModule } from '../../common/shared-schedule';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { scrimJobsEnabledFromEnv } from '../../config/env';
import { GamesModule } from '../games/games.module';
import { RatingsModule } from '../ratings/ratings.module';
import { ScrimAutoCloseScheduler, ScrimAutoCloser } from './scrim-auto-close';
import { ScrimRestrictionService } from './scrim-restriction.service';
import { ScrimResultsService } from './scrim-results.service';
import { ScrimTeamsService } from './scrim-teams.service';
import { ScrimViews } from './scrim-views.service';
import { ScrimsController } from './scrims.controller';
import { ScrimsService } from './scrims.service';

/**
 * S2 내전(계약 S2 4·5절) + S3 팀 구성·결과·승인(계약 S3 5절, ScrimTeamsService·ScrimResultsService). 자동 마감 cron(ScrimAutoCloseScheduler)은 SCRIM_JOBS_ENABLED=true일 때만 등록한다(D96).
 * @Cron은 정적 데코레이터라 모듈 구성 시점(process.env)에 결정한다 — JobsModule.forRoot와 같은 방식.
 * 스케줄 모듈은 sharedScheduleModule 하나를 공유한다.
 * Nest 11은 동적 모듈을 참조로 구분하므로 forRoot()는 구성(jobs 여부)마다 같은 객체를 돌려준다. DashboardModule이 ScrimViews 때문에
 * 다시 import해도 인스턴스와 자동 마감 cron이 늘지 않는다.
 */
const forRootCache = new Map<boolean, DynamicModule>();

@Module({ imports: [GamesModule, RatingsModule] })
export class ScrimsModule {
  static forRoot(env: Record<string, string | undefined> = process.env): DynamicModule {
    const jobs = scrimJobsEnabledFromEnv(env);
    const cached = forRootCache.get(jobs);
    if (cached) return cached;
    const built: DynamicModule = {
      module: ScrimsModule,
      imports: jobs ? [sharedScheduleModule] : [],
      controllers: [ScrimsController],
      providers: [
        JwtGuard,
        RolesGuard,
        ScrimRestrictionService,
        ScrimViews,
        ScrimsService,
        ScrimTeamsService,
        ScrimResultsService,
        ScrimAutoCloser,
        ...(jobs ? [ScrimAutoCloseScheduler] : []),
      ],
      exports: [ScrimRestrictionService, ScrimAutoCloser, ScrimViews],
    };
    forRootCache.set(jobs, built);
    return built;
  }
}
