import { describe, expect, it } from 'vitest';
import {
  ApiPath,
  ConfirmRiotVerificationResponse,
  ERROR_HTTP_STATUS,
  GAME_ACCOUNT_SYNC_STATE_TRANSITIONS,
  GAME_CODES_BY_PROVIDER,
  GAME_PROVIDER_BY_CODE,
  GAME_SEED,
  GameAccountView,
  GameCode,
  GetMyGameAccountsResponse,
  GetUserProfileResponse,
  LinkGameAccountRequest,
  LinkGameAccountResponse,
  LolMatchSummary,
  LolPosition,
  RANKED_QUEUE_BY_GAME,
  RIOT_DIVISION_ORDER,
  RIOT_LINK_VERIFICATION_TRANSITIONS,
  RIOT_TIER_ORDER,
  RIOT_VERIFICATION_ICON_IDS,
  RankTier,
  RankValue,
  RiotDivision,
  RiotIdInput,
  RiotTier,
  STEAM_CLAIMED_ID_PATTERN,
  SetPrimaryGameAccountResponse,
  SettingsPageQuery,
  SteamLinkErrorCode,
  SyncGameAccountResponse,
  canTransition,
  isStaleOnlySyncTransition,
  fillPath,
  formatRiotId,
  toLolPosition,
} from './index';

const ID = '7d1f0b5e-4a7a-4c9b-9f5c-2b1a3c4d5e6f';
const ID2 = '0f1e2d3c-4b5a-4968-8776-655443322110';
const T = '2026-10-28T13:41:00.000Z';

const syncIdle = { state: 'idle', synced_at: T, matches_synced_at: null, error: null } as const;
const lolAccount = {
  id: ID,
  game: 'lol',
  provider: 'riot',
  display_name: '새벽감자#KR1',
  verified_at: T,
  is_primary: true,
  rank: { tier: 'EMERALD', division: 'III', lp: 12, wins: 48, losses: 41 },
  sync: syncIdle,
  steam_owned_game_count: null,
} as const;
const quota = { limit: 5, used: 1, remaining: 4, resets_at: '2026-10-29T00:00:00.000+09:00' };

describe('S1 errors', () => {
  it('새 오류 코드와 상태', () => {
    expect(ERROR_HTTP_STATUS.SYNC_LIMIT_EXCEEDED).toBe(429);
    expect(ERROR_HTTP_STATUS.OWNERSHIP_CHECK_EXPIRED).toBe(410);
    expect(ERROR_HTTP_STATUS.GAME_ACCOUNT_ALREADY_LINKED).toBe(409);
    expect(ERROR_HTTP_STATUS.GAME_ACCOUNT_ALREADY_LINKED_TO_ME).toBe(409);
    expect(ERROR_HTTP_STATUS.GAME_PROVIDER_ERROR).toBe(502);
  });
  it('스팀 콜백 오류 코드는 ErrorCode 부분집합', () => {
    expect(SteamLinkErrorCode.options).toContain('STEAM_OPENID_INVALID');
    expect(SettingsPageQuery.safeParse({ steam_error: 'NICKNAME_TAKEN' }).success).toBe(false);
    expect(SettingsPageQuery.parse({ steam: 'linked' })).toEqual({ steam: 'linked' });
  });
});

describe('riot constants', () => {
  it('티어 순서·디비전 순서', () => {
    expect(RiotTier.options.map((t) => RIOT_TIER_ORDER[t])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(RiotDivision.options.map((d) => RIOT_DIVISION_ORDER[d])).toEqual([3, 2, 1, 0]);
    expect(RankTier.options).toContain('UNRANKED');
  });
  it('RankValue: 상위 티어·언랭은 division null, 나머지는 필수', () => {
    expect(RankValue.safeParse({ tier: 'EMERALD', division: 'III', lp: 12, wins: 48, losses: 41 }).success).toBe(true);
    expect(RankValue.safeParse({ tier: 'MASTER', division: null, lp: 120, wins: 1, losses: 1 }).success).toBe(true);
    expect(RankValue.safeParse({ tier: 'MASTER', division: 'I', lp: 0, wins: 0, losses: 0 }).success).toBe(false);
    expect(RankValue.safeParse({ tier: 'GOLD', division: null, lp: 0, wins: 0, losses: 0 }).success).toBe(false);
    expect(RankValue.safeParse({ tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0 }).success).toBe(true);
  });
  it('LolPosition = GAME_SEED lol.positions (순서 포함)', () => {
    const lol = GAME_SEED.find((g) => g.code === 'lol');
    expect(lol?.positions).toEqual([...LolPosition.options]);
  });
  it('teamPosition 매핑', () => {
    expect(toLolPosition('UTILITY')).toBe('support');
    expect(toLolPosition('MIDDLE')).toBe('mid');
    expect(toLolPosition('')).toBeNull();
    expect(toLolPosition('Invalid')).toBeNull();
  });
  it('큐 매핑과 소유 확인 아이콘 후보', () => {
    expect(RANKED_QUEUE_BY_GAME).toEqual({ lol: 'RANKED_SOLO_5x5', tft: 'RANKED_TFT' });
    expect(RIOT_VERIFICATION_ICON_IDS.length).toBeGreaterThan(1);
  });
});

describe('providers', () => {
  it('모든 GameCode에 제공자가 있고 역매핑과 일치', () => {
    for (const code of GameCode.options) {
      const p = GAME_PROVIDER_BY_CODE[code];
      expect((GAME_CODES_BY_PROVIDER[p] as readonly string[]).includes(code)).toBe(true);
    }
  });
});

describe('riot id input', () => {
  it('게임이름#태그를 나눈다(마지막 # 기준, 앞뒤 공백 제거)', () => {
    expect(RiotIdInput.parse(' 새벽감자#KR1 ')).toEqual({ game_name: '새벽감자', tag_line: 'KR1' });
    expect(RiotIdInput.parse('Hide on bush#KR1')).toEqual({ game_name: 'Hide on bush', tag_line: 'KR1' });
    expect(formatRiotId({ game_name: 'a', tag_line: 'b' })).toBe('a#b');
  });
  it('형식 오류', () => {
    for (const bad of ['새벽감자', '#KR1', '새벽감자#', '새벽감자#KR-1', '새벽감자#ABCDEF', 'a'.repeat(17) + '#KR1', 'a#b#c']) {
      expect(RiotIdInput.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('link request/response', () => {
  it('provider로 분기, 모르는 필드 거절', () => {
    const r = LinkGameAccountRequest.parse({ provider: 'riot', riot_id: '새벽감자#KR1' });
    expect(r).toEqual({ provider: 'riot', riot_id: { game_name: '새벽감자', tag_line: 'KR1' } });
    expect(LinkGameAccountRequest.parse({ provider: 'steam' })).toEqual({ provider: 'steam' });
    expect(LinkGameAccountRequest.safeParse({ provider: 'steam', steam_id: '76561198000000000' }).success).toBe(false);
    expect(LinkGameAccountRequest.safeParse({ provider: 'riot' }).success).toBe(false);
  });
  it('응답', () => {
    const verification = {
      id: ID,
      display_name: '새벽감자#KR1',
      icon_id: 23,
      icon_image_url: null,
      status: 'pending',
      expires_at: T,
      created_at: T,
    };
    expect(LinkGameAccountResponse.parse({ provider: 'riot', verification }).provider).toBe('riot');
    expect(
      LinkGameAccountResponse.parse({ provider: 'steam', authorize_url: 'https://steamcommunity.com/openid/login?x=1' })
        .provider,
    ).toBe('steam');
    expect(
      ConfirmRiotVerificationResponse.parse({
        verification: { ...verification, status: 'verified' },
        accounts: [lolAccount, { ...lolAccount, id: ID2, game: 'tft' }],
      }).accounts,
    ).toHaveLength(2);
  });
});

describe('external id 비노출', () => {
  it('GameAccountView는 external_id를 출력하지 않는다(strip)', () => {
    const parsed = GameAccountView.parse({ ...lolAccount, external_id: 'puuid-secret' });
    expect('external_id' in parsed).toBe(false);
  });
});

describe('primary account', () => {
  it('대표·부계정 표시, rank는 null 허용', () => {
    const sub = { ...lolAccount, id: ID2, display_name: '감자튀김#0101', is_primary: false, rank: null };
    expect(SetPrimaryGameAccountResponse.parse({ accounts: [lolAccount, sub] }).accounts[1]?.is_primary).toBe(false);
    expect(GameAccountView.safeParse({ ...lolAccount, is_primary: undefined }).success).toBe(false);
  });
  it('경로', () => {
    expect(fillPath(ApiPath.myGameAccountPrimary, { id: ID })).toBe(`/me/game-accounts/${ID}/primary`);
  });
});

describe('my game accounts & sync', () => {
  it('GET /me/game-accounts', () => {
    const limits = { riot_accounts_max: 3, steam_accounts_max: 1 };
    expect(
      GetMyGameAccountsResponse.parse({ accounts: [lolAccount], riot_verification: null, sync_quota: quota, limits }).limits,
    ).toEqual(limits);
    expect(GetMyGameAccountsResponse.safeParse({ accounts: [], riot_verification: null, sync_quota: quota }).success).toBe(false);
  });
  it('POST sync 응답', () => {
    const r = SyncGameAccountResponse.parse({
      accounts: [{ ...lolAccount, sync: { ...syncIdle, state: 'queued' } }],
      sync_quota: quota,
      quota_consumed: true,
    });
    expect(r.quota_consumed).toBe(true);
    expect(() =>
      SyncGameAccountResponse.parse({
        accounts: [{ ...lolAccount, sync: { ...syncIdle, error: { code: 'STEAM_PRIVATE', at: T } } }],
        sync_quota: quota,
        quota_consumed: false,
      }),
    ).toThrow();
  });
});

describe('profile', () => {
  const base = {
    user: { id: ID, nickname: '새벽감자', role: 'member', avatar_url: null, discord_linked: true, joined_at: T },
    is_self: false,
    game_accounts: [],
    tiers: [],
    main_position: null,
    recent_matches: null,
    sync_quota: null,
    scrim: null,
    badges: null,
  };
  it('빈 프로필(연동 없음)', () => {
    expect(GetUserProfileResponse.parse(base).scrim).toBeNull();
  });
  it('S3·P2 자리는 S1에서 null만 허용', () => {
    expect(GetUserProfileResponse.safeParse({ ...base, scrim: { elo: 1421 } }).success).toBe(false);
    expect(GetUserProfileResponse.safeParse({ ...base, badges: [] }).success).toBe(false);
  });
  it('티어·주 포지션·최근 전적', () => {
    const p = GetUserProfileResponse.parse({
      ...base,
      is_self: true,
      game_accounts: [lolAccount],
      tiers: [
        {
          game_account_id: ID,
          game: 'lol',
          queue: 'RANKED_SOLO_5x5',
          rank: { tier: 'EMERALD', division: 'III', lp: 12, wins: 48, losses: 41 },
          synced_at: T,
        },
        { game_account_id: ID2, game: 'tft', queue: 'RANKED_TFT', rank: null, synced_at: null },
      ],
      main_position: {
        source: 'riot_ranked_solo',
        sample_size: 20,
        positions: [
          { position: 'top', count: 14, ratio: 0.7 },
          { position: 'jungle', count: 4, ratio: 0.2 },
        ],
      },
      recent_matches: {
        items: [
          {
            id: ID,
            played_at: T,
            win: true,
            champion_id: 266,
            champion_key: 'Aatrox',
            champion_name: '아트록스',
            champion_image_url: null,
            position: 'top',
            kills: 7,
            deaths: 3,
            assists: 9,
            duration_sec: 1872,
          },
        ],
        synced_at: T,
        refresh_queued: false,
      },
      sync_quota: quota,
    });
    expect(p.tiers).toHaveLength(2);
    expect(
      GetUserProfileResponse.safeParse({
        ...base,
        main_position: { source: 'riot_ranked_solo', sample_size: 3, positions: [] },
      }).success,
    ).toBe(false);
  });
  it('LolMatchSummary 저장 형식', () => {
    expect(
      LolMatchSummary.parse({
        queue_id: 420,
        champion_id: 266,
        champion_key: 'Aatrox',
        position: null,
        kills: 0,
        deaths: 0,
        assists: 0,
        duration_sec: 900,
      }).queue_id,
    ).toBe(420);
  });
});

describe('transitions & paths', () => {
  it('소유 확인 전이', () => {
    expect(canTransition(RIOT_LINK_VERIFICATION_TRANSITIONS, 'pending', 'verified')).toBe(true);
    expect(canTransition(RIOT_LINK_VERIFICATION_TRANSITIONS, 'expired', 'pending')).toBe(false);
    expect(canTransition(RIOT_LINK_VERIFICATION_TRANSITIONS, 'verified', 'cancelled')).toBe(false);
  });
  it('동기화 상태 전이', () => {
    expect(canTransition(GAME_ACCOUNT_SYNC_STATE_TRANSITIONS, 'idle', 'queued')).toBe(true);
    expect(canTransition(GAME_ACCOUNT_SYNC_STATE_TRANSITIONS, 'idle', 'idle')).toBe(false);
    // 멈춘 행 전용 전이(계약 6-1)
    expect(canTransition(GAME_ACCOUNT_SYNC_STATE_TRANSITIONS, 'running', 'queued')).toBe(true);
    expect(canTransition(GAME_ACCOUNT_SYNC_STATE_TRANSITIONS, 'running', 'running')).toBe(true);
    expect(canTransition(GAME_ACCOUNT_SYNC_STATE_TRANSITIONS, 'queued', 'queued')).toBe(true);
    expect(isStaleOnlySyncTransition('running', 'queued')).toBe(true);
    expect(isStaleOnlySyncTransition('queued', 'queued')).toBe(true);
    expect(isStaleOnlySyncTransition('queued', 'running')).toBe(false);
    expect(isStaleOnlySyncTransition('running', 'idle')).toBe(false);
  });
  it('fillPath', () => {
    expect(fillPath(ApiPath.userProfile, { id: ID })).toBe(`/users/${ID}/profile`);
    expect(fillPath(ApiPath.riotVerificationConfirm, { id: 'a/b' })).toBe('/me/game-accounts/riot-verifications/a%2Fb/confirm');
    expect(() => fillPath(ApiPath.myGameAccountSync, {})).toThrow();
  });
  it('스팀 claimed_id 형식', () => {
    expect('https://steamcommunity.com/openid/id/76561198000000000'.match(STEAM_CLAIMED_ID_PATTERN)?.[1]).toBe(
      '76561198000000000',
    );
    expect(STEAM_CLAIMED_ID_PATTERN.test('https://evil.com/openid/id/76561198000000000')).toBe(false);
    expect(STEAM_CLAIMED_ID_PATTERN.test('https://steamcommunity.com/openid/id/76561198000000000/x')).toBe(false);
  });
});
