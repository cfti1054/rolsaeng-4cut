'use client';

import type { NotificationSettings, UpdateMyNotificationSettingsRequest } from '@gcd/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '@/lib/api/client';
import { getMyNotificationSettings, updateMyNotificationSettings } from '@/lib/api/notification-settings';

/** S6 알림 설정 훅 2개(계약 S6 13절). 키 ['me', 'notification-settings'] */
export const notificationKeys = {
  settings: ['me', 'notification-settings'] as const,
};

/** GET /me/notification-settings */
export function useNotificationSettings() {
  return useQuery({
    queryKey: notificationKeys.settings,
    queryFn: ({ signal }) => getMyNotificationSettings(signal),
    staleTime: 60_000,
    retry: (count, err) => !(isApiError(err) && err.status > 0 && err.status < 500) && count < 2,
  });
}

/**
 * PATCH /me/notification-settings — 즉시 저장. 낙관적 갱신 후 실패하면 이전 값으로 되돌린다(계약 S6 13절).
 */
export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMyNotificationSettingsRequest) => updateMyNotificationSettings(body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: notificationKeys.settings });
      const prev = qc.getQueryData<NotificationSettings>(notificationKeys.settings);
      if (prev) qc.setQueryData<NotificationSettings>(notificationKeys.settings, { ...prev, ...body });
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData(notificationKeys.settings, ctx.prev);
    },
    onSuccess: (data) => qc.setQueryData(notificationKeys.settings, data),
  });
}
