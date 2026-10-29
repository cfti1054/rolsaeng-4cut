import { Module } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { GameAccountViews } from './game-account-views.service';
import { GameAccountsController } from './game-accounts.controller';
import { GameAccountsService } from './game-accounts.service';
import { GameCatalog } from './game-catalog.service';
import { RANDOM, RiotLinkService } from './riot-link.service';
import { SteamLinkService } from './steam-link.service';
import { SyncEnqueuer } from './sync-enqueuer.service';

/**
 * S1 게임 계정 연동. 외부 API(RIOT_API·STEAM_API·DATA_DRAGON)는 IntegrationsModule,
 * SYNC_QUEUE는 JobsModule(둘 다 전역)이 제공한다.
 */
@Module({
  controllers: [GameAccountsController],
  providers: [
    JwtGuard,
    GameCatalog,
    GameAccountViews,
    SyncEnqueuer,
    RiotLinkService,
    SteamLinkService,
    GameAccountsService,
    { provide: RANDOM, useValue: Math.random },
  ],
  exports: [GameCatalog, GameAccountViews, SyncEnqueuer],
})
export class GameAccountsModule {}
