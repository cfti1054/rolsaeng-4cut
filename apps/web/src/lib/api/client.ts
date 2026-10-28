import {
  ACCESS_TOKEN_TYPE,
  API_PREFIX,
  ApiPath,
  ErrorBody,
  RefreshTokenResponse,
  type ErrorDetail,
  type Me,
} from '@gcd/shared';
import type { z } from 'zod';
import type { AppErrorCode } from '@/lib/errors';

/**
 * API 클라이언트(계약 5-9).
 * - 브라우저는 웹 오리진의 /api/v1/* 만 호출한다(Next rewrites가 API로 프록시). credentials: 'include'.
 * - 액세스 토큰은 이 모듈의 메모리에만 둔다. localStorage·쿠키에 저장하지 않는다.
 * - 토큰이 없으면 먼저 POST /auth/refresh(single-flight)로 받아 온다(부팅).
 * - 401 ACCESS_TOKEN_EXPIRED → refresh 1회 → 원 요청 1회 재시도. 그래도 401이면 포기.
 * - 리프레시 실패(REFRESH_TOKEN_*), UNAUTHENTICATED → 세션 비우고 onAuthFailure(기본: /login 이동).
 * - 성공 응답은 shared zod 스키마로 parse한다. 어긋나면 INVALID_RESPONSE.
 */

export class ApiError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: AppErrorCode, status: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiClientHandlers {
  /** 세션을 잃었을 때(리프레시 실패 등). 기본 구현은 /login으로 이동 */
  onAuthFailure?: (error: ApiError) => void;
  /** refresh·dev-login으로 새 사용자 정보를 받았을 때(react-query 캐시 갱신용) */
  onSession?: (user: Me) => void;
}

export interface ApiClientOptions extends ApiClientHandlers {
  fetch: FetchLike;
  /** 기본 '' = 같은 오리진 */
  baseUrl?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON으로 보낼 본문 */
  body?: unknown;
  /** false면 Authorization을 붙이지 않고 토큰 부팅·재시도도 하지 않는다(인증 엔드포인트용) */
  auth?: boolean;
  signal?: AbortSignal;
}

export type ApiClient = ReturnType<typeof createApiClient>;

const REFRESH_FAILURE_STATUS = 401;

export function createApiClient(options: ApiClientOptions) {
  const handlers: ApiClientHandlers = { onAuthFailure: options.onAuthFailure, onSession: options.onSession };
  const baseUrl = options.baseUrl ?? '';
  let accessToken: string | null = null;
  let refreshInFlight: Promise<RefreshTokenResponse> | null = null;

  function url(path: string): string {
    return `${baseUrl}${API_PREFIX}${path}`;
  }

  async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `${ACCESS_TOKEN_TYPE} ${token}`;
    try {
      return await options.fetch(url(path), {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: 'include',
        cache: 'no-store',
        signal: opts.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError('NETWORK_ERROR', 0, e instanceof Error ? e.message : 'network error');
    }
  }

  async function toError(res: Response): Promise<ApiError> {
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* 본문 없음·JSON 아님(프록시 502 HTML 등) */
    }
    const parsed = ErrorBody.safeParse(json);
    if (parsed.success) {
      return new ApiError(parsed.data.code, res.status, parsed.data.message, parsed.data.details);
    }
    // API가 꺼져 있으면 Next 프록시가 500/502를 HTML로 낸다 → 연결 실패로 본다
    const code: AppErrorCode = res.status >= 500 ? 'NETWORK_ERROR' : 'INVALID_RESPONSE';
    return new ApiError(code, res.status, `HTTP ${res.status}`);
  }

  async function parseBody<S extends z.ZodTypeAny>(res: Response, schema: S, path: string): Promise<z.infer<S>> {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new ApiError('INVALID_RESPONSE', res.status, `${path}: JSON 아님`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // 계약 위반은 여기서 드러난다(타입 단언으로 넘기지 않는다)
      console.error(`[api] ${path} 응답이 계약과 다릅니다`, parsed.error.issues);
      throw new ApiError('INVALID_RESPONSE', res.status, `${path}: 응답 계약 위반`);
    }
    return parsed.data as z.infer<S>;
  }

  function clearSession(): void {
    accessToken = null;
  }

  function failAuth(err: ApiError): void {
    clearSession();
    handlers.onAuthFailure?.(err);
  }

  function applySession(res: RefreshTokenResponse): void {
    accessToken = res.access_token;
    handlers.onSession?.(res.user);
  }

  /**
   * POST /auth/refresh — 여러 곳에서 동시에 불러도 요청은 1개(single-flight).
   * 401(REFRESH_TOKEN_INVALID·REUSED)이면 세션을 비우고 onAuthFailure를 부른다.
   */
  function refresh(): Promise<RefreshTokenResponse> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const res = await send(ApiPath.authRefresh, { method: 'POST' }, null);
        if (!res.ok) {
          const err = await toError(res);
          if (res.status === REFRESH_FAILURE_STATUS) failAuth(err);
          throw err;
        }
        const body = await parseBody(res, RefreshTokenResponse, ApiPath.authRefresh);
        applySession(body);
        return body;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function request<S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    opts?: RequestOptions,
  ): Promise<z.infer<S>>;
  async function request(path: string, schema: null, opts?: RequestOptions): Promise<void>;
  async function request<S extends z.ZodTypeAny>(
    path: string,
    schema: S | null,
    opts: RequestOptions = {},
  ): Promise<z.infer<S> | void> {
    const auth = opts.auth ?? true;

    if (auth && !accessToken) await refresh();

    let usedToken = auth ? accessToken : null;
    let res = await send(path, opts, usedToken);

    if (auth && res.status === 401) {
      const err = await toError(res);
      if (err.code !== 'ACCESS_TOKEN_EXPIRED') {
        failAuth(err);
        throw err;
      }
      // 다른 요청이 이미 새 토큰을 받아 왔으면 refresh 없이 그 토큰으로 재시도
      if (accessToken === usedToken) await refresh();
      usedToken = accessToken;
      res = await send(path, opts, usedToken);
      if (res.status === 401) {
        const again = await toError(res);
        failAuth(again);
        throw again;
      }
    }

    if (!res.ok) throw await toError(res);
    if (schema === null || res.status === 204) return;
    return parseBody(res, schema, path);
  }

  return {
    request,
    refresh,
    clearSession,
    /** dev-login처럼 인증 응답을 직접 받은 경우 */
    setSession: applySession,
    hasAccessToken: () => accessToken !== null,
    configure(next: ApiClientHandlers) {
      Object.assign(handlers, next);
    },
  };
}
