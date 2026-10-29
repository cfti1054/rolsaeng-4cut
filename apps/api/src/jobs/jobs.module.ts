import { Global, type DynamicModule, Module, type OnApplicationShutdown, type OnModuleInit, Inject } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SYNC_QUEUE } from '../integrations/contracts';
import { INTEGRATION_OPTIONS, type IntegrationOptions, loadIntegrationOptions } from '../integrations/options';
import { BullMqSyncQueue } from './bullmq-queue';
import { InProcessSyncQueue, type SyncQueueRunner } from './in-process-queue';
import { SyncScheduler } from './sync-scheduler';
import { PrismaSyncStore, SYNC_STORE } from './sync-store';
import { CLOCK_NOW, SyncWorker } from './sync-worker';

const SYNC_RUNNER = Symbol('SYNC_RUNNER');

/**
 * 큐(SyncQueue 토큰)와 작업자. REDIS_URL 있으면 BullMQ, 없으면 in-process.
 * cron 생산자는 SYNC_JOBS_ENABLED=false 이면 등록하지 않는다(정적 decorator라 모듈 구성 시점에 결정).
 * 큐 소비자는 플래그와 무관하게 항상 실행한다(D69): false 여도 수동 새로고침 작업은 처리된다.
 */
@Global()
@Module({})
export class JobsModule implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(SYNC_RUNNER) private readonly runner: SyncQueueRunner,
    private readonly worker: SyncWorker,
  ) {}

  static forRoot(env: Record<string, string | undefined> = process.env): DynamicModule {
    const opts = loadIntegrationOptions(env);
    return {
      module: JobsModule,
      imports: opts.jobsEnabled ? [ScheduleModule.forRoot()] : [],
      providers: [
        { provide: SYNC_STORE, useClass: PrismaSyncStore },
        { provide: CLOCK_NOW, useValue: () => new Date() },
        SyncWorker,
        {
          provide: SYNC_RUNNER,
          useFactory: (o: IntegrationOptions): SyncQueueRunner =>
            o.redisUrl ? new BullMqSyncQueue(o.redisUrl) : new InProcessSyncQueue(),
          inject: [INTEGRATION_OPTIONS],
        },
        { provide: SYNC_QUEUE, useExisting: SYNC_RUNNER },
        ...(opts.jobsEnabled ? [SyncScheduler] : []),
      ],
      exports: [SYNC_QUEUE, SYNC_STORE, SyncWorker],
    };
  }

  onModuleInit(): void {
    this.runner.start((job, ctx) => this.worker.run(job, ctx));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner.stop();
  }
}
