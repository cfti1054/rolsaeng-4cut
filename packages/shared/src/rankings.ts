import { z } from 'zod';
import { paginated } from './common/pagination';
import { IsoDateTime, Uuid } from './common/primitives';
import type { ActivityType } from './constants/enums';
import { GameCode } from './constants/games';
import { RankTier, RiotDivision } from './constants/riot';
import { ScrimUserRef } from './scrims';
import { SeasonRef } from './seasons';
import { SteamAppId } from './steam-apps';

// =============================================================================
// S4 티어·내전 ELO 랭킹(문서 6장 /rankings/tier·/rankings/elo, 7-3, 8장 /rankings, 목업 Rankings)
// 계약: _workspace/01_architect_contract.md 4·7절
//
// 응답 공통 규칙
// - 랭킹은 요청마다 계산하지 않는다. 진행 중 시즌과 티어는 ranking_caches(5분), 종료 처리된 시즌은 season_standings.
// - items는 순위 순 전체(최대 RANKING_ITEMS_MAX). 페이지를 나누지 않으므로 next_cursor는 항상 null(D75·D120과 같은 방식).
//   5분마다 순위가 바뀌는 스냅샷을 커서로 넘기면 행이 빠지거나 겹친다(D154).
// - me: 요청자의 행. 캐시 전체에서 찾으므로 items가 잘려도 값이 있다. 순위권 밖이면 null.
// - rank_change: 양수 = 오름. 이번 KST 주 시작 기준(D153). 기준 자료가 없으면 null(화면 `—`), 변동 없음은 0(화면 `—`).
// =============================================================================

/** 캐시 갱신 주기(분). 문서 7-3 「5분 단위」. cron 식이 고정이라 환경 변수가 아니다 */
export const RANKING_CACHE_INTERVAL_MIN = 5;
/** 마지막 성공이 이 초보다 오래되면 stale=true(주기 2번 + 1분) */
export const RANKING_STALE_AFTER_SEC = 660;
/** 응답 items 최대 행 수. 넘는 순위는 me로만 내려간다 */
export const RANKING_ITEMS_MAX = 200;
/** ELO 랭킹 노출 최소 경기 수(RANKING_ELO_MIN_GAMES 기본값, 문서 7-3). 화면은 응답 min_games를 쓴다(D101) */
export const RANKING_ELO_MIN_GAMES_DEFAULT = 5;

/** 티어 랭킹이 있는 게임. shared RANKED_QUEUE_BY_GAME 키와 같다(계약 테스트로 확인) */
export const TierRankingGame = z.enum(['lol', 'tft']);
export type TierRankingGame = z.infer<typeof TierRankingGame>;

const RankingRank = z.number().int().min(1);
const RankChange = z.number().int().nullable();

/**
 * 티어 랭킹 1행. 대표 계정(D56)의 해당 큐 최신 스냅샷. 언랭·라이엇 미연동 제외.
 * score = 티어 × 400 + 디비전 × 100 + LP(문서 7-3, core tierScore).
 */
export const TierRankingEntry = z.object({
  rank: RankingRank,
  user: ScrimUserRef,
  /** 대표 계정 표시 이름(`게임이름#태그`). 목업 「미드고정#KR1」 */
  account_name: z.string(),
  tier: RankTier.exclude(['UNRANKED']),
  division: RiotDivision.nullable(),
  lp: z.number().int().min(0),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  score: z.number().int().min(0),
  rank_change: RankChange,
});
export type TierRankingEntry = z.infer<typeof TierRankingEntry>;

/** ELO 랭킹 1행. win_rate = wins ÷ games(소수 셋째 자리), games ≥ 1이라 null이 아니다 */
export const EloRankingEntry = z.object({
  rank: RankingRank,
  user: ScrimUserRef,
  elo: z.number().int(),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  games: z.number().int().min(1),
  win_rate: z.number().min(0).max(1),
  rank_change: RankChange,
});
export type EloRankingEntry = z.infer<typeof EloRankingEntry>;

// -----------------------------------------------------------------------------
// GET /rankings/tier?game=
// -----------------------------------------------------------------------------

/** game 필수. 티어가 없는 게임(steam)은 VALIDATION_FAILED */
export const GetTierRankingQuery = z.object({ game: TierRankingGame });
export type GetTierRankingQuery = z.infer<typeof GetTierRankingQuery>;

/**
 * synced_at: 이 응답을 만든 캐시의 마지막 성공 계산 시각(문서 9장 「갱신 시각」).
 * stale: 마지막 갱신이 실패했거나 RANKING_STALE_AFTER_SEC보다 오래됨 → 화면은 마지막 성공값 + 「갱신 지연」 표시.
 * total: 순위권 전체 인원(items가 잘려도 전체 수).
 */
export const GetTierRankingResponse = paginated(TierRankingEntry).extend({
  game: TierRankingGame,
  total: z.number().int().min(0),
  me: TierRankingEntry.nullable(),
  synced_at: IsoDateTime,
  stale: z.boolean(),
});
export type GetTierRankingResponse = z.infer<typeof GetTierRankingResponse>;

// -----------------------------------------------------------------------------
// GET /rankings/elo?game=&season=
// -----------------------------------------------------------------------------

/**
 * game 필수. season 생략 → 현재 시즌, 없으면 starts_at ≤ now인 가장 최근 시즌, 그것도 없으면 season null·빈 목록.
 * 없는 season id → NOT_FOUND. 아직 시작 전인 시즌 → 빈 목록.
 */
export const GetEloRankingQuery = z.object({
  game: GameCode,
  season: Uuid.optional(),
});
export type GetEloRankingQuery = z.infer<typeof GetEloRankingQuery>;

/**
 * is_final: true면 종료 처리된 시즌의 season_standings(값이 다시 바뀌지 않음, rank_change 항상 null, synced_at = closed_at, stale false).
 * false면 ranking_caches. 끝났지만 아직 종료 처리 전인 시즌도 false다.
 * min_games: 노출 기준 경기 수(서버 설정 현재값). 화면 규칙 문구는 이 값으로 만든다.
 * synced_at: season이 null이거나 시작 전 시즌이면 null.
 */
export const GetEloRankingResponse = paginated(EloRankingEntry).extend({
  game: GameCode,
  season: SeasonRef.nullable(),
  is_final: z.boolean(),
  min_games: z.number().int().min(1),
  total: z.number().int().min(0),
  me: EloRankingEntry.nullable(),
  synced_at: IsoDateTime.nullable(),
  stale: z.boolean(),
});
export type GetEloRankingResponse = z.infer<typeof GetEloRankingResponse>;

// =============================================================================
// 서버 내부 저장 형식(와이어 아님): ranking_caches.payload·baseline_ranks JSON
// 읽을 때 이 스키마로 parse한다. 형식이 맞지 않으면(배포로 필드가 바뀐 경우) 캐시 없음으로 보고 다시 계산한다.
// =============================================================================

/** ranking_caches.payload — 키 `rankings:tier:{game}`. entries는 순위 순 전체(잘라내지 않음) */
export const TierRankingCachePayload = z.object({ entries: z.array(TierRankingEntry) });
export type TierRankingCachePayload = z.infer<typeof TierRankingCachePayload>;

/** ranking_caches.payload — 키 `rankings:elo:{game}:{season_id}` */
export const EloRankingCachePayload = z.object({ entries: z.array(EloRankingEntry) });
export type EloRankingCachePayload = z.infer<typeof EloRankingCachePayload>;

/** ranking_caches.baseline_ranks — { user_id: 기준 순위 } */
export const RankingBaselineRanks = z.record(Uuid, RankingRank);
export type RankingBaselineRanks = z.infer<typeof RankingBaselineRanks>;

// =============================================================================
// S5 활동·플레이타임 랭킹(문서 2장 P1, 6장 /rankings/activity·/rankings/playtime, 7-3, 목업 Rankings 활동·플레이타임 탭)
// 계약: _workspace/01_architect_contract.md 7절
//
// 같은 ranking_caches 경로(5분 작업, 첫 요청 동기 계산, 실패 시 마지막 성공값 + stale)를 쓴다(D215).
// 페이징 없음(next_cursor null, 최대 RANKING_ITEMS_MAX행, total 제공) — 티어·ELO와 같다(D154).
// =============================================================================

/** 활동 랭킹 기간. week = 이번 KST 주(월요일 00:00 시작), month = 이번 KST 달(1일 00:00 시작). 문서 7-3 */
export const ActivityPeriod = z.enum(['week', 'month']);
export type ActivityPeriod = z.infer<typeof ActivityPeriod>;

/**
 * 랭킹 시간에 넣는 활동 type. 사용자 결정(Q3 답, D232): 음성만. 목업 「VOICE TIME · 디스코드 음성 채널 접속 시간 합계」.
 * - play: 봇이 계속 보내고(POST /bot/activity) 저장만 한다. 어떤 활동 집계에도 쓰지 않는다(D240)
 * - chat: duration_sec이 항상 0이라 시간에 들어가지 않고, 활동 일수(active_days)와 「이번 주 활동 멤버」에만 쓴다(D210)
 */
export const ACTIVITY_RANKED_TYPES = ['voice'] as const satisfies readonly ActivityType[];

/**
 * 「활동」으로 세는 type. 활동 일수(active_days)와 홈 「이번 주 활동 멤버」(community.active_members)에 쓴다.
 * 사용자 결정(D240): play는 「우리 채팅방 사람들과 같이 한 게임」이라는 보장이 없어 모든 활동 집계에서 뺀다(수신·저장만).
 */
export const ACTIVITY_COUNTED_TYPES = ['voice', 'chat'] as const satisfies readonly ActivityType[];

/** 주 게임 칩 최대 개수(목업 「롤 협곡 · 롤체」) */
export const ACTIVITY_MAIN_GAMES_MAX = 2;

/** 활동 행의 게임(games 행 요약) */
export const ActivityGameRef = z.object({ code: GameCode, name: z.string() });
export type ActivityGameRef = z.infer<typeof ActivityGameRef>;

/**
 * 활동 랭킹 1행. 기간 안에 started_at이 있는 활동만 센다(세션을 기간 경계에서 나누지 않는다, D212).
 * - total_sec = voice_sec(정렬 기준, ACTIVITY_RANKED_TYPES = voice만, D232). 0인 멤버는 순위에 없다.
 *   두 필드가 같은 값이지만 둘 다 둔다: total_sec은 봇 랭킹 value·화면 정렬 기준 이름이고, voice_sec은 출처를 밝힌다.
 *   play_sec 필드는 없다(S5 최초 계약에서 제거)
 * - active_days: 기간 안에서 활동(ACTIVITY_COUNTED_TYPES = voice·chat, play 제외)이 하나라도 있는 KST 날짜 수. 화면 「7일 중 6일 활동」(D240)
 * - main_games: game이 있는 voice 시간 합이 큰 게임 순 최대 2개(같으면 games.sort_order). 없으면 []
 * - scrim_count: 참고 열(D239). 같은 기간 [period_start, period_end)에 시작한 내전 중 그 회원이 참가 확정(joined)이고
 *   결과가 승인(approved)된 내전 수. 대기·취소·노쇼 참가와 취소된 내전, 결과 대기·반려 내전은 세지 않는다.
 *   기간 기준 = 내전 시작 시각 COALESCE(started_at, scheduled_at)의 KST. 정렬·total_sec·순위 포함 여부에 쓰지 않는다
 *   (내전만 있고 음성이 0인 회원은 순위에 없다)
 * - rank_change: 직전 기간(지난주·지난달) 마지막 순위 − 현재 순위. 직전 기간 자료가 없으면 null(D216)
 * 동점: total_sec DESC → active_days DESC → user id ASC
 */
export const ActivityRankingEntry = z
  .object({
    rank: RankingRank,
    user: ScrimUserRef,
    total_sec: z.number().int().min(1),
    voice_sec: z.number().int().min(1),
    active_days: z.number().int().min(1).max(31),
    main_games: z.array(ActivityGameRef).max(ACTIVITY_MAIN_GAMES_MAX),
    scrim_count: z.number().int().min(0),
    rank_change: RankChange,
  })
  .refine((e) => e.total_sec === e.voice_sec, {
    path: ['total_sec'],
    message: 'total_sec은 voice_sec과 같아야 한다(D232)',
  });
export type ActivityRankingEntry = z.infer<typeof ActivityRankingEntry>;

// -----------------------------------------------------------------------------
// GET /rankings/activity?period=
// -----------------------------------------------------------------------------

/** period 생략 → week */
export const GetActivityRankingQuery = z.object({ period: ActivityPeriod.default('week') });
export type GetActivityRankingQuery = z.infer<typeof GetActivityRankingQuery>;

/**
 * period_start·period_end: 집계 구간 [start, end), +09:00 표기. 화면 「이번 주 (10.26 – 11.01)」는 end − 1ms의 날짜까지.
 * period_days: 구간의 KST 날짜 수(주 7, 달 28–31). 화면 「{period_days}일 중 {active_days}일 활동」
 * bot_connected: 봇이 활동(activity_logs) 또는 접속 현황(bot_presence)을 한 번이라도 보냈는가.
 *   false면 화면은 빈 목록을 「봇 연동 전」으로, true면 「이 기간 활동 기록이 없어요」로 구분한다(가짜 숫자 금지).
 */
export const GetActivityRankingResponse = paginated(ActivityRankingEntry).extend({
  period: ActivityPeriod,
  period_start: IsoDateTime,
  period_end: IsoDateTime,
  period_days: z.number().int().min(1).max(31),
  bot_connected: z.boolean(),
  total: z.number().int().min(0),
  me: ActivityRankingEntry.nullable(),
  synced_at: IsoDateTime,
  stale: z.boolean(),
});
export type GetActivityRankingResponse = z.infer<typeof GetActivityRankingResponse>;

/**
 * 플레이타임 랭킹 1행. 대표 스팀 계정(verified, is_primary)의 steam_playtime 마지막 성공값(문서 9장).
 * 지금 비공개 프로필이어도 마지막 성공값은 남는다(S1 6-2 「실패해도 지우지 않는다」).
 * - account_name: 스팀 표시 이름(personaname). 스팀 ID 숫자는 내리지 않는다(D38)
 * - minutes_total: playtime_forever(분). 0인 행은 순위에 없다
 * - minutes_recent: playtime_2weeks(분)
 * - rank_change: 티어와 같은 주간 기준(D153)
 * 동점: minutes_total DESC → minutes_recent DESC → user id ASC
 */
export const PlaytimeRankingEntry = z.object({
  rank: RankingRank,
  user: ScrimUserRef,
  account_name: z.string(),
  minutes_total: z.number().int().min(1),
  minutes_recent: z.number().int().min(0),
  rank_change: RankChange,
});
export type PlaytimeRankingEntry = z.infer<typeof PlaytimeRankingEntry>;

// -----------------------------------------------------------------------------
// GET /rankings/playtime?app_id=
// -----------------------------------------------------------------------------

/**
 * app_id 필수(게임 기본값을 서버에 박지 않는다). 게임 선택지는 GET /steam-apps(q 없음)를 쓴다.
 * 그 목록의 owner_count는 이 랭킹의 보유자 수와 같은 조건이라(D234) 첫 항목은 순위가 빈 게임이 아니다.
 * 화면 기본값은 pickDefaultPlaytimeAppId(steam-apps.ts)
 */
export const GetPlaytimeRankingQuery = z.object({ app_id: z.coerce.number().pipe(SteamAppId) });
export type GetPlaytimeRankingQuery = z.infer<typeof GetPlaytimeRankingQuery>;

/** 랭킹의 스팀 게임. name = steam_playtime.app_name(멤버 중 한 명이라도 가진 경우). 아무도 없으면 null */
export const PlaytimeRankingApp = z.object({ app_id: SteamAppId, name: z.string().min(1).nullable() });
export type PlaytimeRankingApp = z.infer<typeof PlaytimeRankingApp>;

/**
 * synced_at·stale: 랭킹 캐시 기준(티어와 같음). 그 게임을 가진 멤버가 없어도 빈 결과(entries [])를 캐시에 저장하므로
 *   synced_at은 항상 계산 시각이다(D235, S5 최초 계약의 「null」을 바꿈). 보유자 없음은 items [] + app.name null로 안다.
 * playtime_synced_at: 순위에 든 행의 steam_playtime.synced_at 중 가장 최근 값(하루 1회 05:00 KST 동기화 시각). 행이 없으면 null.
 */
export const GetPlaytimeRankingResponse = paginated(PlaytimeRankingEntry).extend({
  app: PlaytimeRankingApp,
  total: z.number().int().min(0),
  me: PlaytimeRankingEntry.nullable(),
  synced_at: IsoDateTime,
  stale: z.boolean(),
  playtime_synced_at: IsoDateTime.nullable(),
});
export type GetPlaytimeRankingResponse = z.infer<typeof GetPlaytimeRankingResponse>;

/**
 * 5분 작업이 미리 갱신하는 스팀 게임 수. 그 게임을 가진 대표 스팀 계정 수가 많은 순(같으면 app_id ASC).
 * 밖의 게임은 첫 요청 때 계산해 저장하고(보유자 0명이어도 빈 결과를 저장, D235), 다음 작업 주기에 지운다
 * → 어떤 app_id든 최대 5분에 한 번만 계산된다(D217).
 * GET /steam-apps(q 없음, STEAM_APP_SEARCH_LIMIT개)는 같은 조건·같은 순서라 그 목록은 모두 이 대상 안에 있다(D234).
 */
export const RANKING_PLAYTIME_APPS_MAX = 50;

/** ranking_caches.payload — 키 `rankings:activity:{period}`. period_start가 현재 구간과 다르면 캐시 없음으로 본다(D216) */
export const ActivityRankingCachePayload = z.object({
  period: ActivityPeriod,
  period_start: IsoDateTime,
  period_end: IsoDateTime,
  period_days: z.number().int().min(1).max(31),
  bot_connected: z.boolean(),
  entries: z.array(ActivityRankingEntry),
});
export type ActivityRankingCachePayload = z.infer<typeof ActivityRankingCachePayload>;

/** ranking_caches.payload — 키 `rankings:playtime:{app_id}`. 보유자 없음 = entries [], app.name null, playtime_synced_at null(D235) */
export const PlaytimeRankingCachePayload = z.object({
  app: PlaytimeRankingApp,
  playtime_synced_at: IsoDateTime.nullable(),
  entries: z.array(PlaytimeRankingEntry),
});
export type PlaytimeRankingCachePayload = z.infer<typeof PlaytimeRankingCachePayload>;
