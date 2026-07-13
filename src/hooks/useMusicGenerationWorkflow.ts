import { useCallback, useEffect, useRef, useState } from 'react'

import type { Locale } from '../domain/types'
import { isApiClientError } from '../services/apiClient'
import type {
  ApiCreativeGeneration,
  ApiUserCreativeGeneration,
  CreateCreativeGenerationRequest,
} from '../services/contracts'
import { creativeService } from '../services/creativeService'
import { mediaService } from '../services/mediaService'

export type MusicGenerationState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  result: ApiCreativeGeneration | null
  error: string | null
}

export type MusicGenerationHistoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: ApiUserCreativeGeneration[]
  selected: ApiUserCreativeGeneration | null
  nextCursor: string | null
  error: string | null
  polling: boolean
}

export type MusicGenerationActionState = {
  type: 'cancel' | 'retry' | 'download' | 'play' | null
  targetId: string | null
  error: string | null
}

export type MusicPreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  assetId: string | null
  url: string | null
  error: string | null
}

export type MusicGenerationDraft = {
  prompt: string
  mode: string
  providerId: string
  parameters: Record<string, string | number>
}

export type MusicGenerationWorkflow = {
  generation: MusicGenerationState
  history: MusicGenerationHistoryState
  action: MusicGenerationActionState
  preview: MusicPreviewState
  refreshHistory: (cursor?: string | null) => Promise<void>
  selectGeneration: (id: string) => void
  runGeneration: (draft: MusicGenerationDraft) => Promise<void>
  cancelGeneration: (id: string) => Promise<void>
  retryGeneration: (id: string) => Promise<void>
  downloadAsset: (assetId: string) => Promise<void>
  loadAudio: (assetId: string, contentType: string) => Promise<void>
  closePreview: () => void
  hasOriginalRequest: (id: string) => boolean
}

const initialHistory = (): MusicGenerationHistoryState => ({
  status: 'idle',
  items: [],
  selected: null,
  nextCursor: null,
  error: null,
  polling: false,
})

const initialPreview = (): MusicPreviewState => ({
  status: 'idle',
  assetId: null,
  url: null,
  error: null,
})

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export function useMusicGenerationWorkflow({
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
}): MusicGenerationWorkflow {
  const [generation, setGeneration] = useState<MusicGenerationState>({ status: 'idle', result: null, error: null })
  const [history, setHistory] = useState<MusicGenerationHistoryState>(initialHistory)
  const [action, setAction] = useState<MusicGenerationActionState>({ type: null, targetId: null, error: null })
  const [preview, setPreview] = useState<MusicPreviewState>(initialPreview)
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
      const page = await creativeService.listGenerations({ workspace: 'music', cursor, limit: 20 })
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
        error: errorMessage(error, locale === 'zh' ? '无法读取音乐任务。' : 'Could not load music jobs.'),
      }))
    }
  }, [enabled, locale])

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
      return
    }
    void refreshHistory()
  }, [accountKey, closePreview, enabled, refreshHistory])

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
          error: errorMessage(error, locale === 'zh' ? '无法刷新音乐状态。' : 'Could not refresh music status.'),
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

  const runGeneration = useCallback(async (draft: MusicGenerationDraft) => {
    const prompt = draft.prompt.trim()
    if (!prompt) {
      pushToast(locale === 'zh' ? '请先填写音乐提示词。' : 'Add a music prompt first.')
      return
    }
    if (!enabled) {
      requireAuth()
      pushToast(locale === 'zh' ? '请先登录后再创建音乐任务。' : 'Sign in before creating a music job.')
      return
    }
    const request: CreateCreativeGenerationRequest = {
      workspace: 'music',
      mode: draft.mode,
      prompt,
      inputAssetIds: [],
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
      pushToast(locale === 'zh' ? '音乐任务已创建。' : 'Music job created.')
    } catch (error) {
      if (isApiClientError(error) && error.code === 'AUTH_REQUIRED') requireAuth()
      const message = errorMessage(error, locale === 'zh' ? '音乐任务创建失败。' : 'Music generation failed.')
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
      pushToast(locale === 'zh' ? '音乐任务已取消。' : 'Music job cancelled.')
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
    const confirmed = window.confirm(locale === 'zh' ? '确认使用相同输入重试此音乐任务？' : 'Retry this music job with the same inputs?')
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
      pushToast(locale === 'zh' ? '已创建音乐重试任务。' : 'Music retry job created.')
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '重试失败。' : 'Retry failed.')
      setAction({ type: null, targetId: null, error: message })
      pushToast(message)
    }
  }, [locale, mergeGeneration, pushToast])

  const resolveDownload = useCallback(async (assetId: string) => {
    const contract = await mediaService.createDownload(assetId)
    if (contract.download.url.startsWith('mock://')) return { contract, url: null as string | null, objectUrl: false }
    if (Object.keys(contract.download.headers).length === 0) {
      return { contract, url: contract.download.url, objectUrl: false }
    }
    const response = await fetch(contract.download.url, { headers: contract.download.headers })
    if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
    return { contract, url: URL.createObjectURL(await response.blob()), objectUrl: true }
  }, [])

  const loadAudio = useCallback(async (assetId: string, contentType: string) => {
    closePreview()
    setAction({ type: 'play', targetId: assetId, error: null })
    setPreview({ status: 'loading', assetId, url: null, error: null })
    try {
      if (contentType !== 'audio/mpeg') {
        setPreview({ status: 'unavailable', assetId, url: null, error: locale === 'zh' ? '当前输出不是可播放的 MP3。' : 'This output is not a playable MP3.' })
      } else {
        const resolved = await resolveDownload(assetId)
        if (!resolved.url) {
          setPreview({ status: 'unavailable', assetId, url: null, error: locale === 'zh' ? 'Mock 存储不提供可播放的音频字节。' : 'Mock storage does not expose playable audio bytes.' })
        } else {
          if (resolved.objectUrl) previewObjectUrl.current = resolved.url
          setPreview({ status: 'ready', assetId, url: resolved.url, error: null })
        }
      }
      setAction({ type: null, targetId: null, error: null })
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '无法加载私有音频。' : 'Could not load the private audio.')
      setPreview({ status: 'error', assetId, url: null, error: message })
      setAction({ type: null, targetId: null, error: message })
    }
  }, [closePreview, locale, resolveDownload])

  const downloadAsset = useCallback(async (assetId: string) => {
    setAction({ type: 'download', targetId: assetId, error: null })
    try {
      const resolved = await resolveDownload(assetId)
      if (!resolved.url) {
        pushToast(locale === 'zh' ? `下载合约已就绪：${resolved.contract.asset.fileName}` : `Download contract ready: ${resolved.contract.asset.fileName}`)
      } else {
        const link = document.createElement('a')
        link.href = resolved.url
        link.download = resolved.contract.asset.fileName
        link.rel = 'noopener'
        if (!resolved.objectUrl) link.target = '_blank'
        link.click()
        if (resolved.objectUrl) URL.revokeObjectURL(resolved.url)
      }
      setAction({ type: null, targetId: null, error: null })
    } catch (error) {
      const message = errorMessage(error, locale === 'zh' ? '下载失败。' : 'Download failed.')
      setAction({ type: null, targetId: null, error: message })
      pushToast(message)
    }
  }, [locale, pushToast, resolveDownload])

  return {
    generation,
    history,
    action,
    preview,
    refreshHistory,
    selectGeneration,
    runGeneration,
    cancelGeneration,
    retryGeneration,
    downloadAsset,
    loadAudio,
    closePreview,
    hasOriginalRequest: (id) => requests.current.has(id),
  }
}
