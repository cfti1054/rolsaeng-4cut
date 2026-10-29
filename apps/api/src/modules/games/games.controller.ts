import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiPath, type ListGamesResponse } from '@gcd/shared';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { GamesService } from './games.service';

@Controller()
@UseGuards(JwtGuard)
export class GamesController {
  constructor(private readonly games: GamesService) {}

  /** GET /games → 200 ListGamesResponse (멤버) */
  @Get(ApiPath.games)
  list(): Promise<ListGamesResponse> {
    return this.games.list();
  }
}
