import { describe, expect, it } from 'vitest';
import * as shared from './index';
import {
  ApiPath,
  BALANCE_ELO_WEIGHT_MAX,
  BALANCE_FULL_WEIGHT_GAMES,
  EloRankingCachePayload,
  GetMyPositionSuggestionsQuery,
  GetMyPositionSuggestionsResponse,
  RATING_START_ELO,
  RatingPolicyView,
  ErrorCode,
  GAME_SEED,
  GetDashboardSummaryBody,
  GetDashboardSummaryResponse,
  GetEloRankingQuery,
  GetEloRankingResponse,
  GetTierRankingQuery,
  GetTierRankingResponse,
  GetUserProfileResponse,
  RANKED_QUEUE_BY_GAME,
  RankingBaselineRanks,
  SEASON_BADGE_PLACES,
  SEASON_BADGE_SEED,
  SEASON_CLOSE_GRACE_SEC,
  TierRankingEntry,
  TierRankingGame,
  parseSeasonBadgeCode,
  seasonBadgeCode,
} from './index';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const T = '2026-10-30T12:00:00.000Z';
const user = { id: ID, nickname: '새벽감자', avatar_url: null };
const season = { id: ID2, name: '시즌 1', starts_at: T, ends_at: T };

const tierRow = {
  rank: 1,
  user,
  account_name: '새벽감자#KR1',
  tier: 'DIAMOND',
  division: 'II',
  lp: 45,
  wins: 10,
  losses: 5,
  score: 2645,
  rank_change: null,
};
const eloRow = { rank: 1, user, elo: 1421, wins: 17, losses: 11, games: 28, win_rate: 0.607, rank_change: -1 };

describe('S4 경로·오류·상수', () => {
  it('경로 3개', () => {
    expect(ApiPath.rankingsTier).toBe('/rankings/tier');
    expect(ApiPath.rankingsElo).toBe('/rankings/elo');
    expect(ApiPath.dashboardSummary).toBe('/dashboard/summary');
  });
  it('S4는 오류 코드를 추가하지 않는다', () => {
    expect(ErrorCode.options).toHaveLength(43);
  });
  it('티어 랭킹 게임 = 랭크 큐가 있는 게임', () => {
    expect([...TierRankingGame.options].sort()).toEqual(Object.keys(RANKED_QUEUE_BY_GAME).sort());
  });
  it('종료 유예 > 승인 트랜잭션 상한 15초', () => {
    expect(SEASON_CLOSE_GRACE_SEC).toBeGreaterThan(15);
  });
});

describe('시즌 뱃지', () => {
  it('시드 = 게임 수 × 3, 코드 유일', () => {
    expect(SEASON_BADGE_SEED).toHaveLength(GAME_SEED.length * SEASON_BADGE_PLACES.length);
    expect(new Set(SEASON_BADGE_SEED.map((b) => b.code)).size).toBe(SEASON_BADGE_SEED.length);
  });
  it('코드 왕복', () => {
    expect(seasonBadgeCode('lol', 1)).toBe('season_lol_top1');
    expect(parseSeasonBadgeCode('season_tft_top3')).toEqual({ game: 'tft', place: 3 });
  });
  it('시즌 뱃지가 아닌 코드는 null', () => {
    expect(parseSeasonBadgeCode('season_lol_top4')).toBeNull();
    expect(parseSeasonBadgeCode('season_unknown_top1')).toBeNull();
    expect(parseSeasonBadgeCode('scrims_50')).toBeNull();
  });
});

describe('GET /rankings/tier', () => {
  it('game 필수, 티어 없는 게임 거부', () => {
    expect(GetTierRankingQuery.safeParse({}).success).toBe(false);
    expect(GetTierRankingQuery.safeParse({ game: 'steam' }).success).toBe(false);
    expect(GetTierRankingQuery.parse({ game: 'tft' }).game).toBe('tft');
  });
  it('언랭은 행이 될 수 없다', () => {
    expect(TierRankingEntry.safeParse({ ...tierRow, tier: 'UNRANKED', division: null }).success).toBe(false);
  });
  it('응답 모양: items·next_cursor + 갱신 시각', () => {
    const r = GetTierRankingResponse.parse({
      items: [tierRow],
      next_cursor: null,
      game: 'lol',
      total: 1,
      me: tierRow,
      synced_at: T,
      stale: false,
    });
    expect(r.me?.score).toBe(2645);
    expect(GetTierRankingResponse.safeParse({ items: [], next_cursor: null, game: 'lol', total: 0, me: null, stale: false }).success).toBe(false);
  });
  it('외부 식별자 필드는 parse로 걸러진다', () => {
    const parsed = TierRankingEntry.parse({ ...tierRow, puuid: 'secret' }) as Record<string, unknown>;
    expect(parsed.puuid).toBeUndefined();
  });
});

describe('GET /rankings/elo', () => {
  it('game 필수, season은 uuid', () => {
    expect(GetEloRankingQuery.safeParse({}).success).toBe(false);
    expect(GetEloRankingQuery.safeParse({ game: 'lol', season: 'current' }).success).toBe(false);
    expect(GetEloRankingQuery.safeParse({ game: 'steam', season: ID2 }).success).toBe(true);
  });
  it('시즌 없음: season·synced_at null, 빈 목록', () => {
    const r = GetEloRankingResponse.parse({
      items: [],
      next_cursor: null,
      game: 'lol',
      season: null,
      is_final: false,
      min_games: 5,
      total: 0,
      me: null,
      synced_at: null,
      stale: false,
    });
    expect(r.season).toBeNull();
  });
  it('캐시 payload·기준 순위 형식', () => {
    expect(EloRankingCachePayload.parse({ entries: [eloRow] }).entries).toHaveLength(1);
    expect(RankingBaselineRanks.parse({ [ID]: 3 })[ID]).toBe(3);
    expect(RankingBaselineRanks.safeParse({ [ID]: 0 }).success).toBe(false);
  });
});

describe('GET /dashboard/summary', () => {
  const base = {
    season: { ...season, days_left: 34, progress: 0.667 },
    rating_policy: { min_games: 5, k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5, full_weight_games: 10, elo_weight_max: 0.2 },
    next_scrim: null,
    recruiting: [],
    stats: { recruiting_scrims: 3, scrims_this_week: 11, week_start: '2026-10-26T00:00:00.000+09:00' },
    top_rankers: { game: 'lol', season, is_final: false, items: [eloRow], synced_at: T, stale: false },
    top_rankers_state: 'ready',
    recent_results: [
      {
        scrim_id: ID,
        title: '일요일 협곡 내전',
        game: { code: 'lol', name: '리그 오브 레전드', has_positions: true, has_teams: true, positions: ['top'] },
        at: T,
        result_status: 'approved',
        outcome: { winner_team: 'blue', winner: null },
        rating_status: 'applied',
        elo_swing: 16,
      },
    ],
    me: { game: 'lol', elo: 1421, rank: 3, games: 28 },
  };
  it('채운 응답', () => {
    const r = GetDashboardSummaryResponse.parse(base);
    expect(r.me?.rank).toBe(3);
    expect(r.top_rankers?.items[0]?.elo).toBe(1421);
  });
  it('패배 배율은 0–1만 허용(후속 D169)', () => {
    const at = (loss_ratio: number) => ({ ...base, rating_policy: { ...base.rating_policy, loss_ratio } });
    expect(GetDashboardSummaryResponse.safeParse(at(1)).success).toBe(true);
    expect(GetDashboardSummaryResponse.safeParse(at(0)).success).toBe(true);
    expect(GetDashboardSummaryResponse.safeParse(at(1.1)).success).toBe(false);
  });
  it('시즌 공백·첫 화면: null 필드 허용', () => {
    const r = GetDashboardSummaryResponse.parse({
      ...base,
      season: null,
      top_rankers: null,
      top_rankers_state: 'no_season',
      me: null,
      recent_results: [],
    });
    expect(r.season).toBeNull();
  });
  it('봇 데이터 필드는 없다(S5)', () => {
    const r = GetDashboardSummaryResponse.parse({ ...base, stats: { ...base.stats, voice_online: 23 } }) as unknown as {
      stats: Record<string, unknown>;
    };
    expect(r.stats.voice_online).toBeUndefined();
  });
  it('상위 랭커 6명 거부', () => {
    const items = Array.from({ length: 6 }, () => eloRow);
    expect(GetDashboardSummaryResponse.safeParse({ ...base, top_rankers: { ...base.top_rankers, items } }).success).toBe(false);
  });

  describe('top_rankers_state(21절, D196–D198)', () => {
    const block = base.top_rankers;
    const parse = (top_rankers: unknown, top_rankers_state: unknown) =>
      GetDashboardSummaryResponse.safeParse({ ...base, top_rankers, top_rankers_state });
    it('ready ↔ 객체, 행 0개도 ready', () => {
      expect(parse(block, 'ready').success).toBe(true);
      const r = parse({ ...block, items: [] }, 'ready');
      expect(r.success && r.data.top_rankers_state === 'ready' && r.data.top_rankers.items).toEqual([]);
    });
    it('no_season·unavailable ↔ null', () => {
      expect(parse(null, 'no_season').success).toBe(true);
      expect(parse(null, 'unavailable').success).toBe(true);
    });
    it('맞지 않는 조합 거부', () => {
      expect(parse(null, 'ready').success).toBe(false);
      expect(parse(block, 'no_season').success).toBe(false);
      expect(parse(block, 'unavailable').success).toBe(false);
    });
    it('필수: 없거나 모르는 값이면 거부', () => {
      const { top_rankers_state: _s, ...noState } = base;
      expect(GetDashboardSummaryResponse.safeParse(noState).success).toBe(false);
      expect(parse(block, 'stale').success).toBe(false);
    });
    it('부분 실패여도 나머지 필드는 그대로(시즌 카드·모집·통계)', () => {
      const r = GetDashboardSummaryResponse.parse({ ...base, top_rankers: null, top_rankers_state: 'unavailable' });
      expect(r.season?.days_left).toBe(34);
      expect(r.stats.recruiting_scrims).toBe(3);
      expect(r.me?.rank).toBe(3);
    });
    it('모양 검사용 Body는 조합을 보지 않고 strict로 쓸 수 있다', () => {
      expect(GetDashboardSummaryBody.strict().safeParse({ ...base, top_rankers: null }).success).toBe(true);
      expect(GetDashboardSummaryBody.strict().safeParse({ ...base, extra: 1 }).success).toBe(false);
    });
  });
});

describe('프로필 뱃지(S4)', () => {
  const base = {
    user: { id: ID, nickname: '새벽감자', role: 'member', avatar_url: null, discord_linked: true, joined_at: T },
    is_self: false,
    game_accounts: [],
    tiers: [],
    main_position: null,
    recent_matches: null,
    sync_quota: null,
    scrim: null,
    badges: [] as unknown[],
  };
  it('뱃지 배열', () => {
    const p = GetUserProfileResponse.parse({
      ...base,
      badges: [
        { id: ID, code: 'season_lol_top1', name: '리그 오브 레전드 시즌 1위', description: null, earned_at: T, season, game: 'lol', place: 1 },
      ],
    });
    expect(p.badges?.[0]?.place).toBe(1);
  });
  it('순위 뱃지 범위 밖 거부', () => {
    const bad = { id: ID, code: 'x', name: 'x', description: null, earned_at: T, season: null, game: null, place: 4 };
    expect(GetUserProfileResponse.safeParse({ ...base, badges: [bad] }).success).toBe(false);
  });
});

describe('S4 후속 변경 2: 시작 점수·밸런스 비중·라인 추천(20절)', () => {
  it('시작 점수 1000, ELO 최대 비중 0.2, 기준 경기 수 10(설정값 아님)', () => {
    expect(RATING_START_ELO).toBe(1000);
    expect(BALANCE_ELO_WEIGHT_MAX).toBe(0.2);
    expect(BALANCE_FULL_WEIGHT_GAMES).toBe(10);
  });
  it('소프트 리셋 상수는 없다(D183)', () => {
    expect((shared as Record<string, unknown>).SEASON_SOFT_RESET_RATIO_DEFAULT).toBeUndefined();
  });
  it('요약 rating_policy: soft_reset_ratio 없음, 밸런스 비중 필수', () => {
    const policy = GetDashboardSummaryBody.shape.rating_policy;
    const ok = { min_games: 5, k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5, full_weight_games: 10, elo_weight_max: 0.2 };
    expect(policy.parse({ ...ok, soft_reset_ratio: 0.5 })).not.toHaveProperty('soft_reset_ratio');
    const { elo_weight_max: _w, ...noWeight } = ok;
    expect(policy.safeParse(noWeight).success).toBe(false);
    expect(policy.safeParse({ ...ok, elo_weight_max: 1.2 }).success).toBe(false);
  });
  it('밸런스 rating_policy: elo_weight_max 필수, 0–1', () => {
    const ok = { k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5, full_weight_games: 10, elo_weight_max: 0.2 };
    expect(RatingPolicyView.parse(ok).elo_weight_max).toBe(0.2);
    const { elo_weight_max: _w, ...noWeight } = ok;
    expect(RatingPolicyView.safeParse(noWeight).success).toBe(false);
    expect(RatingPolicyView.safeParse({ ...ok, elo_weight_max: -0.1 }).success).toBe(false);
  });
  it('GET /me/position-suggestions 경로·쿼리', () => {
    expect(ApiPath.myPositionSuggestions).toBe('/me/position-suggestions');
    expect(GetMyPositionSuggestionsQuery.safeParse({}).success).toBe(false);
    expect(GetMyPositionSuggestionsQuery.parse({ game: 'lol' }).game).toBe('lol');
  });
  it('추천 응답: 0–2개, 중복 금지, 근거 수 ≤ 20', () => {
    const ok = { game: 'lol', positions: ['mid', 'top'], sample_size: 18, synced_at: T };
    expect(GetMyPositionSuggestionsResponse.parse(ok).positions).toEqual(['mid', 'top']);
    expect(GetMyPositionSuggestionsResponse.parse({ ...ok, game: 'tft', positions: [], sample_size: 0, synced_at: null }).positions).toEqual([]);
    expect(GetMyPositionSuggestionsResponse.safeParse({ ...ok, positions: ['mid', 'mid'] }).success).toBe(false);
    expect(GetMyPositionSuggestionsResponse.safeParse({ ...ok, positions: ['mid', 'top', 'bot'] }).success).toBe(false);
    expect(GetMyPositionSuggestionsResponse.safeParse({ ...ok, sample_size: 21 }).success).toBe(false);
  });
  it('S4 후속 변경 2도 오류 코드를 추가하지 않는다', () => {
    expect(ErrorCode.options).toHaveLength(43);
  });
});
