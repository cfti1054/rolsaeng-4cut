import type { GameAccountView, GetMyGameAccountsResponse } from '@gcd/shared';

/** 테스트용 GameAccountView 생성기(스키마를 통과하는 값) */
let seq = 0;
export function account(p: Partial<GameAccountView> & Pick<GameAccountView, 'game' | 'display_name'>): GameAccountView {
  seq += 1;
  const provider = p.game === 'steam' ? 'steam' : 'riot';
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    provider,
    verified_at: '2026-10-01T00:00:00.000Z',
    is_primary: provider === 'steam',
    rank: null,
    sync: { state: 'idle', synced_at: null, matches_synced_at: null, error: null },
    steam_owned_game_count: null,
    ...p,
  };
}

/** 라이엇 ID 하나의 lol·tft 두 행 */
export function riotPair(name: string, o: Partial<GameAccountView> = {}): [GameAccountView, GameAccountView] {
  return [account({ game: 'lol', display_name: name, ...o }), account({ game: 'tft', display_name: name, ...o })];
}

export function listResponse(accounts: GameAccountView[], extra: Partial<GetMyGameAccountsResponse> = {}): GetMyGameAccountsResponse {
  return {
    accounts,
    riot_verification: null,
    sync_quota: { limit: 5, used: 0, remaining: 5, resets_at: '2026-10-29T00:00:00.000+09:00' },
    limits: { riot_accounts_max: 3, steam_accounts_max: 1 },
    ...extra,
  };
}
