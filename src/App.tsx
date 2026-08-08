import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
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
  TaskProposalDraft,
} from './domain/types'
import {
  createIdentityProfile,
  pointText,
} from './domain/utils'
import { adminDeepLinkFromHash, notificationDeepLink, notificationTargetHash, parseNotificationTarget } from './domain/notificationTargets'
import { AppShell, PageRenderer } from './components/layout'
import { LoginModal, SearchPanel } from './components/overlays'
import { ToastViewport } from './components/ui/ToastViewport'
import { useAccountState } from './hooks/useAccountState'
import { useAppFeedback } from './hooks/useAppFeedback'
import { useCommunityWorkflows } from './hooks/useCommunityWorkflows'
import { useNavigationState } from './hooks/useNavigationState'
import { usePlayerState } from './hooks/usePlayerState'
import { useTaskWorkflows } from './hooks/useTaskWorkflows'
import { useThemeState } from './hooks/useThemeState'
import { useMusicGenerationWorkflow } from './hooks/useMusicGenerationWorkflow'
import { useVideoGenerationWorkflow } from './hooks/useVideoGenerationWorkflow'
import type { GenerationOperationFeedback } from './hooks/generationOperationFeedback'
import { copy } from './i18n/copy'
import { persistLocale, readLocale } from './i18n/locale'
import { notificationService } from './services/notificationService'
import { profileService } from './services/profileService'
import { creativeService } from './services/creativeService'
import { mediaService } from './services/mediaService'
import { uploadMediaFile } from './services/mediaUpload'
import { isApiClientError } from './services/apiClient'
import { isOperationalCreativeProvider } from './services/creativeProviderSelection'
import type { ApiAcceptanceChecklistItem, ApiCreativeGeneration, ApiCreativeProviderCatalog, ApiMediaAsset, ApiNotification, ApiUserCreativeGeneration, CreateCreativeGenerationRequest, NotificationListQuery } from './services/contracts'

const publicInformationPages = new Set(['terms', 'privacy', 'aup', 'disclosures', 'support', 'points'])
const CommunityLandingPage = lazy(() => import('./features/landing/CommunityLandingPage').then((module) => ({ default: module.CommunityLandingPage })))

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown
}

const startNativePageTransition = (update: () => void) => {
  const startViewTransition = (document as ViewTransitionDocument).startViewTransition
  if (!startViewTransition) {
    return false
  }
  startViewTransition.call(document, () => flushSync(update))
  return true
}

function App() {
  const [locale, setLocale] = useState<Locale>(readLocale)
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
  const [authPageOpen, setAuthPageOpen] = useState(() => window.location.hash.startsWith('#auth'))
  const [authRouteHash, setAuthRouteHash] = useState(() => window.location.hash)
  const [publicTransition, setPublicTransition] = useState<'idle' | 'to-auth' | 'to-landing'>('idle')
  const publicTransitionTimer = useRef<number | null>(null)
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
    verifyEmail,
    resetPassword,
    acceptCurrentPolicies,
    refreshAccount,
    logout,
  } = useAccountState()
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
  const [imageGenerationFeedback, setImageGenerationFeedback] = useState<GenerationOperationFeedback | null>(null)
  const accountProfile = userProfile ?? createIdentityProfile(accountHandle, accountName, userRole)
  const [profileList, setProfileList] = useState<MarketplaceProfile[]>(() => accountHandle ? [accountProfile] : [])
  const [selectedProfile, setSelectedProfile] = useState<MarketplaceProfile>(() => accountProfile)
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState<string | null>(null)
  const [notificationReadState, setNotificationReadState] = useState<NonNullable<NotificationListQuery['readState']>>('unread')
  const [adminDeepLink, setAdminDeepLink] = useState<AdminDeepLink | null>(null)
  const t = copy[locale]

  useEffect(() => {
    persistLocale(locale)
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  useEffect(() => {
    const restoreAdminTarget = () => setAdminDeepLink(adminDeepLinkFromHash())
    restoreAdminTarget()
    window.addEventListener('hashchange', restoreAdminTarget)
    window.addEventListener('popstate', restoreAdminTarget)
    return () => {
      window.removeEventListener('hashchange', restoreAdminTarget)
      window.removeEventListener('popstate', restoreAdminTarget)
    }
  }, [])

  useEffect(() => () => {
    if (publicTransitionTimer.current !== null) {
      window.clearTimeout(publicTransitionTimer.current)
    }
  }, [])

  const transitionPublicRoute = useCallback((direction: 'to-auth' | 'to-landing', update: () => void) => {
    if (startNativePageTransition(update)) return
    if (publicTransitionTimer.current !== null) {
      window.clearTimeout(publicTransitionTimer.current)
    }
    setPublicTransition(direction)
    publicTransitionTimer.current = window.setTimeout(() => {
      update()
      setPublicTransition('idle')
      publicTransitionTimer.current = null
    }, direction === 'to-auth' ? 320 : 240)
  }, [])

  useEffect(() => {
    const restorePublicRoute = () => {
      setAuthPageOpen(window.location.hash.startsWith('#auth'))
      setAuthRouteHash(window.location.hash)
    }
    restorePublicRoute()
    window.addEventListener('hashchange', restorePublicRoute)
    window.addEventListener('popstate', restorePublicRoute)
    return () => {
      window.removeEventListener('hashchange', restorePublicRoute)
      window.removeEventListener('popstate', restorePublicRoute)
    }
  }, [])
  const { ledgerItems, pointsSummary, pointsStatus, toasts, pushToast, pushLedger, simulateAction, dismissToast } = useAppFeedback(locale, `${accountSource}:${accountHandle}`)
  const requireAuth = useCallback(() => setLoginOpen(true), [])
  const musicWorkflow = useMusicGenerationWorkflow({
    enabled: accountSource !== 'fallback',
    accountKey: `${accountSource}:${accountHandle}`,
    locale,
    requireAuth,
  })
  const videoWorkflow = useVideoGenerationWorkflow({
    enabled: accountSource !== 'fallback',
    accountKey: `${accountSource}:${accountHandle}`,
    locale,
    requireAuth,
  })
  const currentPoints = accountSource === 'fallback'
    ? (locale === 'zh' ? '未登录' : 'Not signed in')
    : pointsSummary
      ? pointText(String(pointsSummary.available), t)
      : '-'

  const switchLocale = () => {
    const nextLocale = locale === 'en' ? 'zh' : 'en'
    setLocale(nextLocale)
  }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [page])

  const refreshProviderCatalog = useCallback(async () => {
    setImageProviderCatalogState('loading')
    try {
      const catalog = await creativeService.listProviders()
      setImageProviderCatalog(catalog)
      setImageProviderCatalogState('ready')
    } catch (error) {
      console.info('[creative-provider-catalog]', error)
      setImageProviderCatalog(null)
      setImageProviderCatalogState('error')
    }
  }, [])

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
        const accountMatch = profileList.find((profile) => profile.handle === accountProfile.handle) ?? accountProfile
        const currentIsPublicProfile = profileList.some((profile) => profile.handle === current.handle && profile.handle !== accountProfile.handle)
        return currentIsPublicProfile ? current : accountMatch
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [accountProfile, profileList])

  const onProfileUpdated = useCallback(async (profile: MarketplaceProfile) => {
    setProfileList((current) => [profile, ...current.filter((item) => item.handle !== profile.handle && item.handle !== accountProfile.handle)])
    setSelectedProfile(profile)
    await refreshAccount()
  }, [accountProfile.handle, refreshAccount])

  const runImageGeneration = async ({
    prompt: imagePrompt,
    mode,
    stylePreset,
    aspectRatio,
    quality,
    strength,
    inputAssetIds,
    providerId,
  }: { prompt: string; mode: string; stylePreset: string; aspectRatio: string; quality: string; strength: number; inputAssetIds: string[]; providerId: string }) => {
    const trimmedPrompt = imagePrompt.trim()
    setImageGenerationFeedback(null)
    if (!trimmedPrompt) {
      setImageGeneration({ status: 'error', result: null, error: locale === 'zh' ? '请先填写图片提示词。' : 'Add an image prompt first.' })
      return
    }
    if (accountSource === 'fallback') {
      requireAuth()
      return
    }
    const provider = imageProviderCatalog?.providers.find((candidate) => candidate.id === providerId)
    const imageCapability = provider?.capabilities.find((capability) => capability.workspace === 'image')
    const modeContract = imageCapability?.modeContracts?.find((candidate) => candidate.id === mode)
    if (!provider || !isOperationalCreativeProvider(provider, 'image') || !modeContract?.available) {
      setImageGeneration({ status: 'error', result: null, error: locale === 'zh' ? '当前图片能力不可用，请稍后重试。' : 'The selected image capability is unavailable.' })
      return
    }
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
          ['quality', quality],
          ['strength', strength],
        ].filter(([key]) => modeContract.parameters.includes(String(key)))),
        providerId: provider.id,
      }
      const result = await creativeService.createGeneration(request)
      imageGenerationRequests.current.set(result.id, request)
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
      setImageGenerationFeedback({
        kind: 'success',
        text: locale === 'zh'
          ? `${completed ? '图片生成完成' : '图片任务已创建'}：${output?.storage.mediaAssetId ?? result.id}`
          : `${completed ? 'Image generation complete' : 'Image job created'}: ${output?.storage.mediaAssetId ?? result.id}`,
      })
    } catch (error) {
      console.info('[creative-service]', error)
      const message = isApiClientError(error) && error.code === 'AUTH_REQUIRED'
        ? (locale === 'zh' ? '请先登录后再使用 API 生成图片。' : 'Sign in before using API-backed image generation.')
        : (error instanceof Error ? error.message : (locale === 'zh' ? '图片生成失败。' : 'Image generation failed.'))
      if (isApiClientError(error) && error.code === 'AUTH_REQUIRED') {
        requireAuth()
      }
      setImageGeneration({ status: 'error', result: null, error: message })
    }
  }

  const uploadImageInput = async (file: File) => {
    setImageGenerationFeedback(null)
    try {
      await uploadMediaFile(file, {
        purpose: 'library_asset',
        metadata: { source: 'image-studio-input' },
      })
      const assets = await creativeService.listInputAssets()
      setImageInputAssets(assets)
      setImageGenerationFeedback({ kind: 'success', text: locale === 'zh' ? '图片已上传；扫描通过后可用于创作。' : 'Image uploaded. It becomes selectable after a clean scan.' })
    } catch (error) {
      setImageGenerationFeedback({ kind: 'error', text: error instanceof Error ? error.message : (locale === 'zh' ? '图片上传失败。' : 'Image upload failed.') })
    }
  }

  const refreshImageInputAssets = async () => {
    const assets = await creativeService.listInputAssets()
    setImageInputAssets(assets)
    return assets
  }

  const cancelImageGeneration = async (id: string) => {
    setImageGenerationFeedback(null)
    setImageGenerationAction({ type: 'cancel', targetId: id, error: null })
    try {
      await creativeService.cancelGeneration(id, {
        idempotencyKey: `ui-${crypto.randomUUID()}`,
        reasonCode: 'user_cancelled',
      })
      const detail = await creativeService.generation(id)
      mergeImageGeneration(detail)
      setImageGenerationHistory((current) => ({ ...current, selected: detail }))
      setImageGenerationFeedback({ kind: 'success', text: locale === 'zh' ? '图片任务已取消。' : 'Image job cancelled.' })
    } catch (error) {
      console.info('[creative-generation-cancel]', error)
      const message = error instanceof Error ? error.message : (locale === 'zh' ? '取消失败。' : 'Cancellation failed.')
      setImageGenerationAction({ type: null, targetId: null, error: message })
      void refreshImageGenerationHistory()
      return
    }
    setImageGenerationAction({ type: null, targetId: null, error: null })
  }

  const retryImageGeneration = async (id: string) => {
    setImageGenerationFeedback(null)
    const request = imageGenerationRequests.current.get(id)
    if (!request) {
      const message = locale === 'zh'
        ? '刷新后不会保留原始提示词；请根据安全预览重新填写后生成。'
        : 'Raw prompts are not retained after refresh. Recreate the request from its safe preview.'
      setImageGenerationAction({ type: null, targetId: null, error: message })
      return false
    }
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
    } catch (error) {
      console.info('[creative-generation-retry]', error)
      const message = error instanceof Error ? error.message : (locale === 'zh' ? '重试失败。' : 'Retry failed.')
      setImageGenerationAction({ type: null, targetId: null, error: message })
      return false
    }
    setImageGenerationAction({ type: null, targetId: null, error: null })
    return true
  }

  const downloadImageGenerationAsset = async (assetId: string) => {
    setImageGenerationFeedback(null)
    setImageGenerationAction({ type: 'download', targetId: assetId, error: null })
    try {
      const contract = await mediaService.createDownload(assetId)
      if (contract.download.url.startsWith('mock://')) {
        setImageGenerationFeedback({ kind: 'success', text: locale === 'zh' ? `下载合约已就绪：${contract.asset.fileName}` : `Download contract ready: ${contract.asset.fileName}` })
      } else if (Object.keys(contract.download.headers).length > 0) {
        const response = await fetch(contract.download.url, { headers: contract.download.headers })
        if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
        const objectUrl = URL.createObjectURL(await response.blob())
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = contract.asset.fileName
        link.click()
        URL.revokeObjectURL(objectUrl)
        setImageGenerationFeedback({ kind: 'success', text: locale === 'zh' ? `已开始下载：${contract.asset.fileName}` : `Download started: ${contract.asset.fileName}` })
      } else {
        const link = document.createElement('a')
        link.href = contract.download.url
        link.download = contract.asset.fileName
        link.rel = 'noopener'
        link.target = '_blank'
        link.click()
        setImageGenerationFeedback({ kind: 'success', text: locale === 'zh' ? `已开始下载：${contract.asset.fileName}` : `Download started: ${contract.asset.fileName}` })
      }
    } catch (error) {
      console.info('[creative-generation-download]', error)
      const message = error instanceof Error ? error.message : (locale === 'zh' ? '下载失败。' : 'Download failed.')
      setImageGenerationAction({ type: null, targetId: null, error: message })
      return
    }
    setImageGenerationAction({ type: null, targetId: null, error: null })
  }

  const prepareImageAssetForReuse = async (assetId: string) => {
    setImageGenerationFeedback(null)
    try {
      const assets = await refreshImageInputAssets()
      const available = assets.some((asset) => asset.id === assetId)
      if (!available) {
        setImageGenerationFeedback({ kind: 'error', text: locale === 'zh' ? '该输出尚未进入可复用资产列表。' : 'This output is not yet available for reuse.' })
      }
      return available
    } catch (error) {
      console.info('[creative-generation-reuse]', error)
      setImageGenerationFeedback({ kind: 'error', text: locale === 'zh' ? '无法刷新可复用资产。' : 'Could not refresh reusable assets.' })
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
    } catch (error) {
      console.info('[notification-service]', error)
      pushToast(locale === 'zh' ? '通知处理失败。' : 'Could not update notification.')
    }
  }

  const markAllNotificationsRead = async () => {
    try {
      await notificationService.markAllRead()
      if (notificationReadState === 'unread') {
        setNotifications([])
      } else {
        void refreshNotifications()
      }
    } catch (error) {
      console.info('[notification-service]', error)
      pushToast(locale === 'zh' ? '批量处理通知失败。' : 'Could not mark reminders as read.')
    }
  }

  const notificationTarget = (notification: ApiNotification): NotificationDeepLink => {
    const metadata = notification.metadata && typeof notification.metadata === 'object' && !Array.isArray(notification.metadata)
      ? notification.metadata as { target?: unknown; userHandle?: unknown }
      : null
    const versionedTarget = parseNotificationTarget(metadata?.target)
    if (versionedTarget) return notificationDeepLink(versionedTarget)
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
    if (notification.resourceType === 'creative_generation') return { page: 'generations' }
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
    navigatePrimary(target.page, target.workspace)
    if (target.target) window.history.replaceState(null, '', notificationTargetHash(target.target))
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
  }

  const {
    taskList,
    selectedTask,
    setSelectedTask,
    taskStatus,
    proposalStateByTask,
    submissionStateByTask,
    timelineStateByTask,
    workflowStateByTask,
    publishTask,
    claimTask,
    submitProposal,
    refreshProposals,
    acceptProposal,
    rejectProposal,
    refreshSubmissions,
    refreshTimeline,
    refreshWorkflow,
    submitTask,
    approveTask,
    rejectTask,
    requestRevisionTask,
    openDisputeTask,
    cancelTask,
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
    myPosts,
    postMutationBusy,
    refreshMyPosts,
    createPost,
    updatePost,
    publishPost,
    deletePost,
  } = useCommunityWorkflows({ locale, publishTask, pushLedger, pushToast, setPage, accountHandle })
  const guardedPublishTask = async (draft: PublishDraft) => {
    if (!requirePermission('task:create', locale === 'zh' ? '请使用可发布任务的账号登录。' : 'Sign in with an account that can publish tasks.')) return
    await publishTask(draft)
  }

  const guardedClaimTask = async (task: Task) => {
    if (!requirePermission('task:claim', locale === 'zh' ? '请使用创作者账号登录后接单。' : 'Sign in with a maker account to claim tasks.')) return
    await claimTask(task)
  }

  const guardedSubmitProposal = async (task: Task, draft: TaskProposalDraft) => {
    if (!requirePermission('task:propose', locale === 'zh' ? '请使用创作者账号登录后提交方案。' : 'Sign in with a maker account to submit proposals.')) return false
    return submitProposal(task, draft)
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

  const guardedCancelTask = async (task: Task) => {
    if (!requirePermission('task:cancel', locale === 'zh' ? '请使用任务发布账号取消任务。' : 'Sign in as the task publisher to cancel it.')) return
    await cancelTask(task)
  }

  const guardedConvertPostToTask = async (post: Post) => {
    if (!requirePermission('task:create', locale === 'zh' ? '请使用可发布任务的账号后再转任务。' : 'Sign in with task creation permission to convert posts.')) return
    await convertPostToTask(post)
  }

  if (!accountReady) {
    return <div className="public-route-loader" role="status">HCAI</div>
  }

  if (authPageOpen) {
    return (
      <LoginModal
        key={authRouteHash}
        t={t}
        presentation="page"
        leaving={publicTransition === 'to-landing'}
        close={() => {
          transitionPublicRoute('to-landing', () => {
            navigateToPage('home')
            setAuthPageOpen(false)
          })
        }}
        onAuthenticated={(destination) => {
          transitionPublicRoute('to-landing', () => {
            navigateToPage(destination ?? 'home')
            setAuthPageOpen(false)
          })
        }}
        simulateAction={simulateAction}
        loginAs={loginAs}
        loginWithPassword={loginWithPassword}
        loginWithOAuthProvider={loginWithOAuthProvider}
        registerWithEmail={registerWithEmail}
        verifyEmail={verifyEmail}
        resetPassword={resetPassword}
        setPage={(destination) => {
          navigateToPage(destination)
          setAuthPageOpen(false)
        }}
      />
    )
  }

  if (accountSource === 'fallback' && !publicInformationPages.has(page)) {
    return (
      <Suspense fallback={<div className="public-route-loader" role="status">HCAI</div>}>
        <CommunityLandingPage
          language={locale}
          leaving={publicTransition === 'to-auth'}
          onOpenPage={(destination) => navigatePrimary(destination)}
          onSearch={() => setSearchOpen(true)}
          onLanguageChange={(nextLocale) => {
            if (locale === nextLocale) return
            setLocale(nextLocale)
          }}
          onLogin={() => {
            transitionPublicRoute('to-auth', () => {
              window.history.pushState(null, '', '#auth')
              setAuthPageOpen(true)
            })
          }}
        />
        {searchOpen && (
          <SearchPanel
            t={t}
            close={() => setSearchOpen(false)}
            playTrack={playTrack}
            setPage={navigateToPage}
            openProfile={openProfile}
          />
        )}
        <ToastViewport toasts={toasts} dismiss={dismissToast} />
      </Suspense>
    )
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
        verifyEmail,
        resetPassword,
        acceptCurrentPolicies,
        logout,
        openProfile,
      }}
      theme={{ themeMode, setThemeMode }}
      chrome={{ sidebarCollapsed, setSidebarCollapsed, searchOpen, setSearchOpen, loginOpen, setLoginOpen }}
      player={{ activeTrack, playing, setPlaying, playTrack }}
      feedback={{ toasts, pushToast, simulateAction, dismissToast }}
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
    >
      <PageRenderer
        t={t}
        navigation={{ page, navigateToPage }}
        workspace={{ imageGeneration, imageGenerationHistory, imageGenerationAction, imageGenerationFeedback, refreshImageGenerationHistory, selectImageGeneration, cancelImageGeneration, retryImageGeneration, downloadImageGenerationAsset, prepareImageAssetForReuse, hasImageGenerationRetryRequest, imageProviderCatalog, imageProviderCatalogState, refreshProviderCatalog, imageInputAssets: accountSource === 'fallback' ? [] : imageInputAssets, uploadImageInput, runImageGeneration, musicWorkflow, videoWorkflow, playgroundWorkspace, setPlaygroundWorkspace }}
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
          workflowStateByTask,
          publishTask: guardedPublishTask,
          claimTask: guardedClaimTask,
          submitProposal: guardedSubmitProposal,
          refreshProposals,
          acceptProposal: guardedAcceptProposal,
          rejectProposal: guardedRejectProposal,
          refreshSubmissions,
          refreshTimeline,
          refreshWorkflow,
          submitTask: guardedSubmitTask,
          approveTask: guardedApproveTask,
          rejectTask: guardedRejectTask,
          requestRevisionTask: guardedRequestRevisionTask,
          openDisputeTask: guardedOpenDisputeTask,
          cancelTask: guardedCancelTask,
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
          myPosts,
          postMutationBusy,
          refreshMyPosts,
          createPost,
          updatePost,
          publishPost,
          deletePost,
        }}
        rewards={{ ledgerItems, pointsSummary, pointsStatus }}
        account={{ accountHandle, accountName, permissions, userRole, hasPermission }}
        billing={{ billing, setBilling }}
        profile={{ selectedProfile, accountProfile, profiles: profileList, openProfile, onProfileUpdated }}
        admin={{ deepLink: adminDeepLink, clearDeepLink: () => setAdminDeepLink(null), openNotificationResource: openNotificationResource }}
      />
    </AppShell>
  )
}

export default App
