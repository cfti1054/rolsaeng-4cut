import { createApiClient, type FetchLike } from './client';
import { browserMockBackend } from './mock/backend';
import { routes } from '@/lib/routes';

/**
 * 앱 전체가 쓰는 API 클라이언트 하나.
 *
 * [API 연결] NEXT_PUBLIC_API_MOCK=true면 목(lib/api/mock/backend.ts)을, 아니면 실제 fetch를 쓴다.
 * 실제 요청은 웹 오리진의 /api/v1/* 로 가고 next.config.ts rewrites가 API_ORIGIN으로 넘긴다.
 */
export const API_MOCK = process.env.NEXT_PUBLIC_API_MOCK === 'true';

let mock: ReturnType<typeof browserMockBackend> | null = null;
export function mockBackend() {
  if (!mock) mock = browserMockBackend();
  return mock;
}

const transport: FetchLike = (input, init) =>
  API_MOCK && typeof window !== 'undefined' ? mockBackend().fetch(input, init) : fetch(input, init);

export const apiClient = createApiClient({
  fetch: transport,
  onAuthFailure: () => {
    if (typeof window === 'undefined') return;
    const { pathname, search } = window.location;
    if (pathname === '/login') return;
    // middleware와 같은 규칙: /welcome?redirect=X 는 X를 넘긴다(/welcome 자체는 루프 방지 규칙에 걸려 / 가 된다)
    const redirect =
      pathname === '/welcome'
        ? (new URLSearchParams(search).get('redirect') ?? '/')
        : `${pathname}${search}`;
    window.location.assign(routes.login({ redirect }));
  },
});
