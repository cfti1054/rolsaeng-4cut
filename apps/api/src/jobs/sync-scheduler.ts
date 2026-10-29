import { Inject, Injectable, Logger, type OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SYNC_QUEUE, type SyncQueue } from '../integrations/contracts';
import { INTEGRATION_OPTIONS, type IntegrationOptions } from '../integrations/options';
import { jobPriority } from './in-process-queue';
import { SYNC_STORE, type SyncStore } from './sync-store';
import { CLOCK_NOW } from './sync-worker';

/** 생산자별 advisory lock 키(여러 인스턴스 중복 등록 방지) */
export const LOCK_KEY_TIER = 710_001;
export const LOCK_KEY_STEAM = 710_002;
export const LOCK_KEY_RECOVERY = 710_003;

const KST = 'Asia/Seoul';

/**
 * cron 생산자(계약 6-2, 6-3). Redis 유무와 무관하게 동작하고 큐에는 등록만 한다.
 * 이 클래스는 SYNC_JOBS_ENABLED=true 일 때만 JobsModule에 등록된다.
 * 멈춘 작업 정리(5분마다·시작 시)도 여기 있다(계약 6-2, D59).
 */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap {
  private readonly log = new Logger('SyncScheduler');

  constructor(
    @Inject(SYNC_STORE) private readonly store: SyncStore,
    @Inject(SYNC_QUEUE) private readonly queue: SyncQueue,
    @Optional() @Inject(INTEGRATION_OPTIONS) private readonly opts?: IntegrationOptions,
    @Optional() @Inject(CLOCK_NOW) private readonly nowFn: () => Date = () => new Date(),
  ) {}

  /** 시작 시: in-process 모드는 메모리 큐가 비었으니 queued 행을 다시 등록하고, 멈춘 행도 정리한다 */
  async onApplicationBootstrap(): Promise<void> {
    try {
      if (!this.opts?.redisUrl) {
        for (const r of await this.store.selectQueued()) await this.enqueueRecovery(r.kind, r.id);
      }
      await this.recoverStuck();
    } catch (err) {
      this.log.error(`시작 시 복구 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  /**
   * 멈춘 작업 정리: 5분마다. sync_state_at 이 10분 넘게 지난 queued|running 행을
   * 조건부 update 한 번으로 queued 로 되돌리고(queued→queued / running→queued) 같은 종류 작업을 다시 등록한다.
   */
  @Cron('*/5 * * * *', { timeZone: KST })
  async recoverStuck(): Promise<number> {
    let count = 0;
    try {
      await this.store.withProducerLock(LOCK_KEY_RECOVERY, async () => {
        const now = this.nowFn();
        const stuck = await this.store.selectStuck(now);
        if (stuck.length === 0) return;
        await this.store.requeueStuck(stuck.map((s) => s.id), now);
        for (const s of stuck) {
          await this.enqueueRecovery(s.kind, s.id);
          count++;
        }
      });
    } catch (err) {
      this.log.error(`멈춘 작업 정리 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    return count;
  }

  private enqueueRecovery(kind: 'riot-full' | 'steam-playtime', id: string): Promise<void> {
    return this.queue.enqueue({ kind, gameAccountId: id, reason: 'recovery', priority: jobPriority(kind, 'recovery') });
  }

  /** 라이엇 티어: 매시 정각. 활동 멤버의 대표 → 그 외, 부계정 포함(SQL 정렬 순서대로 등록) */
  @Cron('0 * * * *', { timeZone: KST })
  async produceTier(): Promise<number> {
    return this.produce(LOCK_KEY_TIER, () => this.store.selectTierTargets());
  }

  /** 스팀 플레이타임: 매일 05:00 KST */
  @Cron('0 5 * * *', { timeZone: KST })
  async produceSteam(): Promise<number> {
    return this.produce(LOCK_KEY_STEAM, () => this.store.selectSteamTargets());
  }

  private async produce(
    lockKey: number,
    select: () => ReturnType<SyncStore['selectTierTargets']>,
  ): Promise<number> {
    let count = 0;
    try {
      await this.store.withProducerLock(lockKey, async () => {
        for (const t of await select()) {
          await this.queue.enqueue({
            kind: t.kind,
            gameAccountId: t.id,
            reason: 'schedule',
            priority: jobPriority(t.kind, 'schedule', t.activeMember),
          });
          count++;
        }
      });
    } catch (err) {
      this.log.error(`생산자 실패 lock=${lockKey}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    return count;
  }
}
