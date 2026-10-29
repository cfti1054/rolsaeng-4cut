import {
  API_PREFIX,
  ApiPath,
  AUTH_COOKIE,
  DevLoginRequest,
  ERROR_HTTP_STATUS,
  Me,
  UpdateMeRequest,
  normalizeNickname,
  type ErrorBody,
  type ErrorCode,
  type RefreshTokenResponse,
} from '@gcd/shared';
import type { FetchLike } from '../client';
import { emptyS1State, handleS1, MockS1State, type MockS1Options } from './game-accounts';
import { emptyS2State, handleS2, MockS2State, type MockS2Options } from './scrims';

/**
 * [목] 계약(_workspace/01_architect_contract.md 4·5절)을 흉내 내는 가짜 API.
 * 백엔드가 준비되면 쓰지 않는다(NEXT_PUBLIC_API_MOCK을 끄면 lib/api/index.ts가 실제 fetch를 쓴다).
 * 모든 응답은 shared 스키마를 통과하는 모양으로 만든다(mock.test.ts가 검사).
 */

export interface MockStorage {
  get(): MockDb | null;
  set(db: MockDb): void;
}

export interface MockCookieJar {
  hasRefresh(): boolean;
  setRefresh(value: string): void;
  clearRefresh(): void;
}

export interface MockDb {
  user: Me | null;
  /** S1 게임 계정·소유 확인·새로고침 기록(lib/api/mock/game-accounts.ts) */
  s1?: MockS1State;
  /** S2 내전·참가자(lib/api/mock/scrims.ts) */
  s2?: MockS2State;
}

export interface MockBackendOptions {
  storage: MockStorage;
  cookies: MockCookieJar;
  now?: () => number;
  /** 액세스 토큰 수명(초). 재시도 흐름을 손으로 확인하려면 짧게 */
  accessTtlSec?: number;
  /** 응답 지연(ms). 로딩 상태 확인용 */
  latencyMs?: number;
  /** S1 목 설정(제공자 키 없음 흉내, 스팀 authorize_url 오리진) */
  s1?: MockS1Options;
  /** S2 목 설정(노쇼 정책) */
  s2?: MockS2Options;
}

/** 다른 멤버가 이미 쓰는 것으로 치는 닉네임(NICKNAME_TAKEN 확인용) */
export const MOCK_TAKEN_NICKNAMES = ['미드고정', '정글차이', 'admin'];

const TOKEN_PREFIX = 'mock-access.';

export function createMockBackend(opts: MockBackendOptions): { fetch: FetchLike; discordSignIn: () => Me } {
  const now = opts.now ?? (() => Date.now());
  const ttl = opts.accessTtlSec ?? 900;

  const load = (): MockDb => opts.storage.get() ?? { user: null };
  const save = (db: MockDb) => opts.storage.set(db);

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }
  function error(code: ErrorCode, message: string, details?: ErrorBody['details'], retryAfterSec?: number): Response {
    const body: ErrorBody = details ? { code, message, details } : { code, message };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (retryAfterSec !== undefined) headers['Retry-After'] = String(retryAfterSec);
    return new Response(JSON.stringify(body), { status: ERROR_HTTP_STATUS[code], headers });
  }
  function issue(user: Me): RefreshTokenResponse {
    return {
      access_token: `${TOKEN_PREFIX}${now() + ttl * 1000}`,
      token_type: 'Bearer',
      expires_in: ttl,
      user,
    };
  }
  function newUser(p: { username: string; nickname: string; discordId: string; role?: Me['role'] }): Me {
    return {
      id: crypto.randomUUID(),
      nickname: p.nickname,
      role: p.role ?? 'member',
      email: null,
      discord_id: p.discordId,
      discord_username: p.username,
      avatar_url: null,
      discord_guild_verified_at: p.discordId.startsWith('dev-') ? null : new Date(now()).toISOString(),
      needs_nickname_confirmation: true,
      created_at: new Date(now()).toISOString(),
    };
  }

  /** Authorization 검사: 없음·형식 오류 → UNAUTHENTICATED, 만료 → ACCESS_TOKEN_EXPIRED */
  function authorize(init: RequestInit | undefined): Response | Me {
    const headers = new Headers(init?.headers);
    const auth = headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token.startsWith(TOKEN_PREFIX)) return error('UNAUTHENTICATED', '인증이 필요합니다.');
    const exp = Number(token.slice(TOKEN_PREFIX.length));
    if (!Number.isFinite(exp)) return error('UNAUTHENTICATED', '인증이 필요합니다.');
    if (exp <= now()) return error('ACCESS_TOKEN_EXPIRED', '액세스 토큰이 만료되었습니다.');
    const user = load().user;
    if (!user) return error('UNAUTHENTICATED', '사용자가 없습니다.');
    return user;
  }

  async function handle(input: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const url = new URL(input, 'http://mock.local');
    const path = url.pathname.replace(API_PREFIX, '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

    if (method === 'POST' && path === ApiPath.authRefresh) {
      const user = load().user;
      if (!opts.cookies.hasRefresh() || !user) {
        opts.cookies.clearRefresh();
        return error('REFRESH_TOKEN_INVALID', '리프레시 토큰이 유효하지 않습니다.');
      }
      return json(200, issue(user));
    }

    if (method === 'POST' && path === ApiPath.authLogout) {
      opts.cookies.clearRefresh();
      return new Response(null, { status: 204 });
    }

    if (method === 'POST' && path === ApiPath.authDevLogin) {
      const parsed = DevLoginRequest.safeParse(body);
      if (!parsed.success) {
        return error(
          'VALIDATION_FAILED',
          '요청 형식이 올바르지 않습니다.',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      const db = load();
      const discordId = `dev-${parsed.data.username}`;
      let user = db.user?.discord_id === discordId ? db.user : null;
      if (!user) {
        user = newUser({ username: parsed.data.username, nickname: parsed.data.username.slice(0, 12), discordId });
      }
      if (parsed.data.role) user = { ...user, role: parsed.data.role };
      // 같은 사용자면 S1 상태(연동 계정)를 유지, 다른 사용자면 비운다
      save(db.user?.id === user.id ? { ...db, user } : { user });
      opts.cookies.setRefresh(`mock-rt-${user.id}`);
      return json(200, issue(user));
    }

    if (path === ApiPath.me && method === 'GET') {
      const r = authorize(init);
      return r instanceof Response ? r : json(200, r);
    }

    if (path === ApiPath.me && method === 'PATCH') {
      const r = authorize(init);
      if (r instanceof Response) return r;
      const parsed = UpdateMeRequest.safeParse(body);
      if (!parsed.success) {
        return error(
          'VALIDATION_FAILED',
          '요청 형식이 올바르지 않습니다.',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      }
      if (MOCK_TAKEN_NICKNAMES.includes(parsed.data.nickname)) {
        return error('NICKNAME_TAKEN', '이미 사용 중인 닉네임입니다.');
      }
      const user: Me = { ...r, nickname: parsed.data.nickname, needs_nickname_confirmation: false };
      save({ ...load(), user });
      return json(200, user);
    }

    // S1 엔드포인트(스팀 콜백은 브라우저 이동이라 목에 없다 — authorize_url이 바로 /settings?steam=linked)
    if (path.startsWith('/me/game-accounts') || path.startsWith('/users/')) {
      const r = authorize(init);
      if (r instanceof Response) return r;
      const db = load();
      const state = db.s1 ?? emptyS1State();
      const res = handleS1({
        method,
        path,
        body,
        me: r,
        now: now(),
        state,
        save: (s1) => save({ ...load(), s1 }),
        json,
        error: (code, message, o) => error(code, message, o?.details, o?.retryAfterSec),
        opts: opts.s1 ?? {},
      });
      if (res) return res;
    }

    // S2 내전·게임·노쇼 제한
    if (
      path === ApiPath.games ||
      path === ApiPath.steamApps ||
      path === ApiPath.scrims ||
      path.startsWith('/scrims/') ||
      path === ApiPath.myScrimRestriction
    ) {
      const r = authorize(init);
      if (r instanceof Response) return r;
      const res = handleS2({
        method,
        path,
        search: url.searchParams,
        body,
        me: r,
        now: now(),
        state: load().s2 ?? emptyS2State(),
        save: (s2) => save({ ...load(), s2 }),
        json,
        error: (code, message, o) => error(code, message, o?.details, o?.retryAfterSec),
        opts: opts.s2,
      });
      if (res) return res;
    }

    return error('NOT_FOUND', `목에 없는 경로: ${method} ${path}`);
  }

  return {
    async fetch(input, init) {
      if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
      return handle(input, init);
    },
    /**
     * 디스코드 OAuth 왕복(GET /auth/discord → 디스코드 → /auth/discord/callback)을 대신한다.
     * 신규 사용자를 만들고 리프레시 쿠키를 심는다. 기본 닉네임은 서버 닉네임을 다듬은 값처럼 만든다.
     */
    discordSignIn() {
      const db = load();
      const user =
        db.user && !db.user.discord_id?.startsWith('dev-')
          ? db.user
          : newUser({
              username: 'saebyeok_potato',
              nickname: normalizeNickname('  새벽감자  '),
              discordId: '123456789012345678',
            });
      save(db.user?.id === user.id ? { ...db, user } : { user });
      opts.cookies.setRefresh(`mock-rt-${user.id}`);
      return user;
    },
  };
}

/** 브라우저용 목: localStorage에 사용자, 일반 쿠키(gcd_rt)에 세션 표시 → middleware.ts도 실제와 같이 동작 */
export function browserMockBackend() {
  const KEY = 'gcd-mock-db';
  return createMockBackend({
    storage: {
      get() {
        try {
          const raw = window.localStorage.getItem(KEY);
          if (!raw) return null;
          const db = JSON.parse(raw) as { user: unknown; s1?: unknown; s2?: unknown };
          const user = Me.nullable().safeParse(db.user);
          if (!user.success) return null;
          // 저장 형식이 바뀌어 맞지 않으면 그 슬라이스 상태만 버린다
          const s1 = MockS1State.safeParse(db.s1);
          const s2 = MockS2State.safeParse(db.s2);
          return {
            user: user.data,
            ...(s1.success ? { s1: s1.data } : {}),
            ...(s2.success ? { s2: s2.data } : {}),
          };
        } catch {
          return null;
        }
      },
      set(db) {
        window.localStorage.setItem(KEY, JSON.stringify(db));
      },
    },
    cookies: {
      hasRefresh: () => document.cookie.split('; ').some((c) => c.startsWith(`${AUTH_COOKIE.refresh}=`)),
      setRefresh: (v) => {
        document.cookie = `${AUTH_COOKIE.refresh}=${encodeURIComponent(v)}; Path=/; SameSite=Lax; Max-Age=${30 * 86400}`;
      },
      clearRefresh: () => {
        document.cookie = `${AUTH_COOKIE.refresh}=; Path=/; SameSite=Lax; Max-Age=0`;
      },
    },
    accessTtlSec: Number(process.env.NEXT_PUBLIC_API_MOCK_ACCESS_TTL_SEC) || 900,
    s1: { origin: () => window.location.origin },
    latencyMs: 250,
  });
}
