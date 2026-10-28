import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ACCESS_TOKEN_TYPE,
  AuthTokenResponse,
  type DevLoginRequest,
  DiscordCallbackQuery,
  Me,
  OAuthLoginErrorCode,
  type UserRole,
} from '@gcd/shared';
import type { Prisma, User } from '@prisma/client';
import { APP_CONFIG, type AppConfig, isDiscordConfigured } from '../../config/env';
import { AppError } from '../../common/app-error';
import { signAccessToken } from '../../common/jwt';
import { serialize } from '../../common/serialize';
import { PrismaService, isUniqueViolation } from '../../prisma/prisma.service';
import { DEV_DISCORD_ID_PREFIX, toMe } from '../users/me.mapper';
import { deriveDefaultNickname, discordFallbackNickname, random4Digits } from './default-nickname';
import {
  DISCORD_OAUTH_CLIENT,
  type DiscordGuildMember,
  type DiscordOAuthClient,
  type DiscordUser,
  buildDiscordAuthorizeUrl,
} from './discord-oauth.client';
import { newOAuthState, signOAuthState, statesMatch, verifyOAuthStateCookie } from './oauth-state';
import { loginErrorUrl, postLoginTarget, toSafeRedirect, webUrl } from './redirect';
import { type IssuedRefreshToken, RefreshTokenService } from './refresh-token.service';

export interface AuthResult {
  body: AuthTokenResponse;
  /** 있으면 Set-Cookie gcd_rt. 유예 응답이면 없음 */
  refresh?: IssuedRefreshToken;
}

export interface OAuthStartResult {
  location: string;
  /** 있으면 Set-Cookie gcd_oauth */
  stateCookie?: string;
}

export interface OAuthCallbackResult {
  location: string;
  refresh?: IssuedRefreshToken;
}

const NICKNAME_CREATE_RETRIES = 3;

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DISCORD_OAUTH_CLIENT) private readonly discord: DiscordOAuthClient,
  ) {}

  // ---------------------------------------------------------------------------
  // 토큰 응답
  // ---------------------------------------------------------------------------

  /** 액세스 토큰 + Me. role은 DB 최신값(계약 5-3 5번). */
  async buildTokenResponse(userId: string): Promise<AuthTokenResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('REFRESH_TOKEN_INVALID');
    return this.tokenResponseFor(user);
  }

  private tokenResponseFor(user: User): AuthTokenResponse {
    const { token } = signAccessToken(
      { sub: user.id, role: user.role },
      this.config.jwtAccessSecret,
      this.config.jwtAccessTtlSec,
    );
    return serialize(AuthTokenResponse, {
      accessToken: token,
      tokenType: ACCESS_TOKEN_TYPE,
      expiresIn: this.config.jwtAccessTtlSec,
      user: toMe(user),
    });
  }

  // ---------------------------------------------------------------------------
  // POST /auth/refresh, /auth/logout
  // ---------------------------------------------------------------------------

  async refresh(rawCookie: string | undefined, userAgent?: string): Promise<AuthResult> {
    const result = await this.refreshTokens.rotate(rawCookie, userAgent);
    const body = await this.buildTokenResponse(result.userId);
    return result.kind === 'rotated' ? { body, refresh: result.next } : { body };
  }

  async logout(rawCookie: string | undefined): Promise<void> {
    await this.refreshTokens.revokeByRaw(rawCookie);
  }

  // ---------------------------------------------------------------------------
  // POST /auth/dev-login (계약 5-8)
  // ---------------------------------------------------------------------------

  async devLogin(input: DevLoginRequest, userAgent?: string): Promise<AuthResult> {
    if (!this.config.devLoginEnabled) throw new AppError('NOT_FOUND');
    const discordId = `${DEV_DISCORD_ID_PREFIX}${input.username}`;
    const now = new Date();
    const user = await this.upsertUser({
      discordId,
      update: {
        discordUsername: input.username,
        lastLoginAt: now,
        ...(input.role ? { role: input.role } : {}),
      },
      create: (nickname) => ({
        discordId,
        nickname,
        discordUsername: input.username,
        role: input.role ?? 'member',
        lastLoginAt: now,
      }),
      nicknameCandidates: [input.username],
      nicknameFallback: `user${random4Digits()}`,
    });
    const refresh = await this.refreshTokens.issueNewFamily(user.id, userAgent);
    return { body: this.tokenResponseFor(user), refresh };
  }

  // ---------------------------------------------------------------------------
  // GET /auth/discord (계약 5-5 시작)
  // ---------------------------------------------------------------------------

  startDiscord(rawQuery: unknown): OAuthStartResult {
    const redirect = toSafeRedirect(
      typeof rawQuery === 'object' && rawQuery !== null
        ? (rawQuery as Record<string, unknown>).redirect
        : undefined,
    );
    if (!isDiscordConfigured(this.config)) {
      return { location: loginErrorUrl(this.config.webOrigin, 'OAUTH_NOT_CONFIGURED', redirect) };
    }
    const state = newOAuthState();
    const stateCookie = signOAuthState(
      { state, redirect, iat: Math.floor(Date.now() / 1000) },
      this.config.cookieSecret,
    );
    const { clientId, redirectUri } = this.config.discord;
    return {
      location: buildDiscordAuthorizeUrl(clientId as string, redirectUri as string, state),
      stateCookie,
    };
  }

  // ---------------------------------------------------------------------------
  // GET /auth/discord/callback (계약 5-5 콜백). 예외를 던지지 않고 항상 이동 주소를 돌려준다.
  // ---------------------------------------------------------------------------

  async handleDiscordCallback(
    rawQuery: unknown,
    stateCookie: unknown,
    userAgent?: string,
  ): Promise<OAuthCallbackResult> {
    const statePayload = verifyOAuthStateCookie(stateCookie, this.config.cookieSecret);
    // 쿠키 값에도 같은 규칙(D31)을 다시 적용한다(규칙 도입 전에 발급된 쿠키 대비).
    const redirect = toSafeRedirect(statePayload?.redirect);
    try {
      return await this.completeDiscordLogin(rawQuery, statePayload, redirect, userAgent);
    } catch (err) {
      const code = this.toLoginErrorCode(err);
      return { location: loginErrorUrl(this.config.webOrigin, code, redirect) };
    }
  }

  private toLoginErrorCode(err: unknown): OAuthLoginErrorCode {
    if (err instanceof AppError) {
      const parsed = OAuthLoginErrorCode.safeParse(err.code);
      if (parsed.success) {
        if (parsed.data === 'INTERNAL_ERROR') this.logger.error(err.stack ?? err.message);
        return parsed.data;
      }
    }
    this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return 'INTERNAL_ERROR';
  }

  private async completeDiscordLogin(
    rawQuery: unknown,
    statePayload: ReturnType<typeof verifyOAuthStateCookie>,
    redirect: string,
    userAgent?: string,
  ): Promise<OAuthCallbackResult> {
    if (!isDiscordConfigured(this.config)) throw new AppError('OAUTH_NOT_CONFIGURED');

    const parsed = DiscordCallbackQuery.safeParse(rawQuery);
    if (!parsed.success) throw new AppError('OAUTH_STATE_INVALID');
    const query = parsed.data;

    // 2. 디스코드가 돌려준 오류
    if (query.error !== undefined) {
      throw new AppError(query.error === 'access_denied' ? 'OAUTH_DENIED' : 'OAUTH_PROVIDER_ERROR');
    }
    // 3. state
    if (!statePayload || !statesMatch(statePayload.state, query.state)) {
      throw new AppError('OAUTH_STATE_INVALID');
    }
    if (!query.code) throw new AppError('OAUTH_PROVIDER_ERROR');

    // 4~5. 토큰 교환·사용자 조회(디스코드 토큰은 지역 변수로만 쓰고 버린다)
    const discordToken = await this.discord.exchangeCode(query.code);
    const discordUser = await this.discord.getCurrentUser(discordToken);

    // 6. 길드 멤버 검사(계약 5-6)
    const guildId = this.config.discord.guildId;
    let member: DiscordGuildMember | undefined;
    if (guildId) {
      const found = await this.discord.getGuildMember(discordToken, guildId);
      if (!found || found.pending) throw new AppError('DISCORD_NOT_GUILD_MEMBER');
      member = found;
    }

    // 7. 사용자 upsert
    const user = await this.upsertDiscordUser(discordUser, member, Boolean(guildId));

    // 9. 새 계열 리프레시 토큰 + 이동
    const refresh = await this.refreshTokens.issueNewFamily(user.id, userAgent);
    const target = postLoginTarget(redirect, user.nicknameConfirmedAt === null);
    return { location: webUrl(this.config.webOrigin, target), refresh };
  }

  private async upsertDiscordUser(
    du: DiscordUser,
    member: DiscordGuildMember | undefined,
    guildChecked: boolean,
  ): Promise<User> {
    const now = new Date();
    const isAdmin = this.config.adminDiscordIds.has(du.id);
    // 인증된 이메일만 쓴다(D7). 단 shared `Me.email` 규칙을 통과하지 못하면 null로 저장한다(QA m1):
    // 저장해 두면 이후 toMe() 직렬화가 계속 실패해 로그인·refresh·/me가 모두 막힌다.
    // undefined = 갱신 안 함(미인증·이메일 없음), null = 저장값 비움(인증됐지만 형식 불일치)
    let email: string | null | undefined;
    if (du.verified && du.email) {
      email = Me.shape.email.safeParse(du.email).success ? du.email : null;
    }
    const common = {
      discordUsername: du.username,
      discordGlobalName: du.global_name,
      discordAvatar: du.avatar,
      lastLoginAt: now,
      ...(guildChecked ? { discordGuildVerifiedAt: now } : {}),
    };
    return this.upsertUser({
      discordId: du.id,
      // 기존: 닉네임은 덮어쓰지 않는다. 승격만 하고 강등하지 않는다. 이메일은 인증된 경우만 갱신.
      update: {
        ...common,
        ...(email !== undefined ? { email } : {}),
        ...(isAdmin ? { role: 'admin' as UserRole } : {}),
      },
      create: (nickname) => ({
        ...common,
        discordId: du.id,
        nickname,
        email: email ?? null,
        role: isAdmin ? 'admin' : 'member',
      }),
      nicknameCandidates: [member?.nick, du.global_name, du.username],
      nicknameFallback: discordFallbackNickname(du.id),
    });
  }

  /**
   * discord_id 기준 upsert. 신규면 기본 닉네임(계약 5-7)으로 만든다.
   * 동시 가입 경쟁: nickname 고유 위반이면 닉네임을 다시 만들고, discord_id 고유 위반이면 기존 행을 갱신한다.
   */
  private async upsertUser(args: {
    discordId: string;
    update: Prisma.UserUpdateInput;
    create: (nickname: string) => Prisma.UserCreateInput;
    nicknameCandidates: Array<string | null | undefined>;
    nicknameFallback: string;
  }): Promise<User> {
    for (let attempt = 0; attempt <= NICKNAME_CREATE_RETRIES; attempt += 1) {
      const existing = await this.prisma.user.findUnique({ where: { discordId: args.discordId } });
      if (existing) {
        return this.prisma.user.update({ where: { id: existing.id }, data: args.update });
      }
      const nickname = await deriveDefaultNickname({
        candidates: args.nicknameCandidates,
        fallback: args.nicknameFallback,
        isTaken: async (n) =>
          (await this.prisma.user.findUnique({ where: { nickname: n }, select: { id: true } })) !== null,
      });
      try {
        return await this.prisma.user.create({ data: args.create(nickname) });
      } catch (err) {
        // users의 고유 제약은 nickname, discord_id 둘뿐이다. 어느 쪽이든 다시 조회부터 한다.
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new AppError('INTERNAL_ERROR', undefined, { message: '사용자를 만들지 못했습니다.' });
  }
}
