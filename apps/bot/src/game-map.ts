import type { GameCode } from '@gcd/shared';

/**
 * 디스코드 활동 이름 → games.code.
 * 스팀 앱 ID는 활동 이름만으로 확정하지 않는다(presence의 steam_app_id는 null).
 */
const KNOWN_ACTIVITIES: Record<string, GameCode> = {
  'league of legends': 'lol',
  '리그 오브 레전드': 'lol',
  'teamfight tactics': 'tft',
  '전략적 팀 전투': 'tft',
};

export function mapActivityName(name: string): { game: GameCode | null; steamAppId: number | null } {
  const game = KNOWN_ACTIVITIES[name.trim().toLowerCase()] ?? null;
  return { game, steamAppId: null };
}
