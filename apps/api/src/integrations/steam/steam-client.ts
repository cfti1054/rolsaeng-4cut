import { STEAM_CLAIMED_ID_PATTERN, STEAM_OPENID_ENDPOINT } from '@gcd/shared';
import { z } from 'zod';
import {
  type CallMode,
  ExternalApiError,
  type SteamApi,
  type SteamOwnedGame,
} from '../contracts';
import {
  type Clock,
  type FetchLike,
  classifyStatus,
  parseJson,
  rawRequest,
  systemClock,
} from '../http';
import type { IntegrationOptions } from '../options';
import type { HostRateLimiter } from '../rate-limiter';
import { withRetry } from '../retry';

const STEAM_API_HOST = 'api.steampowered.com';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';

const OwnedGamesSchema = z.object({
  response: z
    .object({
      game_count: z.number().int().optional(),
      games: z
        .array(
          z.object({
            appid: z.number().int(),
            name: z.string().optional(),
            playtime_forever: z.number().int().optional(),
            playtime_2weeks: z.number().int().optional(),
          }),
        )
        .optional(),
    })
    .default({}),
});
const PlayerSummariesSchema = z.object({
  response: z.object({ players: z.array(z.object({ personaname: z.string() })).default([]) }),
});

export class SteamHttpApi implements SteamApi {
  /**
   * @param limiter 토큰 버킷 없이 429 일시정지만 쓰는 인스턴스(스팀은 호출량이 작다)
   */
  constructor(
    private readonly opts: IntegrationOptions,
    private readonly limiter: HostRateLimiter,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly clock: Clock = systemClock,
  ) {}

  async getOwnedGames(
    steamId: string,
  ): Promise<{ visibility: 'private' } | { visibility: 'public'; games: SteamOwnedGame[] }> {
    const body = await this.getJson(
      '/IPlayerService/GetOwnedGames/v0001/',
      { steamid: steamId, include_appinfo: '1', include_played_free_games: '1', format: 'json' },
      OwnedGamesSchema,
      'background',
    );
    const r = body.response;
    // 비공개 프로필(게임 세부 정보 비공개)은 `{"response":{}}` — game_count가 없다. 0개 공개는 game_count: 0.
    if (r.game_count === undefined) return { visibility: 'private' };
    return {
      visibility: 'public',
      games: (r.games ?? []).map((g) => ({
        appId: g.appid,
        name: g.name ?? null,
        minutesTotal: g.playtime_forever ?? 0,
        minutesRecent: g.playtime_2weeks ?? 0,
      })),
    };
  }

  /** 기본은 요청 처리 중 호출(콜백)이라 'interactive'. 작업자는 'background'를 넘긴다. */
  async getPlayerSummary(steamId: string, mode: CallMode = 'interactive'): Promise<{ personaName: string } | null> {
    const body = await this.getJson(
      '/ISteamUser/GetPlayerSummaries/v0002/',
      { steamids: steamId, format: 'json' },
      PlayerSummariesSchema,
      mode,
    );
    const p = body.response.players[0];
    return p ? { personaName: p.personaname } : null;
  }

  /**
   * 계약 5-2 4·5단계. 모든 검증 실패는 { ok:false }(호출부가 STEAM_OPENID_INVALID로 변환),
   * 네트워크·5xx는 ExternalApiError.
   */
  async verifyOpenIdAssertion(
    query: Record<string, string>,
    expectedReturnTo: string,
  ): Promise<{ ok: true; steamId: string } | { ok: false }> {
    if (query['openid.ns'] !== OPENID_NS) return { ok: false };
    if (query['openid.op_endpoint'] !== STEAM_OPENID_ENDPOINT) return { ok: false };
    if (query['openid.return_to'] !== expectedReturnTo) return { ok: false };
    const claimed = query['openid.claimed_id'];
    if (claimed === undefined || query['openid.identity'] !== claimed) return { ok: false };
    const m = STEAM_CLAIMED_ID_PATTERN.exec(claimed);
    if (!m || !m[1]) return { ok: false };
    const steamId = m[1];

    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (k.startsWith('openid.')) form.set(k, v);
    }
    form.set('openid.mode', 'check_authentication');

    const text = await withRetry(this.clock, 'interactive', async () => {
      await this.limiter.acquire('steamcommunity.com', { maxWaitMs: this.opts.interactiveMaxWaitMs });
      const res = await rawRequest(
        this.fetchFn,
        STEAM_OPENID_ENDPOINT,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
          body: form.toString(),
        },
        this.opts.timeoutMs,
        this.clock,
      );
      const err = classifyStatus(res);
      if (err) {
        if (err.kind === 'rate_limited' && err.retryAfterSec !== undefined) {
          this.limiter.pause('steamcommunity.com', err.retryAfterSec);
        }
        // 4xx(404 포함)는 검증 실패가 아니라 공급자 오류로 취급
        throw err.kind === 'not_found' || err.kind === 'bad_response' ? new ExternalApiError('bad_response', err.message) : err;
      }
      return res.text;
    });

    // 응답은 `ns:...\nis_valid:true\n` 형태의 key:value 줄
    const valid = text.split(/\r?\n/).some((line) => line.trim() === 'is_valid:true');
    return valid ? { ok: true, steamId } : { ok: false };
  }

  private async getJson<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    mode: CallMode,
  ): Promise<T> {
    const key = this.opts.steamApiKey;
    if (!key) throw new ExternalApiError('not_configured', 'STEAM_API_KEY 없음');
    // 키는 쿼리 문자열에만 들어가며 오류 메시지·로그에는 URL을 싣지 않는다
    const url = `https://${STEAM_API_HOST}${path}?${new URLSearchParams({ key, ...params }).toString()}`;

    return withRetry(this.clock, mode, async () => {
      await this.limiter.acquire(STEAM_API_HOST, mode === 'interactive' ? { maxWaitMs: this.opts.interactiveMaxWaitMs } : {});
      const res = await rawRequest(this.fetchFn, url, { method: 'GET', headers: { Accept: 'application/json' } }, this.opts.timeoutMs, this.clock);
      const err = classifyStatus(res);
      if (err) {
        if (err.kind === 'rate_limited' && err.retryAfterSec !== undefined) this.limiter.pause(STEAM_API_HOST, err.retryAfterSec);
        if (err.kind === 'auth') console.error('[steam] 401/403: 스팀 키 확인 필요');
        throw err;
      }
      const parsed = schema.safeParse(parseJson(res.text));
      if (!parsed.success) throw new ExternalApiError('bad_response', `${path} 응답 형식 불일치`);
      return parsed.data;
    });
  }
}
