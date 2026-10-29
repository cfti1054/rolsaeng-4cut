import { Injectable } from '@nestjs/common';
import { GameCode, GameView, ListGamesResponse } from '@gcd/shared';
import type { Game } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** games 행 → shared GameView(id 비노출, 계약 S2 D75) */
export function toGameView(g: Game): GameView | null {
  const code = GameCode.safeParse(g.code);
  if (!code.success) return null;
  return GameView.parse({
    code: code.data,
    name: g.name,
    has_positions: g.hasPositions,
    has_teams: g.hasTeams,
    positions: g.hasPositions ? g.positions : [],
    sort_order: g.sortOrder,
    capacity: { min: g.capacityMin, max: g.capacityMax, default: g.capacityDefault },
  });
}

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /games: sort_order 오름차순 전부, next_cursor 항상 null. 모르는 code 행은 건너뛴다 */
  async list(): Promise<ListGamesResponse> {
    const rows = await this.prisma.game.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    const items = rows.map(toGameView).filter((v): v is GameView => v !== null);
    return ListGamesResponse.parse({ items, next_cursor: null });
  }
}
