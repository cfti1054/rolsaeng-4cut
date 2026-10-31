import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RatingsModule } from '../ratings/ratings.module';
import { PrismaRankingCacheStore, RANKING_CACHE_STORE } from './ranking-cache.store';
import { RankingCalculator } from './ranking-calculator.service';
import { RankingRefresher } from './ranking-refresher';
import { RankingsController } from './rankings.controller';
import { RankingsReader } from './rankings-reader.service';
import { SeasonCloser } from './season-closer';

/** S4 랭킹(계약 S4 4·6·7절). 실행기는 항상 등록하고 cron만 RankingJobsModule에 둔다 */
@Module({
  imports: [RatingsModule],
  controllers: [RankingsController],
  providers: [
    { provide: RANKING_CACHE_STORE, useClass: PrismaRankingCacheStore },
    RankingCalculator,
    RankingsReader,
    RankingRefresher,
    SeasonCloser,
    JwtGuard,
  ],
  exports: [RankingsReader, RankingRefresher, RankingCalculator, SeasonCloser],
})
export class RankingsModule {}
