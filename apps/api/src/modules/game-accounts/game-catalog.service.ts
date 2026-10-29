import { Injectable } from '@nestjs/common';
import { GAME_CODES_BY_PROVIDER, GAME_PROVIDER_BY_CODE, GameCode, type GameProvider } from '@gcd/shared';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../prisma/prisma.service';

export type GameIds = Readonly<Record<GameCode, string>>;

/**
 * games 행(시드) id ↔ code. 게임 행은 시드로만 바뀌므로 첫 조회 결과를 프로세스 동안 캐시한다.
 * 시드가 안 돼 있으면 INTERNAL_ERROR(운영 설정 오류).
 */
@Injectable()
export class GameCatalog {
  private cache: { ids: GameIds; codeById: Map<string, GameCode> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load(): Promise<{ ids: GameIds; codeById: Map<string, GameCode> }> {
    if (this.cache) return this.cache;
    const rows = await this.prisma.game.findMany({ select: { id: true, code: true } });
    const codeById = new Map<string, GameCode>();
    const ids: Partial<Record<GameCode, string>> = {};
    for (const r of rows) {
      const code = GameCode.safeParse(r.code);
      if (!code.success) continue;
      ids[code.data] = r.id;
      codeById.set(r.id, code.data);
    }
    for (const c of GameCode.options) {
      if (!ids[c]) throw new AppError('INTERNAL_ERROR', undefined, { message: `games 시드 없음: ${c}` });
    }
    this.cache = { ids: ids as GameIds, codeById };
    return this.cache;
  }

  async ids(): Promise<GameIds> {
    return (await this.load()).ids;
  }

  /** 제공자의 game_id 목록(라이엇 = lol, tft) */
  async idsOf(provider: GameProvider): Promise<string[]> {
    const ids = await this.ids();
    return GAME_CODES_BY_PROVIDER[provider].map((c) => ids[c]);
  }

  async codeOf(gameId: string): Promise<GameCode> {
    const code = (await this.load()).codeById.get(gameId);
    if (!code) throw new AppError('INTERNAL_ERROR', undefined, { message: `알 수 없는 game_id` });
    return code;
  }

  async providerOf(gameId: string): Promise<GameProvider> {
    return GAME_PROVIDER_BY_CODE[await this.codeOf(gameId)];
  }
}
