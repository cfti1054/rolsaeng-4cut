import { z } from 'zod';
import { paginated } from './common/pagination';
import { IsoDateTime, Uuid } from './common/primitives';
import { GameCode } from './constants/games';
import { RankTier, RiotDivision } from './constants/riot';
import { ScrimUserRef } from './scrims';
import { SeasonRef } from './seasons';

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
