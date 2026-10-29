import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LinkGameAccountResponse,
  STEAM_LINK_COMPLETE_PATH,
  STEAM_OPENID_ENDPOINT,
  type SteamLinkDisplay,
  SteamLinkErrorCode,
} from '@gcd/shared';
import { advisoryXactLock, userGameAccountsLockKey } from '../../common/advisory-lock';
import { AppError } from '../../common/app-error';
import { APP_CLOCK, type Clock } from '../../common/clock';
import { constantTimeEquals } from '../../common/signed-cookie';
import { classifyGameAccountUniqueViolation } from '../../common/unique-violation';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { ExternalApiError, STEAM_API, type SteamApi } from '../../integrations/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GameCatalog } from './game-catalog.service';
import {
  type SteamCookiePayload,
  newSteamState,
  signSteamCookie,
  steamReturnTo,
  verifySteamCookie,
} from './steam-link-cookie';
import { SyncEnqueuer } from './sync-enqueuer.service';

const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const OPENID_IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
/** GetPlayerSummaries 실패 시 표시 이름(D52) */
export const STEAM_FALLBACK_NAME = '스팀 사용자';

export type SteamStartResult = { body: LinkGameAccountResponse; cookie: string };

/** 콜백 결과: 웹으로 보낼 302 위치 */
export type SteamCallbackResult = { location: string };

/**
 * 스팀 연동: OpenID 2.0(계약 S1 5-2, 5-2a, D34·D52).
 */
@Injectable()
export class SteamLinkService {
  private readonly log = new Logger('SteamLinkService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: GameCatalog,
    private readonly enqueuer: SyncEnqueuer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_CLOCK) private readonly clock: Clock,
    @Inject(STEAM_API) private readonly steam: SteamApi,
  ) {}

  /** 시작 `POST /me/game-accounts {provider:'steam'}` (5-2 시작 1–4) */
  async start(userId: string, display: SteamLinkDisplay = 'redirect'): Promise<SteamStartResult> {
    if (!this.config.steam.apiKey) throw new AppError('GAME_PROVIDER_NOT_CONFIGURED');
    const { steam } = await this.catalog.ids();
    if ((await this.prisma.gameAccount.count({ where: { userId, gameId: steam } })) > 0) {
      throw new AppError('GAME_ACCOUNT_LIMIT_REACHED');
    }
    const state = newSteamState();
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const cookie = signSteamCookie({ state, user_id: userId, iat, display }, this.config.cookieSecret);
    const params = new URLSearchParams({
      'openid.ns': OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.return_to': steamReturnTo(this.config, state, display),
      'openid.realm': this.config.webOrigin,
      'openid.identity': OPENID_IDENTIFIER_SELECT,
      'openid.claimed_id': OPENID_IDENTIFIER_SELECT,
    });
    const body = LinkGameAccountResponse.parse({
      provider: 'steam',
      authorize_url: `${STEAM_OPENID_ENDPOINT}?${params.toString()}`,
    });
    return { body, cookie };
  }

  /** 도착지: redirect = 웹 /settings(S1), popup = 웹 /steam-link/complete(S2 9-2). 쿼리 키는 같다 */
  private resultUrl(display: SteamLinkDisplay, query: string): string {
    const path = display === 'popup' ? STEAM_LINK_COMPLETE_PATH : '/settings';
    return `${this.config.webOrigin}${path}?${query}`;
  }

  /**
   * 콜백 `GET /me/game-accounts/steam/callback` (5-2 콜백 2–10). 쿠키 삭제(1단계)는 컨트롤러가 한다.
   * 성공 → {도착지}?steam=linked, 실패 → {도착지}?steam_error={SteamLinkErrorCode}.
   * 도착지(S2 9-2): 쿠키가 유효하면 쿠키의 display, 쿠키가 없거나 깨졌으면 쿼리 display === 'popup'일 때만 popup.
   * 쿼리 display는 오류 페이지 선택에만 쓰고 검증에는 쓰지 않는다.
   */
  async callback(rawQuery: unknown, cookie: string | undefined): Promise<SteamCallbackResult> {
    const payload = verifySteamCookie(cookie, this.config.cookieSecret, this.clock.now().getTime());
    const queryDisplay =
      rawQuery && typeof rawQuery === 'object' ? (rawQuery as Record<string, unknown>).display : undefined;
    const display: SteamLinkDisplay = payload ? payload.display : queryDisplay === 'popup' ? 'popup' : 'redirect';
    try {
      await this.handleCallback(rawQuery, payload);
      return { location: this.resultUrl(display, 'steam=linked') };
    } catch (err) {
      let code: SteamLinkErrorCode = 'INTERNAL_ERROR';
      if (err instanceof AppError) {
        const parsed = SteamLinkErrorCode.safeParse(err.code);
        code = parsed.success ? parsed.data : 'INTERNAL_ERROR';
      }
      if (code === 'INTERNAL_ERROR') {
        this.log.error(`스팀 콜백 처리 실패: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      }
      return { location: this.resultUrl(display, `steam_error=${encodeURIComponent(code)}`) };
    }
  }

  private async handleCallback(rawQuery: unknown, payload: SteamCookiePayload | null): Promise<void> {
    // 쿼리 값은 모두 문자열 1개여야 한다(같은 키 반복·중첩은 변조로 본다)
    const query: Record<string, string> = {};
    let malformed = false;
    if (rawQuery && typeof rawQuery === 'object') {
      for (const [k, v] of Object.entries(rawQuery as Record<string, unknown>)) {
        if (typeof v === 'string') query[k] = v;
        else malformed = true;
      }
    }
    // 2
    const mode = query['openid.mode'];
    if (mode === 'cancel' && !malformed) throw new AppError('STEAM_LINK_CANCELLED');
    if (mode !== 'id_res') throw new AppError('STEAM_OPENID_INVALID');
    // 3
    if (!payload || !constantTimeEquals(payload.state, query.state)) {
      throw new AppError('STEAM_LINK_STATE_INVALID');
    }
    if (malformed) throw new AppError('STEAM_OPENID_INVALID');
    if (!this.config.steam.apiKey) throw new AppError('GAME_PROVIDER_NOT_CONFIGURED');
    // 4·5 — 형식 검증 + check_authentication(integration SteamApi)
    const openid: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) if (k.startsWith('openid.')) openid[k] = v;
    let verified: Awaited<ReturnType<SteamApi['verifyOpenIdAssertion']>>;
    try {
      verified = await this.steam.verifyOpenIdAssertion(openid, steamReturnTo(this.config, payload.state, payload.display));
    } catch (err) {
      if (err instanceof ExternalApiError) {
        if (err.kind === 'rate_limited') {
          throw new AppError('GAME_PROVIDER_RATE_LIMITED', undefined, { retryAfterSec: err.retryAfterSec ?? 60 });
        }
        if (err.kind === 'not_configured') throw new AppError('GAME_PROVIDER_NOT_CONFIGURED');
        throw new AppError('GAME_PROVIDER_ERROR', undefined, { cause: err });
      }
      throw err;
    }
    if (!verified.ok) throw new AppError('STEAM_OPENID_INVALID');
    const steamId = verified.steamId;
    const userId = payload.user_id;
    // 6
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new AppError('UNAUTHENTICATED');
    // 7 — 실패해도 진행
    let name = STEAM_FALLBACK_NAME;
    try {
      const summary = await this.steam.getPlayerSummary(steamId);
      if (summary?.personaName.trim()) name = summary.personaName.trim();
    } catch {
      name = STEAM_FALLBACK_NAME;
    }
    // 8
    const { steam } = await this.catalog.ids();
    const now = this.clock.now();
    let accountId: string;
    try {
      accountId = await this.prisma.$transaction(async (tx) => {
        await advisoryXactLock(tx, userGameAccountsLockKey(userId));
        if ((await tx.gameAccount.count({ where: { userId, gameId: steam } })) > 0) {
          throw new AppError('GAME_ACCOUNT_LIMIT_REACHED');
        }
        const other = await tx.gameAccount.findFirst({ where: { gameId: steam, externalId: steamId } });
        if (other) throw new AppError('GAME_ACCOUNT_ALREADY_LINKED');
        const row = await tx.gameAccount.create({
          data: {
            userId,
            gameId: steam,
            externalId: steamId,
            displayName: name,
            verified: true,
            verifiedAt: now,
            isPrimary: true,
            syncState: 'queued',
            syncStateAt: now,
          },
        });
        return row.id;
      });
    } catch (err) {
      // 5-2a 스팀 열
      const kind = classifyGameAccountUniqueViolation(err);
      if (kind === 'external_id') {
        const owner = await this.prisma.gameAccount.findFirst({ where: { gameId: steam, externalId: steamId } });
        throw new AppError(owner && owner.userId === userId ? 'GAME_ACCOUNT_LIMIT_REACHED' : 'GAME_ACCOUNT_ALREADY_LINKED');
      }
      if (kind === 'one_primary') throw new AppError('GAME_ACCOUNT_LIMIT_REACHED');
      if (kind === 'unknown') throw new AppError('INTERNAL_ERROR', undefined, { cause: err });
      throw err;
    }
    // 9
    await this.enqueuer.enqueue('steam-playtime', accountId, 'link');
  }
}
