import { Inject, Injectable, Logger } from '@nestjs/common';
import { SYNC_QUEUE, type SyncJobKind, type SyncJobReason, type SyncQueue } from '../../integrations/contracts';
import { jobPriority } from '../../jobs/in-process-queue';

/**
 * 커밋 후 동기화 작업 등록(계약 S1 6-2). 등록 실패는 요청을 실패시키지 않는다:
 * DB sync_state(queued)가 원본이라 멈춘 작업 정리(10분)가 다시 등록한다(6-3).
 * 로그에는 PUUID 대신 game_account id만 남긴다(D38).
 */
@Injectable()
export class SyncEnqueuer {
  private readonly log = new Logger('SyncEnqueuer');

  constructor(@Inject(SYNC_QUEUE) private readonly queue: SyncQueue) {}

  async enqueue(kind: SyncJobKind, gameAccountId: string, reason: SyncJobReason): Promise<boolean> {
    try {
      await this.queue.enqueue({ kind, gameAccountId, reason, priority: jobPriority(kind, reason) });
      return true;
    } catch (err) {
      this.log.error(
        `작업 등록 실패 kind=${kind} account=${gameAccountId} reason=${reason}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return false;
    }
  }
}
