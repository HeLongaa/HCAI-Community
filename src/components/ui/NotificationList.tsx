import { CheckCircle, ExternalLink } from 'lucide-react'
import type { ApiNotification } from '../../services/contracts'
import { StatusBadge } from '../../features/tasks'
import { textFor } from '../../domain/utils'

type NotificationListProps = {
  t: Record<string, string>
  notifications: ApiNotification[]
  loading: boolean
  error: string | null
  variant: 'popover' | 'admin'
  readingId?: string | null
  onOpen?: (notification: ApiNotification) => void
  onMarkRead: (notification: ApiNotification) => void | Promise<void>
  formatTime: (value: string) => string
  loadingTitle?: string
  loadingBody?: string
  emptyTitle?: string
  emptyBody?: string
  errorTitle?: string
}

export function NotificationList({
  t,
  notifications,
  loading,
  error,
  variant,
  readingId = null,
  onOpen,
  onMarkRead,
  formatTime,
  loadingTitle,
  loadingBody,
  emptyTitle,
  emptyBody,
  errorTitle,
}: NotificationListProps) {
  const emptyClass = variant === 'popover' ? 'notification-empty' : 'empty-state'
  const listClass = variant === 'popover' ? 'notification-list' : 'admin-table'

  return (
    <div className={listClass}>
      {loading && (
        <div className={emptyClass}>
          <strong>{loadingTitle ?? textFor(t, 'Loading reminders', '正在加载提醒')}</strong>
          <span>{loadingBody ?? textFor(t, 'Reading your latest reminders.', '正在读取最新提醒。')}</span>
        </div>
      )}
      {!loading && error && (
        <div className={emptyClass}>
          <strong>{errorTitle ?? textFor(t, 'Notifications unavailable', '通知暂不可用')}</strong>
          <span>{error}</span>
        </div>
      )}
      {!loading && !error && notifications.length === 0 && (
        <div className={emptyClass}>
          <strong>{emptyTitle ?? textFor(t, 'No unread reminders', '暂无未读提醒')}</strong>
          <span>{emptyBody ?? textFor(t, 'High-risk point workflows will show up here.', '高风险积分流程会显示在这里。')}</span>
        </div>
      )}
      {!loading && !error && notifications.map((notification) => (
        variant === 'popover' ? (
          <article className="notification-item" key={notification.id}>
            <button
              type="button"
              onClick={() => onOpen?.(notification)}
            >
              <strong>{notification.title}</strong>
              <span>{notification.body}</span>
              <small>
                {notification.type} · {formatTime(notification.createdAt)}
              </small>
            </button>
            <button
              className="ghost-button small"
              type="button"
              onClick={() => void onMarkRead(notification)}
            >
              {textFor(t, 'Read', '已读')}
            </button>
          </article>
        ) : (
          <div className="admin-row" key={notification.id}>
            <StatusBadge status={notification.readAt ? 'Completed' : 'Pending review'} t={t} />
            <strong>{notification.title}</strong>
            <span>{notification.type}</span>
            <small>
              {notification.body} · {notification.resourceType}
              {notification.resourceId ? ` / ${notification.resourceId}` : ''} · {formatTime(notification.createdAt)}
            </small>
            <div className="button-row">
              {onOpen && (
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => onOpen(notification)}
                >
                  <ExternalLink size={17} />
                  {textFor(t, 'Open', '打开')}
                </button>
              )}
              <button
                className="ghost-button"
                type="button"
                onClick={() => void onMarkRead(notification)}
                disabled={Boolean(notification.readAt || readingId === notification.id)}
              >
                <CheckCircle size={17} />
                {readingId === notification.id ? textFor(t, 'Saving', '保存中') : textFor(t, 'Mark read', '标为已读')}
              </button>
            </div>
          </div>
        )
      ))}
    </div>
  )
}
