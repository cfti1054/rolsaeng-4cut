import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RankingRefresher } from './ranking-refresher';
import { SeasonCloser } from './season-closer';

/**
 * cron 등록(RANKING_JOBS_ENABLED=true일 때만, 계약 S4 7-5, D164). `*\/5 * * * *` Asia/Seoul + 프로세스 시작 시 1회(기동을 기다리지 않음).
 * 한 tick = 시즌 종료 → 캐시 갱신. 종료 실패가 캐시 갱신을 막지 않는다.
 */
@Injectable()
export class RankingJobsScheduler implements OnApplicationBootstrap {
  private readonly log = new Logger('RankingJobsScheduler');

  constructor(
    private readonly closer: SeasonCloser,
    private readonly refresher: RankingRefresher,
  ) {}

  onApplicationBootstrap(): void {
    void this.tick();
  }

  @Cron('*/5 * * * *', { timeZone: 'Asia/Seoul' })
  async tick(): Promise<void> {
    try {
      await this.closer.runOnce();
    } catch (err) {
      this.log.error(`시즌 종료 작업 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    try {
      await this.refresher.runOnce();
    } catch (err) {
      this.log.error(`랭킹 캐시 갱신 작업 실패: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}
