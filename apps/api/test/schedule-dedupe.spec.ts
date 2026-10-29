/**
 * SYNC_JOBS_ENABLED와 SCRIM_JOBS_ENABLED가 둘 다 true면 JobsModule.forRoot와 ScrimsModule.forRoot가 각각
 * ScheduleModule.forRoot()를 import한다. Nest가 같은 동적 모듈을 한 번만 만들어 cron이 중복 등록되지 않는지 확인한다
 * (계약 S2 D96, QA minor 3).
 */
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { describe, expect, it } from 'vitest';
import { JobsModule } from '../src/jobs/jobs.module';
import { ScrimsModule } from '../src/modules/scrims/scrims.module';

@Injectable()
class SyncLikeJob {
  @Cron('0 * * * *', { name: 'sync-like' })
  run(): void {}
}

@Injectable()
class ScrimLikeJob {
  @Cron('*/5 * * * *', { name: 'scrim-like' })
  run(): void {}
}

describe('ScheduleModule 중복 import (SYNC_JOBS_ENABLED=true + SCRIM_JOBS_ENABLED=true)', () => {
  it('두 모듈의 실제 import(ScheduleModule.forRoot)를 함께 써도 cron은 각 1번만 등록된다', async () => {
    const jobsImports = JobsModule.forRoot({ SYNC_JOBS_ENABLED: 'true' }).imports ?? [];
    const scrimImports = ScrimsModule.forRoot({ SCRIM_JOBS_ENABLED: 'true' }).imports ?? [];
    expect(jobsImports).toHaveLength(1);
    expect(scrimImports).toHaveLength(1);

    @Module({ imports: jobsImports, providers: [SyncLikeJob] })
    class JobsLike {}
    @Module({ imports: scrimImports, providers: [ScrimLikeJob] })
    class ScrimsLike {}

    const moduleRef = await Test.createTestingModule({ imports: [JobsLike, ScrimsLike] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      const jobs = app.get(SchedulerRegistry).getCronJobs();
      expect([...jobs.keys()].sort()).toEqual(['scrim-like', 'sync-like']);
    } finally {
      await app.close();
    }
  });
});
