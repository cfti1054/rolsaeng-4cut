import { Logger } from '@nestjs/common';
import { DelayedError, Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { SyncJob } from '../integrations/contracts';
import { type SyncJobHandler, type SyncQueueRunner, dedupeKey } from './in-process-queue';

export const SYNC_QUEUE_NAME = 'external-sync';

type JobData = { job: SyncJob; rateLimitedCount: number };

/** redis://[user:pass@]host:port[/db] → BullMQ 연결 옵션(ioredis는 bullmq 내부 의존이라 직접 import하지 않는다) */
export function parseRedisUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

/**
 * Redis가 있을 때 쓰는 BullMQ 구현(계약 6-3). 작성만 했고 이 PC에 Redis가 없어 실행은 확인하지 못했다.
 * - jobId = 중복 제거 키, BullMQ 우선순위 = job.priority(작을수록 먼저)
 * - 429: handler가 retryAfterSec를 돌려주면 worker.rateLimit()로 소비를 멈추고 작업을 지연 상태로 옮긴다
 *   (한 큐라서 스팀 작업도 같이 멈추지만 스팀 429는 드물어 받아들인다 — 보고서 참조)
 */
export class BullMqSyncQueue implements SyncQueueRunner {
  private readonly log = new Logger('BullMqSyncQueue');
  private readonly queue: Queue<JobData>;
  private worker: Worker<JobData> | null = null;

  constructor(private readonly redisUrl: string) {
    this.queue = new Queue<JobData>(SYNC_QUEUE_NAME, {
      connection: parseRedisUrl(redisUrl),
      defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
    });
  }

  async enqueue(job: SyncJob): Promise<void> {
    // 같은 jobId가 이미 있으면 BullMQ가 조용히 무시한다
    await this.queue.add(job.kind, { job, rateLimitedCount: 0 }, { jobId: dedupeKey(job), priority: job.priority });
  }

  start(handler: SyncJobHandler): void {
    const worker: Worker<JobData> = new Worker<JobData>(
      SYNC_QUEUE_NAME,
      async (bullJob, token) => {
        const res = await handler(bullJob.data.job, { rateLimitedCount: bullJob.data.rateLimitedCount });
        if (res?.retryAfterSec !== undefined) {
          const ms = res.retryAfterSec * 1000;
          await bullJob.updateData({ ...bullJob.data, rateLimitedCount: bullJob.data.rateLimitedCount + 1 });
          await worker.rateLimit(ms);
          await bullJob.moveToDelayed(Date.now() + ms, token);
          throw new DelayedError();
        }
      },
      { connection: parseRedisUrl(this.redisUrl), concurrency: 2 },
    );
    worker.on('failed', (j, err) => this.log.error(`작업 실패 kind=${j?.name}: ${err.message}`));
    this.worker = worker;
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}
