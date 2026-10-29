import { ScheduleModule } from '@nestjs/schedule';
import { describe, expect, it, vi } from 'vitest';
import type { SyncJob } from '../../src/integrations/contracts';
import { InProcessSyncQueue } from '../../src/jobs/in-process-queue';
import { JobsModule } from '../../src/jobs/jobs.module';
import { SyncScheduler } from '../../src/jobs/sync-scheduler';
import type { SyncWorker } from '../../src/jobs/sync-worker';

describe('JobsModule SYNC_JOBS_ENABLED (D69)', () => {
  it('false: cron 생산자·ScheduleModule 은 등록하지 않는다', () => {
    const m = JobsModule.forRoot({ SYNC_JOBS_ENABLED: 'false' });
    expect(m.providers).not.toContain(SyncScheduler);
    expect(m.imports ?? []).toHaveLength(0);
    const on = JobsModule.forRoot({ SYNC_JOBS_ENABLED: 'true' });
    expect(on.providers).toContain(SyncScheduler);
    expect(JSON.stringify(on.imports?.length)).toBe('1');
    void ScheduleModule;
  });

  it('false 여도 소비자는 시작되어 수동 sync 작업을 처리한다', async () => {
    const runner = new InProcessSyncQueue();
    const run = vi.fn(async () => undefined);
    const mod = new JobsModule(runner, { run } as unknown as SyncWorker);
    mod.onModuleInit();
    const job: SyncJob = { kind: 'riot-full', gameAccountId: 'acc-1', reason: 'manual', priority: 1 };
    await runner.enqueue(job);
    await runner.onIdle();
    expect(run).toHaveBeenCalledWith(job, { rateLimitedCount: 0 });
  });
});
