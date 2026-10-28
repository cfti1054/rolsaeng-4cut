import { z } from 'zod';
import { ErrorCode } from './common/errors';
import { UserRole } from './constants/enums';
import { Me } from './me';

// ---------------------------------------------------------------------------
// 쿠키·토큰 상수
// ---------------------------------------------------------------------------

/** 쿠키 이름. 둘 다 httpOnly, SameSite=Lax, production에서 Secure. Path는 gcd_rt = /, gcd_oauth = /api/v1/auth (계약 5-5). */
export const AUTH_COOKIE = {
  /** 리프레시 토큰(불투명 문자열). 수명 = REFRESH_TOKEN_TTL_DAYS */
  refresh: 'gcd_rt',
  /** OAuth state + 로그인 후 이동 경로. COOKIE_SECRET으로 서명, 수명 10분 */
  oauthState: 'gcd_oauth',
} as const;

export const ACCESS_TOKEN_TTL_SEC_DEFAULT = 900; // 15분
export const REFRESH_TOKEN_TTL_DAYS_DEFAULT = 30;
export const OAUTH_STATE_TTL_SEC = 600; // 10분

/** 디스코드 OAuth2 범위. email은 사용자가 이메일 미인증이면 null로 저장한다(선택 정보). */
export const DISCORD_OAUTH_SCOPES = ['identify', 'email', 'guilds.members.read'] as const;

/** Authorization 헤더 형식: `Bearer {access_token}` */
export const ACCESS_TOKEN_TYPE = 'Bearer' as const;

/** 액세스 토큰(JWT HS256) 클레임. 서버 내부 계약 — 클라이언트는 토큰을 해석하지 않는다. */
export const AccessTokenClaims = z.object({
  sub: z.string().uuid(), // users.id
  role: UserRole,
  typ: z.literal('access'),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;

// ---------------------------------------------------------------------------
// 공통
// ---------------------------------------------------------------------------

/**
 * 로그인 후 이동할 웹 내부 경로. 오픈 리다이렉트 방지:
 * `/`로 시작, `//`·`/\` 시작 금지, 공백·제어문자 금지, 512자 이하.
 */
export const SafeRedirectPath = z
  .string()
  .max(512)
  .regex(/^\/(?![/\\])[^\s\u0000-\u001f]*$/, 'redirect: 웹 내부 경로만 허용');
export type SafeRedirectPath = z.infer<typeof SafeRedirectPath>;

/**
 * 인증 성공 응답(토큰 갱신, 개발 전용 로그인 공통).
 * 리프레시 토큰은 본문에 넣지 않고 Set-Cookie(gcd_rt)로만 내려간다.
 */
export const AuthTokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.literal(ACCESS_TOKEN_TYPE),
  /** 액세스 토큰 남은 수명(초) */
  expires_in: z.number().int().positive(),
  user: Me,
});
export type AuthTokenResponse = z.infer<typeof AuthTokenResponse>;

// ---------------------------------------------------------------------------
// GET /auth/discord — 디스코드 OAuth 시작(브라우저 이동, 302)
// ---------------------------------------------------------------------------

export const StartDiscordAuthQuery = z.object({
  redirect: SafeRedirectPath.optional(),
});
export type StartDiscordAuthQuery = z.infer<typeof StartDiscordAuthQuery>;

// ---------------------------------------------------------------------------
// GET /auth/discord/callback — 디스코드가 돌려보내는 콜백(브라우저 이동, 302)
// ---------------------------------------------------------------------------

/** 디스코드가 붙이는 쿼리. 성공: code+state, 사용자 취소: error=access_denied(+state) */
export const DiscordCallbackQuery = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});
export type DiscordCallbackQuery = z.infer<typeof DiscordCallbackQuery>;

/** 콜백 실패 시 웹 /login?error= 로 전달되는 코드(이 목록 밖의 값은 보내지 않는다) */
export const OAuthLoginErrorCode = ErrorCode.extract([
  'OAUTH_NOT_CONFIGURED',
  'OAUTH_STATE_INVALID',
  'OAUTH_DENIED',
  'OAUTH_PROVIDER_ERROR',
  'DISCORD_NOT_GUILD_MEMBER',
  'INTERNAL_ERROR',
]);
export type OAuthLoginErrorCode = z.infer<typeof OAuthLoginErrorCode>;

/** 웹 /login 페이지 쿼리 */
export const LoginPageQuery = z.object({
  error: OAuthLoginErrorCode.optional(),
  redirect: SafeRedirectPath.optional(),
});
export type LoginPageQuery = z.infer<typeof LoginPageQuery>;

// ---------------------------------------------------------------------------
// POST /auth/refresh — 본문 없음. 쿠키 gcd_rt 필요. 성공 시 쿠키 회전.
// ---------------------------------------------------------------------------

export const RefreshTokenResponse = AuthTokenResponse;
export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponse>;

// ---------------------------------------------------------------------------
// POST /auth/logout — 본문 없음. 204 No Content, gcd_rt 쿠키 삭제. 요청·응답 스키마 없음.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /auth/dev-login — 개발 전용. AUTH_DEV_LOGIN=true && NODE_ENV!=='production'일 때만 열림.
// ---------------------------------------------------------------------------

/**
 * username으로 개발 사용자(discord_id = `dev-{username}`)를 찾거나 만든다.
 * role을 주면 새 사용자·기존 사용자 모두에 적용한다(권한 테스트용). 생략하면 새 사용자는 member, 기존 사용자는 유지.
 * 새 사용자는 nickname = username을 닉네임 규칙에 맞게 다듬은 값, nickname_confirmed_at = null.
 */
export const DevLoginRequest = z
  .object({
    username: z.string().regex(/^[a-z0-9_]{2,32}$/, 'username: 소문자·숫자·밑줄 2–32자'),
    role: UserRole.optional(),
  })
  .strict();
export type DevLoginRequest = z.infer<typeof DevLoginRequest>;

export const DevLoginResponse = AuthTokenResponse;
export type DevLoginResponse = z.infer<typeof DevLoginResponse>;
