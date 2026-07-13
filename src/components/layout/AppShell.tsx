import { useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  CircleHelp,
  FileText,
  Languages,
  LayoutDashboard,
  ListFilter,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Tags,
  UserRound,
  UsersRound,
  WandSparkles,
} from 'lucide-react'
import type {
  Page,
} from '../../domain/types'
import type {
  AccountViewModel,
  AppCopyViewModel,
  ChromeViewModel,
  FeedbackViewModel,
  NotificationCenterViewModel,
  PlayerViewModel,
  ShellNavigationViewModel,
  ThemeViewModel,
} from './viewModels'
import { themeModes } from '../../domain/theme'
import { isZhCopy, localizeText, roleTier, textFor } from '../../domain/utils'
import { showLocalTestAccounts } from '../../services/runtimeConfig'
import { DynamicIsland, LoginModal, PolicyConsentModal, SearchPanel, SecurityModal } from '../overlays'
import { CompassIcon } from '../prototype/PrototypeComponents'
import { NotificationList } from '../ui/NotificationList'

type NavItem = {
  key: Page
  label: string
  icon: LucideIcon | typeof CompassIcon
}

type AppShellProps = {
  children: ReactNode
  app: AppCopyViewModel
  navigation: ShellNavigationViewModel
  account: AccountViewModel
  theme: ThemeViewModel
  chrome: ChromeViewModel
  player: PlayerViewModel
  feedback: FeedbackViewModel
  notifications: NotificationCenterViewModel
  requireAuth: () => void
}

export function AppShell({
  children,
  app,
  navigation,
  account,
  theme,
  chrome,
  player,
  feedback,
  notifications,
  requireAuth,
}: AppShellProps) {
  const { t, locale, switchLocale } = app
  const { page, parentPage, navigatePrimary, navigateToPage, navigateBackToParent } = navigation
  const { accountProfile, accountName, accountSource, accountReady, currentPoints, userRole, hasPermission, openProfile, policyConsent } = account
  const { themeMode, setThemeMode } = theme
  const { sidebarCollapsed, setSidebarCollapsed, searchOpen, setSearchOpen, loginOpen, setLoginOpen } = chrome
  const { activeTrack, playing, setPlaying, playTrack } = player
  const { pushToast, simulateAction } = feedback
  const {
    items: notificationItems,
    loading: notificationsLoading,
    error: notificationsError,
    readState: notificationReadState,
    setReadState: setNotificationReadState,
    refresh: refreshNotifications,
    markRead,
    markAllRead,
    openResource,
  } = notifications
  const [securityOpen, setSecurityOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const isSignedIn = accountReady && accountSource !== 'fallback'
  const consentGateExempt = page === 'terms' || page === 'privacy' || page === 'aup' || page === 'disclosures' || page === 'support'
  const currentTier = roleTier(userRole)
  const currentTierMark = currentTier.charAt(0)
  const accountSourceLabel = !accountReady
    ? textFor(t, 'Checking API', '正在检查 API')
    : accountSource === 'api'
      ? textFor(t, 'API session', 'API 会话')
      : accountSource === 'stored'
        ? textFor(t, 'Stored session', '本地会话')
        : textFor(t, 'Demo fallback', '演示回退')
  const navItems: NavItem[] = [
    { key: 'home', label: t.home, icon: LayoutDashboard },
    { key: 'tasks', label: t.tasks, icon: BriefcaseBusiness },
    { key: 'community', label: t.community, icon: MessageCircle },
    { key: 'inspiration', label: t.inspiration, icon: Tags },
    { key: 'explore', label: t.explore, icon: CompassIcon },
    { key: 'playground', label: t.playground ?? t.create, icon: WandSparkles },
    { key: 'generations', label: textFor(t, 'Generations', '生成任务'), icon: ListFilter },
    ...(hasPermission('admin:access') ? [{ key: 'admin' as Page, label: t.admin, icon: UsersRound }] : []),
  ]
  const pageLabels = {
    home: t.home,
    playground: t.playground,
    generations: textFor(t, 'Generations', '生成任务'),
    chat: t.chat,
    explore: t.explore,
    tasks: t.tasks,
    publish: t.publish,
    mine: t.mine,
    community: t.community,
    inspiration: t.inspiration,
    points: t.points,
    admin: t.admin,
    pricing: t.pricing,
    api: t.api,
    earn: t.earn,
    about: t.about,
    playlist: t.playlists,
    profile: t.profile,
    terms: t.terms,
    privacy: t.privacy,
    aup: textFor(t, 'Acceptable Use', '可接受使用政策'),
    disclosures: textFor(t, 'AI disclosures', 'AI 生成说明'),
    support: textFor(t, 'Support', '支持'),
  } satisfies Record<Page, string>
  const unreadNotificationCount = notificationItems.filter((item) => !item.readAt).length
  const notificationTriggerClass = unreadNotificationCount
    ? 'topbar-status notification-trigger active'
    : 'topbar-status notification-trigger'
  const notificationStatusLabel = notificationsLoading
    ? textFor(t, 'Syncing reminders', '正在同步提醒')
    : unreadNotificationCount > 0
      ? textFor(t, `${unreadNotificationCount} unread reminder${unreadNotificationCount === 1 ? '' : 's'}`, `${unreadNotificationCount} 条未读提醒`)
      : textFor(t, 'AI generation queue is clear', 'AI 生成队列已清空')
  const notificationReadStateLabels = {
    unread: textFor(t, 'Unread', '未读'),
    all: textFor(t, 'All', '全部'),
    read: textFor(t, 'Read', '已读'),
  }
  const closeMobileSidebar = () => {
    if (window.matchMedia('(max-width: 820px)').matches) {
      setSidebarCollapsed(false)
    }
  }
  const formatNotificationTime = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
  }

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'} data-theme={themeMode}>
      <aside className={sidebarCollapsed ? 'sidebar mobile-expanded collapsed' : 'sidebar'}>
        <button className="brand" type="button" onClick={() => { navigatePrimary('home'); closeMobileSidebar() }}>
          <span className="brand-mark">
            <Sparkles size={22} />
          </span>
          <span>{t.brand}</span>
        </button>

        <button className="search-trigger" type="button" onClick={() => setSearchOpen(true)} aria-label={t.search}>
          <Search size={18} />
          <span>{t.search}</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="sidebar-scroll">
          <nav className="nav-list" aria-label="Primary navigation">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  className={page === item.key ? 'nav-item active' : 'nav-item'}
                  data-testid={`nav-${item.key}`}
                  key={item.key}
                  type="button"
                  onClick={() => {
                    navigatePrimary(item.key)
                    closeMobileSidebar()
                  }}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-profile">
            <button
              type="button"
              onClick={() => {
                if (isSignedIn) {
                  openProfile(accountProfile)
                  return
                }
                setLoginOpen(true)
              }}
            >
              <UserRound size={17} />
              <span className="sidebar-profile-copy">
                <span className="sidebar-profile-name">{accountName}</span>
                <small>{currentPoints}</small>
                <small className={`sidebar-data-source ${accountReady ? accountSource : 'loading'}`}>{accountSourceLabel}</small>
              </span>
              {isSignedIn && (
                <span className="sidebar-tier-badge" title={currentTier} aria-label={`${currentTier} tier`}>
                  <Star size={12} />
                  <span>{currentTierMark}</span>
                </span>
              )}
            </button>
          </div>

          <div className="theme-picker" aria-label={textFor(t, 'Theme style', '主题风格')}>
            <span className="theme-picker-label">
              {themeMode === 'black' ? <Moon size={16} /> : <Sun size={16} />}
              <span>{textFor(t, 'Theme style', '主题风格')}</span>
            </span>
            <div className="theme-options">
              {themeModes.map((item) => {
                const Icon = item.key === 'black' ? Moon : Sun
                return (
                  <button
                    aria-pressed={themeMode === item.key}
                    className={themeMode === item.key ? 'theme-option active' : 'theme-option'}
                    key={item.key}
                    onClick={() => setThemeMode(item.key)}
                    type="button"
                  >
                    <Icon size={14} />
                    <span>{localizeText(item.label, t)}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <nav className="sidebar-legal-links" aria-label={textFor(t, 'Policy and support', '政策与支持')}>
            <button aria-label={textFor(t, 'Policies', '政策')} data-testid="policy-center-link" type="button" onClick={() => { navigatePrimary('terms'); closeMobileSidebar() }}>
              <FileText size={15} />
              <span>{textFor(t, 'Policies', '政策')}</span>
            </button>
            <button aria-label={t.privacy} data-testid="privacy-center-link" type="button" onClick={() => { navigatePrimary('privacy'); closeMobileSidebar() }}>
              <ShieldCheck size={15} />
              <span>{t.privacy}</span>
            </button>
            <button aria-label={textFor(t, 'Support', '支持')} data-testid="support-center-link" type="button" onClick={() => { navigatePrimary('support'); closeMobileSidebar() }}>
              <CircleHelp size={15} />
              <span>{textFor(t, 'Support', '支持')}</span>
            </button>
          </nav>

          <button
            className="ghost-button security-session-button"
            data-testid="security-open-button"
            type="button"
            onClick={() => setSecurityOpen(true)}
          >
            <ShieldCheck size={17} />
            {textFor(t, 'Security', '安全')}
          </button>

          {showLocalTestAccounts && !hasPermission('admin:access') && (
            <button
              className="ghost-button"
              data-testid="admin-demo-button"
              type="button"
              onClick={() => {
                void account.loginAs('opsplus').then(() => {
                  navigatePrimary('admin')
                  simulateAction(isZhCopy(t) ? '已切换为本地测试管理员账号' : 'Switched to local admin test account')
                })
              }}
            >
              <UsersRound size={17} />
              {textFor(t, 'Test admin', '测试管理员')}
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            type="button"
            onClick={() => {
              const nextOpen = !sidebarCollapsed
              setSidebarCollapsed(nextOpen)
              const mobileMenu = window.matchMedia('(max-width: 820px)').matches
              pushToast(
                locale === 'zh'
                  ? mobileMenu
                    ? nextOpen ? '已打开导航菜单' : '已关闭导航菜单'
                    : nextOpen ? '已收起侧边栏' : '已展开侧边栏'
                  : mobileMenu
                    ? nextOpen ? 'Navigation menu opened' : 'Navigation menu closed'
                    : nextOpen ? 'Sidebar collapsed' : 'Sidebar expanded',
              )
            }}
            aria-label={textFor(t, 'Toggle navigation', '切换导航')}
          >
            <Menu size={20} />
          </button>
          <div className="notification-center">
            <button
              className={notificationTriggerClass}
              type="button"
              onClick={() => {
                setNotificationOpen((open) => !open)
                if (!notificationOpen) void refreshNotifications()
              }}
              aria-expanded={notificationOpen}
            >
              <span className="notification-bell">
                <Bell size={17} />
                {unreadNotificationCount > 0 && <span>{unreadNotificationCount}</span>}
              </span>
              <span>{notificationStatusLabel}</span>
            </button>
            {notificationOpen && (
              <div className="notification-popover">
                <div className="notification-popover-header">
                  <strong>{textFor(t, 'Notifications', '通知')}</strong>
                  <div className="button-row compact-buttons">
                    <button className="ghost-button small" type="button" onClick={() => void refreshNotifications()}>
                      {textFor(t, 'Refresh', '刷新')}
                    </button>
                    <button className="ghost-button small" type="button" onClick={() => void markAllRead()} disabled={unreadNotificationCount === 0}>
                      {textFor(t, 'Read all', '全部已读')}
                    </button>
                  </div>
                </div>
                <div className="notification-filters" aria-label={textFor(t, 'Notification read state', '通知读取状态')}>
                  {(['unread', 'all', 'read'] as const).map((state) => (
                    <button
                      className={notificationReadState === state ? 'chip active' : 'chip'}
                      type="button"
                      key={state}
                      onClick={() => setNotificationReadState(state)}
                    >
                      {notificationReadStateLabels[state]}
                    </button>
                  ))}
                </div>
                <NotificationList
                  t={t}
                  notifications={notificationItems}
                  loading={notificationsLoading}
                  error={notificationsError}
                  variant="popover"
                  formatTime={formatNotificationTime}
                  loadingTitle={textFor(t, 'Syncing', '同步中')}
                  loadingBody={textFor(t, 'Reading your latest reminders.', '正在读取最新提醒。')}
                  errorTitle={textFor(t, 'Unavailable', '暂不可用')}
                  onMarkRead={markRead}
                  onOpen={(notification) => {
                    openResource(notification)
                    setNotificationOpen(false)
                    simulateAction(
                      locale === 'zh'
                        ? `已打开提醒关联资源：${notification.title}`
                        : `Opened reminder resource: ${notification.title}`,
                    )
                  }}
                />
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <button className="language" type="button" onClick={switchLocale}>
              <Languages size={16} />
              {locale === 'en' ? '中文' : 'English'}
            </button>
            {isSignedIn ? (
              <>
                <button className="ghost-button" type="button" onClick={() => openProfile(accountProfile)}>
                  <UserRound size={17} />
                  {accountName}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    void account.logout().then(() => {
                      navigatePrimary('home')
                      simulateAction(isZhCopy(t) ? '已退出登录' : 'Signed out')
                    })
                  }}
                >
                  <LogOut size={17} />
                  {textFor(t, 'Logout', '退出')}
                </button>
              </>
            ) : (
              <button className="ghost-button" type="button" onClick={() => setLoginOpen(true)}>
                <LogIn size={17} />
                {t.login}
              </button>
            )}
            <button aria-label={t.getStarted} className="primary-button" type="button" onClick={() => navigatePrimary('inspiration')}>
              <Sparkles size={17} />
              <span>{t.getStarted}</span>
            </button>
          </div>
        </header>

        <div className={page === 'tasks' ? 'page task-page' : 'page'}>
          {parentPage && (
            <nav className="parent-nav" aria-label={textFor(t, 'Page parent navigation', '页面上级导航')}>
              <button
                className="ghost-button parent-back-button"
                type="button"
                onClick={navigateBackToParent}
                aria-label={`${t.backToParent}: ${pageLabels[parentPage]}`}
              >
                <ArrowLeft size={17} />
                <span>{t.backToParent}</span>
              </button>
            </nav>
          )}
          {children}
        </div>
      </main>

      {searchOpen && (
        <SearchPanel
          t={t}
          close={() => setSearchOpen(false)}
          playTrack={playTrack}
          setPage={navigateToPage}
          openProfile={openProfile}
          simulateAction={simulateAction}
        />
      )}
      {loginOpen && (
        <LoginModal
          t={t}
          close={() => setLoginOpen(false)}
          simulateAction={simulateAction}
          loginAs={account.loginAs}
          loginWithPassword={account.loginWithPassword}
          loginWithOAuthProvider={account.loginWithOAuthProvider}
          registerWithEmail={account.registerWithEmail}
          setPage={navigateToPage}
        />
      )}
      {securityOpen && (
        <SecurityModal
          t={t}
          close={() => setSecurityOpen(false)}
          simulateAction={simulateAction}
        />
      )}
      {isSignedIn && policyConsent?.required && !consentGateExempt && (
        <PolicyConsentModal
          t={t}
          status={policyConsent}
          acceptCurrentPolicies={account.acceptCurrentPolicies}
          logout={account.logout}
          openPage={navigatePrimary}
          simulateAction={simulateAction}
        />
      )}
      {!consentGateExempt && (
        <DynamicIsland
          t={t}
          locale={locale}
          page={page}
          setPage={navigatePrimary}
          track={activeTrack}
          playTrack={playTrack}
          playing={playing}
          setPlaying={setPlaying}
          requireAuth={requireAuth}
          simulateAction={simulateAction}
        />
      )}
    </div>
  )
}
