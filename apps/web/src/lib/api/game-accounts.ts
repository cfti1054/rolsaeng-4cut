import {
  ApiPath,
  ConfirmRiotVerificationResponse,
  GetMyGameAccountsResponse,
  GetUserProfileResponse,
  LinkGameAccountResponse,
  SetPrimaryGameAccountResponse,
  SyncGameAccountResponse,
  fillPath,
  type LinkGameAccountRequestInput,
} from '@gcd/shared';
import { apiClient } from './index';

/**
 * S1 엔드포인트(계약 4절). 엔드포인트 하나당 함수 하나, 응답은 전부 shared zod 스키마로 parse된다.
 * 경로는 ApiPath + fillPath만 쓴다(D54).
 */

/** GET /me/game-accounts */
export function getMyGameAccounts(signal?: AbortSignal) {
  return apiClient.request(ApiPath.myGameAccounts, GetMyGameAccountsResponse, { signal });
}

/** POST /me/game-accounts — riot: 소유 확인 시작, steam: OpenID 시작 URL */
export function linkGameAccount(body: LinkGameAccountRequestInput) {
  return apiClient.request(ApiPath.myGameAccounts, LinkGameAccountResponse, { method: 'POST', body });
}

/** POST /me/game-accounts/riot-verifications/:id/confirm */
export function confirmRiotVerification(id: string) {
  return apiClient.request(fillPath(ApiPath.riotVerificationConfirm, { id }), ConfirmRiotVerificationResponse, {
    method: 'POST',
  });
}

/** DELETE /me/game-accounts/riot-verifications/:id (204) */
export function cancelRiotVerification(id: string): Promise<void> {
  return apiClient.request(fillPath(ApiPath.riotVerification, { id }), null, { method: 'DELETE' });
}

/** DELETE /me/game-accounts/:id (204) — 라이엇이면 같은 라이엇 ID의 lol·tft 함께 */
export function unlinkGameAccount(id: string): Promise<void> {
  return apiClient.request(fillPath(ApiPath.myGameAccount, { id }), null, { method: 'DELETE' });
}

/** POST /me/game-accounts/:id/primary */
export function setPrimaryGameAccount(id: string) {
  return apiClient.request(fillPath(ApiPath.myGameAccountPrimary, { id }), SetPrimaryGameAccountResponse, {
    method: 'POST',
  });
}

/** POST /me/game-accounts/:id/sync (202) */
export function syncGameAccount(id: string) {
  return apiClient.request(fillPath(ApiPath.myGameAccountSync, { id }), SyncGameAccountResponse, { method: 'POST' });
}

/** GET /users/:id/profile */
export function getUserProfile(id: string, signal?: AbortSignal) {
  return apiClient.request(fillPath(ApiPath.userProfile, { id }), GetUserProfileResponse, { signal });
}
