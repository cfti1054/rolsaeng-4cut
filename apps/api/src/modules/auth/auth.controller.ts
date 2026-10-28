import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { AUTH_COOKIE, ApiPath, DevLoginRequest, type DevLoginResponse, type RefreshTokenResponse } from '@gcd/shared';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AppError } from '../../common/app-error';
import { OriginGuard } from '../../common/guards/origin.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { AuthService } from './auth.service';
import {
  clearOAuthStateCookie,
  clearRefreshCookie,
  setOAuthStateCookie,
  setRefreshCookie,
} from './cookies';
import { DevLoginEnabledGuard } from './dev-login.guard';

function readCookie(req: Request, name: string): string | undefined {
  const v: unknown = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function userAgent(req: Request): string | undefined {
  return req.headers['user-agent'];
}

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** GET /auth/discord?redirect=… → 302 디스코드 authorize(또는 /login?error=OAUTH_NOT_CONFIGURED) */
  @Get(ApiPath.authDiscordStart)
  startDiscord(@Query() query: unknown, @Res() res: Response): void {
    const result = this.auth.startDiscord(query);
    if (result.stateCookie) setOAuthStateCookie(res, this.config, result.stateCookie);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, result.location);
  }

  /** GET /auth/discord/callback → 302 웹(/welcome 또는 redirect) / 실패 시 /login?error= */
  @Get(ApiPath.authDiscordCallback)
  async discordCallback(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const stateCookie = readCookie(req, AUTH_COOKIE.oauthState);
    // 1. 성공·실패와 무관하게 state 쿠키를 지운다.
    clearOAuthStateCookie(res, this.config);
    const result = await this.auth.handleDiscordCallback(query, stateCookie, userAgent(req));
    if (result.refresh) setRefreshCookie(res, this.config, result.refresh.raw, result.refresh.expiresAt);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, result.location);
  }

  /** POST /auth/refresh → 200 RefreshTokenResponse + 회전 쿠키 */
  @Post(ApiPath.authRefresh)
  @HttpCode(200)
  @UseGuards(OriginGuard)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<RefreshTokenResponse> {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await this.auth.refresh(readCookie(req, AUTH_COOKIE.refresh), userAgent(req));
      if (result.refresh) setRefreshCookie(res, this.config, result.refresh.raw, result.refresh.expiresAt);
      return result.body;
    } catch (err) {
      if (
        err instanceof AppError &&
        (err.code === 'REFRESH_TOKEN_INVALID' || err.code === 'REFRESH_TOKEN_REUSED')
      ) {
        clearRefreshCookie(res, this.config);
      }
      throw err;
    }
  }

  /** POST /auth/logout → 204, 쿠키 삭제(쿠키가 없거나 모르는 토큰이어도 성공) */
  @Post(ApiPath.authLogout)
  @HttpCode(204)
  @UseGuards(OriginGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, AUTH_COOKIE.refresh));
    clearRefreshCookie(res, this.config);
  }

  /** POST /auth/dev-login → 200 DevLoginResponse + 쿠키. 닫혀 있으면 404 NOT_FOUND */
  @Post(ApiPath.authDevLogin)
  @HttpCode(200)
  @UseGuards(DevLoginEnabledGuard, OriginGuard)
  async devLogin(
    @Body(new ZodValidationPipe(DevLoginRequest)) body: DevLoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DevLoginResponse> {
    res.setHeader('Cache-Control', 'no-store');
    const result = await this.auth.devLogin(body, userAgent(req));
    if (result.refresh) setRefreshCookie(res, this.config, result.refresh.raw, result.refresh.expiresAt);
    return result.body;
  }
}
