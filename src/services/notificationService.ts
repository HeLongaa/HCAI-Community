import { api, withQuery } from './apiClient'
import type { ApiNotification, MarkAllNotificationsReadResponse, NotificationListQuery, NotificationPreference } from './contracts'

export const notificationService = {
  async list(query?: NotificationListQuery) {
    return api.get<ApiNotification[]>(withQuery('/notifications', {
      cursor: query?.cursor,
      limit: query?.limit,
      readState: query?.readState ?? (query?.unreadOnly ? 'unread' : null),
      type: query?.type,
      resourceType: query?.resourceType,
    }))
  },
  async markRead(id: string) {
    return api.post<ApiNotification>(`/notifications/${id}/read`)
  },
  async markAllRead() {
    return api.post<MarkAllNotificationsReadResponse>('/notifications/read-all')
  },
  async listPreferences() {
    return api.get<NotificationPreference[]>('/notifications/preferences')
  },
  async setPreference(notificationType: string, inAppEnabled: boolean, expectedVersion?: number | null) {
    return api.put<NotificationPreference>(`/notifications/preferences/${encodeURIComponent(notificationType)}`, {
      inAppEnabled,
      expectedVersion: expectedVersion ?? null,
    })
  },
}
