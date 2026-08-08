import { useEffect, useState, type ReactNode } from 'react'
import {
  Bot,
  ChevronDown,
  Clapperboard,
  Download,
  FileText,
  FolderOpen,
  History,
  Image,
  Music2,
  RefreshCcw,
  RotateCcw,
  Share2,
  Sparkles,
  Square,
  Upload,
  Video,
} from 'lucide-react'
import type { InspirationItem, Page, PlaygroundMode, Task } from '../../domain/types'
import { isZhCopy, textFor } from '../../domain/utils'
import type { VideoGenerationWorkflow } from '../../hooks/useVideoGenerationWorkflow'
import type { MusicGenerationWorkflow } from '../../hooks/useMusicGenerationWorkflow'
import type { GenerationOperationFeedback } from '../../hooks/generationOperationFeedback'
import type { ApiCreativeCapability, ApiCreativeGeneration, ApiCreativeProviderCatalog, ApiMediaAsset, ApiUserCreativeGeneration } from '../../services/contracts'
import { ChatPage } from './ChatPage'
import { MusicStudioPage } from './MusicStudioPage'
import { VideoStudioPage } from './VideoStudioPage'
import { CreativeCostPreview } from './CreativeCostPreview'
import { GenerationRetryConfirmation } from './GenerationRetryConfirmation'
import { UseCreativeAsset } from '../assets/UseCreativeAsset'
import { ActionFeedback, type ActionFeedbackMessage } from '../../components/ui/ActionFeedback'
import { MediaLoadFallback } from '../../components/ui/MediaLoadFallback'
import {
  isMockCreativeProvider,
  isOperationalCreativeProvider,
  selectOperationalCreativeProvider,
} from '../../services/creativeProviderSelection'

type ImageGenerationState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  result: ApiCreativeGeneration | null
  error: string | null
}

type ImageGenerationHistoryState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: ApiUserCreativeGeneration[]
  selected: ApiUserCreativeGeneration | null
  nextCursor: string | null
  error: string | null
  polling: boolean
}

export function PlaygroundPage({
  t,
  imageGeneration,
  imageGenerationHistory,
  imageGenerationAction,
  imageGenerationFeedback,
  refreshImageGenerationHistory,
  selectImageGeneration,
  cancelImageGeneration,
  retryImageGeneration,
  downloadImageGenerationAsset,
  prepareImageAssetForReuse,
  hasImageGenerationRetryRequest,
  imageProviderCatalog,
  imageProviderCatalogState,
  refreshProviderCatalog,
  imageInputAssets,
  uploadImageInput,
  runImageGeneration,
  musicWorkflow,
  videoWorkflow,
  signedIn,
  tasks,
  libraryItems,
  openModerationAppeal,
  requireAuth,
  workspace,
  setWorkspace,
  setPage,
}: {
  t: Record<string, string>
  imageGeneration: ImageGenerationState
  imageGenerationHistory: ImageGenerationHistoryState
  imageGenerationAction: {
    type: 'cancel' | 'retry' | 'download' | null
    targetId: string | null
    error: string | null
  }
  imageGenerationFeedback: GenerationOperationFeedback | null
  refreshImageGenerationHistory: (cursor?: string | null) => Promise<void>
  selectImageGeneration: (id: string) => void
  cancelImageGeneration: (id: string) => Promise<void>
  retryImageGeneration: (id: string) => Promise<boolean>
  downloadImageGenerationAsset: (assetId: string) => Promise<void>
  prepareImageAssetForReuse: (assetId: string) => Promise<boolean>
  hasImageGenerationRetryRequest: (id: string) => boolean
  imageProviderCatalog: ApiCreativeProviderCatalog | null
  imageProviderCatalogState: 'loading' | 'ready' | 'error'
  refreshProviderCatalog: () => Promise<void>
  imageInputAssets: ApiMediaAsset[]
  uploadImageInput: (file: File) => Promise<void>
  runImageGeneration: (input: { prompt: string; mode: string; stylePreset: string; aspectRatio: string; quality: string; strength: number; inputAssetIds: string[]; providerId: string }) => Promise<void>
  musicWorkflow: MusicGenerationWorkflow
  videoWorkflow: VideoGenerationWorkflow
  signedIn: boolean
  tasks: Task[]
  libraryItems: InspirationItem[]
  openModerationAppeal: (moderationDecisionId: string) => void
  requireAuth: () => void
  workspace: PlaygroundMode
  setWorkspace: (workspace: PlaygroundMode) => void
  setPage: (page: Page) => void
}) {
  const imageProvider = selectOperationalCreativeProvider(imageProviderCatalog, 'image')
  const imageCapability = imageProvider?.capabilities.find((capability) => capability.workspace === 'image') ?? null
  const imageProviderAvailable = Boolean(imageProvider && isOperationalCreativeProvider(imageProvider, 'image'))

  const workspaceTabs = [
    { key: 'image' as PlaygroundMode, label: textFor(t, 'Image', '图片'), icon: Image },
    { key: 'video' as PlaygroundMode, label: textFor(t, 'Video', '视频'), icon: Video },
    { key: 'music' as PlaygroundMode, label: textFor(t, 'Music', '音乐'), icon: Music2 },
    { key: 'chat' as PlaygroundMode, label: t.chat, icon: Bot },
  ]
  const workspaceProfiles: Record<PlaygroundMode, { index: string; kicker: string; title: string; description: string }> = {
    image: {
      index: '01',
      kicker: textFor(t, 'VISUAL SYNTHESIS', '视觉生成'),
      title: textFor(t, 'Image Studio', '图像创作'),
      description: textFor(t, 'Generate, transform, and refine a visual world from words or references.', '从文字或参考图出发，生成、转换并打磨完整视觉。'),
    },
    video: {
      index: '02',
      kicker: textFor(t, 'MOTION SYNTHESIS', '动态生成'),
      title: textFor(t, 'Video Studio', '视频创作'),
      description: textFor(t, 'Direct movement, timing, and cinematic rhythm across every frame.', '控制运动、时长与镜头节奏，让每一帧进入叙事。'),
    },
    music: {
      index: '03',
      kicker: textFor(t, 'AUDIO SYNTHESIS', '声音生成'),
      title: textFor(t, 'Music Studio', '音乐创作'),
      description: textFor(t, 'Compose structure, mood, and sound from a focused creative brief.', '从清晰的创作需求出发，编排结构、情绪与声音。'),
    },
    chat: {
      index: '04',
      kicker: textFor(t, 'CREATIVE INTELLIGENCE', '创作智能'),
      title: textFor(t, 'AI Assistant', 'AI 助手'),
      description: textFor(t, 'Develop ideas, prompts, and production decisions in one conversation.', '在一次对话中推进想法、提示词与制作决策。'),
    },
  }
  const workspaceProfile = workspaceProfiles[workspace]
  const workspaceProvider = workspace === 'image'
    ? imageProvider
    : workspace === 'chat' ? null : selectOperationalCreativeProvider(imageProviderCatalog, workspace)
  const workspaceProviderAvailable = workspace === 'chat'
    ? signedIn
    : Boolean(
        workspaceProvider && isOperationalCreativeProvider(workspaceProvider, workspace),
      )
  const workspaceProviderIsDemo = workspace !== 'chat' && Boolean(
    workspaceProvider && isMockCreativeProvider(workspaceProvider),
  )
  const runtimeTone = workspace === 'chat'
    ? (signedIn ? 'available' : 'unavailable')
    : imageProviderCatalogState === 'loading'
      ? 'loading'
      : imageProviderCatalogState === 'error'
        ? 'error'
        : workspaceProviderIsDemo
          ? 'demo'
          : workspaceProviderAvailable ? 'available' : 'unavailable'
  const runtimeLabel = runtimeTone === 'loading'
    ? textFor(t, 'CONNECTING', '连接中')
    : runtimeTone === 'error'
      ? textFor(t, 'CHECK RUNTIME', '检查运行来源')
      : runtimeTone === 'available'
        ? textFor(t, 'READY', '可用')
        : runtimeTone === 'demo'
          ? textFor(t, 'DEMO RUNTIME', '演示运行')
        : workspace === 'chat'
          ? textFor(t, 'SIGN IN', '请登录')
          : textFor(t, 'NOT READY', '未就绪')
  const runtimeName = workspace === 'chat'
    ? textFor(t, 'Personal session', '个人会话')
    : workspaceProvider?.label ?? textFor(t, 'No runtime selected', '未选择运行来源')

  return (
    <div className={`workspace-page workspace-${workspace}`} data-workspace={workspace}>
      <header className="workspace-page-header">
        <div className="workspace-page-title">
          <span className="workspace-page-kicker"><b>{workspaceProfile.index}</b> / 04&nbsp;&nbsp;{workspaceProfile.kicker}</span>
          <div className="workspace-page-display">{workspaceProfile.title}</div>
          <p>{workspaceProfile.description}</p>
        </div>
        <div className={`workspace-runtime workspace-runtime-${runtimeTone}`} aria-live="polite">
          <span className="workspace-runtime-signal" aria-hidden="true" />
          <span>
            <small>{textFor(t, 'ACTIVE RUNTIME', '当前运行来源')}</small>
            <strong>{runtimeName}</strong>
          </span>
          <b>{runtimeLabel}</b>
        </div>
        <div className="workspace-page-toolbar">
          <div className="playground-tabs" aria-label={t.playgroundTitle}>
          {workspaceTabs.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={workspace === item.key ? 'active' : ''}
                type="button"
                aria-pressed={workspace === item.key}
                data-workspace={item.key}
                key={item.key}
                onClick={() => setWorkspace(item.key)}
              >
                <Icon size={16} />
                {item.label}
              </button>
            )
          })}
          </div>
          <div className="workspace-page-actions">
            <button type="button" onClick={() => setPage('generations')}>
              <History size={16} />
              {textFor(t, 'Generations', '生成记录')}
            </button>
            <button type="button" onClick={() => setPage('assets')}>
              <FolderOpen size={16} />
              {textFor(t, 'Assets', '资产')}
            </button>
          </div>
        </div>
      </header>

      <section className="workspace-mode-surface">
      {workspace === 'music' && (
        <MusicStudioPage
          t={t}
          providerCatalog={imageProviderCatalog}
          providerCatalogState={imageProviderCatalogState}
          workflow={musicWorkflow}
          onUseInVideo={() => setWorkspace('video')}
        />
      )}

      {workspace === 'image' && (
        <StudioPage
          t={t}
          eyebrow={textFor(t, 'Visual AI', '视觉 AI')}
          title={t.imageTitle}
          subtitle={t.imageSubtitle}
          icon={<Image size={22} />}
          prompt={textFor(t, 'Minimal album cover, chrome flower, cinematic lighting, black background', '小红书美妆产品图，高级干净光线，真实质感，适合封面')}
          primaryAction={textFor(t, 'Generate images', '生成图片')}
          options={['none', 'poster', 'avatar', 'product_visual', 'logo_concept']}
          controls={['1:1', '16:9', '4:5', '9:16']}
          providerGeneration={{
            state: imageGeneration,
            history: imageGenerationHistory,
            action: imageGenerationAction,
            feedback: imageGenerationFeedback,
            refreshHistory: refreshImageGenerationHistory,
            selectGeneration: selectImageGeneration,
            cancelGeneration: cancelImageGeneration,
            retryGeneration: retryImageGeneration,
            downloadAsset: downloadImageGenerationAsset,
            prepareAssetForReuse: prepareImageAssetForReuse,
            hasOriginalRequest: hasImageGenerationRetryRequest,
            capability: imageCapability,
            catalogState: imageProviderCatalogState,
            inputAssets: imageInputAssets,
            uploadInput: uploadImageInput,
            providerAvailable: imageProviderAvailable,
            providerId: imageProvider?.id ?? null,
            providerLabel: imageProvider?.label ?? null,
            onGenerate: runImageGeneration,
            openAssetLibrary: () => setPage('assets'),
          }}
        />
      )}

      {workspace === 'video' && (
        <VideoStudioPage
          t={t}
          providerCatalog={imageProviderCatalog}
          providerCatalogState={imageProviderCatalogState}
          onRetryCatalog={refreshProviderCatalog}
          workflow={videoWorkflow}
        />
      )}

      {workspace === 'chat' && (
        <ChatPage
          t={t}
          setPage={setPage}
          openWorkspace={setWorkspace}
          signedIn={signedIn}
          requireAuth={requireAuth}
          tasks={tasks}
          libraryItems={libraryItems}
        openModerationAppeal={openModerationAppeal}
      />
      )}
      </section>
    </div>
  )
}

const isBrowserRenderableImageUrl = (value: string | null | undefined) => {
  if (!value) return false
  return /^(https?:\/\/|\/\/|\/(?!\/)|blob:|data:image\/)/i.test(value)
}

function StudioPage({
  t,
  eyebrow,
  title,
  subtitle,
  icon,
  prompt,
  primaryAction,
  options,
  controls,
  extraAction,
  extraActionLabel,
  providerGeneration,
}: {
  t: Record<string, string>
  eyebrow: string
  title: string
  subtitle: string
  icon: ReactNode
  prompt: string
  primaryAction: string
  options: string[]
  controls: string[]
  extraAction?: () => void
  extraActionLabel?: string
  providerGeneration: {
    state: ImageGenerationState
    history: ImageGenerationHistoryState
    action: {
      type: 'cancel' | 'retry' | 'download' | null
      targetId: string | null
      error: string | null
    }
    feedback: GenerationOperationFeedback | null
    refreshHistory: (cursor?: string | null) => Promise<void>
    selectGeneration: (id: string) => void
    cancelGeneration: (id: string) => Promise<void>
    retryGeneration: (id: string) => Promise<boolean>
    downloadAsset: (assetId: string) => Promise<void>
    prepareAssetForReuse: (assetId: string) => Promise<boolean>
    hasOriginalRequest: (id: string) => boolean
    capability: ApiCreativeCapability | null
    catalogState: 'loading' | 'ready' | 'error'
    providerAvailable: boolean
    providerId: string | null
    providerLabel: string | null
    inputAssets: ApiMediaAsset[]
    uploadInput: (file: File) => Promise<void>
    onGenerate: (input: { prompt: string; mode: string; stylePreset: string; aspectRatio: string; quality: string; strength: number; inputAssetIds: string[]; providerId: string }) => Promise<void>
    openAssetLibrary: () => void
  }
}) {
  const isZh = isZhCopy(t)
  const [activeOption, setActiveOption] = useState(options[0])
  const [activeControls, setActiveControls] = useState<string[]>([controls[0]])
  const [draftPrompt, setDraftPrompt] = useState(prompt)
  const [activeImageMode, setActiveImageMode] = useState('text_to_image')
  const [sourceAssetId, setSourceAssetId] = useState('')
  const [maskAssetId, setMaskAssetId] = useState('')
  const [quality, setQuality] = useState('medium')
  const [strength, setStrength] = useState(0.7)
  const [uploadingInput, setUploadingInput] = useState(false)
  const [activePanel, setActivePanel] = useState<'setup' | 'result' | 'history'>('setup')
  const [pendingRetryId, setPendingRetryId] = useState<string | null>(null)
  const [retryFeedback, setRetryFeedback] = useState<ActionFeedbackMessage | null>(null)
  const [failedPreviewUrl, setFailedPreviewUrl] = useState<string | null>(null)
  const [sampleMediaFailed, setSampleMediaFailed] = useState(false)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('hcaiAssetReuse')
      if (!raw) return
      const reuse = JSON.parse(raw) as { assetId?: string; workspace?: string }
      if (reuse.workspace !== 'image' || !reuse.assetId || !providerGeneration?.inputAssets.some((asset) => asset.id === reuse.assetId)) return
      window.queueMicrotask(() => {
        setActiveImageMode('image_to_image')
        setSourceAssetId(reuse.assetId!)
      })
    } catch { window.sessionStorage.removeItem('hcaiAssetReuse') }
  }, [providerGeneration?.inputAssets])
  const parameterDefinitions = providerGeneration?.capability?.parameterDefinitions
  const displayedOptions = providerGeneration
    ? (parameterDefinitions?.stylePreset?.options?.map(String) ?? options)
    : options
  const displayedControls = providerGeneration
    ? (parameterDefinitions?.aspectRatio?.options?.map(String) ?? controls)
    : controls
  const displayedQualities = parameterDefinitions?.quality?.options?.map(String) ?? ['low', 'medium', 'high']
  const selectedQuality = displayedQualities.includes(quality)
    ? quality
    : (String(parameterDefinitions?.quality?.default ?? displayedQualities[0] ?? 'medium'))
  const selectableImageModes = providerGeneration?.capability?.modeContracts?.filter((modeContract) => modeContract.available) ?? []
  const selectedImageMode = selectableImageModes.some((modeContract) => modeContract.id === activeImageMode)
    ? activeImageMode
    : (selectableImageModes[0]?.id ?? '')
  const selectedOption = displayedOptions.includes(activeOption) ? activeOption : (displayedOptions[0] ?? '')

  const imageLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      text_to_image: ['Text to Image', '文生图'],
      image_to_image: ['Image to Image', '图生图'],
      image_edit: ['Image Edit', '图片编辑'],
      image_variation: ['Image Variation', '图片变体'],
      none: ['No preset', '无预设'],
      editorial: ['Editorial', '编辑风格'],
      editorial_launch: ['Editorial launch', '发布视觉'],
      poster: ['Poster', '海报'],
      avatar: ['Avatar', '头像'],
      product_visual: ['Product visual', '商品图'],
      logo_concept: ['Logo concept', 'Logo 概念'],
    }
    const label = labels[value]
    return label ? (isZh ? label[1] : label[0]) : value
  }

  const toggleControl = (control: string) => {
    if (providerGeneration) {
      setActiveControls([control])
      return
    }
    setActiveControls((current) =>
      current.includes(control) ? current.filter((item) => item !== control) : [...current, control],
    )
  }

  const runStudioGenerate = () => {
    const inputAssetIds = selectedImageMode === 'image_edit'
      ? [sourceAssetId, maskAssetId].filter(Boolean)
      : selectedImageMode === 'text_to_image' ? [] : [sourceAssetId].filter(Boolean)
    setActivePanel('result')
    void providerGeneration.onGenerate({
      prompt: draftPrompt,
      mode: selectedImageMode,
      stylePreset: selectedOption,
      aspectRatio: activeControls.find((control) => displayedControls.includes(control)) ?? displayedControls[0] ?? '1:1',
      quality: selectedQuality,
      strength,
      inputAssetIds,
      providerId: providerGeneration.providerId ?? '',
    })
  }

  const selectedGeneration = providerGeneration?.history.selected ?? null
  const visibleRetryId = pendingRetryId === selectedGeneration?.id ? pendingRetryId : null
  const selectedStatus = selectedGeneration?.status ?? null
  const lifecycleActive = selectedStatus === 'queued' || selectedStatus === 'running'
  const actionBusy = providerGeneration?.action.type != null
  const exactRetryAvailable = selectedGeneration ? providerGeneration?.hasOriginalRequest(selectedGeneration.id) === true : false
  const confirmRetry = async () => {
    if (!pendingRetryId) return
    setRetryFeedback(null)
    const succeeded = await providerGeneration.retryGeneration(pendingRetryId)
    if (!succeeded) return
    setPendingRetryId(null)
    setRetryFeedback({
      kind: 'success',
      text: textFor(t, 'A new image attempt was created with the same inputs.', '已使用相同输入创建新的图片尝试。'),
    })
  }
  const activeState = providerGeneration?.state.status === 'loading' || lifecycleActive
    ? 'loading'
    : selectedStatus === 'completed' || selectedStatus === 'review_required' || providerGeneration?.state.status === 'done'
      ? 'done'
      : 'idle'
  const immediateResult = providerGeneration?.state.result ?? null
  const generatedOutput = immediateResult && immediateResult.id === selectedGeneration?.id
    ? immediateResult.outputs[0] ?? null
    : null
  const historyOutput = selectedGeneration?.outputs[0] ?? null
  const mediaAsset = generatedOutput?.mediaAsset
  const generatedAssetId = historyOutput?.assetId ?? generatedOutput?.storage.mediaAssetId ?? null
  const generatedContentType = historyOutput?.contentType ?? generatedOutput?.contentType ?? null
  const scanStatus = historyOutput?.scanStatus ?? generatedOutput?.storage.scanStatus ?? mediaAsset?.scanStatus ?? null
  const outputChecksPending = selectedStatus === 'completed'
    && Boolean(generatedAssetId)
    && (scanStatus == null || scanStatus === 'pending')
  const outputRejected = scanStatus === 'rejected'
  const previewUrl = scanStatus === 'clean' && isBrowserRenderableImageUrl(generatedOutput?.url)
    ? generatedOutput?.url ?? null
    : null
  const previewMediaFailed = Boolean(previewUrl && failedPreviewUrl === previewUrl)
  const providerCost = selectedGeneration?.accounting?.providerCost ?? null
  const providerCostAmount = providerCost?.actualAmount ?? providerCost?.estimateAmount ?? null
  const providerCostSummary = providerCost && providerCostAmount != null
    ? `${textFor(t, 'Provider cost', '提供方成本')} ${providerCost.currency ?? 'USD'} ${providerCostAmount.toFixed(6)}`
    : null
  const activeModeContract = selectableImageModes.find((modeContract) => modeContract.id === selectedImageMode)
  const governedImageInputAssets = providerGeneration?.inputAssets.filter((asset) =>
    (!activeModeContract || activeModeContract.inputAssets.contentTypes.includes(asset.contentType)) &&
    (!activeModeContract || activeModeContract.inputAssets.purposes.includes(asset.purpose))) ?? []
  const requiredInputsReady = !activeModeContract || activeModeContract.inputAssets.minimum === 0
    || (Boolean(sourceAssetId) && (selectedImageMode !== 'image_edit' || Boolean(maskAssetId)))
  const lifecycleLabel = (status: string | null) => {
    const labels: Record<string, [string, string]> = {
      queued: ['Queued', '排队中'],
      running: ['Running', '生成中'],
      review_required: ['Review required', '等待审核'],
      completed: ['Completed', '已完成'],
      failed: ['Failed', '失败'],
      cancelled: ['Cancelled', '已取消'],
    }
    const label = status ? labels[status] : null
    return label ? (isZh ? label[1] : label[0]) : textFor(t, 'Ready', '就绪')
  }
  const formatGenerationTime = (value: string | null) => {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div className="stack workspace-image-studio" data-panel={activePanel}>
      <section className="studio-hero workspace-studio-header">
        <div className="workspace-studio-title">
          <div className="studio-icon">{icon}</div>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
        </div>
        <div className="image-provider-summary">
          <span className={`status-dot ${providerGeneration.providerAvailable ? 'done' : 'error'}`} />
          <span>{textFor(t, 'Model', '模型')}</span>
          <strong>{providerGeneration.providerLabel ?? textFor(t, 'Not configured', '未配置')}</strong>
          {providerGeneration.capability?.contractVersion && (
            <small>{providerGeneration.capability.contractVersion}</small>
          )}
        </div>
      </section>
      <nav className="workspace-panel-switcher" aria-label={textFor(t, 'Image workspace panels', '图片工作台面板')}>
        <button className={activePanel === 'setup' ? 'active' : ''} type="button" onClick={() => setActivePanel('setup')}>{textFor(t, 'Create', '创作')}</button>
        <button className={activePanel === 'result' ? 'active' : ''} type="button" onClick={() => setActivePanel('result')}>{textFor(t, 'Result', '生成结果')}</button>
        <button className={activePanel === 'history' ? 'active' : ''} type="button" onClick={() => setActivePanel('history')}>{textFor(t, 'History', '生成记录')}</button>
      </nav>
      <section className="composer" aria-label={textFor(t, 'Image generation controls', '图片生成控件')}>
        <section className="workspace-setting-block workspace-prompt-block">
          <div className="workspace-setting-heading workspace-prompt-heading">
            <strong>{textFor(t, 'Prompt', '提示词')}</strong>
            <button
              className="primary-button image-generate-inline"
              type="button"
              onClick={runStudioGenerate}
              disabled={providerGeneration
                ? providerGeneration.catalogState !== 'ready'
                  || !providerGeneration.capability
                  || !providerGeneration.providerAvailable
                  || !selectedImageMode
                  || !requiredInputsReady
                  || activeState === 'loading'
                : false}
            >
              <Sparkles size={15} />
              {activeState === 'loading' ? t.generating : primaryAction}
            </button>
          </div>
          <textarea
            aria-label={textFor(t, 'Image prompt', '图片提示词')}
            maxLength={providerGeneration?.capability?.maxPromptCharacters ?? 2000}
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
          />
        </section>
        {providerGeneration && (
          <section className="workspace-setting-block workspace-mode-block">
            <div className="workspace-setting-heading">
              <strong>{textFor(t, 'Mode', '模式')}</strong>
            </div>
            <div className="chip-row image-mode-row">
            {(providerGeneration.capability?.modeContracts ?? []).map((modeContract) => {
              const disabled = !modeContract.available
              const unavailableReason = modeContract.unavailableReason ?? ''
              return (
                <button
                  className={selectedImageMode === modeContract.id ? 'chip active' : 'chip'}
                  type="button"
                  key={modeContract.id}
                  disabled={disabled}
                  title={unavailableReason}
                  onClick={() => setActiveImageMode(modeContract.id)}
                >
                  {imageLabel(modeContract.id)}
                </button>
              )
            })}
            </div>
          </section>
        )}
        {providerGeneration && activeModeContract && activeModeContract.inputAssets.minimum > 0 && (
          <div className="image-input-controls">
            <label className="media-file-picker">
              <Upload size={16} />
              <span>{uploadingInput ? textFor(t, 'Uploading', '上传中') : textFor(t, 'Upload image', '上传图片')}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingInput} onChange={(event) => {
                const file = event.target.files?.[0]
                event.currentTarget.value = ''
                if (!file) return
                setUploadingInput(true)
                void providerGeneration.uploadInput(file).finally(() => setUploadingInput(false))
              }} />
            </label>
            <label>
              <span>{textFor(t, 'Source image', '源图片')}</span>
              <select value={sourceAssetId} onChange={(event) => setSourceAssetId(event.target.value)}>
                <option value="">{textFor(t, 'Select a clean image', '选择已通过扫描的图片')}</option>
                {governedImageInputAssets.map((asset) => (
                  <option value={asset.id} key={asset.id}>{asset.fileName}</option>
                ))}
              </select>
            </label>
            {selectedImageMode === 'image_edit' && (
              <label>
                <span>{textFor(t, 'PNG mask', 'PNG 蒙版')}</span>
                <select value={maskAssetId} onChange={(event) => setMaskAssetId(event.target.value)}>
                  <option value="">{textFor(t, 'Select a clean PNG mask', '选择已通过扫描的 PNG 蒙版')}</option>
                  {governedImageInputAssets
                    .filter((asset) => asset.contentType === 'image/png' && asset.id !== sourceAssetId)
                    .map((asset) => <option value={asset.id} key={asset.id}>{asset.fileName}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>{textFor(t, 'Change strength', '改动强度')} {Math.round(strength * 100)}%</span>
              <input type="range" min="0" max="1" step="0.05" value={strength} onChange={(event) => setStrength(Number(event.target.value))} />
            </label>
          </div>
        )}
        {(!providerGeneration || activeModeContract?.parameters.includes('stylePreset')) && (
          <section className="workspace-setting-block workspace-style-block">
            <div className="workspace-setting-heading">
              <strong>{textFor(t, 'Style', '风格')}</strong>
            </div>
            <div className="chip-row">
            {displayedOptions.map((option) => (
              <button
                className={selectedOption === option ? 'chip active' : 'chip'}
                type="button"
                key={option}
                onClick={() => {
                  setActiveOption(option)
                }}
              >
                {imageLabel(option)}
              </button>
            ))}
            </div>
          </section>
        )}
        <section className="workspace-setting-block workspace-output-block">
          <div className="workspace-setting-heading">
            <strong>{textFor(t, 'Format', '格式')}</strong>
          </div>
          <div className="workspace-output-controls">
            {(!providerGeneration || activeModeContract?.parameters.includes('aspectRatio')) && (
              <div className="control-grid">
              {displayedControls.map((control) => (
                <button
                  className={activeControls.includes(control) ? 'control-pill active' : 'control-pill'}
                  type="button"
                  key={control}
                  onClick={() => toggleControl(control)}
                >
                  {control}
                </button>
              ))}
              </div>
            )}
            {providerGeneration && activeModeContract?.parameters.includes('quality') && (
              <label className="image-quality-control">
                <span>{textFor(t, 'Image quality', '图片质量')}</span>
                <select aria-label={textFor(t, 'Image quality', '图片质量')} value={selectedQuality} onChange={(event) => setQuality(event.target.value)}>
                  {displayedQualities.map((value) => (
                    <option value={value} key={value}>{textFor(t, `${value[0].toUpperCase()}${value.slice(1)} quality`, `${value === 'low' ? '低' : value === 'high' ? '高' : '中'}质量`)}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </section>
        <div className="button-row">
          {providerGeneration && <CreativeCostPreview
            t={t}
            workspace="image"
            mode={activeImageMode}
            providerId={providerGeneration.providerId}
            parameters={{
              aspectRatio: activeControls.find((control) => displayedControls.includes(control)) ?? displayedControls[0] ?? '1:1',
              quality: selectedQuality,
            }}
          />}
          {providerGeneration && selectedGeneration?.actions.cancel.available && (
            <button className="ghost-button" type="button" disabled={actionBusy} onClick={() => void providerGeneration.cancelGeneration(selectedGeneration.id)}>
              <Square size={16} />
              {providerGeneration.action.type === 'cancel' ? textFor(t, 'Cancelling', '正在取消') : textFor(t, 'Cancel', '取消')}
            </button>
          )}
          {providerGeneration && selectedGeneration?.actions.retry.available && (
            <button
              className="ghost-button"
              type="button"
              disabled={actionBusy || !exactRetryAvailable}
              title={!exactRetryAvailable ? textFor(t, 'Exact retry is unavailable after refresh because raw prompts are not retained.', '刷新后不会保留原始提示词，因此无法精确重试。') : textFor(t, 'Retry with the same inputs', '使用相同输入重试')}
              onClick={() => {
                setRetryFeedback(null)
                setPendingRetryId(selectedGeneration.id)
              }}
            >
              <RotateCcw size={16} />
              {providerGeneration.action.type === 'retry' ? textFor(t, 'Retrying', '正在重试') : textFor(t, 'Retry', '重试')}
            </button>
          )}
          {providerGeneration && selectedGeneration?.actions.reuse.available && generatedAssetId && scanStatus === 'clean' && (
            <button className="ghost-button" type="button" disabled={actionBusy} onClick={() => {
              void providerGeneration.prepareAssetForReuse(generatedAssetId).then((available) => {
                if (!available) return
                setSourceAssetId(generatedAssetId)
                setActiveImageMode('image_to_image')
                setActivePanel('setup')
              })
            }}>
              <RefreshCcw size={17} />
              {textFor(t, 'Use result as source', '使用结果继续创作')}
            </button>
          )}
          {extraAction && (
            <button className="ghost-button" type="button" onClick={extraAction}>
              <Clapperboard size={17} />
              {extraActionLabel}
            </button>
          )}
        </div>
        {visibleRetryId && (
          <GenerationRetryConfirmation
            t={t}
            busy={providerGeneration.action.type === 'retry' && providerGeneration.action.targetId === visibleRetryId}
            onCancel={() => setPendingRetryId(null)}
            onConfirm={() => void confirmRetry()}
          />
        )}
        <ActionFeedback message={retryFeedback} className="generation-retry-feedback" />
        <ActionFeedback message={providerGeneration.feedback} className="generation-operation-feedback" />
        {providerGeneration && (
          <div className="provider-status-panel" role="status" aria-live="polite" aria-label={textFor(t, 'Image generation status', '图片生成状态')}>
            <div>
              <span className={`status-dot ${lifecycleActive || providerGeneration.state.status === 'loading' ? 'loading' : selectedStatus === 'completed' ? 'done' : selectedStatus === 'failed' || selectedStatus === 'cancelled' ? 'error' : ''}`} />
              <strong>
                {selectedGeneration
                  ? lifecycleLabel(selectedGeneration.status)
                  : providerGeneration.state.status === 'loading'
                    ? textFor(t, 'Submitting generation', '正在提交生成任务')
                    : providerGeneration.state.status === 'error'
                      ? textFor(t, 'Image generation failed', '图片生成失败')
                      : providerGeneration.catalogState === 'loading'
                        ? textFor(t, 'Loading capability contract', '正在加载能力合同')
                        : providerGeneration.catalogState === 'error'
                          ? textFor(t, 'Capability contract unavailable', '能力合同不可用')
                          : !providerGeneration.providerAvailable
                            ? textFor(t, 'Model unavailable', '模型暂不可用')
                            : textFor(t, 'Ready', '就绪')}
              </strong>
            </div>
            <p>
              {providerGeneration.state.error
                ? providerGeneration.state.error
                : selectedGeneration
                  ? textFor(
                    t,
                    `${selectedGeneration.promptPreview ?? selectedGeneration.id} · ${providerGeneration.history.polling ? 'refreshing' : selectedGeneration.provider.mode ?? selectedGeneration.provider.id}`,
                    `${selectedGeneration.promptPreview ?? selectedGeneration.id} · ${providerGeneration.history.polling ? '正在刷新' : selectedGeneration.provider.mode ?? selectedGeneration.provider.id}`,
                  )
                  : providerGeneration.providerAvailable
                    ? textFor(t, 'Ready for your prompt.', '等待你的提示词。')
                    : textFor(t, 'Generation is unavailable until a model is configured.', '配置可用模型后才能开始生成。')}
            </p>
            {selectedGeneration && (
              <details className="provider-technical-details">
                <summary>
                  <span>{textFor(t, 'Technical details', '技术详情')}</span>
                  <ChevronDown size={14} />
                </summary>
                <div className="provider-meta-row">
                  <span>{selectedGeneration.provider.id}</span>
                  <span>{textFor(t, `${selectedGeneration.usage.estimatedCredits} credits`, `${selectedGeneration.usage.estimatedCredits} 点额度`)}</span>
                  <span>{textFor(t, `Attempt ${selectedGeneration.attempt.number}`, `第 ${selectedGeneration.attempt.number} 次尝试`)}</span>
                  {generatedContentType && <span>{generatedContentType}</span>}
                  {selectedGeneration.safety.reviewRequired && (
                    <span>{textFor(t, 'Policy review', '策略复核')}</span>
                  )}
                  {providerCostSummary && <span>{providerCostSummary}</span>}
                  {generatedAssetId && <span>{scanStatus === 'clean' ? textFor(t, 'Download ready', '可下载') : textFor(t, 'Download gated', '下载受限')}</span>}
                </div>
              </details>
            )}
            {providerGeneration.action.error && <p className="image-history-error">{providerGeneration.action.error}</p>}
            {selectedGeneration?.actions.retry.available && !exactRetryAvailable && (
              <p>{textFor(t, 'Exact retry is unavailable after refresh; recreate the request from its safe preview.', '刷新后无法恢复原始提示词；请根据安全预览重新填写。')}</p>
            )}
          </div>
        )}
      </section>

      <section className="image-preview-panel" aria-label={textFor(t, 'Image result', '图片结果')}>
        <div className="image-preview-toolbar" role="status" aria-live="polite">
          <div>
            <span className={`status-dot ${lifecycleActive || providerGeneration.state.status === 'loading' || outputChecksPending ? 'loading' : selectedStatus === 'completed' && !outputRejected ? 'done' : selectedStatus === 'failed' || selectedStatus === 'cancelled' || outputRejected ? 'error' : ''}`} />
            <strong>{outputChecksPending
              ? textFor(t, 'Output checks in progress', '输出检查中')
              : outputRejected
                ? textFor(t, 'Output blocked', '输出已拦截')
                : selectedGeneration
                  ? lifecycleLabel(selectedGeneration.status)
                  : providerGeneration.providerAvailable
                    ? textFor(t, 'Ready to create', '可以开始创作')
                    : textFor(t, 'Model unavailable', '模型暂不可用')}</strong>
          </div>
          {selectedGeneration && <span>{formatGenerationTime(selectedGeneration.createdAt)}</span>}
        </div>
        <div className="image-preview-stage">
          {previewUrl && previewMediaFailed ? (
            <MediaLoadFallback
              title={textFor(t, 'Image could not be loaded', '图片加载失败')}
              detail={textFor(t, 'The output remains in Assets. Refresh the history to request a new private preview.', '产物仍保存在资产库中，可刷新历史记录重新获取私有预览。')}
              testId="image-preview-load-failed"
            />
          ) : previewUrl ? (
            <img data-testid="generated-image-preview" onError={() => setFailedPreviewUrl(previewUrl)} src={previewUrl} alt={selectedGeneration?.promptPreview ?? textFor(t, 'Generated image', '生成图片')} />
          ) : outputChecksPending ? (
            <div className="image-preview-empty image-preview-checking" data-testid="image-preview-checking">
              <Sparkles size={32} />
              <strong>{textFor(t, 'Checking your image', '正在检查图片')}</strong>
              <span>{textFor(t, 'Preview and download become available after safety checks.', '安全检查通过后即可预览和下载。')}</span>
            </div>
          ) : outputRejected ? (
            <div className="image-preview-empty image-preview-blocked" data-testid="image-preview-blocked">
              <Image size={32} />
              <strong>{textFor(t, 'Preview blocked', '预览已拦截')}</strong>
              <span>{textFor(t, 'This output did not pass safety checks and cannot be previewed or downloaded.', '此输出未通过安全检查，无法预览或下载。')}</span>
            </div>
          ) : scanStatus === 'clean' && generatedAssetId ? (
            <div className="image-preview-empty" data-testid="image-preview-unavailable">
              <Image size={32} />
              <strong>{textFor(t, 'Preview unavailable', '暂不支持预览')}</strong>
              <span>{textFor(t, 'The checked output is available in Assets.', '已通过检查的输出可在资产库中查看。')}</span>
            </div>
          ) : (
            <div className={`image-preview-empty ${providerGeneration.providerAvailable ? 'image-preview-sample' : ''}`}>
              {providerGeneration.providerAvailable && (sampleMediaFailed ? (
                <MediaLoadFallback
                  compact
                  title={textFor(t, 'Sample unavailable', '示例图暂不可用')}
                  detail={textFor(t, 'You can still create with the configured model.', '模型仍可正常使用，可以继续创作。')}
                  testId="workspace-sample-load-failed"
                />
              ) : <img src="/showcase/home-cinematic.jpg" alt="" aria-hidden="true" onError={() => setSampleMediaFailed(true)} />)}
              <div>
                <span>{providerGeneration.providerAvailable ? textFor(t, 'STUDIO SAMPLE', '工作台示例') : textFor(t, 'MODEL STATUS', '模型状态')}</span>
                <strong>{providerGeneration.providerAvailable
                  ? textFor(t, 'Your next image starts here.', '你的下一张图片，从这里开始。')
                  : textFor(t, 'No image model is available', '暂无可用的图片模型')}</strong>
                <small>{providerGeneration.providerAvailable
                  ? textFor(t, 'This sample is not part of your assets.', '此示例不属于你的资产。')
                  : textFor(t, 'Ask an administrator to configure a model.', '请联系管理员配置模型。')}</small>
              </div>
            </div>
          )}
        </div>
        <div className="image-preview-actions">
          {generatedAssetId && (
            <>
              <button className="ghost-button" type="button" onClick={providerGeneration.openAssetLibrary}>
                <FileText size={16} />{textFor(t, 'Open in Assets', '在资产中查看')}
              </button>
              <button
                className="ghost-button"
                type="button"
                title={textFor(t, 'Download output', '下载输出')}
                aria-label={textFor(t, 'Download output', '下载输出')}
                disabled={scanStatus !== 'clean' || actionBusy}
                onClick={() => void providerGeneration.downloadAsset(generatedAssetId)}
              >
                <Download size={16} />{textFor(t, 'Download', '下载')}
              </button>
            </>
          )}
          {!generatedAssetId && <span>{textFor(t, 'No generation selected', '尚未选择生成记录')}</span>}
        </div>
      </section>

      {providerGeneration && (
        <section className="image-generation-history" aria-label={textFor(t, 'Image generation history', '图片生成历史')}>
          <div className="image-history-header">
            <div>
              <span className="eyebrow">{textFor(t, 'Generation history', '生成历史')}</span>
              <h2>{textFor(t, 'Image jobs', '图片任务')}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              title={textFor(t, 'Refresh history', '刷新历史')}
              aria-label={textFor(t, 'Refresh history', '刷新历史')}
              onClick={() => void providerGeneration.refreshHistory()}
              disabled={providerGeneration.history.status === 'loading'}
            >
              <RefreshCcw size={17} />
            </button>
          </div>
          {providerGeneration.history.error && (
            <p className="image-history-error">{providerGeneration.history.error}</p>
          )}
          {providerGeneration.history.status === 'loading' && providerGeneration.history.items.length === 0 ? (
            <p className="image-history-empty">{textFor(t, 'Loading image jobs', '正在加载图片任务')}</p>
          ) : providerGeneration.history.items.length === 0 ? (
            <p className="image-history-empty">{textFor(t, 'No image jobs yet', '暂无图片任务')}</p>
          ) : (
            <div className="image-history-table">
              <div className="image-history-row image-history-columns" aria-hidden="true">
                <span>{textFor(t, 'Status', '状态')}</span>
                <span>{textFor(t, 'Request', '请求')}</span>
                <span>{textFor(t, 'Mode', '模式')}</span>
                <span>{textFor(t, 'Created', '创建时间')}</span>
                <span>{textFor(t, 'Output', '输出')}</span>
              </div>
              {providerGeneration.history.items.map((generation) => {
                const output = generation.outputs[0]
                return (
                  <button
                    className={`image-history-row ${providerGeneration.history.selected?.id === generation.id ? 'active' : ''}`}
                    type="button"
                    key={generation.id}
                    onClick={() => {
                      providerGeneration.selectGeneration(generation.id)
                      setActivePanel('result')
                    }}
                  >
                    <span className="image-history-status">
                      <span className={`status-dot ${generation.status === 'queued' || generation.status === 'running' ? 'loading' : generation.status === 'completed' ? 'done' : generation.status === 'failed' || generation.status === 'cancelled' ? 'error' : ''}`} />
                      {lifecycleLabel(generation.status)}
                    </span>
                    <span className="image-history-prompt">{generation.promptPreview ?? generation.id}</span>
                    <span>{imageLabel(generation.mode)}</span>
                    <span>{formatGenerationTime(generation.createdAt)}</span>
                    <span>{output ? output.scanStatus : '-'}</span>
                  </button>
                )
              })}
            </div>
          )}
          {providerGeneration.history.nextCursor && (
            <button
              className="ghost-button image-history-more"
              type="button"
              onClick={() => void providerGeneration.refreshHistory(providerGeneration.history.nextCursor)}
            >
              <ChevronDown size={16} />
              {textFor(t, 'Load more', '加载更多')}
            </button>
          )}
        </section>
      )}

      <section className="visual-grid">
        {generatedAssetId && (
          <article className="visual-card generated-result-card">
            <div className="generated-preview">
              <Sparkles size={26} />
              <span>{scanStatus ?? 'pending'}</span>
            </div>
            <div>
              <strong>{textFor(t, 'Generated provider image', '提供方生成图片')}</strong>
              <span>
                {generatedAssetId} · {selectedGeneration?.provider.mode ?? selectedGeneration?.provider.id ?? 'mock'}
              </span>
            </div>
            <div className="card-actions">
              <button type="button" title={textFor(t, 'Open asset library', '打开资产库')} onClick={providerGeneration.openAssetLibrary}>
                <FileText size={16} />
              </button>
              <button
                type="button"
                title={textFor(t, 'Download asset from legacy card', '从旧卡片下载资产')}
                disabled={scanStatus !== 'clean' || actionBusy}
                onClick={() => void providerGeneration?.downloadAsset(generatedAssetId)}
              >
                <Download size={16} />
              </button>
              <button type="button" title={textFor(t, 'Output sharing is not available yet', '输出分享暂未开放')} disabled>
                <Share2 size={16} />
              </button>
            </div>
            <UseCreativeAsset t={t} assetId={generatedAssetId} fileName={historyOutput?.fileName ?? undefined} available={scanStatus === 'clean' && selectedStatus === 'completed'}/>
          </article>
        )}
      </section>
    </div>
  )
}
