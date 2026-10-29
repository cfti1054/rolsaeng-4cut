import { z } from 'zod';
import {
  type CallMode,
  ExternalApiError,
  type RiotAccount,
  type RiotApi,
  type RiotLeagueEntry,
  type RiotMatch,
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

/**
 * 경로 확인: 2026-10-28, Riot OpenAPI 스키마(공식 swagger에서 생성된 mingweisamuel/riotapi-schema)와 대조.
 * developer.riotgames.com/apis 는 JS 렌더링이라 WebFetch로 경로를 읽지 못했다(보고서 I1).
 * 라우팅: Account-V1·Match-V5 = regional(asia), Summoner-V4·League-V4·TFT-League-V1 = platform(kr).
 */
const AccountSchema = z.object({ puuid: z.string().min(1), gameName: z.string().min(1), tagLine: z.string().min(1) });
const SummonerSchema = z.object({ profileIconId: z.number().int() });
const LeagueEntrySchema = z.object({
  queueType: z.string(),
  // RANKED_TFT_TURBO 같은 항목은 tier·rank가 없다
  tier: z.string().default(''),
  rank: z.string().default(''),
  leaguePoints: z.number().int().default(0),
  wins: z.number().int().default(0),
  losses: z.number().int().default(0),
});
const MatchIdsSchema = z.array(z.string());
const MatchSchema = z.object({
  metadata: z.object({ matchId: z.string() }),
  info: z.object({
    queueId: z.number().int(),
    gameDuration: z.number(),
    gameStartTimestamp: z.number(),
    gameEndTimestamp: z.number().optional(),
    participants: z.array(
      z.object({
        puuid: z.string(),
        win: z.boolean(),
        championId: z.number().int(),
        teamPosition: z.string().default(''),
        kills: z.number().int(),
        deaths: z.number().int(),
        assists: z.number().int(),
      }),
    ),
  }),
});

export class RiotHttpApi implements RiotApi {
  constructor(
    private readonly opts: IntegrationOptions,
    private readonly limiter: HostRateLimiter,
    private readonly fetchFn: FetchLike = (url, init) => fetch(url, init),
    private readonly clock: Clock = systemClock,
  ) {}

  private get regionalHost(): string {
    return `${this.opts.regionalRouting}.api.riotgames.com`;
  }
  private get platformHost(): string {
    return `${this.opts.platformRouting}.api.riotgames.com`;
  }

  getAccountByRiotId(gameName: string, tagLine: string, mode: CallMode): Promise<RiotAccount> {
    const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    return this.get(this.regionalHost, path, AccountSchema, mode);
  }

  getAccountByPuuid(puuid: string, mode: CallMode): Promise<RiotAccount> {
    return this.get(this.regionalHost, `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`, AccountSchema, mode);
  }

  getSummonerByPuuid(puuid: string, mode: CallMode): Promise<{ profileIconId: number }> {
    return this.get(this.platformHost, `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`, SummonerSchema, mode);
  }

  getLolLeagueEntries(puuid: string): Promise<RiotLeagueEntry[]> {
    return this.get(
      this.platformHost,
      `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
      z.array(LeagueEntrySchema),
      'background',
    );
  }

  getTftLeagueEntries(puuid: string): Promise<RiotLeagueEntry[]> {
    // 주의: TFT-League-V1은 `/tft/league/v1/by-puuid/{puuid}` (entries 없음)
    return this.get(
      this.platformHost,
      `/tft/league/v1/by-puuid/${encodeURIComponent(puuid)}`,
      z.array(LeagueEntrySchema),
      'background',
    );
  }

  getLolMatchIds(puuid: string, opts: { queue: number; count: number }): Promise<string[]> {
    const q = new URLSearchParams({ queue: String(opts.queue), type: 'ranked', count: String(opts.count) });
    return this.get(
      this.regionalHost,
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${q.toString()}`,
      MatchIdsSchema,
      'background',
    );
  }

  async getLolMatch(matchId: string): Promise<RiotMatch> {
    const m = await this.get(
      this.regionalHost,
      `/lol/match/v5/matches/${encodeURIComponent(matchId)}`,
      MatchSchema,
      'background',
    );
    const end = m.info.gameEndTimestamp ?? null;
    // gameEndTimestamp가 없는 옛 응답은 gameDuration이 밀리초(Riot 스키마 설명)
    const durationSec = end === null ? Math.round(m.info.gameDuration / 1000) : Math.round(m.info.gameDuration);
    return {
      matchId: m.metadata.matchId,
      queueId: m.info.queueId,
      gameDuration: durationSec,
      gameStartTimestamp: m.info.gameStartTimestamp,
      gameEndTimestamp: end,
      participants: m.info.participants,
    };
  }

  /** 키 확인 → 토큰 → 호출 → 분류. 429는 호스트를 멈추고 던진다. */
  private async get<T>(
    host: string,
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    mode: CallMode,
  ): Promise<T> {
    const key = this.opts.riotApiKey;
    if (!key) throw new ExternalApiError('not_configured', 'RIOT_API_KEY 없음');

    const once = async (): Promise<T> => {
      await this.limiter.acquire(host, mode === 'interactive' ? { maxWaitMs: this.opts.interactiveMaxWaitMs } : {});
      const res = await rawRequest(
        this.fetchFn,
        `https://${host}${path}`,
        { method: 'GET', headers: { 'X-Riot-Token': key, Accept: 'application/json' } },
        this.opts.timeoutMs,
        this.clock,
      );
      const err = classifyStatus(res);
      if (err) {
        if (err.kind === 'rate_limited' && err.retryAfterSec !== undefined) this.limiter.pause(host, err.retryAfterSec);
        if (err.kind === 'auth') console.error('[riot] 401/403: 라이엇 키 만료/권한 확인 필요');
        throw err;
      }
      const parsed = schema.safeParse(parseJson(res.text));
      if (!parsed.success) throw new ExternalApiError('bad_response', `${path.split('/')[1]} 응답 형식 불일치`);
      return parsed.data;
    };

    // 리그 항목 조회의 404는 계정 없음으로 그대로 던진다(기록 없음은 200 [] 이다).
    return withRetry(this.clock, mode, once);
  }
}
