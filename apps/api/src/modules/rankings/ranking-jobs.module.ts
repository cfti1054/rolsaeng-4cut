import { type DynamicModule, Module } from '@nestjs/common';
import { sharedScheduleModule } from '../../common/shared-schedule';
import { rankingJobsEnabledFromEnv } from '../../config/env';
import { RankingJobsScheduler } from './ranking-jobs.scheduler';
import { RankingsModule } from './rankings.module';

/**
 * 스케줄러만 따로 둔 모듈(계약 S4 11절). 다른 모듈이 RankingsModule을 import해도 cron이 중복되지 않는다.
 * @Cron은 정적 데코레이터라 모듈 구성 시점(process.env)에 결정한다(D96과 같음).
 */
@Module({})
export class RankingJobsModule {
  static forRoot(env: Record<string, string | undefined> = process.env): DynamicModule {
    const jobs = rankingJobsEnabledFromEnv(env);
    return {
      module: RankingJobsModule,
      imports: jobs ? [sharedScheduleModule, RankingsModule] : [],
      providers: jobs ? [RankingJobsScheduler] : [],
    };
  }
}
