import { useCallback, useEffect, useState } from 'react'
import './index.css'

import type {
  AdminDeepLink,
  Locale,
  MarketplaceProfile,
  NotificationDeepLink,
  Permission,
  Post,
  PublishDraft,
  Task,
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
import { notificationService } from './services/notificationService'
import { profileService } from './services/profileService'
import { creativeService } from './services/creativeService'
import { isApiClientError } from './services/apiClient'
import type { ApiAcceptanceChecklistItem, ApiCreativeGeneration, ApiNotification, NotificationListQuery } from './services/contracts'

function App() {
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
  const {
    accountName,
    accountHandle,
    accountSource,
    accountReady,
    accountProfile: userProfile,
    userRole,
    permissions,
    hasPermission,
    setUserRole,
    loginAs,
    loginWithPassword,
    loginWithOAuthProvider,
    registerWithEmail,
    logout,
  } = useAccountState()
  const [prompt, setPrompt] = useState('Lo-fi instrumental song for late-night coding')
  const [generationState, setGenerationState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [imageGeneration, setImageGeneration] = useState<{
    status: 'idle' | 'loading' | 'done' | 'error'
    result: ApiCreativeGeneration | null
    error: string | null
  }>({
    status: 'idle',
    result: null,
    error: null,
  })
  const accountProfile = userProfile ?? findProfile('taskops') ?? marketplaceProfiles[0]
  const [profileList, setProfileList] = useState<MarketplaceProfile[]>(marketplaceProfiles)
  const [selectedProfile, setSelectedProfile] = useState<MarketplaceProfile>(() => accountProfile)
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const [notificationReadState, setNotificationReadState] = useState<NonNullable<NotificationListQuery['readState']>>('unread')
  const [adminDeepLink, setAdminDeepLink] = useState<AdminDeepLink | null>(null)
  const t = copy[locale]
  const { ledgerItems, pointsSummary, pointsStatus, pushToast, pushLedger, simulateAction } = useAppFeedback(locale, `${accountSource}:${accountHandle}`)
  const currentPoints = accountSource === 'fallback'
    ? (locale === 'zh' ? '未登录' : 'Not signed in')
    : pointText(String(pointsSummary?.available ?? ledgerItems[0]?.[3] ?? '18,420'))

  const switchLocale = () => {
    const nextLocale = locale === 'en' ? 'zh' : 'en'
    setLocale(nextLocale)
    pushToast(nextLocale === 'zh' ? '已切换为中文内容。' : 'Switched to English content.')
  }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [page])

  useEffect(() => {
    const applyHashDeepLink = () => {
      const auditMatch = window.location.hash.match(/^#admin\/audit\/(.+)$/)
      if (!auditMatch) return
      setAdminDeepLink({
        tab: 'Audit log',
        auditEventId: decodeURIComponent(auditMatch[1]),
      })
      navigatePrimary('admin')
    }
    applyHashDeepLink()
    window.addEventListener('hashchange', applyHashDeepLink)
    return () => window.removeEventListener('hashchange', applyHashDeepLink)
  }, [navigatePrimary])

  useEffect(() => {
    let active = true
    profileService
      .list()
      .then((profiles) => {
        if (!active || profiles.length === 0) return
        setProfileList(profiles)
        setSelectedProfile((current) => profiles.find((profile) => profile.handle === current.handle) ?? current)
      })
      .catch((error) => {
        console.info('[profile-service]', error)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSelectedProfile((current) => {
        if (current.handle !== 'taskops' && current.handle !== accountProfile.handle) return current
        return profileList.find((profile) => profile.handle === accountProfile.handle) ?? accountProfile
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [accountProfile, profileList])

  const runGenerate = () => {
    setGenerationState('loading')
    window.setTimeout(() => setGenerationState('done'), 900)
  }

  const runImageGeneration = async ({ prompt: imagePrompt, option, controls }: { prompt: string; option: string; controls: string[] }) => {
    const trimmedPrompt = imagePrompt.trim()
    if (!trimmedPrompt) {
      pushToast(locale === 'zh' ? '请先填写图片提示词。' : 'Add an image prompt first.')
      return
    }
    if (accountSource === 'fallback') {
      requireAuth()
      pushToast(locale === 'zh' ? '请先登录后再使用 API 生成图片。' : 'Sign in before using API-backed image generation.')
      return
    }
    const aspectRatio = controls.find((control) => ['1:1', '16:9', '4:5', '9:16'].includes(control)) ?? '1:1'
    setGenerationState('loading')
    setImageGeneration({ status: 'loading', result: null, error: null })
    try {
      const result = await creativeService.createGeneration({
        workspace: 'image',
        mode: 'text_to_image',
        prompt: trimmedPrompt,
        parameters: {
          aspectRatio,
          stylePreset: option,
          controls,
        },
      })
      setGenerationState('done')
      setImageGeneration({ status: 'done', result, error: null })
      const output = result.outputs[0]
      pushToast(locale === 'zh'
        ? `图片生成完成：${output?.storage.mediaAssetId ?? result.id}`
        : `Image generation complete: ${output?.storage.mediaAssetId ?? result.id}`)
    } catch (error) {
      console.info('[creative-service]', error)
      const message = isApiClientError(error) && error.code === 'AUTH_REQUIRED'
        ? (locale === 'zh' ? '请先登录后再使用 API 生成图片。' : 'Sign in before using API-backed image generation.')
        : (error instanceof Error ? error.message : (locale === 'zh' ? '图片生成失败。' : 'Image generation failed.'))
      if (isApiClientError(error) && error.code === 'AUTH_REQUIRED') {
        requireAuth()
      }
      setGenerationState('idle')
      setImageGeneration({ status: 'error', result: null, error: message })
      pushToast(message)
    }
  }

  const requireAuth = () => setLoginOpen(true)

  const refreshNotifications = useCallback(async () => {
    setNotificationsLoading(true)
    setNotificationsError(null)
    try {
      const items = await notificationService.list({ readState: notificationReadState, limit: 8 })
      setNotifications(items)
    } catch (error) {
      console.info('[notification-service]', error)
      setNotificationsError(locale === 'zh' ? '无法读取通知。' : 'Could not load notifications.')
    } finally {
      setNotificationsLoading(false)
    }
  }, [locale, notificationReadState])

  const markNotificationRead = async (notification: ApiNotification) => {
    try {
      const updated = await notificationService.markRead(notification.id)
      setNotifications((current) => current
        .map((item) => (item.id === updated.id ? updated : item))
        .filter((item) => notificationReadState !== 'unread' || !item.readAt))
      pushToast(locale === 'zh' ? `已标记已读：${notification.title}` : `Marked read: ${notification.title}`)
    } catch (error) {
      console.info('[notification-service]', error)
      pushToast(locale === 'zh' ? '通知处理失败。' : 'Could not update notification.')
    }
  }

  const markAllNotificationsRead = async () => {
    try {
      const result = await notificationService.markAllRead()
      if (notificationReadState === 'unread') {
        setNotifications([])
      } else {
        void refreshNotifications()
      }
      pushToast(locale === 'zh' ? `已标记 ${result.updated} 条提醒为已读。` : `Marked ${result.updated} reminders as read.`)
    } catch (error) {
      console.info('[notification-service]', error)
      pushToast(locale === 'zh' ? '批量处理通知失败。' : 'Could not mark reminders as read.')
    }
  }

  const notificationTarget = (notification: ApiNotification): NotificationDeepLink => {
    const metadata = notification.metadata && typeof notification.metadata === 'object' && !Array.isArray(notification.metadata)
      ? notification.metadata as { target?: unknown; userHandle?: unknown }
      : null
    const target = metadata?.target && typeof metadata.target === 'object' && !Array.isArray(metadata.target)
      ? metadata.target as Partial<NotificationDeepLink>
      : null
    if (target?.page) {
      return {
        page: target.page,
        admin: target.admin,
      } as NotificationDeepLink
    }
    if (notification.resourceType === 'admin_review') {
      return {
        page: 'admin',
        admin: {
          tab: 'Task review',
          queue: 'points',
          reviewId: notification.resourceId ?? null,
        },
      }
    }
    if (notification.resourceType === 'point_adjustment_policy') {
      return {
        page: 'admin',
        admin: {
          tab: 'Finance',
          policyHistoryEventId: typeof metadata?.target === 'string' ? metadata.target : null,
        },
      }
    }
    if (notification.resourceType === 'media_governance_policy') {
      return {
        page: 'admin',
        admin: {
          tab: 'Audit log',
        },
      }
    }
    if (notification.resourceType === 'media_asset') {
      return {
        page: 'admin',
        admin: {
          tab: 'Task review',
          mediaStatus: null,
          mediaAssetId: notification.resourceId ?? null,
        },
      }
    }
    if (notification.resourceType === 'media_scan_alert') {
      return {
        page: 'admin',
        admin: {
          tab: 'Task review',
          mediaStatus: null,
          mediaAssetId: null,
        },
      }
    }
    if (notification.resourceType === 'security_alert') {
      return {
        page: 'admin',
        admin: {
          tab: 'Security',
          securityAlertId: notification.resourceId ?? null,
        },
      }
    }
    if (notification.resourceType === 'task') {
      return {
        page: 'mine',
      }
    }
    return {
      page: 'admin',
      admin: {
        tab: 'Finance',
        ledgerUserHandle: typeof metadata?.userHandle === 'string' ? metadata.userHandle : null,
      },
    }
  }

  const openNotificationResource = (notification: ApiNotification) => {
    const target = notificationTarget(notification)
    if (target.page === 'admin') {
      setAdminDeepLink(target.admin ?? null)
    }
    navigatePrimary(target.page)
  }

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void refreshNotifications()
    }, 0)
    const timer = window.setInterval(() => {
      void refreshNotifications()
    }, 30_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [accountHandle, refreshNotifications])

  const requirePermission = (permission: Permission, fallbackMessage: string) => {
    if (hasPermission(permission)) return true
    pushToast(fallbackMessage)
    setLoginOpen(true)
    return false
  }

  const openProfile = (profile: MarketplaceProfile) => {
    const nextProfile = profileList.find((item) => item.handle === profile.handle) ?? profile
    setSelectedProfile(nextProfile)
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
    taskStatus,
    proposalStateByTask,
    submissionStateByTask,
    timelineStateByTask,
    publishTask,
    claimTask,
    submitProposal,
    refreshProposals,
    acceptProposal,
    rejectProposal,
    refreshSubmissions,
    refreshTimeline,
    submitTask,
    approveTask,
    rejectTask,
    requestRevisionTask,
    openDisputeTask,
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
    communityStatus,
    likePost,
    replyToPost,
    convertPostToTask,
    savePostToLibrary,
  } = useCommunityWorkflows({ locale, publishTask, pushLedger, pushToast, setPage })
  const sourceCopy = {
    loading: locale === 'zh' ? '同步中' : 'Syncing',
    fallback: locale === 'zh' ? '演示回退' : 'Demo fallback',
    stored: locale === 'zh' ? '本地会话' : 'Stored session',
    mock: locale === 'zh' ? '模拟工作台' : 'Mock workspace',
  }
  const sourceFromStatus = (label: string, status: { loading: boolean; error: string | null }, apiDetail: string, fallbackDetail: string) => ({
    label,
    state: status.loading ? 'loading' as const : status.error ? 'fallback' as const : 'api' as const,
    detail: status.loading ? sourceCopy.loading : status.error ? fallbackDetail : apiDetail,
  })
  const homeDataSources = {
    sources: [
      {
        label: locale === 'zh' ? '账号' : 'Account',
        state: accountReady ? accountSource : 'loading' as const,
        detail: accountReady
          ? accountSource === 'api'
            ? (locale === 'zh' ? '/api/me 已同步' : '/api/me synced')
            : accountSource === 'stored'
              ? sourceCopy.stored
              : sourceCopy.fallback
          : sourceCopy.loading,
      },
      sourceFromStatus(
        locale === 'zh' ? '任务' : 'Tasks',
        taskStatus,
        locale === 'zh' ? 'Tasks API' : 'Tasks API',
        locale === 'zh' ? '本地任务演示数据' : 'Local task demo data',
      ),
      sourceFromStatus(
        locale === 'zh' ? '社区' : 'Community',
        communityStatus,
        locale === 'zh' ? 'Community API' : 'Community API',
        locale === 'zh' ? '本地社区演示数据' : 'Local community demo data',
      ),
      sourceFromStatus(
        locale === 'zh' ? '积分' : 'Points',
        pointsStatus,
        locale === 'zh' ? 'Points API' : 'Points API',
        locale === 'zh' ? '本地积分演示数据' : 'Local points demo data',
      ),
      {
        label: locale === 'zh' ? '创作' : 'Creation',
        state: 'mock' as const,
        detail: sourceCopy.mock,
      },
    ],
  }

  const guardedPublishTask = async (draft: PublishDraft) => {
    if (!requirePermission('task:create', locale === 'zh' ? '请使用可发布任务的账号登录。' : 'Sign in with an account that can publish tasks.')) return
    await publishTask(draft)
  }

  const guardedClaimTask = async (task: Task) => {
    if (!requirePermission('task:claim', locale === 'zh' ? '请使用创作者账号登录后接单。' : 'Sign in with a maker account to claim tasks.')) return
    await claimTask(task)
  }

  const guardedSubmitProposal = async (task: Task) => {
    if (!requirePermission('task:propose', locale === 'zh' ? '请使用创作者账号登录后提交方案。' : 'Sign in with a maker account to submit proposals.')) return
    await submitProposal(task)
  }

  const guardedAcceptProposal = async (task: Task, proposalId: string) => {
    if (!requirePermission('task:review', locale === 'zh' ? '请使用发布方或管理员账号采纳方案。' : 'Sign in as a publisher or admin to accept proposals.')) return
    await acceptProposal(task, proposalId)
  }

  const guardedRejectProposal = async (task: Task, proposalId: string) => {
    if (!requirePermission('task:review', locale === 'zh' ? '请使用发布方或管理员账号拒绝方案。' : 'Sign in as a publisher or admin to reject proposals.')) return
    await rejectProposal(task, proposalId)
  }

  const guardedSubmitTask = async (task: Task, options?: { assetIds?: string[]; rightsNote?: string }) => {
    if (!requirePermission('task:submit', locale === 'zh' ? '请使用创作者账号登录后提交成果。' : 'Sign in with a maker account to submit work.')) return
    await submitTask(task, options)
  }

  const guardedApproveTask = async (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => {
    if (!requirePermission('task:review', locale === 'zh' ? '请使用发布方或管理员账号验收任务。' : 'Sign in as a publisher or admin to review tasks.')) return
    await approveTask(task, options)
  }

  const guardedRejectTask = async (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => {
    if (!requirePermission('task:review', locale === 'zh' ? '请使用发布方或管理员账号驳回任务。' : 'Sign in as a publisher or admin to reject tasks.')) return
    await rejectTask(task, options)
  }

  const guardedRequestRevisionTask = async (task: Task, options?: { acceptanceChecklist?: ApiAcceptanceChecklistItem[] }) => {
    if (!requirePermission('task:review', locale === 'zh' ? '请使用发布方或管理员账号要求修改。' : 'Sign in as a publisher or admin to request changes.')) return
    await requestRevisionTask(task, options)
  }

  const guardedOpenDisputeTask = async (task: Task) => {
    if (!requirePermission('task:submit', locale === 'zh' ? '请使用创作者账号发起争议。' : 'Sign in as a maker to open disputes.')) return
    await openDisputeTask(task)
  }

  const guardedConvertPostToTask = async (post: Post) => {
    if (!requirePermission('task:create', locale === 'zh' ? '请使用可发布任务的账号后再转任务。' : 'Sign in with task creation permission to convert posts.')) return
    await convertPostToTask(post)
  }

  return (
    <AppShell
      app={{ t, locale, switchLocale }}
      navigation={{ page, parentPage, navigatePrimary, navigateToPage, navigateBackToParent }}
      account={{
        accountProfile,
        accountName,
        accountHandle,
        accountSource,
        accountReady,
        currentPoints,
        userRole,
        permissions,
        hasPermission,
        setUserRole,
        loginAs,
        loginWithPassword,
        loginWithOAuthProvider,
        registerWithEmail,
        logout,
        openProfile,
      }}
      theme={{ themeMode, setThemeMode }}
      chrome={{ sidebarCollapsed, setSidebarCollapsed, searchOpen, setSearchOpen, loginOpen, setLoginOpen }}
      player={{ activeTrack, playing, setPlaying, playTrack }}
      feedback={{ pushToast, simulateAction }}
      notifications={{
        items: notifications,
        loading: notificationsLoading,
        error: notificationsError,
        readState: notificationReadState,
        setReadState: setNotificationReadState,
        refresh: refreshNotifications,
        markRead: markNotificationRead,
        markAllRead: markAllNotificationsRead,
        openResource: openNotificationResource,
      }}
      requireAuth={requireAuth}
    >
      <PageRenderer
        t={t}
        navigation={{ page, navigateToPage }}
        workspace={{ prompt, setPrompt, generationState, runGenerate, imageGeneration, runImageGeneration, playgroundWorkspace, setPlaygroundWorkspace }}
        player={{ playTrack }}
        feedback={{ requireAuth, simulateAction }}
        tasks={{
          taskList,
          selectedTask,
          setSelectedTask,
          taskStatus,
          proposalStateByTask,
          submissionStateByTask,
          timelineStateByTask,
          publishTask: guardedPublishTask,
          claimTask: guardedClaimTask,
          submitProposal: guardedSubmitProposal,
          refreshProposals,
          acceptProposal: guardedAcceptProposal,
          rejectProposal: guardedRejectProposal,
          refreshSubmissions,
          refreshTimeline,
          submitTask: guardedSubmitTask,
          approveTask: guardedApproveTask,
          rejectTask: guardedRejectTask,
          requestRevisionTask: guardedRequestRevisionTask,
          openDisputeTask: guardedOpenDisputeTask,
        }}
        community={{
          postList,
          selectedPost,
          setSelectedPost,
          communityFilter,
          setCommunityFilter,
          communityView,
          setCommunityView,
          communityStatus,
          convertPostToTask: guardedConvertPostToTask,
          savePostToLibrary,
          likePost,
          replyToPost,
          libraryItems,
        }}
        rewards={{ ledgerItems, pointsSummary, pointsStatus }}
        homeDataSources={homeDataSources}
        account={{ accountHandle, permissions, userRole, hasPermission }}
        billing={{ billing, setBilling }}
        profile={{ selectedProfile, accountProfile, openProfile }}
        admin={{ deepLink: adminDeepLink, clearDeepLink: () => setAdminDeepLink(null), openNotificationResource: openNotificationResource }}
      />
    </AppShell>
  )
}

export default App
