import { z } from 'zod';
import { ErrorCode } from './common/errors';
import { IsoDateTime, Uuid } from './common/primitives';
import { GameAccountSyncError, GameAccountSyncState, GameProvider, RiotLinkVerificationStatus } from './constants/enums';
import { GameCode } from './constants/games';
import { RankValue, RiotIdInput } from './constants/riot';

// =============================================================================
// S1 게임 계정 연동·소유 확인·수동 새로고침. 계약: _workspace/01_architect_contract.md 4·5·6절
//
// 외부 식별자 비노출(D38): PUUID·스팀 64비트 ID(game_accounts.external_id), 라이엇 매치 ID
// (recent_matches.external_match_id)는 어떤 응답에도 넣지 않는다. 표시용은 display_name만.
// =============================================================================

// -----------------------------------------------------------------------------
// 상수
// -----------------------------------------------------------------------------

/** 수동 새로고침 하루 한도 기본값(문서 9장 제안값). 환경 변수 SYNC_DAILY_LIMIT로 바꾼다. 라이엇·스팀 합산 */
export const SYNC_DAILY_LIMIT_DEFAULT = 5;

/** 사용자당 라이엇 ID 최대 개수 기본값(대표 1 + 부계정, D56). 환경 변수 RIOT_ACCOUNTS_MAX. 스팀은 항상 1개 */
export const RIOT_ACCOUNTS_MAX_DEFAULT = 3;
/** 사용자당 스팀 계정 최대 개수(고정) */
export const STEAM_ACCOUNTS_MAX = 1;

/** 하루 경계 시간대. 수동 새로고침 횟수는 KST 자정(00:00 +09:00)에 초기화된다 */
export const KST_UTC_OFFSET_MINUTES = 9 * 60;

/** 스팀 연동 state 쿠키. HttpOnly, SameSite=Lax, Path=/api/v1/me/game-accounts/steam, COOKIE_SECRET 서명 */
export const STEAM_LINK_COOKIE = 'gcd_steam' as const;
export const STEAM_LINK_STATE_TTL_SEC = 600;

/** Steam OpenID 2.0 OP 주소(시작 리다이렉트·check_authentication 공통) */
export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
/** OpenID claimed_id 형식. 캡처 그룹 1 = 스팀 64비트 ID */
export const STEAM_CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;

// ---- S2 인증 보완 2: 스팀 연동 팝업(S2 계약 9-2, D74) ----

/**
 * 스팀 연동 진행 방식. redirect = 현재 창 이동(S1 방식, 기본값), popup = 새 창에서 진행 후 결과를 원래 창에 알리고 닫힘.
 * 웹은 팝업을 열지 못하면(차단) redirect로 요청한다.
 */
export const SteamLinkDisplay = z.enum(['redirect', 'popup']);
export type SteamLinkDisplay = z.infer<typeof SteamLinkDisplay>;

/** 팝업 모드에서 API 콜백이 302로 보내는 웹 경로. 쿼리는 SettingsPageQuery와 같다(steam=linked | steam_error=코드) */
export const STEAM_LINK_COMPLETE_PATH = '/steam-link/complete';

/** 팝업 → 원래 창 결과 전달 채널(같은 오리진 BroadcastChannel 이름) */
export const STEAM_LINK_BROADCAST_CHANNEL = 'gcd-steam-link';
/** 팝업 → 원래 창 메시지 type 값(postMessage·BroadcastChannel 공통) */
export const STEAM_LINK_MESSAGE_TYPE = 'gcd:steam-link' as const;

// -----------------------------------------------------------------------------
// 공통 응답 조각
// -----------------------------------------------------------------------------

/**
 * 수동 새로고침 남은 횟수. 사용자 단위(라이엇·스팀 합산), KST 자정 초기화.
 * used = 오늘(KST) game_account_sync_requests 행 수. remaining = max(0, limit - used).
 */
export const SyncQuota = z.object({
  limit: z.number().int().min(0),
  used: z.number().int().min(0),
  remaining: z.number().int().min(0),
  /** 다음 KST 자정(+09:00 오프셋으로 표기) */
  resets_at: IsoDateTime,
});
export type SyncQuota = z.infer<typeof SyncQuota>;

/** 마지막 동기화 실패. 다음 성공 시 null로 지운다(실패해도 기존 데이터는 지우지 않는다). */
export const GameAccountSyncFailure = z.object({
  code: GameAccountSyncError,
  at: IsoDateTime,
});
export type GameAccountSyncFailure = z.infer<typeof GameAccountSyncFailure>;

/** 동기화 상태. 화면은 마지막 성공값 + synced_at을 보여준다(문서 9장). */
export const GameAccountSyncInfo = z.object({
  state: GameAccountSyncState,
  /** 마지막 성공 동기화 시각(라이엇: 티어, 스팀: 플레이타임). 한 번도 성공 못 했으면 null */
  synced_at: IsoDateTime.nullable(),
  /** 라이엇 lol 행만: 최근 전적 마지막 성공 시각. tft·스팀 행은 null → 라이엇 카드의 전적 시각은 lol 행 값을 쓴다 */
  matches_synced_at: IsoDateTime.nullable(),
  error: GameAccountSyncFailure.nullable(),
});
export type GameAccountSyncInfo = z.infer<typeof GameAccountSyncInfo>;

/**
 * 연동 계정 1행(= game_accounts 1행). 내 계정 목록·다른 사람 프로필 공통.
 * - 라이엇은 라이엇 ID마다 lol·tft 두 행이 같은 display_name·verified_at·sync·is_primary로 나온다(D25).
 *   화면은 provider + display_name으로 묶어 라이엇 ID당 카드 1개로 그린다. 대표 계정이 먼저 오도록 정렬된다(D56).
 * - external_id(PUUID, 스팀 ID)는 넣지 않는다(D38).
 */
export const GameAccountView = z.object({
  id: Uuid,
  game: GameCode,
  provider: GameProvider,
  /** 라이엇: `게임이름#태그`, 스팀: 프로필 이름(personaname) */
  display_name: z.string(),
  verified_at: IsoDateTime,
  /** 대표 계정 여부(D56). 라이엇은 사용자당 라이엇 ID 1개만 true(lol·tft 함께), 스팀 행은 항상 true */
  is_primary: z.boolean(),
  /**
   * 이 계정의 최신 티어(lol: 솔로 랭크, tft: 롤체 랭크). 스팀 행·아직 동기화 성공 없음은 null.
   * 부계정 티어도 설정 화면에서 보여줄 수 있게 넣는다(D57). 랭킹·밸런스·프로필 티어 카드는 대표 계정만 쓴다.
   */
  rank: RankValue.nullable(),
  sync: GameAccountSyncInfo,
  /** 스팀 행만: 보유 게임 수(steam_playtime 행 수). 동기화 전·라이엇 행은 null */
  steam_owned_game_count: z.number().int().min(0).nullable(),
});
export type GameAccountView = z.infer<typeof GameAccountView>;

/** 진행 중인 라이엇 소유 확인. 목업 Settings 「소유 확인 1/2 단계」 카드 */
export const RiotLinkVerificationView = z.object({
  id: Uuid,
  /** Account-V1이 돌려준 표기의 `게임이름#태그` */
  display_name: z.string(),
  /** 바꿔야 할 프로필 아이콘 번호 */
  icon_id: z.number().int().min(0),
  /** 아이콘 이미지(Data Dragon). 버전을 못 구하면 null → 화면은 번호만 표시 */
  icon_image_url: z.string().url().nullable(),
  /** pending이어도 expires_at이 지났으면 서버가 expired로 내려준다 */
  status: RiotLinkVerificationStatus,
  expires_at: IsoDateTime,
  created_at: IsoDateTime,
});
export type RiotLinkVerificationView = z.infer<typeof RiotLinkVerificationView>;

// -----------------------------------------------------------------------------
// GET /me/game-accounts — 설정 화면용 내 연동 계정
// -----------------------------------------------------------------------------

/**
 * 목록이 사용자당 최대 7행(라이엇 ID 3개 × lol·tft + 스팀 1)으로 작아 페이징하지 않는다(D35).
 * 정렬: 대표 라이엇 계정(lol, tft) → 부계정(verified_at 오름차순, 각 lol, tft) → 스팀.
 * riot_verification: 가장 최근 소유 확인이 pending(또는 시간이 지나 expired로 보이는 pending)이면 그 값, 아니면 null.
 */
/** 연동 개수 한도(서버 설정값). 웹은 「부계정 추가」 노출 여부를 이 값으로 판단한다(RIOT_ACCOUNTS_MAX를 직접 알 수 없음) */
export const GameAccountLimits = z.object({
  /** 라이엇 ID 최대 개수 = 환경 변수 RIOT_ACCOUNTS_MAX(기본 3) */
  riot_accounts_max: z.number().int().min(1),
  /** 스팀 최대 개수 = STEAM_ACCOUNTS_MAX(1) */
  steam_accounts_max: z.number().int().min(1),
});
export type GameAccountLimits = z.infer<typeof GameAccountLimits>;

export const GetMyGameAccountsResponse = z.object({
  accounts: z.array(GameAccountView),
  riot_verification: RiotLinkVerificationView.nullable(),
  sync_quota: SyncQuota,
  limits: GameAccountLimits,
});
export type GetMyGameAccountsResponse = z.infer<typeof GetMyGameAccountsResponse>;

// -----------------------------------------------------------------------------
// POST /me/game-accounts — 연동 시작(문서 6장). provider로 분기
// -----------------------------------------------------------------------------

/**
 * - riot: 라이엇 ID 조회 → 소유 확인(아이콘) 시작. 이미 RIOT_ACCOUNTS_MAX개면 GAME_ACCOUNT_LIMIT_REACHED. 첫 라이엇 ID는 대표가 된다. 이미 pending인 확인은 cancelled로 바꾸고 새로 만든다.
 * - steam: Steam OpenID 시작 URL 발급 + state 쿠키(gcd_steam) 설정. display(S2): redirect면 웹은 현재 창을
 *   authorize_url로 이동, popup이면 미리 연 팝업 창을 authorize_url로 이동. 콜백 도착지가 display에 따라 달라진다.
 */
export const LinkGameAccountRequest = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('riot'), riot_id: RiotIdInput }).strict(),
  z.object({ provider: z.literal('steam'), display: SteamLinkDisplay.default('redirect') }).strict(),
]);
export type LinkGameAccountRequest = z.infer<typeof LinkGameAccountRequest>;
/** 웹이 보내는 형태(riot_id는 `게임이름#태그` 문자열) */
export type LinkGameAccountRequestInput = z.input<typeof LinkGameAccountRequest>;

/** 200. provider별 응답 */
export const LinkGameAccountResponse = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('riot'), verification: RiotLinkVerificationView }),
  z.object({ provider: z.literal('steam'), authorize_url: z.string().url() }),
]);
export type LinkGameAccountResponse = z.infer<typeof LinkGameAccountResponse>;

// -----------------------------------------------------------------------------
// POST /me/game-accounts/riot-verifications/{id}/confirm — "바꿨어요, 확인"
// -----------------------------------------------------------------------------

/** 본문 없음. 성공 시 lol·tft 두 행 생성(verified, 라이엇 계정이 처음이면 is_primary=true), 초기 동기화 큐 등록(횟수 차감 없음). 이미 verified면 같은 응답(멱등). */
export const ConfirmRiotVerificationResponse = z.object({
  verification: RiotLinkVerificationView,
  accounts: z.array(GameAccountView),
});
export type ConfirmRiotVerificationResponse = z.infer<typeof ConfirmRiotVerificationResponse>;

// DELETE /me/game-accounts/riot-verifications/{id} — 소유 확인 취소. 204, 본문 없음.
// DELETE /me/game-accounts/{id} — 연동 해제. 204, 본문 없음. 라이엇 행이면 같은 라이엇 ID의 lol·tft 두 행 함께 삭제.
//   대표를 해제하면 남은 라이엇 ID 중 가장 먼저 연동한 것(verified_at, 같으면 id 순)이 같은 트랜잭션에서 대표가 된다(D56).

// -----------------------------------------------------------------------------
// POST /me/game-accounts/{id}/primary — 대표 계정 지정(D56). 본문 없음
// -----------------------------------------------------------------------------

/**
 * 라이엇 행(lol·tft 어느 쪽 id든)을 대표로: 한 트랜잭션에서 기존 대표 lol·tft → false, 대상 라이엇 ID의 lol·tft → true.
 * 이미 대표이거나 스팀 행이면 변경 없이 200(멱등). 응답 = 갱신 후 내 계정 전체(GET /me/game-accounts의 accounts와 같은 정렬).
 */
export const SetPrimaryGameAccountResponse = z.object({
  accounts: z.array(GameAccountView),
});
export type SetPrimaryGameAccountResponse = z.infer<typeof SetPrimaryGameAccountResponse>;

// -----------------------------------------------------------------------------
// GET /me/game-accounts/steam/callback — 스팀이 돌려보내는 콜백(브라우저 이동, 302)
// -----------------------------------------------------------------------------

/**
 * 쿼리: 우리 state + openid.* 전부. openid.* 는 check_authentication에 그대로 되돌려 보내야 하므로
 * passthrough로 받고, 서버는 원본 쿼리 문자열을 써서 검증한다(계약 5-2).
 */
export const SteamLinkCallbackQuery = z
  .object({
    state: z.string().min(1).max(128).optional(),
    /**
     * (S2) 팝업 모드면 return_to에 `display=popup`이 붙어 돌아온다. 검증에는 쿠키의 display를 쓰고,
     * 이 값은 쿠키가 없거나 깨졌을 때 오류를 어느 웹 경로로 보낼지 정하는 데만 쓴다('popup'만 인정, 그 밖은 redirect).
     */
    display: z.string().optional(),
    'openid.mode': z.string().optional(),
  })
  .passthrough();
export type SteamLinkCallbackQuery = z.infer<typeof SteamLinkCallbackQuery>;

/** 콜백 실패 시 웹 /settings?steam_error= 로 전달되는 코드(이 목록 밖의 값은 보내지 않는다) */
export const SteamLinkErrorCode = ErrorCode.extract([
  'STEAM_LINK_STATE_INVALID',
  'STEAM_LINK_CANCELLED',
  'STEAM_OPENID_INVALID',
  'GAME_PROVIDER_NOT_CONFIGURED',
  'GAME_PROVIDER_ERROR',
  'GAME_PROVIDER_RATE_LIMITED',
  'GAME_ACCOUNT_LIMIT_REACHED',
  'GAME_ACCOUNT_ALREADY_LINKED',
  'UNAUTHENTICATED',
  'INTERNAL_ERROR',
]);
export type SteamLinkErrorCode = z.infer<typeof SteamLinkErrorCode>;

/** 웹 /settings 쿼리. 성공: steam=linked, 실패: steam_error={코드}. 알 수 없는 값은 무시(파싱 실패 시 빈 쿼리 취급) */
export const SettingsPageQuery = z.object({
  steam: z.literal('linked').optional(),
  steam_error: SteamLinkErrorCode.optional(),
});
export type SettingsPageQuery = z.infer<typeof SettingsPageQuery>;

/** (S2) 팝업 완료 페이지(STEAM_LINK_COMPLETE_PATH) 쿼리. /settings와 같은 키를 쓴다 */
export const SteamLinkCompletePageQuery = SettingsPageQuery;
export type SteamLinkCompletePageQuery = SettingsPageQuery;

/**
 * (S2) 팝업 → 원래 창 결과 메시지. 완료 페이지가 BroadcastChannel(STEAM_LINK_BROADCAST_CHANNEL)과
 * window.opener.postMessage(targetOrigin = 자기 origin) 두 경로로 같은 메시지를 보낸다.
 * 받는 쪽은 origin = 자기 origin(postMessage), 이 스키마 parse 성공인 것만 처리하고, 같은 시도에서 첫 메시지만 쓴다.
 */
export const SteamLinkPopupMessage = z.discriminatedUnion('status', [
  z.object({ type: z.literal(STEAM_LINK_MESSAGE_TYPE), status: z.literal('linked') }).strict(),
  z.object({ type: z.literal(STEAM_LINK_MESSAGE_TYPE), status: z.literal('error'), code: SteamLinkErrorCode }).strict(),
]);
export type SteamLinkPopupMessage = z.infer<typeof SteamLinkPopupMessage>;

// -----------------------------------------------------------------------------
// POST /me/game-accounts/{id}/sync — 수동 새로고침(문서 6장, 9장 하루 5회)
// -----------------------------------------------------------------------------

/**
 * 본문 없음. 202 Accepted. 대표·부계정 모두 가능(횟수는 사용자 단위 합산). 동기화는 비동기로 실행되고 웹은 GET /me/game-accounts를 폴링한다.
 * - 대상 계정(라이엇이면 lol·tft 두 행)이 이미 queued/running이면 횟수를 쓰지 않고 현재 상태를 돌려준다(quota_consumed=false).
 * - 그 외에는 횟수 1 차감 후 queued로 바꾼다(quota_consumed=true). 외부 호출이 실패해도 차감은 유지된다.
 */
export const SyncGameAccountResponse = z.object({
  accounts: z.array(GameAccountView),
  sync_quota: SyncQuota,
  quota_consumed: z.boolean(),
});
export type SyncGameAccountResponse = z.infer<typeof SyncGameAccountResponse>;
