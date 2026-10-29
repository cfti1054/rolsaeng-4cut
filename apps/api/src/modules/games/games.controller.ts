import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiPath, type ListGamesResponse, SearchSteamAppsQuery, type SearchSteamAppsResponse } from '@gcd/shared';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { GamesService } from './games.service';
import { SteamAppsService } from './steam-apps.service';

@Controller()
@UseGuards(JwtGuard)
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly steamApps: SteamAppsService,
  ) {}

  /** GET /games → 200 ListGamesResponse (멤버) */
  @Get(ApiPath.games)
  list(): Promise<ListGamesResponse> {
    return this.games.list();
  }

  /** GET /steam-apps?q= → 200 SearchSteamAppsResponse (멤버, D98) */
  @Get(ApiPath.steamApps)
  searchSteamApps(
    @Query(new ZodValidationPipe(SearchSteamAppsQuery)) query: SearchSteamAppsQuery,
  ): Promise<SearchSteamAppsResponse> {
    return this.steamApps.search(query.q);
  }
}
