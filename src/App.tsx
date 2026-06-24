import { useEffect, useState } from 'react'
import './index.css'

import type {
  Locale,
  MarketplaceProfile,
} from './domain/types'
import { marketplaceProfiles } from './data/mockData'
import {
  findProfile,
  pointText,
} from './domain/utils'
import { AppShell, PageRenderer } from './components/layout'
import { useAccountState } from './hooks/useAccountState'
import { useAppFeedback } from './hooks/useAppFeedback'
import { useCommunityWorkflows } from './hooks/useCommunityWorkflows'
import { useNavigationState } from './hooks/useNavigationState'
import { usePlayerState } from './hooks/usePlayerState'
import { useTaskWorkflows } from './hooks/useTaskWorkflows'
import { useThemeState } from './hooks/useThemeState'
import { copy } from './i18n/copy'

function App() {
  const accountProfile = findProfile('taskops') ?? marketplaceProfiles[0]
  const [locale, setLocale] = useState<Locale>('en')
  const {
    page,
    setPage,
    playgroundWorkspace,
    setPlaygroundWorkspace,
    parentPage,
    navigateToPage,
    navigatePrimary,
    navigateBackToParent,
    rememberReturnTarget,
  } = useNavigationState()
  const { activeTrack, playing, setPlaying, playTrack } = usePlayerState()
  const [searchOpen, setSearchOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { themeMode, setThemeMode } = useThemeState()
  const [billing, setBilling] = useState<'year' | 'month'>('year')
  const { accountName, userRole, setUserRole } = useAccountState()
  const [prompt, setPrompt] = useState('Lo-fi instrumental song for late-night coding')
  const [generationState, setGenerationState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [selectedProfile, setSelectedProfile] = useState<MarketplaceProfile>(() => accountProfile)
  const t = copy[locale]
  const { ledgerItems, pushToast, pushLedger, simulateAction } = useAppFeedback(locale)
  const currentPoints = pointText(ledgerItems[0]?.[3] ?? '18,420')

  const switchLocale = () => {
    const nextLocale = locale === 'en' ? 'zh' : 'en'
    setLocale(nextLocale)
    pushToast(nextLocale === 'zh' ? '已切换为中文内容。' : 'Switched to English content.')
  }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [page])

  const runGenerate = () => {
    setGenerationState('loading')
    window.setTimeout(() => setGenerationState('done'), 900)
  }

  const requireAuth = () => setLoginOpen(true)

  const openProfile = (profile: MarketplaceProfile) => {
    setSelectedProfile(profile)
    if (page !== 'profile') {
      rememberReturnTarget('profile', page)
    }
    setPage('profile')
    pushToast(locale === 'zh' ? `已打开用户主页：@${profile.handle}` : `Opened public profile: @${profile.handle}`)
  }

  const {
    taskList,
    selectedTask,
    setSelectedTask,
    publishTask,
    claimTask,
    submitTask,
    approveTask,
    rejectTask,
  } = useTaskWorkflows({ locale, pushLedger, pushToast, setPage })

  const {
    postList,
    selectedPost,
    setSelectedPost,
    communityFilter,
    setCommunityFilter,
    communityView,
    setCommunityView,
    libraryItems,
    likePost,
    replyToPost,
    convertPostToTask,
    savePostToLibrary,
  } = useCommunityWorkflows({ locale, publishTask, pushLedger, pushToast, setPage })

  return (
    <AppShell
      app={{ t, locale, switchLocale }}
      navigation={{ page, parentPage, navigatePrimary, navigateToPage, navigateBackToParent }}
      account={{ accountProfile, accountName, currentPoints, userRole, setUserRole, openProfile }}
      theme={{ themeMode, setThemeMode }}
      chrome={{ sidebarCollapsed, setSidebarCollapsed, searchOpen, setSearchOpen, loginOpen, setLoginOpen }}
      player={{ activeTrack, playing, setPlaying, playTrack }}
      feedback={{ pushToast, simulateAction }}
      requireAuth={requireAuth}
    >
      <PageRenderer
        t={t}
        navigation={{ page, navigateToPage }}
        workspace={{ prompt, setPrompt, generationState, runGenerate, playgroundWorkspace, setPlaygroundWorkspace }}
        player={{ playTrack }}
        feedback={{ requireAuth, simulateAction }}
        tasks={{ taskList, selectedTask, setSelectedTask, publishTask, claimTask, submitTask, approveTask, rejectTask }}
        community={{
          postList,
          selectedPost,
          setSelectedPost,
          communityFilter,
          setCommunityFilter,
          communityView,
          setCommunityView,
          convertPostToTask,
          savePostToLibrary,
          likePost,
          replyToPost,
          libraryItems,
        }}
        rewards={{ ledgerItems }}
        billing={{ billing, setBilling }}
        profile={{ selectedProfile, accountProfile, openProfile }}
      />
    </AppShell>
  )
}

export default App
