import { z } from 'zod';
import { IsoDateTime, Uuid } from './common/primitives';
import { GAME_SEED, GameCode } from './constants/games';
import { SeasonRef } from './seasons';

// =============================================================================
// S4 뱃지(문서 5장 badges·user_badges, 7-3 「뱃지를 지급한 뒤」). 시즌 최종 순위 뱃지만 있다.
// 계약: _workspace/01_architect_contract.md 6-4절
//
// 코드는 게임별로 다르다(`season_lol_top1`). 그래서 user_badges 유일 키 (user, badge, season)를 그대로 쓰면서도
// 한 사람이 같은 시즌에 롤 1위·롤체 1위를 함께 받을 수 있다. 새 게임 = GAME_SEED 행 추가 + 시드 재실행.
// =============================================================================

/** 시즌 뱃지를 받는 최종 순위 범위(게임별 1·2·3위, 메인 기본값 2) */
export const SEASON_BADGE_PLACES = [1, 2, 3] as const;
export type SeasonBadgePlace = (typeof SEASON_BADGE_PLACES)[number];

/** 뱃지 코드: `season_{game}_top{place}` */
export function seasonBadgeCode(game: GameCode, place: SeasonBadgePlace): string {
  return `season_${game}_top${place}`;
}

/** 시즌 뱃지 코드 → 게임·순위. 시즌 뱃지가 아니면 null */
export function parseSeasonBadgeCode(code: string): { game: GameCode; place: SeasonBadgePlace } | null {
  const m = /^season_([a-z0-9]+)_top([123])$/.exec(code);
  if (!m) return null;
  const game = GameCode.safeParse(m[1]);
  if (!game.success) return null;
  return { game: game.data, place: Number(m[2]) as SeasonBadgePlace };
}

export type BadgeSeed = { code: string; name: string; description: string; condition: string };

/** 게임 1개의 시즌 뱃지 3행. seed.ts와 시즌 종료 작업이 같은 값을 쓴다 */
export function seasonBadgeSeed(game: { code: GameCode; name: string }): BadgeSeed[] {
  return SEASON_BADGE_PLACES.map((place) => ({
    code: seasonBadgeCode(game.code, place),
    name: `${game.name} 시즌 ${place}위`,
    description: `${game.name} 내전 ELO 시즌 최종 순위 ${place}위`,
    condition: `season_final_rank:${game.code}:${place}`,
  }));
}

/** badges 시드 전체(GAME_SEED × 1·2·3위). apps/api/prisma/seed.ts가 code 기준 upsert한다 */
export const SEASON_BADGE_SEED: readonly BadgeSeed[] = GAME_SEED.flatMap((g) => seasonBadgeSeed(g));

/**
 * 프로필 뱃지 1개(user_badges 1행 + badges). 목업 Profile BADGES.
 * - name: 시즌 이름을 뺀 뱃지 이름. 화면은 `{season.name} · {name}`으로 보여준다
 * - season·game·place: 시즌 뱃지일 때만 값이 있다. 시즌 행이 없거나(season_id null) 다른 종류 뱃지면 null
 * - earned_at: 지급 기준 시각(시즌 뱃지 = 그 시즌 ends_at). 목업 「2026.06」
 */
export const ProfileBadge = z.object({
  /** user_badges.id */
  id: Uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  earned_at: IsoDateTime,
  season: SeasonRef.nullable(),
  game: GameCode.nullable(),
  place: z.number().int().min(1).max(3).nullable(),
});
export type ProfileBadge = z.infer<typeof ProfileBadge>;
