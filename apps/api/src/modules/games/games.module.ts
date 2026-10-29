import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

/** S2 게임 목록(작성 폼·필터, 계약 S2 4절 D75) */
@Module({
  controllers: [GamesController],
  providers: [GamesService, JwtGuard],
  exports: [GamesService],
})
export class GamesModule {}
