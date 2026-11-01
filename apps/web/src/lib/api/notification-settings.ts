import {
  ApiPath,
  GetMyNotificationSettingsResponse,
  UpdateMyNotificationSettingsResponse,
  type UpdateMyNotificationSettingsRequest,
} from '@gcd/shared';
import { apiClient } from './index';

/** S6 알림 설정 2개(계약 S6 9절). scrim_start·patch 두 항목만(D259) */

/** GET /me/notification-settings */
export function getMyNotificationSettings(signal?: AbortSignal) {
  return apiClient.request(ApiPath.myNotificationSettings, GetMyNotificationSettingsResponse, { signal });
}

/** PATCH /me/notification-settings — 바꿀 항목만 보낸다 */
export function updateMyNotificationSettings(body: UpdateMyNotificationSettingsRequest) {
  return apiClient.request(ApiPath.myNotificationSettings, UpdateMyNotificationSettingsResponse, { method: 'PATCH', body });
}
