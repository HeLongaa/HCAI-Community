import { useCallback, useEffect, useRef, useState } from 'react'

import type { Locale } from '../domain/types'
import { isApiClientError } from '../services/apiClient'
import type {
  ApiCreativeGeneration,
  ApiMediaAsset,
  ApiUserCreativeGeneration,
  CreateCreativeGenerationRequest,
  MediaAssetPurpose,
} from '../services/contracts'
import { creativeService } from '../services/creativeService'
import { mediaService } from '../services/mediaService'
import { uploadMediaFile } from '../services/mediaUpload'

export type VideoGenerationState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  result: ApiCreativeGeneration | null
  error: string | null
}

export type VideoGenerationHistoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: ApiUserCreativeGeneration[]
  selected: ApiUserCreativeGeneration | null
  nextCursor: string | null
  error: string | null
  polling: boolean
}

export type VideoGenerationActionState = {
  type: 'cancel' | 'retry' | 'download' | 'preview' | 'upload' | null
  targetId: string | null
  error: string | null
}

export type VideoPreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  assetId: string | null
  url: string | null
  contentType: string | null
  error: string | null
}

export type VideoGenerationDraft = {
  prompt: string
  mode: string
  providerId: string
  inputAssetIds: string[]
  parameters: Record<string, string | number>
}

export type VideoGenerationWorkflow = {
  generation: VideoGenerationState
  history: VideoGenerationHistoryState
  action: VideoGenerationActionState
  preview: VideoPreviewState
  inputAssets: ApiMediaAsset[]
  inputAssetsState: 'idle' | 'loading' | 'ready' | 'error'
  refreshHistory: (cursor?: string | null) => Promise<void>
  selectGeneration: (id: string) => void
  runGeneration: (draft: VideoGenerationDraft) => Promise<void>
  cancelGeneration: (id: string) => Promise<void>
  retryGeneration: (id: string) => Promise<void>
  downloadAsset: (assetId: string) => Promise<void>
  openPreview: (assetId: string, contentType: string) => Promise<void>
  closePreview: () => void
  uploadInput: (file: File, purpose?: MediaAssetPurpose) => Promise<void>
  hasOriginalRequest: (id: string) => boolean
}

const initialHistory = (): VideoGenerationHistoryState => ({
  status: 'idle',
  items: [],
  selected: null,
  nextCursor: null,
  error: null,
  polling: false,
})

const initialPreview = (): VideoPreviewState => ({
  status: 'idle',
  assetId: null,
  url: null,
  contentType: null,
  error: null,
})

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export function useVideoGenerationWorkflow({
  enabled,
  accountKey,
  locale,
  requireAuth,
  pushToast,
}: {
  enabled: boolean
  accountKey: string
  locale: Locale
  requireAuth: () => void
  pushToast: (message: string) => void
}): VideoGenerationWorkflow {
  const [generation, setGeneration] = useState<VideoGenerationState>({ status: 'idle', result: null, error: null })
  const [history, setHistory] = useState<VideoGenerationHistoryState>(initialHistory)
  const [action, setAction] = useState<VideoGenerationActionState>({ type: null, targetId: null, error: null })
  const [preview, setPreview] = useState<VideoPreviewState>(initialPreview)
  const [inputAssets, setInputAssets] = useState<ApiMediaAsset[]>([])
  const [inputAssetsState, setInputAssetsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const requests = useRef(new Map<string, CreateCreativeGenerationRequest>())
  const previewObjectUrl = useRef<string | null>(null)

  const mergeGeneration = useCallback((item: ApiUserCreativeGeneration) => {
    setHistory((current) => ({
      ...current,
      status: 'ready',
      items: [item, ...current.items.filter((candidate) => candidate.id !== item.id)]
        .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? ''))),
      selected: current.selected?.id === item.id || !current.selected ? item : current.selected,
      error: null,
    }))
  }, [])

  const refreshHistory = useCallback(async (cursor: string | null = null) => {
    if (!enabled) return
    setHistory((current) => ({ ...current, status: cursor ? current.status : 'loading', error: null }))
    try {
      const page = await creativeService.listGenerations({ workspace: 'video', cursor, limit: 20 })
      setHistory((current) => {
        const items = cursor
          ? [...current.items, ...page.items.filter((item) => !current.items.some((existing) => existing.id === item.id))]
          : page.items
        return {
          status: 'ready',
          items,
          selected: current.selected
            ? items.find((item) => item.id === current.selected?.id) ?? items[0] ?? null
            : items[0] ?? null,
          nextCursor: page.nextCursor,
          error: null,
          polling: current.polling,
        }
      })
    } catch (error) {
      setHistory((current) => ({
        ...current,
        status: 'error',
        error: errorMessage(error, locale === 'zh' ? '无法读取视频任务。' : 'Could not load video jobs.'),
      }))
    }
  }, [enabled, locale])

  const refreshInputAssets = useCallback(async () => {
    if (!enabled) return []
    setInputAssetsState('loading')
    try {
      const assets = await creativeService.listInputAssets()
      setInputAssets(assets)
      setInputAssetsState('ready')
      return assets
    } catch {
      setInputAssets([])
      setInputAssetsState('error')
      return []
    }
  }, [enabled])

  const closePreview = useCallback(() => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
    previewObjectUrl.current = null
    setPreview(initialPreview())
  }, [])

  useEffect(() => () => {
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current)
  }, [])

  useEffect(() => {
    requests.current.clear()
    closePreview()
    setGeneration({ status: 'idle', result: null, error: null })
    setAction({ type: null, targetId: null, error: null })
    if (!enabled) {
      setHistory(initialHistory())
      setInputAssets([])
      setInputAssetsState('idle')
      return
    }
    void refreshHistory()
    void refreshInputAssets()
  }, [accountKey, closePreview, enabled, refreshHistory, refreshInputAssets])

  useEffect(() => {
    closePreview()
  }, [closePreview, history.selected?.id])

  useEffect(() => {
    const generationId = history.selected?.id
    if (!enabled || !generationId || !history.selected?.actions.poll.available) {
      setHistory((current) => current.polling ? { ...current, polling: false } : current)
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
        setHistory((current) => ({ ...current, polling: false }))
        schedule(5_000)
        return
      }
      setHistory((current) => ({ ...current, polling: true }))
      try {
        const item = await creativeService.generation(generationId)
        if (cancelled) return
        mergeGeneration(item)
        setHistory((current) => ({ ...current, selected: item, polling: item.actions.poll.available }))
        if (item.actions.poll.available) {
          delayMs = Math.min(Math.round(delayMs * 1.5), 10_000)
          schedule(delayMs)
        }
      } catch (error) {
        if (cancelled) return
        setHistory((current) => ({
          ...current,
          polling: false,
          error: errorMessage(error, locale === 'zh' ? '无法刷新视频状态。' : 'Could not refresh video status.'),
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
  }, [enabled, history.selected?.actions.poll.available, history.selected?.id, locale, mergeGeneration])

  const selectGeneration = useCallback((id: string) => {
    setHistory((current) => ({
      ...current,
      selected: current.items.find((item) => item.id === id) ?? current.selected,
    }))
  }, [])

  const runGeneration = useCallback(async (draft: VideoGenerationDraft) => {
    const prompt = draft.prompt.trim()
    if (!prompt) {
      pushToast(locale === 'zh' ? '请先填写视频提示词。' : 'Add a video prompt first.')
      return
    }
    if (!enabled) {
      requireAuth()
      pushToast(locale === 'zh' ? '请先登录后再创建视频任务。' : 'Sign in before creating a video job.')
      return
    }
    const request: CreateCreativeGenerationRequest = {
      workspace: 'video',
      mode: draft.mode,
      prompt,
      inputAssetIds: draft.inputAssetIds,
      parameters: draft.parameters,
      providerId: draft.providerId,
    }
    setGeneration({ status: 'loading', result: null, error: null })
    try {
      const result = await creativeService.createGeneration(request)
      requests.current.set(result.id, request)
      setGeneration({ status: 'done', result, error: null })
      try {
        const detail = await creativeService.generation(result.id)
        mergeGeneration(detail)
        setHistory((current) => ({ ...current, selected: detail }))
      } catch {
        void refreshHistory()
      }
      pushToast(locale === 'zh' ? '视频任务已创建。' : 'Video job created.')
    } catch (error) {
      if (isApiClientError(error) && error.code === 'AUTH_REQUIRED') requireAuth()
      const message = errorMessage(error, locale === 'zh' ? '视频任务创建失败。' : 'Video generation failed.')
      setGeneration({ status: 'error', result: null, error: message })
      pushToast(message)
    }
  }, [enabled, locale, mergeGeneration, pushToast, refreshHistory, requireAuth])

  const cancelGeneration = useCallback(async (id: string) => {
    setAction({ type: 'cancel', targetId: id, error: null })
    try {
      await creativeService.cancelGeneration(id, {
        idempotencyKey: `ui-${crypto.randomUUID()}`,
        reasonCode: 'user_cancelled',
      })
      const detail = await creativeService.generation(id)
      mergeGeneration(detail)
      setHistory((current) => ({ ...current, selected: detail }))
      setAction({ type: null, targetId: null, error: null })
      pushToast(locale === 'zh' ? '视频任务已取消。' : 'Video job cancelled.')
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '取消失败。' : 'Cancellation failed.')
      setAction({ type: null, targetId: null, error: message })
      void refreshHistory()
      pushToast(message)
    }
  }, [locale, mergeGeneration, pushToast, refreshHistory])

  const retryGeneration = useCallback(async (id: string) => {
    const request = requests.current.get(id)
    if (!request) {
      const message = locale === 'zh'
        ? '刷新后不会保留原始提示词；请根据安全预览重新填写。'
        : 'Raw prompts are not retained after refresh. Recreate the request from its safe preview.'
      setAction({ type: null, targetId: null, error: message })
      pushToast(message)
      return
    }
    const confirmed = window.confirm(locale === 'zh' ? '确认使用相同输入重试此视频任务？' : 'Retry this video job with the same inputs?')
    if (!confirmed) return
    setAction({ type: 'retry', targetId: id, error: null })
    try {
      const result = await creativeService.retryGeneration(id, {
        idempotencyKey: `ui-${crypto.randomUUID()}`,
        reasonCode: 'user_confirmed_retry',
        generation: request,
      })
      const targetId = result.generation?.id ?? result.targetGeneration?.id
      if (!targetId) throw new Error(locale === 'zh' ? '重试已接受，但新任务暂不可读。' : 'Retry accepted, but the new job is not available yet.')
      requests.current.set(targetId, request)
      const detail = await creativeService.generation(targetId)
      mergeGeneration(detail)
      setHistory((current) => ({ ...current, selected: detail }))
      setAction({ type: null, targetId: null, error: null })
      pushToast(locale === 'zh' ? '已创建视频重试任务。' : 'Video retry job created.')
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '重试失败。' : 'Retry failed.')
      setAction({ type: null, targetId: null, error: message })
      pushToast(message)
    }
  }, [locale, mergeGeneration, pushToast])

  const downloadAsset = useCallback(async (assetId: string) => {
    setAction({ type: 'download', targetId: assetId, error: null })
    try {
      const contract = await mediaService.createDownload(assetId)
      if (contract.download.url.startsWith('mock://')) {
        pushToast(locale === 'zh' ? `下载合约已就绪：${contract.asset.fileName}` : `Download contract ready: ${contract.asset.fileName}`)
      } else if (Object.keys(contract.download.headers).length > 0) {
        const response = await fetch(contract.download.url, { headers: contract.download.headers })
        if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
        const url = URL.createObjectURL(await response.blob())
        const link = document.createElement('a')
        link.href = url
        link.download = contract.asset.fileName
        link.click()
        URL.revokeObjectURL(url)
      } else {
        const link = document.createElement('a')
        link.href = contract.download.url
        link.download = contract.asset.fileName
        link.rel = 'noopener'
        link.target = '_blank'
        link.click()
      }
      setAction({ type: null, targetId: null, error: null })
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '下载失败。' : 'Download failed.')
      setAction({ type: null, targetId: null, error: message })
      pushToast(message)
    }
  }, [locale, pushToast])

  const openPreview = useCallback(async (assetId: string, contentType: string) => {
    closePreview()
    setAction({ type: 'preview', targetId: assetId, error: null })
    setPreview({ status: 'loading', assetId, url: null, contentType, error: null })
    try {
      if (contentType !== 'video/mp4') {
        setPreview({
          status: 'unavailable',
          assetId,
          url: null,
          contentType,
          error: locale === 'zh' ? 'Mock 结果仅包含受治理的占位产物，不能播放。' : 'Mock results contain a governed placeholder artifact, not playable video.',
        })
        setAction({ type: null, targetId: null, error: null })
        return
      }
      const contract = await mediaService.createDownload(assetId)
      if (contract.download.url.startsWith('mock://')) {
        setPreview({
          status: 'unavailable',
          assetId,
          url: null,
          contentType,
          error: locale === 'zh' ? 'Mock 存储不提供可播放的视频字节。' : 'Mock storage does not expose playable video bytes.',
        })
      } else if (Object.keys(contract.download.headers).length > 0) {
        const response = await fetch(contract.download.url, { headers: contract.download.headers })
        if (!response.ok) throw new Error(`Preview failed with status ${response.status}`)
        const url = URL.createObjectURL(await response.blob())
        previewObjectUrl.current = url
        setPreview({ status: 'ready', assetId, url, contentType, error: null })
      } else {
        setPreview({ status: 'ready', assetId, url: contract.download.url, contentType, error: null })
      }
      setAction({ type: null, targetId: null, error: null })
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '无法加载私有预览。' : 'Could not load the private preview.')
      setPreview({ status: 'error', assetId, url: null, contentType, error: message })
      setAction({ type: null, targetId: null, error: message })
    }
  }, [closePreview, locale])

  const uploadInput = useCallback(async (file: File, purpose: MediaAssetPurpose = 'submission_asset') => {
    if (!enabled) {
      requireAuth()
      return
    }
    setAction({ type: 'upload', targetId: file.name, error: null })
    try {
      await uploadMediaFile(file, {
        purpose,
        metadata: { source: 'video-studio-input' },
      })
      await refreshInputAssets()
      setAction({ type: null, targetId: null, error: null })
      pushToast(locale === 'zh' ? '素材已上传；扫描通过后可用于视频任务。' : 'Asset uploaded. It becomes selectable after a clean scan.')
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '素材上传失败。' : 'Asset upload failed.')
      setAction({ type: null, targetId: null, error: message })
      pushToast(message)
    }
  }, [enabled, locale, pushToast, refreshInputAssets, requireAuth])

  return {
    generation,
    history,
    action,
    preview,
    inputAssets,
    inputAssetsState,
    refreshHistory,
    selectGeneration,
    runGeneration,
    cancelGeneration,
    retryGeneration,
    downloadAsset,
    openPreview,
    closePreview,
    uploadInput,
    hasOriginalRequest: (id) => requests.current.has(id),
  }
}
