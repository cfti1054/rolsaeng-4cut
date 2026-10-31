import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { GameAccountsModule } from '../game-accounts/game-accounts.module';
import { RankingsModule } from '../rankings/rankings.module';
import { RatingsModule } from '../ratings/ratings.module';
import { ScrimsModule } from '../scrims/scrims.module';
import { BotActivityService } from './bot-activity.service';
import { BotMembersService } from './bot-members.service';
import { BotPresenceService } from './bot-presence.service';
import { BotQueryService } from './bot-query.service';
import { BotController } from './bot.controller';

/**
 * S5 디스코드 봇 API(계약 S5 11절). 티어 조회는 GameAccountsModule(GameAccountViews, 프로필과 같은 출처),
 * 순위는 RankingsModule(웹과 같은 캐시). ScrimsModule.forRoot()은 AppModule과 같은 인스턴스다.
 */
@Module({
  imports: [RankingsModule, RatingsModule, GameAccountsModule, ScrimsModule.forRoot()],
  controllers: [BotController],
  providers: [ApiKeyGuard, BotActivityService, BotMembersService, BotPresenceService, BotQueryService],
})
export class BotModule {}
