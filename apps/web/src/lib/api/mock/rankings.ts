import {
  buildEloRanking,
  buildTierRanking,
  computeRankChange,
  computeSeasonBadges,
  computeSeasonStandings,
  isRankingStale,
  kstWeekWindow,
  latestStartedSeason,
  resolveSeasonAt,
  seasonDaysLeft,
  seasonProgress,
  type EloPolicy,
} from '@gcd/core';
import {
  ApiPath,
  DASHBOARD_NEXT_SCRIM_AVATARS_MAX,
  DASHBOARD_RECENT_RESULTS_LIMIT,
  DASHBOARD_RECRUITING_LIMIT,
  DASHBOARD_TOP_RANKERS_LIMIT,
  GetActivityRankingQuery,
  GetDashboardSummaryResponse,
  GetEloRankingQuery,
  GetPlaytimeRankingQuery,
  GetEloRankingResponse,
  GetTierRankingQuery,
  GetTierRankingResponse,
  BALANCE_ELO_WEIGHT_MAX,
  BALANCE_FULL_WEIGHT_GAMES,
  RANKING_CACHE_INTERVAL_MIN,
  RANKING_ELO_MIN_GAMES_DEFAULT,
  RANKING_ITEMS_MAX,
  SEASON_CLOSE_GRACE_SEC,
  seasonBadgeCode,
  seasonBadgeSeed,
  type DashboardCommunity,
  type DashboardRecentResult,
  type EloRankingEntry,
  type ErrorCode,
  type GameCode,
  type GameSeed,
  type Me,
  type ProfileBadge,
  type RankTier,
  type RiotDivision,
  type ScrimRatingStatus,
  type ScrimSummary,
  type ScrimUserRef,
  type SteamAppOption,
  type TierRankingEntry,
  type TierRankingGame,
} from '@gcd/shared';
import { z } from 'zod';
import { activityResponse, mockActivityLogs, mockCommunity, mockPresence, playtimeResponse, scenarioLogs, type MockBotScenario, type MockScrimJoin } from './community';
import { currentSeason, mockEloStandings, seasonRef, type MockResult, type MockSeason, type S3Data } from './ratings';

/**
 * [목] S4 GET /rankings/tier·elo, /dashboard/summary, 프로필 badges(계약 4·8절).
 * 순위·점수·시즌 계산은 @gcd/core를 import한다(공식 복사본 없음). 설정값은 shared `*_DEFAULT`(목 전용, D101).
 *
 * - 캐시 흉내: synced_at = 5분 단위로 내린 시각, rank_change = 이번 KST 주 시작 시점 순위 대비(D153).
 * - 종료 작업은 없다(계약 10절). 끝난 시즌(ends_at + 유예 ≤ now)은 저장된 ratings로 읽기 때 순위·뱃지를 계산해
 *   season_standings처럼 내려 준다. 새 시즌 행은 승인 때 RATING_START_ELO로 만든다(이월 없음, 20절).
 * - S5 활동·플레이타임·홈 community는 community.ts(gcd-mock-bot). 패치 값은 만들지 않는다.
 *
 * 상태 확인: localStorage `gcd-mock-rankings`에 아래 값을 넣고 새로고침한다.
 *   stale      마지막 갱신 실패 + 오래된 synced_at
 *   final      현재 시즌 없음 → 사이드바 「다음 시즌 준비 중」, 랭킹·홈 is_final
 *   no_season  시즌이 하나도 없음
 *   empty      시즌은 있고 순위·내전·결과가 없음. S5: 활동 기록 없음(봇은 연결), 스팀 보유 게임 목록 빔
 *   error      랭킹·요약 엔드포인트 INTERNAL_ERROR
 *   loading    세 엔드포인트가 오래 걸림
 *   me_outside 내 행이 items 밖(맨 아래 한 줄)
 *   me_error   세션 부팅(/auth/refresh, /me)이 5xx → 요약이 시작되지 않는 상태
 */

export const MOCK_RANKING_SCENARIO_KEY = 'gcd-mock-rankings';
export const MockRankingScenario = z.enum([
  'stale',
  'final',
  'no_season',
  'empty',
  'error',
  'loading',
  'me_outside',
  'me_error',
  'top_unavailable',
]);
export type MockRankingScenario = z.infer<typeof MockRankingScenario>;

export interface MockRankingOptions {
  scenario?: () => MockRankingScenario | null;
  /** S5 봇 상태(community.ts, localStorage gcd-mock-bot). 없으면 live */
  bot?: () => MockBotScenario | null;
}

const MIN_GAMES = RANKING_ELO_MIN_GAMES_DEFAULT;
const INTERVAL_MS = RANKING_CACHE_INTERVAL_MIN * 60_000;

// -----------------------------------------------------------------------------
// 티어 표(목 멤버별 고정 스냅샷). 칼바람러는 언랭이라 없다, lastWeekRank null은 주 시작 기준 없음(`—`)
// -----------------------------------------------------------------------------

interface MockTierRow {
  nickname: string | null; // null = 로그인 사용자
  tag: string;
  tier: Exclude<RankTier, 'UNRANKED'>;
  division: RiotDivision | null;
  lp: number;
  wins: number;
  losses: number;
  /** 이번 KST 주가 시작될 때의 순위(기준 순위 흉내) */
  lastWeekRank: number | null;
}

const row = (nickname: string | null, tag: string, tier: MockTierRow['tier'], division: RiotDivision | null, lp: number, wins: number, losses: number, lastWeekRank: number | null): MockTierRow => ({
  nickname,
  tag,
  tier,
  division,
  lp,
  wins,
  losses,
  lastWeekRank,
});

const LOL_TIER: readonly MockTierRow[] = [
  row('미드고정', 'KR1', 'DIAMOND', 'II', 45, 61, 40, 1),
  row('무한점멸', 'KR2', 'DIAMOND', 'IV', 12, 48, 44, 3),
  row('정글차이', 'KR2', 'EMERALD', 'I', 80, 52, 47, 2),
  row(null, 'KR1', 'EMERALD', 'III', 12, 48, 41, 4),
  row('한타각', 'KR1', 'EMERALD', 'IV', 67, 39, 37, 6),
  row('별빛미드', 'STAR', 'PLATINUM', 'I', 30, 44, 42, 7),
  row('원딜장인', 'ADC', 'PLATINUM', 'IV', 55, 35, 36, 5),
  row('서폿요정', 'KR1', 'GOLD', 'I', 90, 30, 29, 8),
  row('바론스틸', 'KR3', 'GOLD', 'II', 20, 26, 28, 9),
  row('와드지기', 'WARD', 'SILVER', 'I', 40, 21, 24, 10),
  row('용용이', 'KR1', 'BRONZE', 'II', 15, 12, 16, null),
];

const TFT_TIER: readonly MockTierRow[] = [
  row('체스왕', 'TFT', 'MASTER', null, 210, 34, 110, 1),
  row('용용이', 'KR1', 'PLATINUM', 'II', 44, 18, 90, 3),
  row('별빛미드', 'STAR', 'PLATINUM', 'IV', 12, 15, 82, 2),
  row(null, 'KR1', 'GOLD', 'I', 33, 12, 80, 4),
  row('와드지기', 'WARD', 'GOLD', 'III', 70, 9, 70, null),
];

// -----------------------------------------------------------------------------
// 공통
// -----------------------------------------------------------------------------

const ALL_PATHS: readonly string[] = [ApiPath.rankingsTier, ApiPath.rankingsElo, ApiPath.dashboardSummary, ApiPath.rankingsActivity, ApiPath.rankingsPlaytime];
export const isRankingPath = (path: string): boolean => ALL_PATHS.includes(path);

const iso = (t: number) => new Date(t).toISOString();

/** 시나리오가 바꾼 저장소 보기. 원본은 건드리지 않는다 */
export function scenarioState<T extends S3Data>(st: T, scenario: MockRankingScenario | null, now: number): T {
  if (scenario === 'no_season') return { ...st, seasons: [] };
  if (scenario === 'empty') return { ...st, ratings: [], results: [], history: [] };
  if (scenario === 'final') {
    const cur = currentSeason(st, now);
    return { ...st, seasons: st.seasons.filter((s) => s.id !== cur?.id) };
  }
  return st;
}

/** 캐시 메타: synced_at + stale(core isRankingStale). stale 시나리오는 갱신 실패를 흉내 낸다 */
export function cacheMeta(now: number, scenario: MockRankingScenario | null): { synced_at: string; stale: boolean } {
  const failed = scenario === 'stale';
  const computedAt = failed ? now - 23 * 60_000 : Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
  const lastFailedAt = failed ? new Date(now - 3 * 60_000) : null;
  return { synced_at: iso(computedAt), stale: isRankingStale({ computedAt: new Date(computedAt), lastFailedAt, now: new Date(now) }) };
}

const toLike = (s: MockSeason) => ({ id: s.id, startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), row: s });

/** 종료 작업이 돌았을 시각. 목에는 closed_at이 없어 ends_at + 유예로 친다 */
const closedAtOf = (s: MockSeason) => Date.parse(s.ends_at) + SEASON_CLOSE_GRACE_SEC * 1000;
const isClosed = (s: MockSeason, now: number) => closedAtOf(s) <= now;

/** 이번 KST 주 시작 시점 순위: 그 전 이력으로 레이팅을 되돌려 계산 */
export function baselineEloRanks(st: S3Data, game: GameCode, season: MockSeason, weekStart: number): Record<string, number> {
  const byUser = new Map<string, { userId: string; elo: number; wins: number; losses: number; t: number }>();
  for (const h of st.history) {
    const t = Date.parse(h.created_at);
    if (h.game !== game || h.season_id !== season.id || t >= weekStart) continue;
    const cur = byUser.get(h.user_id) ?? { userId: h.user_id, elo: h.elo_after, wins: 0, losses: 0, t: 0 };
    if (t >= cur.t) Object.assign(cur, { elo: h.elo_after, t });
    if (h.outcome === 'win') cur.wins += 1;
    else cur.losses += 1;
    byUser.set(h.user_id, cur);
  }
  return Object.fromEntries(buildEloRanking({ rows: [...byUser.values()], minGames: MIN_GAMES }).map((e) => [e.userId, e.rank]));
}

function eloEntries(st: S3Data, input: { game: GameCode; season: MockSeason; now: number; final: boolean; userRef: (id: string) => ScrimUserRef }): EloRankingEntry[] {
  const baseline = input.final ? {} : baselineEloRanks(st, input.game, input.season, kstWeekWindow(new Date(input.now)).start.getTime());
  return mockEloStandings(st, input.game, input.season.id).map((e) => ({
    rank: e.rank,
    user: input.userRef(e.userId),
    elo: e.elo,
    wins: e.wins,
    losses: e.losses,
    games: e.games,
    win_rate: e.winRate ?? 0,
    rank_change: input.final ? null : computeRankChange(baseline[e.userId], e.rank),
  }));
}

/** me_outside: 내 행을 items에서 뺀다. 표 끝에 붙는 한 줄 확인용 */
function page<T extends { user: { id: string } }>(entries: readonly T[], meId: string, scenario: MockRankingScenario | null) {
  const me = entries.find((e) => e.user.id === meId) ?? null;
  const shown = scenario === 'me_outside' ? entries.filter((e) => e.user.id !== meId) : entries;
  return { items: shown.slice(0, RANKING_ITEMS_MAX), next_cursor: null, total: entries.length, me };
}

// -----------------------------------------------------------------------------
// GET /rankings/tier
// -----------------------------------------------------------------------------

function tierEntries(game: TierRankingGame, ctx: { me: Me; members: readonly ScrimUserRef[] }): TierRankingEntry[] {
  const refOf = (r: MockTierRow): ScrimUserRef | undefined =>
    r.nickname === null ? { id: ctx.me.id, nickname: ctx.me.nickname, avatar_url: ctx.me.avatar_url } : ctx.members.find((u) => u.nickname === r.nickname);
  const rows = (game === 'lol' ? LOL_TIER : TFT_TIER).flatMap((r) => {
    const user = refOf(r);
    return user ? [{ ...r, user, userId: user.id }] : [];
  });
  return buildTierRanking(rows).map((e) => ({
    rank: e.rank,
    user: e.user,
    account_name: `${e.user.nickname}#${e.tag}`,
    tier: e.tier,
    division: e.division,
    lp: e.lp,
    wins: e.wins,
    losses: e.losses,
    score: e.score,
    rank_change: computeRankChange(e.lastWeekRank ?? undefined, e.rank),
  }));
}

function tierResponse(game: TierRankingGame, ctx: { me: Me; members: readonly ScrimUserRef[]; now: number; scenario: MockRankingScenario | null }): GetTierRankingResponse {
  const entries = ctx.scenario === 'empty' ? [] : tierEntries(game, ctx);
  return GetTierRankingResponse.parse({ ...page(entries, ctx.me.id, ctx.scenario), game, ...cacheMeta(ctx.now, ctx.scenario) });
}

// -----------------------------------------------------------------------------
// GET /rankings/elo
// -----------------------------------------------------------------------------

function defaultSeason(st: S3Data, now: number): MockSeason | null {
  const likes = st.seasons.map(toLike);
  const at = new Date(now);
  return resolveSeasonAt(likes, at)?.row ?? latestStartedSeason(likes, at)?.row ?? null;
}

interface EloSource {
  items: readonly EloRankingEntry[];
  is_final: boolean;
  synced_at: string | null;
  stale: boolean;
}

/** 계약 4-2 표 */
function eloSource(st: S3Data, game: GameCode, season: MockSeason, ctx: { now: number; scenario: MockRankingScenario | null; userRef: (id: string) => ScrimUserRef }): EloSource {
  if (Date.parse(season.starts_at) > ctx.now) return { items: [], is_final: false, synced_at: null, stale: false };
  if (isClosed(season, ctx.now)) {
    return { items: eloEntries(st, { game, season, now: ctx.now, final: true, userRef: ctx.userRef }), is_final: true, synced_at: iso(closedAtOf(season)), stale: false };
  }
  return { items: eloEntries(st, { game, season, now: ctx.now, final: false, userRef: ctx.userRef }), is_final: false, ...cacheMeta(ctx.now, ctx.scenario) };
}

function eloResponse(st: S3Data, game: GameCode, season: MockSeason | null, ctx: { me: Me; now: number; scenario: MockRankingScenario | null; userRef: (id: string) => ScrimUserRef }): GetEloRankingResponse {
  if (!season) {
    return GetEloRankingResponse.parse({ items: [], next_cursor: null, game, season: null, is_final: false, min_games: MIN_GAMES, total: 0, me: null, synced_at: null, stale: false });
  }
  const src = eloSource(st, game, season, ctx);
  return GetEloRankingResponse.parse({
    ...page(src.items, ctx.me.id, ctx.scenario),
    game,
    season: seasonRef(season),
    is_final: src.is_final,
    min_games: MIN_GAMES,
    synced_at: src.synced_at,
    stale: src.stale,
  });
}

// -----------------------------------------------------------------------------
// GET /dashboard/summary
// -----------------------------------------------------------------------------

/** 홈 요약에 필요한 내전 행(목 MockScrim의 일부) */
export interface RankingScrim {
  id: string;
  game: GameCode;
  title: string;
  status: string;
  scheduled_at: string;
  rated: boolean;
}

interface SummaryCtx {
  community: DashboardCommunity;
  policy: EloPolicy;
  me: Me;
  now: number;
  scenario: MockRankingScenario | null;
  scrims: readonly RankingScrim[];
  games: readonly GameSeed[];
  userRef: (id: string) => ScrimUserRef;
  summary: (s: RankingScrim) => ScrimSummary;
  joinedUsers: (s: RankingScrim) => ScrimUserRef[];
}

const isOpen = (s: { status: string }) => s.status === 'recruiting' || s.status === 'full';
const bySchedule = (a: RankingScrim, b: RankingScrim) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at) || (a.id < b.id ? -1 : 1);

function recentResults(st: S3Data, ctx: SummaryCtx): DashboardRecentResult[] {
  const at = (r: MockResult) => r.approved_at ?? r.created_at;
  const approved = st.results.filter((r) => r.status === 'approved').sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));
  const pending = st.results.filter((r) => r.status === 'pending').sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));
  const merged = [...approved.slice(0, DASHBOARD_RECENT_RESULTS_LIMIT), ...pending.slice(0, DASHBOARD_RECENT_RESULTS_LIMIT)].sort(
    (a, b) => Date.parse(at(b)) - Date.parse(at(a)) || (a.scrim_id < b.scrim_id ? -1 : 1),
  );
  return merged.slice(0, DASHBOARD_RECENT_RESULTS_LIMIT).flatMap((r) => {
    const s = ctx.scrims.find((x) => x.id === r.scrim_id);
    const game = ctx.games.find((g) => g.code === s?.game);
    if (!s || !game) return [];
    const history = st.history.filter((h) => h.result_id === r.id);
    const rating_status: ScrimRatingStatus = !s.rated ? 'not_rated' : r.status === 'pending' ? 'waiting' : history.length > 0 ? 'applied' : 'skipped';
    const first = r.placements?.find((p) => p.placement === 1);
    return [
      {
        scrim_id: s.id,
        title: s.title,
        game: { code: game.code, name: game.name, has_positions: game.has_positions, has_teams: game.has_teams, positions: [...game.positions] },
        at: at(r),
        result_status: r.status as 'pending' | 'approved',
        outcome: { winner_team: r.winner_team, winner: first ? ctx.userRef(first.user_id) : null },
        rating_status,
        elo_swing: game.has_teams && rating_status === 'applied' ? Math.max(...history.map((h) => Math.abs(h.elo_after - h.elo_before))) : null,
      },
    ];
  });
}

function dashboardResponse(st: S3Data, ctx: SummaryCtx): GetDashboardSummaryResponse {
  const { now, me } = ctx;
  const nowDate = new Date(now);
  const cur = currentSeason(st, now);
  const shownSeason = cur ?? defaultSeason(st, now);

  // 상위 랭커: sort_order 순으로 처음 행이 있는 게임, 전부 비면 첫 게임(계약 8-2)
  let top: GetDashboardSummaryResponse['top_rankers'] = null;
  let topState: GetDashboardSummaryResponse['top_rankers_state'] = 'no_season';
  if (ctx.games.length === 0 && shownSeason) {
    topState = 'unavailable';
  } else if (shownSeason) {
    topState = 'ready';
    const sources = ctx.games.map((g) => ({ game: g.code, src: eloSource(st, g.code, shownSeason, ctx) }));
    const pick = sources.find((x) => x.src.items.length > 0) ?? sources[0]!;
    top = {
      game: pick.game,
      season: seasonRef(shownSeason),
      is_final: pick.src.is_final,
      items: pick.src.items.slice(0, DASHBOARD_TOP_RANKERS_LIMIT),
      synced_at: pick.src.synced_at,
      stale: pick.src.stale,
    };
  }
  if (ctx.scenario === 'top_unavailable' && shownSeason) {
    top = null;
    topState = 'unavailable';
  }

  // 다음 내전(계약 8-1)
  const open = ctx.scrims.filter(isOpen).sort(bySchedule);
  const mine = open.find((s) => ctx.joinedUsers(s).some((u) => u.id === me.id));
  const nextRow = mine ?? open.find((s) => s.status === 'recruiting' && Date.parse(s.scheduled_at) > now) ?? null;
  const next_scrim = nextRow
    ? {
        source: mine ? ('joined' as const) : ('recruiting' as const),
        scrim: ctx.summary(nextRow),
        participants: ctx.joinedUsers(nextRow).slice(0, DASHBOARD_NEXT_SCRIM_AVATARS_MAX),
      }
    : null;

  const week = kstWeekWindow(nowDate);
  const inWeek = (s: RankingScrim) => {
    const t = Date.parse(s.scheduled_at);
    return t >= week.start.getTime() && t < week.end.getTime() && s.status !== 'cancelled';
  };

  // 내 ELO: 현재 시즌 행 중 경기 수 최다(같으면 sort_order, 계약 8-2)
  const order = (g: GameCode) => ctx.games.findIndex((x) => x.code === g);
  const myRow = cur
    ? st.ratings
        .filter((r) => r.user_id === me.id && r.season_id === cur.id)
        .sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || order(a.game) - order(b.game))[0]
    : undefined;
  const myEntry = myRow && cur ? mockEloStandings(st, myRow.game, cur.id).find((e) => e.userId === me.id) : undefined;

  return GetDashboardSummaryResponse.parse({
    season: cur
      ? {
          ...seasonRef(cur),
          days_left: seasonDaysLeft(new Date(cur.ends_at), nowDate),
          progress: seasonProgress({ startsAt: new Date(cur.starts_at), endsAt: new Date(cur.ends_at) }, nowDate),
        }
      : null,
    rating_policy: {
      min_games: MIN_GAMES,
      k_base: ctx.policy.kBase,
      k_new: ctx.policy.kNew,
      new_player_games: ctx.policy.newPlayerGames,
      loss_ratio: ctx.policy.lossRatio,
      full_weight_games: BALANCE_FULL_WEIGHT_GAMES,
      elo_weight_max: BALANCE_ELO_WEIGHT_MAX,
    },
    next_scrim,
    recruiting: open
      .filter((s) => s.id !== nextRow?.id)
      .slice(0, DASHBOARD_RECRUITING_LIMIT)
      .map((s) => ctx.summary(s)),
    stats: { recruiting_scrims: open.length, scrims_this_week: ctx.scrims.filter(inWeek).length, week_start: week.start.toISOString() },
    // S5: 목 접속 현황·활동 기록(community.ts, gcd-mock-bot)
    community: ctx.community,
    top_rankers: top,
    top_rankers_state: topState,
    recent_results: recentResults(st, ctx),
    me: myRow
      ? {
          game: myRow.game,
          elo: myEntry?.elo ?? myRow.elo,
          rank: ctx.scenario === 'top_unavailable' ? null : (myEntry?.rank ?? null),
          games: myRow.wins + myRow.losses,
        }
      : null,
  });
}

// -----------------------------------------------------------------------------
// 프로필 badges
// -----------------------------------------------------------------------------

/** 끝난 시즌의 게임별 1·2·3위(core computeSeasonStandings·computeSeasonBadges). earned_at = ends_at, 코드는 shared */
export function mockProfileBadges(st: S3Data, input: { userId: string; now: number; games: readonly GameSeed[]; scenario: MockRankingScenario | null }): ProfileBadge[] {
  const view = scenarioState(st, input.scenario, input.now);
  const out: ProfileBadge[] = [];
  for (const season of view.seasons) {
    if (!isClosed(season, input.now)) continue;
    for (const game of input.games) {
      const rows = view.ratings.filter((r) => r.game === game.code && r.season_id === season.id).map((r) => ({ userId: r.user_id, elo: r.elo, wins: r.wins, losses: r.losses }));
      const badges = computeSeasonBadges(computeSeasonStandings({ rows, minGames: MIN_GAMES }));
      for (const b of badges) {
        if (b.userId !== input.userId) continue;
        const seed = seasonBadgeSeed(game).find((x) => x.code === seasonBadgeCode(game.code, b.place))!;
        out.push({
          id: `5c4b0000-0000-4000-8000-${String(out.length + 1).padStart(12, '0')}`,
          code: seed.code,
          name: seed.name,
          description: seed.description,
          earned_at: season.ends_at,
          season: seasonRef(season),
          game: game.code,
          place: b.place,
        });
      }
    }
  }
  return out.sort((a, b) => Date.parse(b.earned_at) - Date.parse(a.earned_at) || (a.id < b.id ? -1 : 1));
}

// -----------------------------------------------------------------------------
// 라우터
// -----------------------------------------------------------------------------

export interface MockRankingContext {
  policy: EloPolicy;
  method: string;
  path: string;
  search: URLSearchParams;
  me: Me;
  now: number;
  state: S3Data;
  scrims: readonly RankingScrim[];
  members: readonly ScrimUserRef[];
  userRef: (id: string) => ScrimUserRef;
  /** 목 내전 행 → ScrimSummary(scrims.ts) */
  summary: (s: RankingScrim) => ScrimSummary;
  /** joined 참가자, 슬롯 순서 */
  joinedUsers: (s: RankingScrim) => ScrimUserRef[];
  games: readonly GameSeed[];
  json: (status: number, body: unknown) => Response;
  error: (code: ErrorCode, message: string, opts?: { details?: { path: string; message: string }[] }) => Response;
  scenario: MockRankingScenario | null;
  /** S5 봇 상태(기본 live) */
  bot: MockBotScenario;
  /** S5 플레이타임 대상 게임(GET /steam-apps q 없음과 같은 목록) */
  steamApps: readonly SteamAppOption[];
  /** S5 활동 scrim_count 출처(승인된 내전 joined 참가, community.ts mockScrimJoins) */
  scrimJoins: readonly MockScrimJoin[];
}

/** 세 엔드포인트 + S5 활동·플레이타임. GET 외에는 NOT_FOUND */
export function handleRankings(ctx: MockRankingContext): Response {
  const { method, path, now, me, scenario, json, error } = ctx;
  if (method !== 'GET') return error('NOT_FOUND', `목에 없는 경로: ${method} ${path}`);
  if (scenario === 'error') return error('INTERNAL_ERROR', '목 오류 상태');
  if (scenario === 'top_unavailable' && path !== ApiPath.dashboardSummary) {
    return error('INTERNAL_ERROR', '목 랭킹 첫 계산 실패');
  }
  const empty = scenario === 'empty';
  const st = scenarioState(ctx.state, scenario, now);

  if (path === ApiPath.rankingsTier) {
    const q = GetTierRankingQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!q.success) return error('VALIDATION_FAILED', '쿼리가 올바르지 않습니다.', { details: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return json(200, tierResponse(q.data.game, { me, members: ctx.members, now, scenario }));
  }

  // S5 활동·플레이타임(계약 S5 4-1). 사용자 목록 = 나 + 목 멤버
  const userIds = [me.id, ...ctx.members.map((u) => u.id)];
  const logs = scenarioLogs(empty ? [] : mockActivityLogs(userIds, now), ctx.bot, now);
  const cache = cacheMeta(now, scenario);
  const meOutside = scenario === 'me_outside';
  if (path === ApiPath.rankingsActivity) {
    const q = GetActivityRankingQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!q.success) return error('VALIDATION_FAILED', '쿼리가 올바르지 않습니다.', { details: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return json(200, activityResponse({ period: q.data.period, now, logs, presence: mockPresence(ctx.bot, now) !== null, me, userRef: ctx.userRef, cache, meOutside, scrimJoins: empty ? [] : ctx.scrimJoins }));
  }
  if (path === ApiPath.rankingsPlaytime) {
    const q = GetPlaytimeRankingQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!q.success) return error('VALIDATION_FAILED', '쿼리가 올바르지 않습니다.', { details: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    return json(200, playtimeResponse({ appId: q.data.app_id, apps: empty ? [] : ctx.steamApps, userIds, now, me, userRef: ctx.userRef, cache, meOutside }));
  }

  if (path === ApiPath.rankingsElo) {
    const q = GetEloRankingQuery.safeParse(Object.fromEntries(ctx.search.entries()));
    if (!q.success) return error('VALIDATION_FAILED', '쿼리가 올바르지 않습니다.', { details: q.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    const season = q.data.season ? (st.seasons.find((s) => s.id === q.data.season) ?? null) : defaultSeason(st, now);
    if (q.data.season && !season) return error('NOT_FOUND', '시즌 없음');
    return json(200, eloResponse(st, q.data.game, season, { me, now, scenario, userRef: ctx.userRef }));
  }

  return json(
    200,
    dashboardResponse(st, {
      community: mockCommunity({ bot: ctx.bot, now, logs }),
      policy: ctx.policy,
      me,
      now,
      scenario,
      scrims: empty ? [] : ctx.scrims,
      games: ctx.games,
      userRef: ctx.userRef,
      summary: ctx.summary,
      joinedUsers: ctx.joinedUsers,
    }),
  );
}

