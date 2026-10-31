import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_COUNTED_TYPES,
  ACTIVITY_RANKED_TYPES,
  API_KEY_PATTERN,
  ActivityRankingCachePayload,
  ActivityRankingEntry,
  ApiKeyScope,
  ApiPath,
  BOT_ACTIVITY_BATCH_MAX,
  BOT_ENDPOINT_SCOPE,
  BOT_RANKING_LIMIT_MAX,
  BOT_RANKING_UNIT_BY_TYPE,
  BotRankingType,
  DASHBOARD_NOW_PLAYING_MAX,
  DashboardCommunity,
  ERROR_HTTP_STATUS,
  ErrorCode,
  GetActivityRankingQuery,
  GetActivityRankingResponse,
  GetBotRankingQueryByType,
  GetBotRankingResponse,
  GetBotUpcomingScrimsQuery,
  GetBotUserLookupResponse,
  GetDashboardSummaryResponse,
  GetPlaytimeRankingQuery,
  GetPlaytimeRankingResponse,
  PlaytimeRankingCachePayload,
  PostBotActivityRequest,
  PostBotActivityResponse,
  PostBotMemberEventsRequest,
  PutBotPresenceRequest,
  isLinkedDiscordId,
  pickDefaultPlaytimeAppId,
} from './index';

const ID = '11111111-1111-4111-8111-111111111111';
const T = '2026-10-30T12:00:00.000Z';
const SNOW = '123456789012345678';
const user = { id: ID, nickname: '새벽감자', avatar_url: null };
const botUser = { ...user, discord_id: SNOW, profile_url: 'https://gcd.example/members/' + ID };

describe('S5 경로·오류·scope', () => {
  it('경로', () => {
    expect(ApiPath.rankingsActivity).toBe('/rankings/activity');
    expect(ApiPath.rankingsPlaytime).toBe('/rankings/playtime');
    expect(ApiPath.botActivity).toBe('/bot/activity');
    expect(ApiPath.botUserLookup).toBe('/bot/users/lookup');
    expect(ApiPath.botUpcomingScrims).toBe('/bot/scrims/upcoming');
    expect(ApiPath.botRanking).toBe('/bot/rankings/:type');
    expect(ApiPath.botMemberEvents).toBe('/bot/member-events');
    expect(ApiPath.botPresence).toBe('/bot/presence');
  });
  it('오류 코드 2개 추가(전체 45개), 상태 표 일치', () => {
    const s5 = {
      API_KEY_INVALID: 401,
      API_KEY_SCOPE_MISSING: 403,
    } as const;
    for (const [c, status] of Object.entries(s5)) {
      expect(ErrorCode.options).toContain(c);
      expect(ERROR_HTTP_STATUS[c as ErrorCode]).toBe(status);
    }
    expect(ErrorCode.options).toHaveLength(46);
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ErrorCode.options].sort());
  });
  it('엔드포인트 scope는 모두 ApiKeyScope 값이고 서로 다르다', () => {
    const vals = Object.values(BOT_ENDPOINT_SCOPE);
    for (const v of vals) expect(ApiKeyScope.options).toContain(v);
    expect(new Set(vals).size).toBe(vals.length);
    expect(ApiKeyScope.options).toHaveLength(6);
    expect([...ApiKeyScope.options].sort()).toEqual([...vals].sort());
  });
  it('API 키 형식', () => {
    expect(API_KEY_PATTERN.test('gcd_' + 'A'.repeat(43))).toBe(true);
    expect(API_KEY_PATTERN.test('gcd_' + 'A'.repeat(42))).toBe(false);
    expect(API_KEY_PATTERN.test('xxx_' + 'A'.repeat(43))).toBe(false);
  });
});

describe('디스코드 연동 판정(연동 코드 기능 없음, D237)', () => {
  it('연동됨 = snowflake', () => {
    expect(isLinkedDiscordId(SNOW)).toBe(true);
    expect(isLinkedDiscordId('dev-alice')).toBe(false);
    expect(isLinkedDiscordId(null)).toBe(false);
    expect(isLinkedDiscordId('1234')).toBe(false);
  });
  it('연동 코드 export·경로·scope·오류 코드가 없다', async () => {
    const shared: Record<string, unknown> = await import('./index');
    for (const name of [
      'DISCORD_LINK_CODE_TTL_SEC',
      'DISCORD_LINK_CODE_DAILY_MAX',
      'DISCORD_LINK_CODE_ALPHABET',
      'DISCORD_LINK_CODE_TRANSITIONS',
      'DiscordLinkCodeState',
      'DiscordLinkCodeInput',
      'normalizeDiscordLinkCode',
      'formatDiscordLinkCode',
      'GetMyDiscordLinkResponse',
      'IssueDiscordLinkCodeResponse',
      'PostBotLinkRequest',
      'PostBotLinkResponse',
    ]) {
      expect(shared[name], name).toBeUndefined();
    }
    expect(Object.values(ApiPath)).not.toContain('/bot/link');
    expect(Object.values(ApiPath)).not.toContain('/me/discord-link');
    expect(Object.values(ApiPath)).not.toContain('/me/discord-link/code');
    expect(ApiKeyScope.options).not.toContain('bot:link');
    for (const c of ['DISCORD_LINK_CODE_INVALID', 'DISCORD_LINK_CODE_EXPIRED', 'DISCORD_ID_ALREADY_LINKED', 'DISCORD_ACCOUNT_ALREADY_LINKED']) {
      expect(ErrorCode.options as readonly string[]).not.toContain(c);
    }
  });
});

describe('POST /bot/activity', () => {
  const ev = {
    idempotency_key: 'voice-123456-20261027T2010',
    discord_id: SNOW,
    type: 'voice',
    game: 'lol',
    started_at: '2026-10-27T20:10:00+09:00',
    duration_sec: 3600,
  };
  it('문서 6장 예시가 그대로 통과', () => {
    const r = PostBotActivityRequest.parse({ events: [ev] });
    expect(r.events[0]?.game).toBe('lol');
  });
  it('game 생략·null 허용, 모르는 게임 거부', () => {
    const { game: _g, ...noGame } = ev;
    expect(PostBotActivityRequest.safeParse({ events: [noGame] }).success).toBe(true);
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, game: null }] }).success).toBe(true);
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, game: 'valorant' }] }).success).toBe(false);
  });
  it('chat은 duration 0만, voice·play는 1초 이상(D210)', () => {
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, type: 'chat', duration_sec: 0 }] }).success).toBe(true);
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, type: 'chat', duration_sec: 5 }] }).success).toBe(false);
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, duration_sec: 0 }] }).success).toBe(false);
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, duration_sec: 86_401 }] }).success).toBe(false);
  });
  it('오프셋 없는 시각·키 형식·건수 한도', () => {
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, started_at: '2026-10-27T20:10:00' }] }).success).toBe(false);
    expect(PostBotActivityRequest.safeParse({ events: [{ ...ev, idempotency_key: 'a b' }] }).success).toBe(false);
    expect(PostBotActivityRequest.safeParse({ events: [] }).success).toBe(false);
    const many = Array.from({ length: BOT_ACTIVITY_BATCH_MAX + 1 }, (_, i) => ({ ...ev, idempotency_key: `k${i}` }));
    expect(PostBotActivityRequest.safeParse({ events: many }).success).toBe(false);
    expect(PostBotActivityRequest.safeParse({ events: many.slice(0, BOT_ACTIVITY_BATCH_MAX) }).success).toBe(true);
  });
  it('건별 결과', () => {
    const r = PostBotActivityResponse.parse({
      results: [
        { idempotency_key: 'a', status: 'created', reason: null },
        { idempotency_key: 'b', status: 'rejected', reason: 'STARTED_AT_TOO_OLD' },
      ],
      counts: { created: 1, duplicate: 0, unlinked: 0, rejected: 1 },
    });
    expect(r.results).toHaveLength(2);
  });
  it('랭킹 시간에 쓰는 type은 voice만(D232), 활동으로 세는 type은 voice·chat(play 제외, D240). play 이벤트는 계속 받는다', () => {
    expect([...ACTIVITY_RANKED_TYPES]).toEqual(['voice']);
    expect([...ACTIVITY_COUNTED_TYPES]).toEqual(['voice', 'chat']);
    expect(ACTIVITY_COUNTED_TYPES).not.toContain('play');
    // 시간에 넣는 type은 모두 활동으로도 센다(집계 행을 COUNTED로 걸러도 voice_sec이 줄지 않는다)
    for (const ty of ACTIVITY_RANKED_TYPES) expect(ACTIVITY_COUNTED_TYPES).toContain(ty);
    const play = { idempotency_key: 'play-1', discord_id: SNOW, type: 'play', game: 'steam', started_at: T, duration_sec: 60 };
    expect(PostBotActivityRequest.safeParse({ events: [play] }).success).toBe(true);
  });
});

describe('봇 조회·알림·랭킹·입퇴장·접속 현황', () => {
  it('lookup 응답', () => {
    const r = GetBotUserLookupResponse.parse({
      user: { ...botUser, role: 'member', joined_at: T, left_at: null },
      tiers: [{ game: 'lol', account_name: '새벽감자#KR1', tier: 'EMERALD', division: 'III', lp: 12, synced_at: T }],
      season: null,
      ratings: [],
    });
    expect(r.tiers[0]?.tier).toBe('EMERALD');
    expect(
      GetBotUserLookupResponse.safeParse({ ...r, tiers: [{ ...r.tiers[0], tier: 'UNRANKED' }] }).success,
    ).toBe(false);
  });
  it('upcoming within_min 기본 60, 범위 1–1440', () => {
    expect(GetBotUpcomingScrimsQuery.parse({}).within_min).toBe(60);
    expect(GetBotUpcomingScrimsQuery.parse({ within_min: '30' }).within_min).toBe(30);
    expect(GetBotUpcomingScrimsQuery.safeParse({ within_min: '1441' }).success).toBe(false);
  });
  it('랭킹 type별 쿼리', () => {
    expect(GetBotRankingQueryByType.tier.safeParse({ game: 'steam' }).success).toBe(false);
    expect(GetBotRankingQueryByType.tier.parse({ game: 'lol' }).limit).toBe(10);
    expect(GetBotRankingQueryByType.elo.safeParse({}).success).toBe(false);
    expect(GetBotRankingQueryByType.activity.parse({}).period).toBe('week');
    expect(GetBotRankingQueryByType.playtime.safeParse({}).success).toBe(false);
    expect(GetBotRankingQueryByType.playtime.parse({ app_id: '578080' }).app_id).toBe(578080);
    expect(GetBotRankingQueryByType.elo.safeParse({ game: 'lol', limit: String(BOT_RANKING_LIMIT_MAX + 1) }).success).toBe(false);
    for (const t of BotRankingType.options) expect(BOT_RANKING_UNIT_BY_TYPE[t]).toBeDefined();
  });
  it('랭킹 응답', () => {
    const r = GetBotRankingResponse.parse({
      type: 'activity',
      unit: 'seconds',
      context: {
        game: null,
        season: null,
        is_final: false,
        period: 'week',
        period_start: '2026-10-26T00:00:00.000+09:00',
        period_end: '2026-11-02T00:00:00.000+09:00',
        app: null,
      },
      items: [{ rank: 1, user: botUser, value: 112800, detail: '7일 중 7일 활동', rank_change: 2 }],
      total: 1,
      synced_at: T,
      stale: false,
      web_url: 'https://gcd.example/rankings?tab=activity&period=week',
    });
    expect(r.items[0]?.user.discord_id).toBe(SNOW);
  });
  it('입퇴장 이벤트', () => {
    expect(PostBotMemberEventsRequest.parse({ events: [{ discord_id: SNOW, type: 'leave', occurred_at: T }] }).events).toHaveLength(1);
    expect(PostBotMemberEventsRequest.safeParse({ events: [{ discord_id: SNOW, type: 'kick', occurred_at: T }] }).success).toBe(false);
  });
  it('접속 현황', () => {
    const ok = { captured_at: T, voice_member_count: 23, playing: [{ name: 'League of Legends', game: 'lol', steam_app_id: null, count: 8 }] };
    expect(PutBotPresenceRequest.parse(ok).voice_member_count).toBe(23);
    expect(PutBotPresenceRequest.safeParse({ ...ok, playing: [{ ...ok.playing[0], count: 0 }] }).success).toBe(false);
    expect(PutBotPresenceRequest.safeParse({ ...ok, voice_member_count: -1 }).success).toBe(false);
  });
});

describe('GET /rankings/activity·/rankings/playtime', () => {
  const act = {
    rank: 1,
    user,
    total_sec: 112800,
    voice_sec: 112800,
    active_days: 7,
    main_games: [{ code: 'lol', name: '리그 오브 레전드' }, { code: 'tft', name: '전략적 팀 전투' }],
    scrim_count: 3,
    rank_change: 2,
  };
  it('쿼리', () => {
    expect(GetActivityRankingQuery.parse({}).period).toBe('week');
    expect(GetActivityRankingQuery.safeParse({ period: 'day' }).success).toBe(false);
    expect(GetPlaytimeRankingQuery.safeParse({}).success).toBe(false);
    expect(GetPlaytimeRankingQuery.safeParse({ app_id: 'abc' }).success).toBe(false);
    expect(GetPlaytimeRankingQuery.parse({ app_id: '578080' }).app_id).toBe(578080);
  });
  it('활동 행: 0초·주 게임 3개 거부', () => {
    expect(ActivityRankingEntry.parse(act).active_days).toBe(7);
    expect(ActivityRankingEntry.safeParse({ ...act, total_sec: 0, voice_sec: 0 }).success).toBe(false);
    expect(ActivityRankingEntry.safeParse({ ...act, main_games: [...act.main_games, act.main_games[0]] }).success).toBe(false);
  });
  it('활동 행: scrim_count 0 이상 정수 필수(D239), 정렬과 무관', () => {
    expect(ActivityRankingEntry.parse({ ...act, scrim_count: 0 }).scrim_count).toBe(0);
    expect(ActivityRankingEntry.safeParse({ ...act, scrim_count: -1 }).success).toBe(false);
    expect(ActivityRankingEntry.safeParse({ ...act, scrim_count: 1.5 }).success).toBe(false);
    const { scrim_count: _s, ...noCount } = act;
    expect(ActivityRankingEntry.safeParse(noCount).success).toBe(false);
  });
  it('활동 행: total_sec = voice_sec(D232), play_sec 없음', () => {
    expect(ActivityRankingEntry.safeParse({ ...act, total_sec: act.voice_sec + 1 }).success).toBe(false);
    expect('play_sec' in ActivityRankingEntry.parse({ ...act, play_sec: 5 })).toBe(false);
    // S5 최초 계약 모양(voice + play 합계)의 옛 캐시 행은 parse 실패 → 캐시 없음으로 다시 계산된다
    expect(ActivityRankingCachePayload.safeParse({
      period: 'week',
      period_start: '2026-10-26T00:00:00.000+09:00',
      period_end: '2026-11-02T00:00:00.000+09:00',
      period_days: 7,
      bot_connected: true,
      entries: [{ ...act, voice_sec: 100000, play_sec: 12800 }],
    }).success).toBe(false);
  });
  it('활동 응답·캐시 payload', () => {
    const period = {
      period: 'week',
      period_start: '2026-10-26T00:00:00.000+09:00',
      period_end: '2026-11-02T00:00:00.000+09:00',
      period_days: 7,
      bot_connected: true,
    };
    const r = GetActivityRankingResponse.parse({ ...period, items: [act], next_cursor: null, total: 1, me: act, synced_at: T, stale: false });
    expect(r.me?.rank).toBe(1);
    expect(ActivityRankingCachePayload.parse({ ...period, entries: [act] }).entries).toHaveLength(1);
  });
  it('플레이타임 응답: 보유자 없음이면 items []·name null, synced_at은 값(D235)', () => {
    const row = { rank: 1, user, account_name: '바론스틸', minutes_total: 128400, minutes_recent: 1080, rank_change: null };
    expect(
      GetPlaytimeRankingResponse.parse({
        items: [row],
        next_cursor: null,
        app: { app_id: 578080, name: 'PUBG: BATTLEGROUNDS' },
        total: 1,
        me: null,
        synced_at: T,
        stale: false,
        playtime_synced_at: T,
      }).items,
    ).toHaveLength(1);
    expect(
      GetPlaytimeRankingResponse.parse({
        items: [],
        next_cursor: null,
        app: { app_id: 1, name: null },
        total: 0,
        me: null,
        synced_at: T,
        stale: false,
        playtime_synced_at: null,
      }).app.name,
    ).toBeNull();
    expect(
      GetPlaytimeRankingResponse.safeParse({
        items: [],
        next_cursor: null,
        app: { app_id: 1, name: null },
        total: 0,
        me: null,
        synced_at: null,
        stale: false,
        playtime_synced_at: null,
      }).success,
    ).toBe(false);
    expect(
      PlaytimeRankingCachePayload.parse({ app: { app_id: 1, name: null }, playtime_synced_at: null, entries: [] }).entries,
    ).toEqual([]);
  });
  it('플레이타임 기본 게임: owner_count ≥ 1인 첫 항목(D234)', () => {
    expect(pickDefaultPlaytimeAppId([])).toBeNull();
    expect(
      pickDefaultPlaytimeAppId([
        { app_id: 10, owner_count: 0 },
        { app_id: 730, owner_count: 3 },
        { app_id: 578080, owner_count: 5 },
      ]),
    ).toBe(730);
    expect(pickDefaultPlaytimeAppId([{ app_id: 10, owner_count: 0 }])).toBeNull();
  });
});

describe('GET /dashboard/summary community(8절)', () => {
  const base = {
    season: null,
    rating_policy: { min_games: 5, k_base: 32, k_new: 40, new_player_games: 10, loss_ratio: 0.5, full_weight_games: 10, elo_weight_max: 0.2 },
    next_scrim: null,
    recruiting: [],
    stats: { recruiting_scrims: 3, scrims_this_week: 11, week_start: '2026-10-26T00:00:00.000+09:00' },
    top_rankers: null,
    top_rankers_state: 'no_season',
    recent_results: [],
    me: null,
  };
  const live = {
    voice: { state: 'live', member_count: 23, captured_at: T },
    active_members: { state: 'ready', count: 58 },
    now_playing: { captured_at: T, items: [{ name: 'League of Legends', game: 'lol', steam_app_id: null, count: 8 }] },
  };
  it('채운 블록', () => {
    const r = GetDashboardSummaryResponse.parse({ ...base, community: live });
    expect(r.community.voice.member_count).toBe(23);
  });
  it('community는 필수(배포 순서, 15절)', () => {
    expect(GetDashboardSummaryResponse.safeParse(base).success).toBe(false);
  });
  it('state와 값 조합: stale·not_connected에는 숫자가 없다(가짜 숫자 금지)', () => {
    expect(DashboardCommunity.safeParse({ ...live, voice: { state: 'stale', member_count: 23, captured_at: T } }).success).toBe(false);
    expect(DashboardCommunity.safeParse({ ...live, voice: { state: 'stale', member_count: null, captured_at: T } }).success).toBe(true);
    expect(DashboardCommunity.safeParse({ ...live, voice: { state: 'not_connected', member_count: null, captured_at: T } }).success).toBe(false);
    expect(DashboardCommunity.safeParse({ ...live, voice: { state: 'live', member_count: null, captured_at: T } }).success).toBe(false);
    expect(DashboardCommunity.safeParse({ ...live, active_members: { state: 'not_connected', count: 0 } }).success).toBe(false);
    expect(DashboardCommunity.safeParse({ ...live, active_members: { state: 'ready', count: 0 } }).success).toBe(true);
  });
  it('now_playing은 1–5행이거나 null', () => {
    expect(DashboardCommunity.safeParse({ ...live, now_playing: { captured_at: T, items: [] } }).success).toBe(false);
    const six = Array.from({ length: DASHBOARD_NOW_PLAYING_MAX + 1 }, (_, i) => ({ name: `g${i}`, game: null, steam_app_id: null, count: 1 }));
    expect(DashboardCommunity.safeParse({ ...live, now_playing: { captured_at: T, items: six } }).success).toBe(false);
    expect(DashboardCommunity.safeParse({ ...live, now_playing: null }).success).toBe(true);
  });
});
