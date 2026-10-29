import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { SteamAppsService } from './steam-apps.service';

/** S2 게임 목록(작성 폼·필터, 계약 S2 4절 D75), 스팀 내전 게임 검색(D98) */
@Module({
  controllers: [GamesController],
  providers: [GamesService, SteamAppsService, JwtGuard],
  exports: [GamesService, SteamAppsService],
})
export class GamesModule {}
