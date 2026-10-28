import {
  ApiPath,
  DevLoginResponse,
  GetMeResponse,
  UpdateMeResponse,
  type DevLoginRequest,
  type Me,
  type UpdateMeRequest,
} from '@gcd/shared';
import { API_MOCK, apiClient, mockBackend } from './index';
import { apiRoutes, routes } from '@/lib/routes';

/** 엔드포인트 하나당 함수 하나. 응답은 전부 shared 스키마로 parse된다(client.request). */

/** GET /me */
export function getMe(): Promise<Me> {
  return apiClient.request(ApiPath.me, GetMeResponse);
}

/** PATCH /me — body는 UpdateMeRequest로 미리 검증·정규화한 값 */
export function updateMe(body: UpdateMeRequest): Promise<Me> {
  return apiClient.request(ApiPath.me, UpdateMeResponse, { method: 'PATCH', body });
}

/** POST /auth/refresh */
export function refreshToken() {
  return apiClient.refresh();
}

/** POST /auth/logout — 실패해도 메모리 토큰은 버린다 */
export async function logout(): Promise<void> {
  try {
    await apiClient.request(ApiPath.authLogout, null, { method: 'POST', auth: false });
  } finally {
    apiClient.clearSession();
  }
}

/** POST /auth/dev-login (개발 전용) */
export async function devLogin(body: DevLoginRequest) {
  const res = await apiClient.request(ApiPath.authDevLogin, DevLoginResponse, { method: 'POST', body, auth: false });
  apiClient.setSession(res);
  return res;
}

/**
 * 디스코드 로그인 시작. 브라우저 전체 이동이다(fetch로 부르지 않는다).
 * [API 연결] 실제: GET /api/v1/auth/discord?redirect=… → 302 디스코드 → 콜백 → 302 /welcome 또는 redirect
 * [목] 디스코드 왕복을 건너뛰고 곧바로 콜백 결과 위치로 보낸다.
 */
export function startDiscordLogin(redirect: string): void {
  if (API_MOCK) {
    const user = mockBackend().discordSignIn();
    window.location.assign(user.needs_nickname_confirmation ? routes.welcome(redirect) : redirect);
    return;
  }
  window.location.assign(apiRoutes.discordStart(redirect === '/' ? undefined : redirect));
}
