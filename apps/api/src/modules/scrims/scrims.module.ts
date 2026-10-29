import { type DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { scrimJobsEnabledFromEnv } from '../../config/env';
import { ScrimAutoCloseScheduler, ScrimAutoCloser } from './scrim-auto-close';
import { ScrimRestrictionService } from './scrim-restriction.service';
import { ScrimViews } from './scrim-views.service';
import { ScrimsController } from './scrims.controller';
import { ScrimsService } from './scrims.service';

/**
 * S2 내전(계약 S2 4·5절). 자동 마감 cron(ScrimAutoCloseScheduler)은 SCRIM_JOBS_ENABLED=true일 때만 등록한다(D96).
 * @Cron은 정적 데코레이터라 모듈 구성 시점(process.env)에 결정한다 — JobsModule.forRoot와 같은 방식.
 * ScheduleModule.forRoot()는 같은 메타데이터라 JobsModule과 함께 import해도 한 번만 만들어진다.
 */
@Module({})
export class ScrimsModule {
  static forRoot(env: Record<string, string | undefined> = process.env): DynamicModule {
    const jobs = scrimJobsEnabledFromEnv(env);
    return {
      module: ScrimsModule,
      imports: jobs ? [ScheduleModule.forRoot()] : [],
      controllers: [ScrimsController],
      providers: [
        JwtGuard,
        RolesGuard,
        ScrimRestrictionService,
        ScrimViews,
        ScrimsService,
        ScrimAutoCloser,
        ...(jobs ? [ScrimAutoCloseScheduler] : []),
      ],
      exports: [ScrimRestrictionService, ScrimAutoCloser],
    };
  }
}
