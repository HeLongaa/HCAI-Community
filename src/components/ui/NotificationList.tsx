import { Check, CheckCircle, ExternalLink } from 'lucide-react'
import type { ApiNotification } from '../../services/contracts'
import { textFor } from '../../domain/utils'
import { StatusBadge } from './StatusBadge'

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

const notificationCategory = (type: string, t: Record<string, string>) => {
  if (type.startsWith('task.')) return textFor(t, 'Task update', '任务动态')
  if (type.startsWith('creative.')) return textFor(t, 'Generation', '生成任务')
  if (type.startsWith('community.')) return textFor(t, 'Community', '社区')
  if (type.startsWith('security.') || type.startsWith('trust.')) return textFor(t, 'Security', '安全')
  if (type.startsWith('billing.') || type.startsWith('points.')) return textFor(t, 'Account', '账户')
  return textFor(t, 'System', '系统')
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
          <article className={notification.readAt ? 'notification-item read' : 'notification-item unread'} key={notification.id}>
            <button
              type="button"
              onClick={() => onOpen?.(notification)}
            >
              <strong>{notification.title}</strong>
              <span>{notification.body}</span>
              <small>
                {!notification.readAt && <i aria-hidden="true" />}
                {notificationCategory(notification.type, t)}
                <time dateTime={notification.createdAt}>{formatTime(notification.createdAt)}</time>
              </small>
            </button>
            {notification.readAt ? (
              <CheckCircle className="notification-read-state" aria-label={textFor(t, 'Read', '已读')} size={17} />
            ) : (
              <button
                className="notification-mark-read"
                type="button"
                title={textFor(t, 'Mark as read', '标为已读')}
                aria-label={textFor(t, `Mark “${notification.title}” as read`, `将“${notification.title}”标为已读`)}
                onClick={() => void onMarkRead(notification)}
              >
                <Check size={16} />
              </button>
            )}
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
