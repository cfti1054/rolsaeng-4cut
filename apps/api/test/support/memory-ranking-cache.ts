import type { RankingCacheRow, RankingCacheStore, RankingCacheWrite } from '../../src/modules/rankings/ranking-cache.store';
import { RANKING_KEY_PREFIX } from '../../src/modules/rankings/ranking-keys';

/** DB 없이 쓰는 RankingCacheStore. computed_at 조건부 쓰기는 PostgreSQL 구현과 같은 규칙(실제 SQL은 ranking-cache.db.e2e) */
export class MemoryRankingCache implements RankingCacheStore {
  rows = new Map<string, RankingCacheRow & { lastError: string | null }>();
  /** 호출 기록(「첫 요청 뒤 재계산 없음」 검사용) */
  writes: string[] = [];
  /** 이 키들의 write는 실패한다(계산 실패 흉내). 다른 키에 영향 없음 검사용 */
  failWrites = new Set<string>();

  async read(key: string): Promise<RankingCacheRow | null> {
    const r = this.rows.get(key);
    return r ? { ...r } : null;
  }

  async write(key: string, row: RankingCacheWrite): Promise<void> {
    if (this.failWrites.has(key)) throw new Error(`write 실패: ${key}`);
    this.writes.push(key);
    const cur = this.rows.get(key);
    if (cur && cur.computedAt.getTime() > row.computedAt.getTime()) return;
    this.rows.set(key, {
      // 실제 저장은 JSON이다. 참조를 공유하지 않게 왕복시킨다
      payload: JSON.parse(JSON.stringify(row.payload)),
      computedAt: row.computedAt,
      lastFailedAt: null,
      lastError: null,
      baselinePeriodStart: row.baselinePeriodStart,
      baselineRanks: JSON.parse(JSON.stringify(row.baselineRanks)),
    });
  }

  async markFailed(key: string, at: Date, reason: string): Promise<void> {
    const cur = this.rows.get(key);
    if (cur) this.rows.set(key, { ...cur, lastFailedAt: at, lastError: reason });
  }

  async deleteExcept(keep: readonly string[]): Promise<number> {
    let n = 0;
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(RANKING_KEY_PREFIX) && !keep.includes(key)) {
        this.rows.delete(key);
        n++;
      }
    }
    return n;
  }
}
