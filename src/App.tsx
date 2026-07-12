import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useVideoGenerationWorkflow } from './hooks/useVideoGenerationWorkflow'
import { copy } from './i18n/copy'
import { notificationService } from './services/notificationService'
import { profileService } from './services/profileService'
import { creativeService } from './services/creativeService'
import { mediaService } from './services/mediaService'
import { isApiClientError } from './services/apiClient'
import type { ApiAcceptanceChecklistItem, ApiCreativeGeneration, ApiCreativeProviderCatalog, ApiMediaAsset, ApiNotification, ApiUserCreativeGeneration, CreateCreativeGenerationRequest, NotificationListQuery } from './services/contracts'

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
    policyConsent,
    hasPermission,
    setUserRole,
    loginAs,
    loginWithPassword,
    loginWithOAuthProvider,
    registerWithEmail,
    acceptCurrentPolicies,
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
  const [imageProviderCatalog, setImageProviderCatalog] = useState<ApiCreativeProviderCatalog | null>(null)
  const [imageProviderCatalogState, setImageProviderCatalogState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [imageInputAssets, setImageInputAssets] = useState<ApiMediaAsset[]>([])
  const [imageGenerationHistory, setImageGenerationHistory] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error'
    items: ApiUserCreativeGeneration[]
    selected: ApiUserCreativeGeneration | null
    nextCursor: string | null
    error: string | null
    polling: boolean
  }>({
    status: 'idle',
    items: [],
    selected: null,
    nextCursor: null,
    error: null,
    polling: false,
  })
  const imageGenerationRequests = useRef(new Map<string, CreateCreativeGenerationRequest>())
  const [imageGenerationAction, setImageGenerationAction] = useState<{
    type: 'cancel' | 'retry' | 'download' | null
    targetId: string | null
    error: string | null
  }>({ type: null, targetId: null, error: null })
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
  const requireAuth = useCallback(() => setLoginOpen(true), [])
  const videoWorkflow = useVideoGenerationWorkflow({
    enabled: accountSource !== 'fallback',
    accountKey: `${accountSource}:${accountHandle}`,
    locale,
    requireAuth,
    pushToast,
  })
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
    let active = true
    creativeService.listProviders()
      .then((catalog) => {
        if (!active) return
        setImageProviderCatalog(catalog)
        setImageProviderCatalogState('ready')
      })
      .catch((error) => {
        if (!active) return
        console.info('[creative-provider-catalog]', error)
        setImageProviderCatalog(null)
        setImageProviderCatalogState('error')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (accountSource === 'fallback') {
      return
    }
    let active = true
    creativeService.listInputAssets()
      .then((assets) => { if (active) setImageInputAssets(assets) })
      .catch((error) => {
        console.info('[creative-input-assets]', error)
        if (active) setImageInputAssets([])
      })
    return () => { active = false }
  }, [accountHandle, accountSource, imageGeneration.result])

  const mergeImageGeneration = useCallback((generation: ApiUserCreativeGeneration) => {
    setImageGenerationHistory((current) => ({
      ...current,
      status: 'ready',
      items: [generation, ...current.items.filter((item) => item.id !== generation.id)]
        .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))),
      selected: current.selected?.id === generation.id || !current.selected ? generation : current.selected,
      error: null,
    }))
  }, [])

  const refreshImageGenerationHistory = useCallback(async (cursor: string | null = null) => {
    if (accountSource === 'fallback') return
    setImageGenerationHistory((current) => ({
      ...current,
      status: cursor ? current.status : 'loading',
      error: null,
    }))
    try {
      const pageResult = await creativeService.listGenerations({ workspace: 'image', cursor, limit: 20 })
      setImageGenerationHistory((current) => {
        const items = cursor
          ? [...current.items, ...pageResult.items.filter((item) => !current.items.some((existing) => existing.id === item.id))]
          : pageResult.items
        return {
          status: 'ready',
          items,
          selected: current.selected
            ? items.find((item) => item.id === current.selected?.id) ?? items[0] ?? null
            : items[0] ?? null,
          nextCursor: pageResult.nextCursor,
          error: null,
          polling: current.polling,
        }
      })
    } catch (error) {
      console.info('[creative-generation-history]', error)
      setImageGenerationHistory((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : 'Could not load image generation history.',
      }))
    }
  }, [accountSource])

  const selectImageGeneration = useCallback((id: string) => {
    setImageGenerationHistory((current) => ({
      ...current,
      selected: current.items.find((item) => item.id === id) ?? current.selected,
    }))
  }, [])

  useEffect(() => {
    imageGenerationRequests.current.clear()
    if (accountSource === 'fallback') {
      setImageGenerationHistory({
        status: 'idle',
        items: [],
        selected: null,
        nextCursor: null,
        error: null,
        polling: false,
      })
      return
    }
    void refreshImageGenerationHistory()
  }, [accountHandle, accountSource, refreshImageGenerationHistory])

  useEffect(() => {
    const generationId = imageGenerationHistory.selected?.id
    if (!generationId || !imageGenerationHistory.selected?.actions.poll.available || accountSource === 'fallback') {
      setImageGenerationHistory((current) => current.polling ? { ...current, polling: false } : current)
      return
    }
    let cancelled = false
    let timeoutId: number | null = null
    let delayMs = 2_000

    const schedule = (delay: number) => {
      if (!cancelled) timeoutId = window.setTimeout(poll, delay)
    }
    const poll = async () => {
      if (cancelled) return
      if (document.hidden || !navigator.onLine) {
        setImageGenerationHistory((current) => ({ ...current, polling: false }))
        schedule(5_000)
        return
      }
      setImageGenerationHistory((current) => ({ ...current, polling: true }))
      try {
        const generation = await creativeService.generation(generationId)
        if (cancelled) return
        mergeImageGeneration(generation)
        setImageGenerationHistory((current) => ({
          ...current,
          selected: generation,
          polling: generation.actions.poll.available,
        }))
        if (generation.actions.poll.available) {
          delayMs = Math.min(Math.round(delayMs * 1.5), 10_000)
          schedule(delayMs)
        }
      } catch (error) {
        if (cancelled) return
        console.info('[creative-generation-poll]', error)
        setImageGenerationHistory((current) => ({
          ...current,
          polling: false,
          error: error instanceof Error ? error.message : 'Could not refresh generation status.',
        }))
        delayMs = Math.min(delayMs * 2, 10_000)
        schedule(delayMs)
      }
    }

    schedule(delayMs)
    return () => {
      cancelled = true
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [accountSource, imageGenerationHistory.selected?.actions.poll.available, imageGenerationHistory.selected?.id, mergeImageGeneration])

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

  const runImageGeneration = async ({
    prompt: imagePrompt,
    mode,
    stylePreset,
    aspectRatio,
    strength,
    inputAssetIds,
  }: { prompt: string; mode: string; stylePreset: string; aspectRatio: string; strength: number; inputAssetIds: string[] }) => {
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
    const provider = imageProviderCatalog?.providers.find((candidate) => candidate.id === imageProviderCatalog.defaultProviderId)
    const imageCapability = provider?.capabilities.find((capability) => capability.workspace === 'image')
    const modeContract = imageCapability?.modeContracts?.find((candidate) => candidate.id === mode)
    if (!provider?.enabled || !provider.configured || !modeContract?.available) {
      pushToast(locale === 'zh' ? '当前图片能力不可用，请稍后重试。' : 'The selected image capability is unavailable.')
      return
    }
    setGenerationState('loading')
    setImageGeneration({ status: 'loading', result: null, error: null })
    try {
      const request: CreateCreativeGenerationRequest = {
        workspace: 'image',
        mode,
        prompt: trimmedPrompt,
        inputAssetIds,
        parameters: Object.fromEntries([
          ['aspectRatio', aspectRatio],
          ['stylePreset', stylePreset],
          ['strength', strength],
        ].filter(([key]) => modeContract.parameters.includes(String(key)))),
        providerId: provider.id,
      }
      const result = await creativeService.createGeneration(request)
      imageGenerationRequests.current.set(result.id, request)
      setGenerationState('done')
      setImageGeneration({ status: 'done', result, error: null })
      try {
        const detail = await creativeService.generation(result.id)
        mergeImageGeneration(detail)
        setImageGenerationHistory((current) => ({ ...current, selected: detail }))
      } catch (historyError) {
        console.info('[creative-generation-detail]', historyError)
        void refreshImageGenerationHistory()
      }
      const output = result.outputs[0]
      const completed = result.status === 'completed' || result.status === 'review_required'
      pushToast(locale === 'zh'
        ? `${completed ? '图片生成完成' : '图片任务已创建'}：${output?.storage.mediaAssetId ?? result.id}`
        : `${completed ? 'Image generation complete' : 'Image job created'}: ${output?.storage.mediaAssetId ?? result.id}`)
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

  const uploadImageInput = async (file: File) => {
    const contract = await mediaService.createUpload({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      purpose: 'library_asset',
      metadata: { source: 'image-studio-input' },
    })
    if (!contract.upload.url.startsWith('mock://')) {
      await fetch(contract.upload.url, { method: contract.upload.method, headers: contract.upload.headers, body: file })
    }
    await mediaService.completeUpload(contract.asset.id)
    const assets = await creativeService.listInputAssets()
    setImageInputAssets(assets)
    pushToast(locale === 'zh' ? '图片已上传；扫描通过后可用于创作。' : 'Image uploaded. It becomes selectable after a clean scan.')
  }

  const refreshImageInputAssets = async () => {
    const assets = await creativeService.listInputAssets()
    setImageInputAssets(assets)
    return assets
  }

  const cancelImageGeneration = async (id: string) => {
    setImageGenerationAction({ type: 'cancel', targetId: id, error: null })
    try {
      await creativeService.cancelGeneration(id, {
        idempotencyKey: `ui-${crypto.randomUUID()}`,
        reasonCode: 'user_cancelled',
      })
      const detail = await creativeService.generation(id)
      mergeImageGeneration(detail)
      setImageGenerationHistory((current) => ({ ...current, selected: detail }))
      pushToast(locale === 'zh' ? '图片任务已取消。' : 'Image job cancelled.')
    } catch (error) {
      console.info('[creative-generation-cancel]', error)
      const message = error instanceof Error ? error.message : (locale === 'zh' ? '取消失败。' : 'Cancellation failed.')
      setImageGenerationAction({ type: null, targetId: null, error: message })
      void refreshImageGenerationHistory()
      pushToast(message)
      return
    }
    setImageGenerationAction({ type: null, targetId: null, error: null })
  }

  const retryImageGeneration = async (id: string) => {
    const request = imageGenerationRequests.current.get(id)
    if (!request) {
      const message = locale === 'zh'
        ? '刷新后不会保留原始提示词；请根据安全预览重新填写后生成。'
        : 'Raw prompts are not retained after refresh. Recreate the request from its safe preview.'
      setImageGenerationAction({ type: null, targetId: null, error: message })
      pushToast(message)
      return
    }
    const confirmed = window.confirm(locale === 'zh' ? '确认使用完全相同的输入重试此任务？' : 'Retry this job with the exact same inputs?')
    if (!confirmed) return
    setImageGenerationAction({ type: 'retry', targetId: id, error: null })
    try {
      const result = await creativeService.retryGeneration(id, {
        idempotencyKey: `ui-${crypto.randomUUID()}`,
        reasonCode: 'user_confirmed_retry',
        generation: request,
      })
      const targetId = result.generation?.id ?? result.targetGeneration?.id
      if (!targetId) {
        await refreshImageGenerationHistory()
        throw new Error(locale === 'zh' ? '重试已接受，但暂时无法读取新任务。' : 'Retry was accepted but the new job is not available yet.')
      }
      imageGenerationRequests.current.set(targetId, request)
      const detail = await creativeService.generation(targetId)
      mergeImageGeneration(detail)
      setImageGenerationHistory((current) => ({ ...current, selected: detail }))
      pushToast(locale === 'zh' ? '已创建新的重试任务。' : 'A new retry attempt was created.')
    } catch (error) {
      console.info('[creative-generation-retry]', error)
      const message = error instanceof Error ? error.message : (locale === 'zh' ? '重试失败。' : 'Retry failed.')
      setImageGenerationAction({ type: null, targetId: null, error: message })
      pushToast(message)
      return
    }
    setImageGenerationAction({ type: null, targetId: null, error: null })
  }

  const downloadImageGenerationAsset = async (assetId: string) => {
    setImageGenerationAction({ type: 'download', targetId: assetId, error: null })
    try {
      const contract = await mediaService.createDownload(assetId)
      if (contract.download.url.startsWith('mock://')) {
        pushToast(locale === 'zh' ? `下载合约已就绪：${contract.asset.fileName}` : `Download contract ready: ${contract.asset.fileName}`)
      } else if (Object.keys(contract.download.headers).length > 0) {
        const response = await fetch(contract.download.url, { headers: contract.download.headers })
        if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
        const objectUrl = URL.createObjectURL(await response.blob())
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = contract.asset.fileName
        link.click()
        URL.revokeObjectURL(objectUrl)
      } else {
        const link = document.createElement('a')
        link.href = contract.download.url
        link.download = contract.asset.fileName
        link.rel = 'noopener'
        link.target = '_blank'
        link.click()
      }
    } catch (error) {
      console.info('[creative-generation-download]', error)
      const message = error instanceof Error ? error.message : (locale === 'zh' ? '下载失败。' : 'Download failed.')
      setImageGenerationAction({ type: null, targetId: null, error: message })
      pushToast(message)
      return
    }
    setImageGenerationAction({ type: null, targetId: null, error: null })
  }

  const prepareImageAssetForReuse = async (assetId: string) => {
    try {
      const assets = await refreshImageInputAssets()
      const available = assets.some((asset) => asset.id === assetId)
      if (!available) {
        pushToast(locale === 'zh' ? '该输出尚未进入可复用资产列表。' : 'This output is not yet available for reuse.')
      }
      return available
    } catch (error) {
      console.info('[creative-generation-reuse]', error)
      pushToast(locale === 'zh' ? '无法刷新可复用资产。' : 'Could not refresh reusable assets.')
      return false
    }
  }

  const hasImageGenerationRetryRequest = (id: string) => imageGenerationRequests.current.has(id)

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
        policyConsent,
        hasPermission,
        setUserRole,
        loginAs,
        loginWithPassword,
        loginWithOAuthProvider,
        registerWithEmail,
        acceptCurrentPolicies,
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
        workspace={{ prompt, setPrompt, generationState, runGenerate, imageGeneration, imageGenerationHistory, imageGenerationAction, refreshImageGenerationHistory, selectImageGeneration, cancelImageGeneration, retryImageGeneration, downloadImageGenerationAsset, prepareImageAssetForReuse, hasImageGenerationRetryRequest, imageProviderCatalog, imageProviderCatalogState, imageInputAssets: accountSource === 'fallback' ? [] : imageInputAssets, uploadImageInput, runImageGeneration, videoWorkflow, playgroundWorkspace, setPlaygroundWorkspace }}
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
