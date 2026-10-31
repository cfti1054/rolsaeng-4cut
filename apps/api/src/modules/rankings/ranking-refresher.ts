import { Inject, Injectable, Logger } from '@nestjs/common';
import { GameCode, TierRankingGame } from '@gcd/shared';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../../prisma/prisma.service';
import { RANKING_CACHE_STORE, type RankingCacheStore } from './ranking-cache.store';
import { RankingCalculator, type RankingTarget, eloTarget, tierTarget } from './ranking-calculator.service';

/** pg_try_advisory_xact_lock(hashtext(키)) — 여러 인스턴스 중 하나만 실행(D151) */
export const RANKING_REFRESH_LOCK_KEY = 'ranking-refresh';
const REFRESH_TX_TIMEOUT_MS = 5 * 60_000;
const REFRESH_TX_MAX_WAIT_MS = 10_000;
/** last_error 최대 길이(7-4) */
const FAILURE_REASON_MAX = 200;

export type RefreshRun = { acquired: boolean; refreshed: number; failed: number; deleted: number };

/**
 * 랭킹 캐시 주기 갱신(계약 S4 7-4). 키별로 실패를 격리해 한 키 실패가 다른 키를 막지 않는다.
 * 실패는 마지막 성공값을 그대로 두고 last_failed_at만 남긴다(D149).
 */
@Injectable()
export class RankingRefresher {
  private readonly log = new Logger('RankingRefresher');

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: RankingCalculator,
    @Inject(RANKING_CACHE_STORE) private readonly store: RankingCacheStore,
    @Inject(APP_CLOCK) private readonly clock: Clock,
  ) {}

  /** 7-1 갱신 대상: 랭크 큐가 있는 게임의 티어 + 모든 게임 × 닫히지 않은 시작된 시즌의 ELO */
  async targets(now: Date): Promise<RankingTarget[]> {
    const games = await this.prisma.game.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    const seasons = await this.prisma.season.findMany({
      where: { closedAt: null, startsAt: { lte: now } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
    });
    const out: RankingTarget[] = [];
    for (const g of games) {
      const code = GameCode.safeParse(g.code);
      if (!code.success) {
        this.log.warn(`GameCode가 아닌 games 행 건너뜀: ${g.code}`);
        continue;
      }
      const tierCode = TierRankingGame.safeParse(g.code);
      if (tierCode.success) out.push(tierTarget({ id: g.id, code: tierCode.data }));
      for (const s of seasons) out.push(eloTarget({ id: g.id, code: code.data }, s.id));
    }
    return out;
  }

  async runOnce(): Promise<RefreshRun> {
    const out: RefreshRun = { acquired: false, refreshed: 0, failed: 0, deleted: 0 };
    await this.prisma.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${RANKING_REFRESH_LOCK_KEY})) AS ok`;
        if (!lock[0]?.ok) return;
        out.acquired = true;
        const now = this.clock.now();
        const targets = await this.targets(now);
        for (const t of targets) {
          try {
            await this.calculator.computeAndStore(t, now);
            out.refreshed++;
          } catch (err) {
            out.failed++;
            await this.recordFailure(t.key, now, err);
          }
        }
        out.deleted = await this.store.deleteExcept(targets.map((t) => t.key));
      },
      { timeout: REFRESH_TX_TIMEOUT_MS, maxWait: REFRESH_TX_MAX_WAIT_MS },
    );
    return out;
  }

  private async recordFailure(key: string, now: Date, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : 'unknown';
    this.log.error(`랭킹 캐시 갱신 실패 ${key}: ${message}`);
    try {
      await this.store.markFailed(key, now, message.slice(0, FAILURE_REASON_MAX));
    } catch (markErr) {
      this.log.error(`랭킹 캐시 실패 기록 실패 ${key}: ${markErr instanceof Error ? markErr.message : 'unknown'}`);
    }
  }
}
