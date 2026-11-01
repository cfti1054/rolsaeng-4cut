import { z } from 'zod';
import { ProfileBadge } from './badges';
import { IsoDateTime, Uuid } from './common/primitives';
import { UserRole } from './constants/enums';
import { GameCode } from './constants/games';
import { LolPosition, RankValue, RankedQueue } from './constants/riot';
import { GameAccountView, SyncQuota } from './game-accounts';
import { ProfileScrim } from './ratings';

// =============================================================================
// GET /users/{id}/profile — 멤버 프로필(문서 6장, 8장 /members/[id], 목업 Profile)
// 로그인 멤버 누구나 조회 가능. 외부 식별자(PUUID, 스팀 ID, 매치 ID)·이메일·디스코드 ID는 넣지 않는다(D38).
// =============================================================================

/** 공개 사용자 정보. Me와 달리 email·discord_id·discord_username이 없다. */
export const ProfileUser = z.object({
  id: Uuid,
  nickname: z.string(),
  role: UserRole,
  avatar_url: z.string().url().nullable(),
  /** 실제 디스코드 계정으로 로그인한 사용자면 true(개발 전용 사용자 `dev-*`는 false). 목업 「디스코드 연동/미연동」 칩 */
  discord_linked: z.boolean(),
  /** 가입 시각(users.created_at). 목업 「2026.03 가입」 */
  joined_at: IsoDateTime,
});
export type ProfileUser = z.infer<typeof ProfileUser>;

/**
 * 게임별 티어 카드. **대표 라이엇 계정**의 lol·tft 두 카드(D56). 라이엇 연동이 없으면 카드 없음.
 * rank=null: 아직 한 번도 동기화에 성공하지 못함(화면: 「동기화 대기 중」). 언랭은 rank.tier='UNRANKED'.
 */
export const ProfileTierCard = z.object({
  game_account_id: Uuid,
  game: GameCode,
  queue: RankedQueue,
  rank: RankValue.nullable(),
  /** 이 계정의 마지막 성공 동기화 시각(game_accounts.last_synced_at) */
  synced_at: IsoDateTime.nullable(),
});
export type ProfileTierCard = z.infer<typeof ProfileTierCard>;

/** 주 포지션 1개 항목. ratio = count / sample_size(0–1, 소수 둘째 자리 반올림) */
export const MainPositionShare = z.object({
  position: LolPosition,
  count: z.number().int().min(1),
  ratio: z.number().min(0).max(1),
});
export type MainPositionShare = z.infer<typeof MainPositionShare>;

/**
 * 주 포지션(대표 라이엇 계정의 솔로 랭크 최근 경기 기준, D40·D56).
 * positions: 경기 수 내림차순 최대 2개(동률은 LolPosition 순서). sample_size = 포지션이 있는 경기 수(≤ 20).
 * S3에서 내전 기준 주 포지션이 생기면 source 값을 추가한다.
 */
export const MainPosition = z.object({
  source: z.literal('riot_ranked_solo'),
  sample_size: z.number().int().min(1),
  positions: z.array(MainPositionShare).min(1).max(2),
});
export type MainPosition = z.infer<typeof MainPosition>;

/** 최근 솔로 랭크 1경기(recent_matches 1행). 목업 「RANKED SOLO 최근 솔로 랭크」 */
export const RecentLolMatch = z.object({
  /** recent_matches.id(우리 UUID). 라이엇 매치 ID는 노출하지 않는다 */
  id: Uuid,
  played_at: IsoDateTime,
  win: z.boolean(),
  champion_id: z.number().int(),
  /** Data Dragon 영문 키(예: `Aatrox`, `MonkeyKing`) */
  champion_key: z.string(),
  /** 한국어 이름(Data Dragon ko_KR). 못 구하면 champion_key와 같은 값 */
  champion_name: z.string(),
  champion_image_url: z.string().url().nullable(),
  position: LolPosition.nullable(),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  duration_sec: z.number().int().min(0),
});
export type RecentLolMatch = z.infer<typeof RecentLolMatch>;

/**
 * 최근 전적 블록(대표 라이엇 계정의 lol 행). 라이엇 연동이 없으면 프로필의 recent_matches 자체가 null.
 * refresh_queued: 이 조회로 전적 갱신을 큐에 넣었거나 이미 갱신 중이면 true → 웹은 잠시 뒤 다시 조회해도 된다.
 */
export const ProfileRecentMatches = z.object({
  items: z.array(RecentLolMatch),
  synced_at: IsoDateTime.nullable(),
  refresh_queued: z.boolean(),
});
export type ProfileRecentMatches = z.infer<typeof ProfileRecentMatches>;

/**
 * 프로필 응답.
 * - 기능 자리(D39): scrim(S3), badges(S4)는 슬라이스마다 `객체 | null`로 넓혔다.
 *   null의 뜻은 언제나 「표시할 데이터 없음」 → 웹은 빈 상태를 그린다.
 * - sync_quota: 본인 프로필(is_self=true)일 때만 값, 다른 사람이면 null.
 */
export const GetUserProfileResponse = z.object({
  user: ProfileUser,
  is_self: z.boolean(),
  /** 연동 계정 전부(대표 + 부계정 + 스팀, GET /me/game-accounts와 같은 정렬). 화면은 연동 칩으로만 쓴다 */
  game_accounts: z.array(GameAccountView),
  /** 대표 라이엇 계정의 lol·tft 순서로 2개, 라이엇 연동이 없으면 빈 배열 */
  tiers: z.array(ProfileTierCard),
  main_position: MainPosition.nullable(),
  recent_matches: ProfileRecentMatches.nullable(),
  sync_quota: SyncQuota.nullable(),
  /**
   * S3 내전 블록(현재 시즌 레이팅 카드·최근 내전). 그래프는 GET /users/{id}/rating-history.
   * S3부터 backend는 항상 객체를 넣는다. nullable은 D39 확장 규칙(넓히기만)과 S1 목 호환 때문에 남긴다.
   */
  scrim: ProfileScrim.nullable(),
  /**
   * S4 획득 뱃지(earned_at 내림차순, 같으면 id 오름차순). backend는 S4부터 항상 배열을 넣는다(없으면 []).
   * nullable은 D39 확장 규칙과 이전 목 호환 때문에 남긴다.
   */
  badges: z.array(ProfileBadge).nullable(),
});
export type GetUserProfileResponse = z.infer<typeof GetUserProfileResponse>;

/** 라우트 파라미터 공통 */
export const IdParam = z.object({ id: Uuid });
export type IdParam = z.infer<typeof IdParam>;

// =============================================================================
// 서버 내부 저장 형식(와이어 아님): recent_matches.summary JSON
// integration이 쓰고 backend가 읽을 때 이 스키마로 parse한다. 형식이 깨진 행은 응답에서 건너뛴다.
// =============================================================================
export const LolMatchSummary = z.object({
  queue_id: z.number().int(),
  champion_id: z.number().int(),
  champion_key: z.string(),
  position: LolPosition.nullable(),
  kills: z.number().int().min(0),
  deaths: z.number().int().min(0),
  assists: z.number().int().min(0),
  duration_sec: z.number().int().min(0),
});
export type LolMatchSummary = z.infer<typeof LolMatchSummary>;
