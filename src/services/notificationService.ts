import { api, withQuery } from './apiClient'
import type { ApiNotification, MarkAllNotificationsReadResponse, NotificationListQuery } from './contracts'

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
}
