import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  Asterisk,
  Bell,
  BriefcaseBusiness,
  Boxes,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  FileText,
  House,
  Languages,
  KeyRound,
  ListFilter,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
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
import { isZhCopy, roleTier, textFor } from '../../domain/utils'
import { DynamicIsland, LoginModal, PolicyConsentModal, SearchPanel, SecurityModal } from '../overlays'
import { NotificationList } from '../ui/NotificationList'
import { NotificationPreferences } from '../ui/NotificationPreferences'
import { ToastViewport } from '../ui/ToastViewport'

type NavItem = {
  key: Page
  label: string
  icon: LucideIcon
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
}: AppShellProps) {
  const { t, locale, switchLocale } = app
  const { page, parentPage, navigatePrimary, navigateToPage, navigateBackToParent } = navigation
  const { accountProfile, accountName, accountSource, accountReady, currentPoints, userRole, hasPermission, openProfile, policyConsent } = account
  const { themeMode, setThemeMode } = theme
  const { sidebarCollapsed, setSidebarCollapsed, searchOpen, setSearchOpen, loginOpen, setLoginOpen } = chrome
  const { activeTrack, playing, setPlaying, playTrack } = player
  const { toasts, simulateAction, dismissToast } = feedback
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
  const [notificationPreferencesOpen, setNotificationPreferencesOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const searchTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAccountMenuOpen(false)
        window.requestAnimationFrame(() => accountMenuTriggerRef.current?.focus())
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen])

  useEffect(() => {
    if (!mobileSidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMobileSidebarOpen(false)
      window.requestAnimationFrame(() => mobileMenuTriggerRef.current?.focus())
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [mobileSidebarOpen])
  const isSignedIn = accountReady && accountSource !== 'fallback'
  const consentGateExempt = page === 'terms' || page === 'privacy' || page === 'aup' || page === 'disclosures' || page === 'support'
  const showDynamicIsland = Boolean(activeTrack.audioUrl) && !consentGateExempt && page !== 'api' && page !== 'admin'
  const currentTier = roleTier(userRole)
  const primaryNavItems: NavItem[] = [
    { key: 'home', label: t.home, icon: House },
    { key: 'tasks', label: t.tasks, icon: BriefcaseBusiness },
    { key: 'community', label: t.community, icon: MessageCircle },
    { key: 'inspiration', label: t.inspiration, icon: Tags },
  ]
  const creationNavItems: NavItem[] = [
    { key: 'playground', label: t.playground ?? t.create, icon: WandSparkles },
    { key: 'generations', label: textFor(t, 'Generations', '生成任务'), icon: ListFilter },
    { key: 'assets', label: textFor(t, 'Assets', '资产库'), icon: Boxes },
  ]
  const systemNavItems: NavItem[] = [
    { key: 'api', label: textFor(t, 'API access', 'API 访问'), icon: KeyRound },
    ...(hasPermission('admin:access') ? [{ key: 'admin' as Page, label: t.admin, icon: UsersRound }] : []),
  ]
  const pageLabels = {
    home: t.home,
    playground: t.playground,
    generations: textFor(t, 'Generations', '生成任务'),
    assets: textFor(t, 'Assets', '资产库'),
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
      setMobileSidebarOpen(false)
    }
  }
  const toggleNavigation = () => {
    if (window.matchMedia('(max-width: 820px)').matches) {
      setMobileSidebarOpen((open) => !open)
      return
    }
    setMobileSidebarOpen(false)
    setSidebarCollapsed(!sidebarCollapsed)
  }
  const closeSearch = () => {
    setSearchOpen(false)
    window.requestAnimationFrame(() => searchTriggerRef.current?.focus())
  }
  const formatNotificationTime = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
  }
  const renderNavGroup = (label: string, items: NavItem[], group: 'discover' | 'create' | 'system') => (
    <div className={`sidebar-nav-group sidebar-nav-${group}`} key={label}>
      <span className="sidebar-nav-label">{label}</span>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            className={`${page === item.key ? 'nav-item active' : 'nav-item'}${item.key === 'playground' ? ' nav-item-create' : ''}`}
            data-testid={`nav-${item.key}`}
            key={item.key}
            type="button"
            onClick={() => {
              navigatePrimary(item.key)
              closeMobileSidebar()
            }}
          >
            <Icon size={17} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className={`${sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'} page-${page}`} data-theme={themeMode}>
      <aside id="primary-sidebar" className={`${sidebarCollapsed ? 'sidebar collapsed' : 'sidebar'}${mobileSidebarOpen ? ' mobile-expanded' : ''}`}>
        <button className="brand" type="button" onClick={() => { navigatePrimary('home'); closeMobileSidebar() }}>
          <span className="brand-mark">
            <Asterisk size={18} />
          </span>
          <span>{t.brand}</span>
        </button>

        <button ref={searchTriggerRef} className="search-trigger" data-testid="discovery-search-trigger" type="button" onClick={() => setSearchOpen(true)} aria-label={t.search}>
          <Search size={16} />
          <span>{t.search}</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="sidebar-scroll">
          <nav className="nav-list" aria-label="Primary navigation">
            {renderNavGroup(textFor(t, 'Discover', '发现'), primaryNavItems, 'discover')}
            {renderNavGroup(textFor(t, 'Create', '创作'), creationNavItems, 'create')}
            {renderNavGroup(textFor(t, 'System', '系统'), systemNavItems, 'system')}
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
              <span className="sidebar-account-avatar">{accountName.trim().charAt(0).toUpperCase() || 'U'}</span>
                <span className="sidebar-profile-copy">
                  <span className="sidebar-profile-name">{accountName}</span>
                  <small>{currentTier} · {currentPoints}</small>
                </span>
            </button>
          </div>
          <nav className="sidebar-legal-links" aria-label={textFor(t, 'Policy and support', '政策与支持')}>
            <button data-testid="policy-center-link" type="button" onClick={() => { navigatePrimary('terms'); closeMobileSidebar() }}>
              <FileText size={15} />
              <span>{textFor(t, 'Policies', '政策')}</span>
            </button>
            <button data-testid="privacy-center-link" type="button" onClick={() => { navigatePrimary('privacy'); closeMobileSidebar() }}>
              <ShieldCheck size={15} />
              <span>{t.privacy}</span>
            </button>
            <button data-testid="support-center-link" type="button" onClick={() => { navigatePrimary('support'); closeMobileSidebar() }}>
              <CircleHelp size={15} />
              <span>{textFor(t, 'Support', '支持')}</span>
            </button>
          </nav>
          {isSignedIn && (
            <button
              className="ghost-button security-session-button"
              data-testid="security-open-button"
              type="button"
              onClick={() => setSecurityOpen(true)}
            >
              <ShieldCheck size={17} />
              {textFor(t, 'Security', '安全')}
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button
            ref={mobileMenuTriggerRef}
            className="icon-button mobile-menu"
            type="button"
            onClick={toggleNavigation}
            aria-label={textFor(t, 'Toggle navigation', '切换导航')}
            aria-controls="primary-sidebar"
            aria-expanded={mobileSidebarOpen}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-context">
            <span>{pageLabels[parentPage ?? page]}</span>
            {parentPage && <small>{pageLabels[page]}</small>}
          </div>
          <div className="topbar-actions">
          <div className="notification-center">
            <button
              className={notificationTriggerClass}
              type="button"
              onClick={() => {
                setNotificationOpen((open) => !open)
                if (!notificationOpen) void refreshNotifications()
              }}
              aria-label={notificationStatusLabel}
              aria-expanded={notificationOpen}
            >
              <span className="notification-bell">
                <Bell size={17} />
                {unreadNotificationCount > 0 && <span>{unreadNotificationCount}</span>}
              </span>
              {(notificationsLoading || unreadNotificationCount > 0) && <span>{notificationStatusLabel}</span>}
            </button>
            {notificationOpen && (
              <div className="notification-popover">
                <div className="notification-popover-header">
                  <div className="notification-popover-heading">
                    <strong>{textFor(t, 'Notifications', '通知')}</strong>
                    <span>{textFor(t, `${unreadNotificationCount} unread`, `${unreadNotificationCount} 条未读`)}</span>
                  </div>
                  <div className="notification-popover-actions">
                    <button
                      className="icon-button"
                      type="button"
                      title={textFor(t, 'Notification preferences', '通知偏好')}
                      aria-label={textFor(t, 'Notification preferences', '通知偏好')}
                      onClick={() => setNotificationPreferencesOpen((open) => !open)}
                    >
                      <Settings2 size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title={textFor(t, 'Refresh notifications', '刷新通知')}
                      aria-label={textFor(t, 'Refresh notifications', '刷新通知')}
                      onClick={() => void refreshNotifications()}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title={textFor(t, 'Mark all as read', '全部标为已读')}
                      aria-label={textFor(t, 'Mark all as read', '全部标为已读')}
                      onClick={() => void markAllRead()}
                      disabled={unreadNotificationCount === 0}
                    >
                      <CheckCheck size={16} />
                    </button>
                  </div>
                </div>
                {notificationPreferencesOpen ? (
                  <NotificationPreferences t={t} notifications={notificationItems} />
                ) : <><div className="notification-filters" aria-label={textFor(t, 'Notification read state', '通知读取状态')}>
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
                  }}
                />
                </>}
              </div>
            )}
          </div>
            {isSignedIn ? (
              <>
                <div className="account-menu-wrap" ref={accountMenuRef}>
                  <button ref={accountMenuTriggerRef} className="topbar-account" type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-label={textFor(t, `Open account menu for ${accountName}`, `打开 ${accountName} 的账号菜单`)} aria-expanded={accountMenuOpen}>
                    <span>{accountName.trim().charAt(0).toUpperCase() || 'U'}</span>
                    <b>{accountName}</b>
                    <ChevronDown size={14} />
                  </button>
                  {accountMenuOpen && (
                    <div className="account-menu">
                      <div className="account-menu-summary">
                        <strong>{accountName}</strong>
                        <span>{currentTier} · {currentPoints}</span>
                      </div>
                      <button type="button" onClick={() => { setAccountMenuOpen(false); openProfile(accountProfile) }}><UserRound size={16} />{t.profile}</button>
                      <button type="button" data-testid="security-open-button" onClick={() => { setAccountMenuOpen(false); setSecurityOpen(true) }}><ShieldCheck size={16} />{textFor(t, 'Security', '安全')}</button>
                      <button type="button" onClick={() => { setAccountMenuOpen(false); switchLocale() }}><Languages size={16} />{locale === 'en' ? '中文' : 'English'}</button>
                      <button type="button" onClick={() => { setAccountMenuOpen(false); setThemeMode(themeMode === 'black' ? 'white' : 'black') }}>
                        {themeMode === 'black' ? <Sun size={16} /> : <Moon size={16} />}
                        {themeMode === 'black' ? textFor(t, 'Light theme', '浅色主题') : textFor(t, 'Dark theme', '深色主题')}
                      </button>
                      <button type="button" onClick={() => { setAccountMenuOpen(false); navigatePrimary('support') }}><CircleHelp size={16} />{textFor(t, 'Help and support', '帮助与支持')}</button>
                      <div className="account-menu-links">
                        <button data-testid="policy-center-link" type="button" onClick={() => { setAccountMenuOpen(false); navigatePrimary('terms') }}>{textFor(t, 'Policies', '政策')}</button>
                        <button data-testid="privacy-center-link" type="button" onClick={() => { setAccountMenuOpen(false); navigatePrimary('privacy') }}>{t.privacy}</button>
                      </div>
                      <button className="account-menu-logout" type="button" onClick={() => {
                        setAccountMenuOpen(false)
                        void account.logout().then(() => {
                          navigatePrimary('home')
                          simulateAction(isZhCopy(t) ? '已退出登录' : 'Signed out')
                        })
                      }}><LogOut size={16} />{textFor(t, 'Logout', '退出')}</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <button className="ghost-button" type="button" onClick={() => setLoginOpen(true)}>
                <LogIn size={17} />
                {t.login}
              </button>
            )}
          </div>
        </header>

        <div className={page === 'tasks' ? 'page task-page' : 'page'}>
          {parentPage && page !== 'community' && (
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
          close={closeSearch}
          playTrack={playTrack}
          setPage={navigateToPage}
          openProfile={openProfile}
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
      {showDynamicIsland && (
        <DynamicIsland
          t={t}
          locale={locale}
          page={page}
          setPage={navigatePrimary}
          track={activeTrack}
          playTrack={playTrack}
          playing={playing}
          setPlaying={setPlaying}
        />
      )}
      <ToastViewport toasts={toasts} dismiss={dismissToast} />
    </div>
  )
}
