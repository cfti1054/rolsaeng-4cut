import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RANKING_KEY_PREFIX } from './ranking-keys';

/** ranking_caches 1행(계약 S4 3·7-1절). JSON 컬럼은 읽는 쪽이 shared 스키마로 parse한다 */
export type RankingCacheRow = {
  payload: unknown;
  computedAt: Date;
  lastFailedAt: Date | null;
  baselinePeriodStart: Date;
  baselineRanks: unknown;
};

export type RankingCacheWrite = {
  payload: unknown;
  computedAt: Date;
  baselinePeriodStart: Date;
  baselineRanks: Record<string, number>;
};

export interface RankingCacheStore {
  read(key: string): Promise<RankingCacheRow | null>;
  /** 새 값 저장. computed_at이 더 새로울 때만 덮어쓴다. last_failed_at·last_error = null */
  write(key: string, row: RankingCacheWrite): Promise<void>;
  /** 값은 두고 실패만 기록. 행이 없으면 아무것도 안 함 */
  markFailed(key: string, at: Date, reason: string): Promise<void>;
  /** keep에 없는 `rankings:` 키 삭제 */
  deleteExcept(keep: readonly string[]): Promise<number>;
}

export const RANKING_CACHE_STORE = Symbol('RANKING_CACHE_STORE');

/** PostgreSQL 저장소(Redis 유무와 무관한 단일 경로, D146) */
@Injectable()
export class PrismaRankingCacheStore implements RankingCacheStore {
  constructor(private readonly prisma: PrismaService) {}

  async read(key: string): Promise<RankingCacheRow | null> {
    const row = await this.prisma.rankingCache.findUnique({ where: { cacheKey: key } });
    if (!row) return null;
    return {
      payload: row.payload,
      computedAt: row.computedAt,
      lastFailedAt: row.lastFailedAt,
      baselinePeriodStart: row.baselinePeriodStart,
      baselineRanks: row.baselineRanks,
    };
  }

  /** 늦게 끝난 오래된 계산이 새 값을 덮지 않게 computed_at 조건부(D151). id는 INSERT 때만 쓰인다 */
  async write(key: string, row: RankingCacheWrite): Promise<void> {
    const payload = JSON.stringify(row.payload);
    const ranks = JSON.stringify(row.baselineRanks);
    await this.prisma.$executeRaw`
      INSERT INTO ranking_caches
        (id, cache_key, payload, computed_at, last_failed_at, last_error, baseline_period_start, baseline_ranks, created_at, updated_at)
      VALUES
        (${randomUUID()}::uuid, ${key}, ${payload}::jsonb, ${row.computedAt}, NULL, NULL, ${row.baselinePeriodStart}, ${ranks}::jsonb, now(), now())
      ON CONFLICT (cache_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        computed_at = EXCLUDED.computed_at,
        last_failed_at = NULL,
        last_error = NULL,
        baseline_period_start = EXCLUDED.baseline_period_start,
        baseline_ranks = EXCLUDED.baseline_ranks,
        updated_at = now()
      WHERE ranking_caches.computed_at <= EXCLUDED.computed_at`;
  }

  async markFailed(key: string, at: Date, reason: string): Promise<void> {
    await this.prisma.rankingCache.updateMany({
      where: { cacheKey: key },
      data: { lastFailedAt: at, lastError: reason },
    });
  }

  async deleteExcept(keep: readonly string[]): Promise<number> {
    const where: Prisma.RankingCacheWhereInput = {
      cacheKey: { startsWith: RANKING_KEY_PREFIX, notIn: [...keep] },
    };
    const r = await this.prisma.rankingCache.deleteMany({ where });
    return r.count;
  }
}
