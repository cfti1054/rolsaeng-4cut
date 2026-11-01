import { z } from 'zod';
import { IsoDateTime, Uuid } from './common/primitives';
import { UserRole } from './constants/enums';

/**
 * 닉네임 규칙(사용자 결정 2026-11-02, 로그인 닉네임 2–50자):
 * 1. 정규화: 앞뒤 공백 제거, 연속 공백(탭·줄바꿈 포함)은 공백 1개로 바꾼다(거부하지 않음).
 * 2. 정규화한 값이 2–50자, 한글(완성형)·영문·숫자·밑줄·공백만.
 * 3. 중복 검사는 정규화한 값으로 한다. DB에는 정규화한 값만 저장하므로 nickname UNIQUE가 곧 중복 검사다.
 */
export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 50;
export const NICKNAME_PATTERN = /^[0-9A-Za-z가-힣_ ]+$/;

/** 닉네임 정규화(앞뒤 공백 제거 + 연속 공백을 1개로). 서버의 기본 닉네임 생성도 이 함수를 쓴다. */
export function normalizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export const Nickname = z
  .string()
  .transform(normalizeNickname)
  .pipe(
    z
      .string()
      .min(NICKNAME_MIN_LENGTH)
      .max(NICKNAME_MAX_LENGTH)
      .regex(NICKNAME_PATTERN, 'nickname: 한글·영문·숫자·밑줄·공백만 사용'),
  );
export type Nickname = z.infer<typeof Nickname>;

/**
 * 로그인한 본인 정보. GET /me, PATCH /me, 인증 응답의 user에 공통으로 쓴다.
 * - needs_nickname_confirmation: users.nickname_confirmed_at이 null이면 true → 웹은 /welcome(닉네임 확인)으로 보낸다.
 * - discord_id: 디스코드 로그인 사용자는 snowflake, 개발 전용 로그인 사용자는 `dev-{username}`. 형식 검사하지 않는다.
 * - discord_guild_verified_at: 마지막 로그인 때 서버 멤버 확인 시각. DISCORD_GUILD_ID 미설정이면 null.
 * - avatar_url: 디스코드 CDN 주소(서버가 users.discord_avatar 해시로 조립). 없으면 null.
 */
export const Me = z.object({
  id: Uuid,
  nickname: z.string(),
  role: UserRole,
  email: z.string().email().nullable(),
  discord_id: z.string().nullable(),
  discord_username: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
  discord_guild_verified_at: IsoDateTime.nullable(),
  needs_nickname_confirmation: z.boolean(),
  created_at: IsoDateTime,
});
export type Me = z.infer<typeof Me>;

/** GET /me */
export const GetMeResponse = Me;
export type GetMeResponse = z.infer<typeof GetMeResponse>;

/**
 * PATCH /me — S0에서는 닉네임만 바꿀 수 있다. 알 수 없는 필드는 VALIDATION_FAILED.
 * 성공 시 nickname_confirmed_at이 비어 있으면 현재 시각으로 채운다(첫 로그인 확인 완료).
 * 닉네임을 바꾸지 않고 확인만 할 때도 현재 닉네임을 그대로 보낸다.
 */
export const UpdateMeRequest = z
  .object({
    nickname: Nickname,
  })
  .strict();
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

/** PATCH /me */
export const UpdateMeResponse = Me;
export type UpdateMeResponse = z.infer<typeof UpdateMeResponse>;

// -----------------------------------------------------------------------------
// S6 GET·PATCH /me/notification-settings — 알림 설정(목업 Settings NOTIFICATIONS, 계약 S6 9절)
// S1 D48 「알림 설정은 알림 발송 기능이 생기는 슬라이스에서」의 실행. 실제로 발송 경로가 있는 두 항목만 연다(D259):
// - scrim_start(users.notify_scrim_start): 봇 GET /bot/scrims/upcoming의 notify_discord_ids(S5 D222)
// - patch(users.notify_patch): 봇 GET /bot/patch-notes/pending의 notify_discord_ids(S6)
// notify_result·notify_waitlist는 봇 수신 경로가 없어(S5 Q12) 노출하지 않는다.
// -----------------------------------------------------------------------------

export const NotificationSettings = z.object({
  /** 참가한 내전 시작 30분 전 디스코드 DM */
  scrim_start: z.boolean(),
  /** 새 패치 요약 디스코드 DM */
  patch: z.boolean(),
  /** DM을 받을 수 있는 상태인가(isLinkedDiscordId(discord_id)). false면 화면이 「디스코드 연동 회원만 받아요」 안내 */
  discord_linked: z.boolean(),
});
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const GetMyNotificationSettingsResponse = NotificationSettings;
export type GetMyNotificationSettingsResponse = z.infer<typeof GetMyNotificationSettingsResponse>;

/** 바꿀 항목만 보낸다. 빈 본문·모르는 필드는 VALIDATION_FAILED */
export const UpdateMyNotificationSettingsRequest = z
  .object({
    scrim_start: z.boolean(),
    patch: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => v.scrim_start !== undefined || v.patch !== undefined, { message: '바꿀 항목이 하나 이상 있어야 함' });
export type UpdateMyNotificationSettingsRequest = z.infer<typeof UpdateMyNotificationSettingsRequest>;

export const UpdateMyNotificationSettingsResponse = NotificationSettings;
export type UpdateMyNotificationSettingsResponse = z.infer<typeof UpdateMyNotificationSettingsResponse>;
