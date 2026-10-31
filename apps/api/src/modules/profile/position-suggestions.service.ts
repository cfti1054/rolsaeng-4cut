import { Injectable, Logger } from '@nestjs/common';
import { computeMainPosition } from '@gcd/core';
import { type GameCode, GetMyPositionSuggestionsResponse, SCRIM_PREFERRED_POSITIONS_MAX } from '@gcd/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { GameCatalog } from '../game-accounts/game-catalog.service';
import { loadRecentLolMatches } from './recent-matches';

/**
 * GET /me/position-suggestions(계약 20-5, D190–D192). 요청자 그 게임 대표 계정의 저장된 최근 전적 → core computeMainPosition
 * → games.positions 안 값, 최대 2개(= 프로필 main_position). 외부 API 호출·동기화 등록을 하지 않는다.
 */
@Injectable()
export class PositionSuggestions {
  private readonly log = new Logger('PositionSuggestions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: GameCatalog,
  ) {}

  async forUser(userId: string, code: GameCode): Promise<GetMyPositionSuggestionsResponse> {
    const empty = { game: code, positions: [], sample_size: 0, synced_at: null };
    const gameId = (await this.catalog.ids())[code];
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game) {
      this.log.error(`games 행 없음: ${code}`);
      throw new AppError('INTERNAL_ERROR');
    }
    if (!game.hasPositions) return GetMyPositionSuggestionsResponse.parse(empty);

    const account = await this.prisma.gameAccount.findFirst({ where: { userId, gameId: game.id, isPrimary: true } });
    if (!account) return GetMyPositionSuggestionsResponse.parse(empty);
    const syncedAt = account.matchesSyncedAt?.toISOString() ?? null;

    const matches = await loadRecentLolMatches(this.prisma, account.id);
    const main = computeMainPosition(matches.map((m) => m.summary.position));
    if (!main) return GetMyPositionSuggestionsResponse.parse({ ...empty, synced_at: syncedAt });
    return GetMyPositionSuggestionsResponse.parse({
      game: code,
      positions: main.positions
        .map((p) => p.position)
        .filter((p) => game.positions.includes(p))
        .slice(0, SCRIM_PREFERRED_POSITIONS_MAX),
      sample_size: main.sample_size,
      synced_at: syncedAt,
    });
  }
}
