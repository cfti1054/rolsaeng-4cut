import { z } from 'zod';
import { paginated } from './common/pagination';
import { DiscordSnowflake, IsoDateTime, Uuid } from './common/primitives';
import { ActivityType, ApiKeyScope, UserRole } from './constants/enums';
import { GameCode } from './constants/games';
import { RankTier, RiotDivision } from './constants/riot';
import { ActivityPeriod, TierRankingGame } from './rankings';
import { ScrimGameRef } from './scrims';
import { SeasonRef } from './seasons';
import { SteamAppId } from './steam-apps';

// =============================================================================
// S5 디스코드 봇 API(문서 6장 「디스코드 봇용 API」). 계약: _workspace/01_architect_contract.md 4·6절
//
// 인증: 헤더 X-API-Key. 키마다 scope(api_keys.scopes)를 두고 엔드포인트별로 검사한다(BOT_ENDPOINT_SCOPE).
//   키 없음·모름·폐기 → 401 API_KEY_INVALID, scope 없음 → 403 API_KEY_SCOPE_MISSING. JWT·쿠키는 보지 않는다.
// 와이어 형식은 웹과 같다(snake_case, 오프셋 있는 ISO 시각, 오류 { code, message }).
// 봇 요청 본문은 .strict(): 모르는 필드는 VALIDATION_FAILED(봇 쪽 오타를 바로 드러낸다, D209).
// 봇 응답에는 discord_id를 넣는다(봇이 멘션·DM에 쓴다). 웹 응답에는 여전히 넣지 않는다(D38).
// =============================================================================

/** 인증 헤더 이름(HTTP 헤더는 대소문자 무시. Nest는 소문자로 읽는다) */
export const BOT_API_KEY_HEADER = 'x-api-key';

/**
 * API 키 원문 형식: `gcd_` + 32바이트 난수 base64url(43자) = 47자.
 * 저장: key_hash = SHA-256(원문) hex, key_prefix = `gcd_` 뒤 8자(목록 식별용, 비밀 아님). 원문은 저장하지 않는다(문서 5장).
 */
export const API_KEY_PREFIX = 'gcd_';
export const API_KEY_RANDOM_BYTES = 32;
export const API_KEY_DISPLAY_PREFIX_LENGTH = 8;
export const API_KEY_PATTERN = /^gcd_[A-Za-z0-9_-]{43}$/;
/** last_used_at은 이 초보다 오래됐을 때만 다시 쓴다(요청마다 쓰기 방지, D221) */
export const API_KEY_LAST_USED_WRITE_INTERVAL_SEC = 60;

/** 엔드포인트 → 필요한 scope. 가드는 이 표만 본다 */
export const BOT_ENDPOINT_SCOPE = {
  activity: 'bot:activity',
  userLookup: 'bot:users:read',
  upcomingScrims: 'bot:scrims:read',
  rankings: 'bot:rankings:read',
  memberEvents: 'bot:members',
  presence: 'bot:presence',
} as const satisfies Record<string, ApiKeyScope>;

/** 봇이 보는 회원 참조. profile_url = `{WEB_ORIGIN}/members/{id}` */
export const BotUserRef = z.object({
  id: Uuid,
  nickname: z.string(),
  avatar_url: z.string().url().nullable(),
  /** 연동된 snowflake. 개발 사용자 등 미연동이면 null */
  discord_id: DiscordSnowflake.nullable(),
  profile_url: z.string().url(),
});
export type BotUserRef = z.infer<typeof BotUserRef>;

// -----------------------------------------------------------------------------
// POST /bot/activity (scope bot:activity) — 일괄 전송
// -----------------------------------------------------------------------------

/** 한 요청 최대 이벤트 수(메인 기본값 4, D211) */
export const BOT_ACTIVITY_BATCH_MAX = 100;
/** 한 이벤트 최대 길이(초) = 하루. 봇은 세션을 KST 자정에서 나눠 보낸다(D212) */
export const BOT_ACTIVITY_MAX_DURATION_SEC = 86_400;
/** started_at 과거 한도(일). 더 오래된 이벤트는 rejected STARTED_AT_TOO_OLD(D211) */
export const BOT_ACTIVITY_MAX_AGE_DAYS = 7;
/** 끝 시각(started_at + duration_sec) 미래 허용 오차(초). 넘으면 rejected ENDS_IN_FUTURE(D211) */
export const BOT_ACTIVITY_FUTURE_TOLERANCE_SEC = 300;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** 중복 방지 키. 문서 예시 `voice-123456-20261027T2010`. 영문·숫자·`. _ : -`만 */
export const IdempotencyKey = z
  .string()
  .min(1)
  .max(IDEMPOTENCY_KEY_MAX_LENGTH)
  .regex(/^[A-Za-z0-9._:-]+$/, 'idempotency_key: 영문·숫자·. _ : - 만');
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

/**
 * 활동 1건(문서 6장 예시와 같은 필드).
 * - game: games.code. 없거나 null이면 게임 없음. 모르는 코드는 VALIDATION_FAILED(게임은 데이터지만 코드 목록은 GameCode다)
 * - chat: duration_sec는 0이어야 한다(채팅은 시간이 아니라 「활동했음」 표시, D210). 봇은 회원·KST 날짜당 1건 권장
 *   (키 예 `chat-{discord_id}-20261027`)
 * - voice·play: 1초 이상
 * - play: 계속 받아 저장한다. 활동 랭킹 시간·주 게임·활동 일수·「이번 주 활동 멤버」 어디에도 쓰지 않는다(D240, 저장만)
 */
export const BotActivityEvent = z
  .object({
    idempotency_key: IdempotencyKey,
    discord_id: DiscordSnowflake,
    type: ActivityType,
    game: GameCode.nullable().optional(),
    started_at: IsoDateTime,
    duration_sec: z.number().int().min(0).max(BOT_ACTIVITY_MAX_DURATION_SEC),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.type === 'chat' && e.duration_sec !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['duration_sec'], message: 'chat은 duration_sec 0' });
    }
    if (e.type !== 'chat' && e.duration_sec < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['duration_sec'], message: 'voice·play는 1초 이상' });
    }
  });
export type BotActivityEvent = z.infer<typeof BotActivityEvent>;

export const PostBotActivityRequest = z
  .object({ events: z.array(BotActivityEvent).min(1).max(BOT_ACTIVITY_BATCH_MAX) })
  .strict();
export type PostBotActivityRequest = z.infer<typeof PostBotActivityRequest>;

/**
 * 건별 결과(D213). 요청 형식 오류는 요청 전체 400이고, 아래는 형식이 맞는 이벤트의 처리 결과다(요청은 200).
 * - created: 저장함
 * - duplicate: 같은 idempotency_key가 이미 저장됨(앞선 요청 또는 이 요청의 앞 이벤트). 내용이 달라도 먼저 온 것이 남는다
 * - unlinked: discord_id에 연결된 회원이 없음. 저장하지 않는다(나중에 연동해도 소급하지 않는다, 메인 기본값 1). 봇은 재전송하지 않는다
 * - rejected: 시각 범위 밖(reason). 저장하지 않는다. 키를 쓰지 않으므로 고쳐서 다시 보낼 수 있다
 * 판정 순서: 이 요청 안 중복 → 저장된 키 → 시각 → 연동 여부 → 저장(경합으로 충돌하면 duplicate)
 */
export const BotActivityResultStatus = z.enum(['created', 'duplicate', 'unlinked', 'rejected']);
export type BotActivityResultStatus = z.infer<typeof BotActivityResultStatus>;

export const BotActivityRejectReason = z.enum(['STARTED_AT_TOO_OLD', 'ENDS_IN_FUTURE']);
export type BotActivityRejectReason = z.infer<typeof BotActivityRejectReason>;

export const BotActivityResult = z.object({
  idempotency_key: IdempotencyKey,
  status: BotActivityResultStatus,
  /** rejected일 때만 값, 그 외 null */
  reason: BotActivityRejectReason.nullable(),
});
export type BotActivityResult = z.infer<typeof BotActivityResult>;

/** 200. results는 요청 events와 같은 순서·같은 길이 */
export const PostBotActivityResponse = z.object({
  results: z.array(BotActivityResult),
  counts: z.object({
    created: z.number().int().min(0),
    duplicate: z.number().int().min(0),
    unlinked: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
});
export type PostBotActivityResponse = z.infer<typeof PostBotActivityResponse>;

// -----------------------------------------------------------------------------
// GET /bot/users/lookup?discord_id= (scope bot:users:read)
// -----------------------------------------------------------------------------

export const GetBotUserLookupQuery = z.object({ discord_id: DiscordSnowflake });
export type GetBotUserLookupQuery = z.infer<typeof GetBotUserLookupQuery>;

/** 대표 라이엇 계정의 최신 티어(프로필과 같은 출처). 언랭·스냅샷 없음이면 그 게임 행이 없다 */
export const BotUserTier = z.object({
  game: TierRankingGame,
  account_name: z.string(),
  tier: RankTier.exclude(['UNRANKED']),
  division: RiotDivision.nullable(),
  lp: z.number().int().min(0),
  synced_at: IsoDateTime.nullable(),
});
export type BotUserTier = z.infer<typeof BotUserTier>;

/** 현재 시즌 내전 레이팅. rank는 랭킹 캐시의 순위(경기 수 미달·캐시 없음이면 null, 프로필과 같은 규칙) */
export const BotUserRating = z.object({
  game: GameCode,
  elo: z.number().int(),
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  rank: z.number().int().min(1).nullable(),
});
export type BotUserRating = z.infer<typeof BotUserRating>;

/**
 * 200. 연결된 회원이 없으면 404 NOT_FOUND.
 * left_at: 서버를 나갔다고 기록된 시각(POST /bot/member-events). 재입장하면 null
 * season: 현재 시즌(없으면 null, 그러면 ratings [])
 */
export const GetBotUserLookupResponse = z.object({
  user: BotUserRef.extend({ role: UserRole, joined_at: IsoDateTime, left_at: IsoDateTime.nullable() }),
  tiers: z.array(BotUserTier),
  season: SeasonRef.nullable(),
  ratings: z.array(BotUserRating),
});
export type GetBotUserLookupResponse = z.infer<typeof GetBotUserLookupResponse>;

// -----------------------------------------------------------------------------
// GET /bot/scrims/upcoming?within_min= (scope bot:scrims:read) — 알림용
// -----------------------------------------------------------------------------

export const BOT_UPCOMING_WITHIN_MIN_DEFAULT = 60;
export const BOT_UPCOMING_WITHIN_MIN_MAX = 1440;
/** 응답 최대 행 수 */
export const BOT_UPCOMING_LIMIT = 50;

export const GetBotUpcomingScrimsQuery = z.object({
  within_min: z.coerce.number().int().min(1).max(BOT_UPCOMING_WITHIN_MIN_MAX).default(BOT_UPCOMING_WITHIN_MIN_DEFAULT),
});
export type GetBotUpcomingScrimsQuery = z.infer<typeof GetBotUpcomingScrimsQuery>;

/**
 * 곧 시작하는 내전 1행: status ∈ {recruiting, full}, now ≤ scheduled_at < now + within_min.
 * notify_discord_ids: joined 참가자 중 연동(snowflake)·notify_scrim_start=true·탈퇴 아님인 회원의 discord_id(목업 Settings
 *   「참가한 내전 시작 30분 전 · 디스코드 연동 시 DM」). 보낸 기록은 봇이 (scrim id, scheduled_at)으로 관리한다(D222)
 */
export const BotUpcomingScrim = z.object({
  id: Uuid,
  title: z.string(),
  url: z.string().url(),
  game: ScrimGameRef,
  status: z.enum(['recruiting', 'full']),
  scheduled_at: IsoDateTime,
  capacity: z.number().int().min(1),
  joined_count: z.number().int().min(0),
  waitlist_count: z.number().int().min(0),
  host: BotUserRef,
  notify_discord_ids: z.array(DiscordSnowflake),
});
export type BotUpcomingScrim = z.infer<typeof BotUpcomingScrim>;

/** scheduled_at ASC, id ASC. 페이징 없음(next_cursor 항상 null), 최대 BOT_UPCOMING_LIMIT */
export const GetBotUpcomingScrimsResponse = paginated(BotUpcomingScrim).extend({
  generated_at: IsoDateTime,
});
export type GetBotUpcomingScrimsResponse = z.infer<typeof GetBotUpcomingScrimsResponse>;

// -----------------------------------------------------------------------------
// GET /bot/rankings/{type} (scope bot:rankings:read) — 디스코드 명령어 응답용 요약
// -----------------------------------------------------------------------------

export const BotRankingType = z.enum(['tier', 'elo', 'activity', 'playtime']);
export type BotRankingType = z.infer<typeof BotRankingType>;

export const BOT_RANKING_LIMIT_DEFAULT = 10;
export const BOT_RANKING_LIMIT_MAX = 25;
const BotRankingLimit = z.coerce.number().int().min(1).max(BOT_RANKING_LIMIT_MAX).default(BOT_RANKING_LIMIT_DEFAULT);

/** 경로 :type 값 */
export const GetBotRankingParams = z.object({ type: BotRankingType });
export type GetBotRankingParams = z.infer<typeof GetBotRankingParams>;

/**
 * type별 쿼리. 컨트롤러는 경로 type으로 하나를 고른다. 웹 랭킹과 같은 필수 규칙:
 * tier → game(lol|tft) 필수, elo → game 필수(현재 시즌 기본 규칙), activity → period(기본 week), playtime → app_id 필수
 */
export const GetBotRankingQueryByType = {
  tier: z.object({ game: TierRankingGame, limit: BotRankingLimit }),
  elo: z.object({ game: GameCode, limit: BotRankingLimit }),
  activity: z.object({ period: ActivityPeriod.default('week'), limit: BotRankingLimit }),
  playtime: z.object({ app_id: z.coerce.number().pipe(SteamAppId), limit: BotRankingLimit }),
} as const satisfies Record<BotRankingType, z.ZodTypeAny>;

/** value의 단위. tier_score = 문서 7-3 티어 점수, elo, seconds = 활동(음성) 초(D232), minutes = 플레이타임 분 */
export const BotRankingUnit = z.enum(['tier_score', 'elo', 'seconds', 'minutes']);
export type BotRankingUnit = z.infer<typeof BotRankingUnit>;

export const BOT_RANKING_UNIT_BY_TYPE = {
  tier: 'tier_score',
  elo: 'elo',
  activity: 'seconds',
  playtime: 'minutes',
} as const satisfies Record<BotRankingType, BotRankingUnit>;

/**
 * 1행. user.discord_id로 봇이 멘션한다.
 * detail: 서버가 만든 짧은 한국어 보조 문구(tier 「Diamond II · 45 LP」, elo 「22승 9패」,
 *   activity 「7일 중 6일 활동 · 내전 3회」(scrim_count 0이면 「 · 내전 …」 생략, D239),
 *   playtime 「최근 2주 18시간」). 봇은 그대로 붙이거나 무시한다
 */
export const BotRankingItem = z.object({
  rank: z.number().int().min(1),
  user: BotUserRef,
  value: z.number().int().min(0),
  detail: z.string().nullable(),
  rank_change: z.number().int().nullable(),
});
export type BotRankingItem = z.infer<typeof BotRankingItem>;

/**
 * 200. 웹 GET /rankings/{type}와 **같은 캐시 행**을 읽어 앞 limit명만 준다(계산 경로를 새로 만들지 않는다, D215).
 * context: type에 해당하는 값만 채우고 나머지는 null. web_url = `{WEB_ORIGIN}/rankings?tab={type}&…`
 * synced_at: elo 시즌 없음·시작 전이면 null(웹과 같다). playtime은 보유자 없음도 빈 결과를 캐시하므로 항상 값이 있다(D235)
 */
export const GetBotRankingResponse = z.object({
  type: BotRankingType,
  unit: BotRankingUnit,
  context: z.object({
    game: GameCode.nullable(),
    season: SeasonRef.nullable(),
    is_final: z.boolean(),
    period: ActivityPeriod.nullable(),
    period_start: IsoDateTime.nullable(),
    period_end: IsoDateTime.nullable(),
    app: z.object({ app_id: SteamAppId, name: z.string().nullable() }).nullable(),
  }),
  items: z.array(BotRankingItem).max(BOT_RANKING_LIMIT_MAX),
  total: z.number().int().min(0),
  synced_at: IsoDateTime.nullable(),
  stale: z.boolean(),
  web_url: z.string().url(),
});
export type GetBotRankingResponse = z.infer<typeof GetBotRankingResponse>;

// -----------------------------------------------------------------------------
// POST /bot/member-events (scope bot:members) — 서버 입장·퇴장(S4 Q4 결정, S0 D24)
// -----------------------------------------------------------------------------

export const BOT_MEMBER_EVENTS_BATCH_MAX = 100;

export const BotMemberEventType = z.enum(['join', 'leave']);
export type BotMemberEventType = z.infer<typeof BotMemberEventType>;

/** occurred_at: 디스코드에서 일어난 시각(봇이 받은 시각). 순서 판정에 쓴다 */
export const BotMemberEvent = z
  .object({
    discord_id: DiscordSnowflake,
    type: BotMemberEventType,
    occurred_at: IsoDateTime,
  })
  .strict();
export type BotMemberEvent = z.infer<typeof BotMemberEvent>;

export const PostBotMemberEventsRequest = z
  .object({ events: z.array(BotMemberEvent).min(1).max(BOT_MEMBER_EVENTS_BATCH_MAX) })
  .strict();
export type PostBotMemberEventsRequest = z.infer<typeof PostBotMemberEventsRequest>;

/**
 * 건별 결과(계약 6-6).
 * - applied: 반영. leave → users.left_at = occurred_at + 미폐기 리프레시 토큰 전부 폐기(D24). join → left_at = null
 * - stale: 그 회원에게 이미 같거나 더 늦은 occurred_at의 입장·퇴장이 반영됨(순서가 뒤바뀐 재전송). 무시
 * - unlinked: discord_id에 연결된 회원 없음. 무시
 * - rejected: occurred_at이 now + BOT_ACTIVITY_FUTURE_TOLERANCE_SEC보다 뒤. 무시
 * 같은 요청 안 이벤트는 occurred_at 오름차순(같으면 요청 순서)으로 처리하고, results는 요청 순서로 돌려준다.
 */
export const BotMemberEventResult = z.object({
  discord_id: DiscordSnowflake,
  type: BotMemberEventType,
  status: z.enum(['applied', 'stale', 'unlinked', 'rejected']),
});
export type BotMemberEventResult = z.infer<typeof BotMemberEventResult>;

export const PostBotMemberEventsResponse = z.object({ results: z.array(BotMemberEventResult) });
export type PostBotMemberEventsResponse = z.infer<typeof PostBotMemberEventsResponse>;

// -----------------------------------------------------------------------------
// PUT /bot/presence (scope bot:presence) — 음성 채널 접속 인원·지금 플레이 중(D214)
// -----------------------------------------------------------------------------

/** 이 초보다 오래된 접속 현황은 홈에서 stale(숫자를 보이지 않는다). 봇 권장 전송 간격 60초 */
export const BOT_PRESENCE_STALE_AFTER_SEC = 300;
export const BOT_PRESENCE_PLAYING_MAX = 20;

export const BotPresencePlaying = z
  .object({
    /** 디스코드 활동 이름(예 `League of Legends`, `PUBG: BATTLEGROUNDS`) */
    name: z.string().trim().min(1).max(100),
    /** 알면 games.code. 모르면 null */
    game: GameCode.nullable(),
    /** 스팀 게임이고 봇이 app id를 알면 */
    steam_app_id: SteamAppId.nullable(),
    count: z.number().int().min(1),
  })
  .strict();
export type BotPresencePlaying = z.infer<typeof BotPresencePlaying>;

/**
 * 전체 스냅샷(덮어쓰기). voice_member_count: 지금 음성 채널에 있는 사람 수(봇 계정 제외, 미연동 회원 포함).
 * playing: 지금 플레이 중인 게임별 인원(봇이 모으지 않으면 []).
 */
export const PutBotPresenceRequest = z
  .object({
    captured_at: IsoDateTime,
    voice_member_count: z.number().int().min(0).max(100_000),
    playing: z.array(BotPresencePlaying).max(BOT_PRESENCE_PLAYING_MAX),
  })
  .strict();
export type PutBotPresenceRequest = z.infer<typeof PutBotPresenceRequest>;

/**
 * 200. accepted false면 저장하지 않았다:
 * OLDER_THAN_STORED(저장된 captured_at보다 이르거나 같음), TOO_OLD(now − BOT_PRESENCE_STALE_AFTER_SEC보다 이름),
 * IN_FUTURE(now + BOT_ACTIVITY_FUTURE_TOLERANCE_SEC보다 늦음)
 */
export const PutBotPresenceResponse = z.object({
  accepted: z.boolean(),
  reason: z.enum(['OLDER_THAN_STORED', 'TOO_OLD', 'IN_FUTURE']).nullable(),
});
export type PutBotPresenceResponse = z.infer<typeof PutBotPresenceResponse>;

/** bot_presence.playing JSON(서버 내부 저장 형식). 읽을 때 parse 실패면 [] */
export const BotPresencePlayingStored = z.array(BotPresencePlaying);
export type BotPresencePlayingStored = z.infer<typeof BotPresencePlayingStored>;
