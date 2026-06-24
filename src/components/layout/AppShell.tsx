import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  Languages,
  LayoutDashboard,
  LogIn,
  Menu,
  MessageCircle,
  Moon,
  Search,
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
  PlayerViewModel,
  ShellNavigationViewModel,
  ThemeViewModel,
} from './viewModels'
import { themeModes } from '../../domain/theme'
import { isZhCopy, localizeText, roleTier, textFor } from '../../domain/utils'
import { DynamicIsland, LoginModal, SearchPanel } from '../overlays'
import { CompassIcon } from '../prototype/PrototypeComponents'

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
  requireAuth,
}: AppShellProps) {
  const { t, locale, switchLocale } = app
  const { page, parentPage, navigatePrimary, navigateToPage, navigateBackToParent } = navigation
  const { accountProfile, accountName, currentPoints, userRole, setUserRole, openProfile } = account
  const { themeMode, setThemeMode } = theme
  const { sidebarCollapsed, setSidebarCollapsed, searchOpen, setSearchOpen, loginOpen, setLoginOpen } = chrome
  const { activeTrack, playing, setPlaying, playTrack } = player
  const { pushToast, simulateAction } = feedback
  const currentTier = roleTier(userRole)
  const currentTierMark = currentTier.charAt(0)
  const navItems: NavItem[] = [
    { key: 'home', label: t.home, icon: LayoutDashboard },
    { key: 'tasks', label: t.tasks, icon: BriefcaseBusiness },
    { key: 'community', label: t.community, icon: MessageCircle },
    { key: 'inspiration', label: t.inspiration, icon: Tags },
    { key: 'explore', label: t.explore, icon: CompassIcon },
    { key: 'playground', label: t.playground ?? t.create, icon: WandSparkles },
    ...(userRole === 'admin' ? [{ key: 'admin' as Page, label: t.admin, icon: UsersRound }] : []),
  ]
  const pageLabels = {
    home: t.home,
    playground: t.playground,
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
  } satisfies Record<Page, string>

  return (
    <div className={sidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'} data-theme={themeMode}>
      <aside className={sidebarCollapsed ? 'sidebar mobile-expanded collapsed' : 'sidebar'}>
        <button className="brand" type="button" onClick={() => navigatePrimary('home')}>
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
                  key={item.key}
                  type="button"
                  onClick={() => navigatePrimary(item.key)}
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
            <button type="button" onClick={() => openProfile(accountProfile)}>
              <UserRound size={17} />
              <span className="sidebar-profile-copy">
                <span className="sidebar-profile-name">{accountName}</span>
                <small>{currentPoints}</small>
              </span>
              <span className="sidebar-tier-badge" title={currentTier} aria-label={`${currentTier} tier`}>
                <Star size={12} />
                <span>{currentTierMark}</span>
              </span>
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

          {userRole !== 'admin' && (
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setUserRole('admin')
                navigatePrimary('admin')
                simulateAction(isZhCopy(t) ? '已切换为管理员演示账号' : 'Switched to admin demo account')
              }}
            >
              <UsersRound size={17} />
              {textFor(t, 'Admin demo', '管理员演示')}
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
              setSidebarCollapsed((open) => !open)
              pushToast(
                locale === 'zh'
                  ? sidebarCollapsed
                    ? '已展开侧边栏'
                    : '已收起侧边栏'
                  : sidebarCollapsed
                    ? 'Sidebar expanded'
                    : 'Sidebar collapsed',
              )
            }}
            aria-label={sidebarCollapsed ? textFor(t, 'Expand sidebar', '展开侧边栏') : textFor(t, 'Collapse sidebar', '收起侧边栏')}
            aria-expanded={!sidebarCollapsed}
          >
            <Menu size={20} />
          </button>
          <div className="topbar-status">
            <Bell size={17} />
            <span>{textFor(t, 'AI generation queue is clear', 'AI 生成队列已清空')}</span>
          </div>
          <div className="topbar-actions">
            <button className="language" type="button" onClick={switchLocale}>
              <Languages size={16} />
              {locale === 'en' ? '中文' : 'English'}
            </button>
            <button className="ghost-button" type="button" onClick={() => setLoginOpen(true)}>
              <LogIn size={17} />
              {t.login}
            </button>
            <button className="primary-button" type="button" onClick={() => navigatePrimary('inspiration')}>
              <Sparkles size={17} />
              {t.getStarted}
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
          setUserRole={setUserRole}
          setPage={navigateToPage}
        />
      )}
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
    </div>
  )
}
