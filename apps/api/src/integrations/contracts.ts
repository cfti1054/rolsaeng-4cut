/**
 * 외부 연동 내부 계약(계약 9절). backend는 이 타입과 목으로 작업하고,
 * integration이 구현을 제공한다. shared가 아니라 apps/api 내부 경계다.
 */

export type ExternalErrorKind =
  | 'not_found'
  | 'auth'
  | 'rate_limited'
  | 'unavailable'
  | 'bad_response'
  | 'not_configured';

export class ExternalApiError extends Error {
  readonly kind: ExternalErrorKind;
  readonly retryAfterSec?: number;

  constructor(kind: ExternalErrorKind, message?: string, opts?: { retryAfterSec?: number; cause?: unknown }) {
    super(message ?? kind, opts?.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'ExternalApiError';
    this.kind = kind;
    if (opts?.retryAfterSec !== undefined) this.retryAfterSec = opts.retryAfterSec;
  }
}

/** 'interactive' = HTTP 요청 처리 중(3초 대기 한도, 1회 재시도), 'background' = 작업자(6-4) */
export type CallMode = 'interactive' | 'background';

export type RiotLeagueEntry = {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

export type RiotAccount = { puuid: string; gameName: string; tagLine: string };

/** Match-V5 응답에서 쓰는 필드만 */
export type RiotMatch = {
  matchId: string;
  queueId: number;
  /** 초 단위로 정규화(gameEndTimestamp 없는 옛 응답의 밀리초 값은 클라이언트가 환산) */
  gameDuration: number;
  gameStartTimestamp: number;
  gameEndTimestamp: number | null;
  participants: {
    puuid: string;
    win: boolean;
    championId: number;
    teamPosition: string;
    kills: number;
    deaths: number;
    assists: number;
  }[];
};

export interface RiotApi {
  getAccountByRiotId(gameName: string, tagLine: string, mode: CallMode): Promise<RiotAccount>;
  getAccountByPuuid(puuid: string, mode: CallMode): Promise<RiotAccount>;
  getSummonerByPuuid(puuid: string, mode: CallMode): Promise<{ profileIconId: number }>;
  getLolLeagueEntries(puuid: string): Promise<RiotLeagueEntry[]>; // background
  getTftLeagueEntries(puuid: string): Promise<RiotLeagueEntry[]>; // background
  getLolMatchIds(puuid: string, opts: { queue: number; count: number }): Promise<string[]>;
  getLolMatch(matchId: string): Promise<RiotMatch>;
}

export type SteamOwnedGame = {
  appId: number;
  name: string | null;
  minutesTotal: number;
  minutesRecent: number;
};

export interface SteamApi {
  getOwnedGames(
    steamId: string,
  ): Promise<{ visibility: 'private' } | { visibility: 'public'; games: SteamOwnedGame[] }>;
  /** mode 생략 = 'interactive'(스팀 콜백 중 호출). 작업자는 'background'를 넘긴다 */
  getPlayerSummary(steamId: string, mode?: CallMode): Promise<{ personaName: string } | null>;
  /** 5-2 4·5단계. 형식 불일치·is_valid≠true → { ok:false }, 네트워크·5xx → ExternalApiError */
  verifyOpenIdAssertion(
    query: Record<string, string>,
    expectedReturnTo: string,
  ): Promise<{ ok: true; steamId: string } | { ok: false }>;
}

export interface DataDragon {
  profileIconUrl(iconId: number): Promise<string | null>;
  champion(championId: number): Promise<{ key: string; nameKo: string; imageUrl: string | null } | null>;
}

export type SyncJobKind = 'riot-full' | 'riot-tier' | 'riot-matches' | 'steam-playtime';
export type SyncJobReason = 'manual' | 'link' | 'profile-view' | 'schedule' | 'recovery';
export type SyncJob = { kind: SyncJobKind; gameAccountId: string; reason: SyncJobReason; priority: number };

export interface SyncQueue {
  /** 중복 키는 조용히 무시 */
  enqueue(job: SyncJob): Promise<void>;
}

export const RIOT_API = Symbol('RIOT_API');
export const STEAM_API = Symbol('STEAM_API');
export const DATA_DRAGON = Symbol('DATA_DRAGON');
export const SYNC_QUEUE = Symbol('SYNC_QUEUE');
