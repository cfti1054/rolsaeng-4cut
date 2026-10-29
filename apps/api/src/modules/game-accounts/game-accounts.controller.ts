import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiPath,
  type ConfirmRiotVerificationResponse,
  type GetMyGameAccountsResponse,
  IdParam,
  LinkGameAccountRequest,
  type LinkGameAccountResponse,
  STEAM_LINK_COOKIE,
  type SetPrimaryGameAccountResponse,
  type SyncGameAccountResponse,
} from '@gcd/shared';
import type { Request, Response } from 'express';
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { ZodValidationPipe } from '../../common/pipes/zod.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { GameAccountsService } from './game-accounts.service';
import { RiotLinkService } from './riot-link.service';
import { clearSteamCookie, setSteamCookie } from './steam-link-cookie';
import { SteamLinkService } from './steam-link.service';

const idPipe = new ZodValidationPipe(IdParam);

/** 게임 계정 연동(계약 S1 4절). 스팀 콜백만 JwtGuard 없이 서명 쿠키로 사용자를 식별한다 */
@Controller()
export class GameAccountsController {
  constructor(
    private readonly accounts: GameAccountsService,
    private readonly riot: RiotLinkService,
    private readonly steam: SteamLinkService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** GET /me/game-accounts → 200 GetMyGameAccountsResponse */
  @Get(ApiPath.myGameAccounts)
  @UseGuards(JwtGuard)
  list(@CurrentUser() user: AuthUser): Promise<GetMyGameAccountsResponse> {
    return this.accounts.list(user.id);
  }

  /** POST /me/game-accounts → 200 LinkGameAccountResponse (스팀이면 Set-Cookie gcd_steam) */
  @Post(ApiPath.myGameAccounts)
  @HttpCode(200)
  @UseGuards(JwtGuard)
  async link(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LinkGameAccountRequest)) body: LinkGameAccountRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LinkGameAccountResponse> {
    res.setHeader('Cache-Control', 'no-store');
    if (body.provider === 'riot') return this.riot.start(user.id, body.riot_id);
    const result = await this.steam.start(user.id, body.display);
    setSteamCookie(res, this.config, result.cookie);
    return result.body;
  }

  /** POST /me/game-accounts/riot-verifications/:id/confirm → 200 */
  @Post(ApiPath.riotVerificationConfirm)
  @HttpCode(200)
  @UseGuards(JwtGuard)
  confirm(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<ConfirmRiotVerificationResponse> {
    return this.riot.confirm(user.id, params.id);
  }

  /** DELETE /me/game-accounts/riot-verifications/:id → 204 */
  @Delete(ApiPath.riotVerification)
  @HttpCode(204)
  @UseGuards(JwtGuard)
  async cancel(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<void> {
    await this.riot.cancel(user.id, params.id);
  }

  /** GET /me/game-accounts/steam/callback → 302 웹 /settings 또는 팝업이면 /steam-link/complete (JWT 없음) */
  @Get(ApiPath.steamLinkCallback)
  async steamCallback(@Query() query: unknown, @Req() req: Request, @Res() res: Response): Promise<void> {
    const raw: unknown = (req.cookies as Record<string, unknown> | undefined)?.[STEAM_LINK_COOKIE];
    // 1. 성공·실패와 무관하게 즉시 삭제(같은 Path)
    clearSteamCookie(res, this.config);
    const result = await this.steam.callback(query, typeof raw === 'string' && raw.length > 0 ? raw : undefined);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, result.location);
  }

  /** DELETE /me/game-accounts/:id → 204 */
  @Delete(ApiPath.myGameAccount)
  @HttpCode(204)
  @UseGuards(JwtGuard)
  async unlink(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<void> {
    await this.accounts.unlink(user.id, params.id);
  }

  /** POST /me/game-accounts/:id/primary → 200 */
  @Post(ApiPath.myGameAccountPrimary)
  @HttpCode(200)
  @UseGuards(JwtGuard)
  setPrimary(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<SetPrimaryGameAccountResponse> {
    return this.accounts.setPrimary(user.id, params.id);
  }

  /** POST /me/game-accounts/:id/sync → 202 */
  @Post(ApiPath.myGameAccountSync)
  @HttpCode(202)
  @UseGuards(JwtGuard)
  sync(@CurrentUser() user: AuthUser, @Param(idPipe) params: IdParam): Promise<SyncGameAccountResponse> {
    return this.accounts.sync(user.id, params.id);
  }
}
