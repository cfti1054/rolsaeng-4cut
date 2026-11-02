import {
  BOT_RANKING_LIMIT_MAX,
  BOT_UPCOMING_WITHIN_MIN_DEFAULT,
  BOT_UPCOMING_WITHIN_MIN_MAX,
  ActivityPeriod,
  BotRankingType,
  GameCode,
  SteamAppId,
  TierRankingGame,
  type BotRankingType as BotRankingTypeT,
} from '@gcd/shared';

export const RANKING_COMMAND = '랭킹';
export const SCRIM_COMMAND = '내전';

export type RankingOptions = {
  type: string | null;
  game: string | null;
  period: string | null;
  limit: number | null;
  appId: number | null;
};

export type RankingPlan =
  | { ok: false; message: string }
  | { ok: true; type: BotRankingTypeT; query: Record<string, string | number> };

export function planRanking(options: RankingOptions): RankingPlan {
  const type = BotRankingType.safeParse(options.type);
  if (!type.success) return { ok: false, message: '랭킹 종류를 골라 주세요.' };
  const query: Record<string, string | number> = {};
  if (options.limit != null) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > BOT_RANKING_LIMIT_MAX) {
      return { ok: false, message: `인원은 1–${BOT_RANKING_LIMIT_MAX}명입니다.` };
    }
    query.limit = options.limit;
  }
  if (type.data === 'tier') {
    const game = TierRankingGame.safeParse(options.game);
    if (!game.success) return { ok: false, message: '티어 랭킹은 롤 또는 롤체를 골라 주세요.' };
    query.game = game.data;
  } else if (type.data === 'elo') {
    const game = GameCode.safeParse(options.game);
    if (!game.success || game.data === 'other') {
      return { ok: false, message: '이 게임은 ELO 랭킹이 없습니다. 롤, 롤체, 스팀 중에서 골라 주세요.' };
    }
    query.game = game.data;
  } else if (type.data === 'activity') {
    if (options.period != null) {
      const period = ActivityPeriod.safeParse(options.period);
      if (!period.success) return { ok: false, message: '기간은 이번 주 또는 이번 달입니다.' };
      query.period = period.data;
    }
  } else if (options.appId == null || !SteamAppId.safeParse(options.appId).success) {
    return { ok: false, message: '플레이타임 랭킹은 스팀 앱 ID가 필요합니다.' };
  } else {
    query.app_id = options.appId;
  }
  return { ok: true, type: type.data, query };
}

export function planUpcoming(
  withinMin: number | null,
): { ok: true; withinMin: number } | { ok: false; message: string } {
  const value = withinMin ?? BOT_UPCOMING_WITHIN_MIN_DEFAULT;
  if (!Number.isInteger(value) || value < 1 || value > BOT_UPCOMING_WITHIN_MIN_MAX) {
    return { ok: false, message: `범위는 1–${BOT_UPCOMING_WITHIN_MIN_MAX}분입니다.` };
  }
  return { ok: true, withinMin: value };
}
