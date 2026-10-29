import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { canStartScrim, decideOverdueScrim } from '@gcd/core';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { assertScrimTransition, countJoined, loadGame, lockOrNotFound } from './scrims.service';

/** pg_try_advisory_xact_lock(hashtext(키)) — 여러 인스턴스 중 하나만 실행(D96, S1 D62 방식) */
export const SCRIM_AUTO_CLOSE_LOCK_KEY = 'scrim-auto-close';
/** 한 번에 처리하는 최대 건수(계약 S2 5-5) */
export const SCRIM_AUTO_CLOSE_BATCH = 100;

export type AutoCloseOutcome = 'start' | 'cancel' | null;
export type AutoCloseRun = { acquired: boolean; started: number; cancelled: number; skipped: number; failed: number };

/**
 * 시작 시각 + SCRIM_AUTO_CLOSE_AFTER_MIN분이 지나도 시작하지 않은 모집글 자동 마감(계약 S2 5-5, D78).
 * 대상 조회는 advisory xact lock을 얻은 트랜잭션 안에서, 건마다 별도 트랜잭션 + 내전 행 잠금(5-0) 후 core decideOverdueScrim으로 다시 판정한다.
 * 이 서비스는 항상 등록되고(테스트·수동 실행), cron 등록은 ScrimAutoCloseScheduler(SCRIM_JOBS_ENABLED)가 한다.
 */
@Injectable()
export class ScrimAutoCloser {
  private readonly log = new Logger('ScrimAutoCloser');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  async runOnce(): Promise<AutoCloseRun> {
    const out: AutoCloseRun = { acquired: false, started: 0, cancelled: 0, skipped: 0, failed: 0 };
    await this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${SCRIM_AUTO_CLOSE_LOCK_KEY})) AS ok`;
        if (!lock[0]?.ok) return;
        out.acquired = true;
        const now = this.clock.now();
        const cutoff = new Date(now.getTime() - this.config.scrim.autoCloseAfterMin * 60_000);
        const targets = await this.prisma.scrim.findMany({
          where: { status: { in: ['recruiting', 'full'] }, scheduledAt: { lte: cutoff } },
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
          take: SCRIM_AUTO_CLOSE_BATCH,
          select: { id: true },
        });
        for (const t of targets) {
          try {
            const r = await this.closeOne(t.id, now);
            if (r === 'start') out.started++;
            else if (r === 'cancel') out.cancelled++;
            else out.skipped++;
          } catch (err) {
            out.failed++;
            this.log.error(`자동 마감 실패 scrim=${t.id}: ${err instanceof Error ? err.message : 'unknown'}`);
          }
        }
      },
      { timeout: 5 * 60_000, maxWait: 10_000 },
    );
    return out;
  }

  /** 한 건: 별도 트랜잭션 + 행 잠금 후 다시 판정(그사이 수정·시작된 건은 null → 건너뜀) */
  async closeOne(id: string, now: Date): Promise<AutoCloseOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const s = await lockOrNotFound(tx, id);
      const game = await loadGame(tx, s.gameId);
      const joinedCount = await countJoined(tx, s.id);
      const decision = decideOverdueScrim({
        status: s.status,
        scheduledAt: s.scheduledAt,
        now,
        autoCloseAfterMin: this.config.scrim.autoCloseAfterMin,
        canStart: canStartScrim({ requiresFull: game.startRequiresFull, capacity: s.capacity, joinedCount }),
      });
      if (decision === 'start') {
        assertScrimTransition(s.status, 'playing');
        await tx.scrim.update({ where: { id: s.id }, data: { status: 'playing', startedAt: now } });
      } else if (decision === 'cancel') {
        assertScrimTransition(s.status, 'cancelled');
        await tx.scrim.update({
          where: { id: s.id },
          data: { status: 'cancelled', cancelledAt: now, cancelReason: 'not_started' },
        });
      }
      return decision;
    });
  }
}

/**
 * cron 등록(SCRIM_JOBS_ENABLED=true일 때만 ScrimsModule에 들어간다). `*\/5 * * * *` Asia/Seoul,
 * 프로세스 시작 시 1회(꺼져 있던 동안 밀린 것) — 기동을 막지 않게 기다리지 않는다.
 */
@Injectable()
export class ScrimAutoCloseScheduler implements OnApplicationBootstrap {
  private readonly log = new Logger('ScrimAutoCloseScheduler');

  constructor(private readonly closer: ScrimAutoCloser) {}

  onApplicationBootstrap(): void {
    void this.tick();
  }

  @Cron('*/5 * * * *', { timeZone: 'Asia/Seoul' })
  async tick(): Promise<AutoCloseRun | null> {
    try {
      return await this.closer.runOnce();
    } catch (err) {
      this.log.error(`자동 마감 실행 실패: ${err instanceof Error ? err.message : 'unknown'}`);
      return null;
    }
  }
}
