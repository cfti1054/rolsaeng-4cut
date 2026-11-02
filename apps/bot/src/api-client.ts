import {
  ApiPath,
  BOT_API_KEY_HEADER,
  ErrorBody,
  GetBotPendingNoticesResponse,
  GetBotPendingPatchNotesResponse,
  GetBotRankingResponse,
  GetBotUpcomingScrimsResponse,
  PostBotActivityResponse,
  PostBotDeliveredResponse,
  PostBotMemberEventsResponse,
  PutBotPresenceResponse,
  fillPath,
  type BotRankingType,
  type GetBotPendingNoticesResponse as PendingNotices,
  type GetBotPendingPatchNotesResponse as PendingPatchNotes,
  type GetBotRankingResponse as RankingResponse,
  type GetBotUpcomingScrimsResponse as UpcomingResponse,
  type PostBotActivityRequest,
  type PostBotActivityResponse as ActivityResponse,
  type PostBotDeliveredResponse as DeliveredResponse,
  type PostBotMemberEventsRequest,
  type PostBotMemberEventsResponse as MemberResponse,
  type PutBotPresenceRequest,
  type PutBotPresenceResponse as PresenceResponse,
} from '@gcd/shared';
import type { z } from 'zod';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(status: number, code: string | null, retryable: boolean) {
    super(`API ${status}${code ? ` ${code}` : ''}`);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function joinUrl(base: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/+$/, '')}${normalized}`;
}

/** 429는 Retry-After를 따른다. 그 외는 1초, 2초, 4초… 최대 8초. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
    const when = Date.parse(retryAfter);
    if (!Number.isNaN(when)) return Math.min(Math.max(0, when - Date.now()), 30_000);
  }
  return Math.min(1000 * 2 ** attempt, 8_000);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function errorCode(payload: unknown): string | null {
  const parsed = ErrorBody.safeParse(payload);
  return parsed.success ? parsed.data.code : null;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type BotApiClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
};

export class BotApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;

  constructor(options: BotApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  postActivity(body: PostBotActivityRequest): Promise<ActivityResponse> {
    return this.send('POST', ApiPath.botActivity, PostBotActivityResponse, body);
  }

  postMemberEvents(body: PostBotMemberEventsRequest): Promise<MemberResponse> {
    return this.send('POST', ApiPath.botMemberEvents, PostBotMemberEventsResponse, body);
  }

  putPresence(body: PutBotPresenceRequest): Promise<PresenceResponse> {
    return this.send('PUT', ApiPath.botPresence, PutBotPresenceResponse, body);
  }

  upcomingScrims(withinMin: number): Promise<UpcomingResponse> {
    return this.send('GET', `${ApiPath.botUpcomingScrims}?within_min=${withinMin}`, GetBotUpcomingScrimsResponse);
  }

  ranking(type: BotRankingType, query: Record<string, string | number | undefined>): Promise<RankingResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    const path = fillPath(ApiPath.botRanking, { type });
    return this.send('GET', qs ? `${path}?${qs}` : path, GetBotRankingResponse);
  }

  pendingNotices(): Promise<PendingNotices> {
    return this.send('GET', ApiPath.botPendingNotices, GetBotPendingNoticesResponse);
  }

  deliverNotice(id: string): Promise<DeliveredResponse> {
    return this.send('POST', fillPath(ApiPath.botNoticeDelivered, { id }), PostBotDeliveredResponse, {});
  }

  pendingPatchNotes(): Promise<PendingPatchNotes> {
    return this.send('GET', ApiPath.botPendingPatchNotes, GetBotPendingPatchNotesResponse);
  }

  deliverPatchNote(id: string): Promise<DeliveredResponse> {
    return this.send('POST', fillPath(ApiPath.botPatchNoteDelivered, { id }), PostBotDeliveredResponse, {});
  }

  private async send<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const url = joinUrl(this.baseUrl, path);
    let last: ApiRequestError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const res = await this.fetchImpl(url, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: {
            accept: 'application/json',
            [BOT_API_KEY_HEADER]: this.apiKey,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const payload = await readJson(res);
        if (res.ok) {
          const parsed = schema.safeParse(payload);
          if (!parsed.success) throw new ApiRequestError(res.status, 'RESPONSE_INVALID', false);
          return parsed.data;
        }
        const error = new ApiRequestError(res.status, errorCode(payload), isRetryableStatus(res.status));
        if (!error.retryable || attempt === this.maxAttempts - 1) throw error;
        last = error;
        await this.sleep(retryDelayMs(attempt, res.headers.get('retry-after')));
      } catch (err) {
        if (err instanceof ApiRequestError) throw err;
        const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        const error = new ApiRequestError(0, timeout ? 'TIMEOUT' : 'NETWORK', true);
        if (attempt === this.maxAttempts - 1) throw error;
        last = error;
        await this.sleep(retryDelayMs(attempt, null));
      }
    }
    throw last ?? new ApiRequestError(0, 'NETWORK', true);
  }
}
