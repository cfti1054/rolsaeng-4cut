import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { RatingHistoryService } from './rating-history.service';
import { RatingInputsService } from './rating-inputs.service';
import { RatingsController } from './ratings.controller';
import { SeasonsService } from './seasons.service';

/**
 * S3 내전 레이팅(계약 S3 10절): 시즌 조회·자동 생성, 레이팅 그래프, 실력값 입력(티어 시드 D103 포함).
 * ELO 반영 자체는 scrims/scrim-results.service.ts(승인 트랜잭션)가 이 모듈의 헬퍼로 한다.
 */
@Module({
  controllers: [RatingsController],
  providers: [SeasonsService, RatingHistoryService, RatingInputsService, JwtGuard],
  exports: [SeasonsService, RatingInputsService],
})
export class RatingsModule {}
