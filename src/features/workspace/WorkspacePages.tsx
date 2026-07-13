import { useEffect, useState, type ReactNode } from 'react'
import {
  Bot,
  ChevronDown,
  Clapperboard,
  Download,
  FileText,
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
import type { InspirationItem, Page, PlaygroundMode, SimulateAction, Task, Work } from '../../domain/types'
import { visualWorks } from '../../data/mockData'
import { isZhCopy, textFor } from '../../domain/utils'
import type { VideoGenerationWorkflow } from '../../hooks/useVideoGenerationWorkflow'
import type { MusicGenerationWorkflow } from '../../hooks/useMusicGenerationWorkflow'
import type { ApiCreativeCapability, ApiCreativeGeneration, ApiCreativeProviderCatalog, ApiMediaAsset, ApiUserCreativeGeneration } from '../../services/contracts'
import { ChatPage } from './ChatPage'
import { MusicStudioPage } from './MusicStudioPage'
import { VideoStudioPage } from './VideoStudioPage'

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
  refreshImageGenerationHistory,
  selectImageGeneration,
  cancelImageGeneration,
  retryImageGeneration,
  downloadImageGenerationAsset,
  prepareImageAssetForReuse,
  hasImageGenerationRetryRequest,
  imageProviderCatalog,
  imageProviderCatalogState,
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
  simulateAction,
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
  refreshImageGenerationHistory: (cursor?: string | null) => Promise<void>
  selectImageGeneration: (id: string) => void
  cancelImageGeneration: (id: string) => Promise<void>
  retryImageGeneration: (id: string) => Promise<void>
  downloadImageGenerationAsset: (assetId: string) => Promise<void>
  prepareImageAssetForReuse: (assetId: string) => Promise<boolean>
  hasImageGenerationRetryRequest: (id: string) => boolean
  imageProviderCatalog: ApiCreativeProviderCatalog | null
  imageProviderCatalogState: 'loading' | 'ready' | 'error'
  imageInputAssets: ApiMediaAsset[]
  uploadImageInput: (file: File) => Promise<void>
  runImageGeneration: (input: { prompt: string; mode: string; stylePreset: string; aspectRatio: string; strength: number; inputAssetIds: string[] }) => Promise<void>
  musicWorkflow: MusicGenerationWorkflow
  videoWorkflow: VideoGenerationWorkflow
  signedIn: boolean
  tasks: Task[]
  libraryItems: InspirationItem[]
  openModerationAppeal: (moderationDecisionId: string) => void
  requireAuth: () => void
  simulateAction: SimulateAction
  workspace: PlaygroundMode
  setWorkspace: (workspace: PlaygroundMode) => void
  setPage: (page: Page) => void
}) {
  const imageProvider = imageProviderCatalog?.providers.find((provider) => provider.id === imageProviderCatalog.defaultProviderId)
  const imageCapability = imageProvider?.capabilities.find((capability) => capability.workspace === 'image') ?? null

  const workspaceTabs = [
    { key: 'music' as PlaygroundMode, label: textFor(t, 'Music', '音乐'), icon: Music2 },
    { key: 'image' as PlaygroundMode, label: textFor(t, 'Image', '图片'), icon: Image },
    { key: 'video' as PlaygroundMode, label: textFor(t, 'Video', '视频'), icon: Video },
    { key: 'chat' as PlaygroundMode, label: t.chat, icon: Bot },
  ]

  return (
    <div className="stack">
      <section className="playground-hero">
        <div>
          <span className="eyebrow">{textFor(t, 'Workspace', '工作区')}</span>
          <h1>{t.playgroundTitle}</h1>
          <p>{t.playgroundSubtitle}</p>
        </div>
        <div className="playground-tabs" role="tablist" aria-label={t.playgroundTitle}>
          {workspaceTabs.map((item) => {
            const Icon = item.icon
            return (
              <button
                className={workspace === item.key ? 'chip active' : 'chip'}
                type="button"
                key={item.key}
                onClick={() => setWorkspace(item.key)}
              >
                <Icon size={16} />
                {item.label}
              </button>
            )
          })}
        </div>
      </section>

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
          results={visualWorks.filter((item) => item.type === 'Image')}
          requireAuth={requireAuth}
          simulateAction={simulateAction}
          providerGeneration={{
            state: imageGeneration,
            history: imageGenerationHistory,
            action: imageGenerationAction,
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
            providerAvailable: Boolean(imageProvider?.enabled && imageProvider.configured),
            onGenerate: runImageGeneration,
          }}
        />
      )}

      {workspace === 'video' && (
        <VideoStudioPage
          t={t}
          providerCatalog={imageProviderCatalog}
          providerCatalogState={imageProviderCatalogState}
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
          simulateAction={simulateAction}
        />
      )}
    </div>
  )
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
  results,
  requireAuth,
  simulateAction,
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
  results: Work[]
  requireAuth: () => void
  simulateAction: SimulateAction
  extraAction?: () => void
  extraActionLabel?: string
  providerGeneration?: {
    state: ImageGenerationState
    history: ImageGenerationHistoryState
    action: {
      type: 'cancel' | 'retry' | 'download' | null
      targetId: string | null
      error: string | null
    }
    refreshHistory: (cursor?: string | null) => Promise<void>
    selectGeneration: (id: string) => void
    cancelGeneration: (id: string) => Promise<void>
    retryGeneration: (id: string) => Promise<void>
    downloadAsset: (assetId: string) => Promise<void>
    prepareAssetForReuse: (assetId: string) => Promise<boolean>
    hasOriginalRequest: (id: string) => boolean
    capability: ApiCreativeCapability | null
    catalogState: 'loading' | 'ready' | 'error'
    providerAvailable: boolean
    inputAssets: ApiMediaAsset[]
    uploadInput: (file: File) => Promise<void>
    onGenerate: (input: { prompt: string; mode: string; stylePreset: string; aspectRatio: string; strength: number; inputAssetIds: string[] }) => Promise<void>
  }
}) {
  const isZh = isZhCopy(t)
  const [activeOption, setActiveOption] = useState(options[0])
  const [activeControls, setActiveControls] = useState<string[]>([controls[0]])
  const [renderState, setRenderState] = useState<'idle' | 'loading' | 'done'>('idle')
  const [draftPrompt, setDraftPrompt] = useState(prompt)
  const [activeImageMode, setActiveImageMode] = useState('text_to_image')
  const [sourceAssetId, setSourceAssetId] = useState('')
  const [maskAssetId, setMaskAssetId] = useState('')
  const [strength, setStrength] = useState(0.7)
  const [uploadingInput, setUploadingInput] = useState(false)
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
      simulateAction(isZh ? `已选择画幅：${control}` : `Aspect ratio selected: ${control}`)
      return
    }
    setActiveControls((current) =>
      current.includes(control) ? current.filter((item) => item !== control) : [...current, control],
    )
    simulateAction(isZh ? `已切换参数：${control}` : `Control changed: ${control}`)
  }

  const runStudioGenerate = () => {
    if (providerGeneration) {
      const inputAssetIds = selectedImageMode === 'image_edit'
        ? [sourceAssetId, maskAssetId].filter(Boolean)
        : selectedImageMode === 'text_to_image' ? [] : [sourceAssetId].filter(Boolean)
      void providerGeneration.onGenerate({
        prompt: draftPrompt,
        mode: selectedImageMode,
        stylePreset: selectedOption,
        aspectRatio: activeControls.find((control) => displayedControls.includes(control)) ?? displayedControls[0] ?? '1:1',
        strength,
        inputAssetIds,
      })
      return
    }
    setRenderState('loading')
    simulateAction(isZh ? `已开始模拟生成：${activeOption}` : `Generation started: ${activeOption}`)
    window.setTimeout(() => {
      setRenderState('done')
      simulateAction(isZh ? `生成完成：${activeOption} 已加入结果区` : `Generated: ${activeOption} added to results`)
    }, 800)
  }

  const selectedGeneration = providerGeneration?.history.selected ?? null
  const selectedStatus = selectedGeneration?.status ?? null
  const lifecycleActive = selectedStatus === 'queued' || selectedStatus === 'running'
  const actionBusy = providerGeneration?.action.type != null
  const exactRetryAvailable = selectedGeneration ? providerGeneration?.hasOriginalRequest(selectedGeneration.id) === true : false
  const activeState = providerGeneration?.state.status === 'loading' || lifecycleActive
    ? 'loading'
    : selectedStatus === 'completed' || selectedStatus === 'review_required' || providerGeneration?.state.status === 'done'
      ? 'done'
      : renderState
  const immediateResult = providerGeneration?.state.result ?? null
  const generatedOutput = immediateResult && immediateResult.id === selectedGeneration?.id
    ? immediateResult.outputs[0] ?? null
    : null
  const historyOutput = selectedGeneration?.outputs[0] ?? null
  const mediaAsset = generatedOutput?.mediaAsset
  const generatedAssetId = historyOutput?.assetId ?? generatedOutput?.storage.mediaAssetId ?? null
  const generatedContentType = historyOutput?.contentType ?? generatedOutput?.contentType ?? null
  const scanStatus = historyOutput?.scanStatus ?? generatedOutput?.storage.scanStatus ?? mediaAsset?.scanStatus ?? null
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
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat(isZh ? 'zh-CN' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div className="stack">
      <section className="studio-hero">
        <div className="studio-icon">{icon}</div>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </section>
      <section className="composer">
        <textarea value={draftPrompt} onChange={(event) => setDraftPrompt(event.target.value)} />
        {providerGeneration && (
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
                void providerGeneration.uploadInput(file)
                  .catch(() => simulateAction(textFor(t, 'Image upload failed', '图片上传失败')))
                  .finally(() => setUploadingInput(false))
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
          <div className="chip-row">
          {displayedOptions.map((option) => (
            <button
              className={selectedOption === option ? 'chip active' : 'chip'}
              type="button"
              key={option}
              onClick={() => {
                setActiveOption(option)
                simulateAction(isZh ? `已选择生成模式：${option}` : `Generation mode selected: ${option}`)
              }}
            >
              {imageLabel(option)}
            </button>
          ))}
          </div>
        )}
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
              <ChevronDown size={14} />
            </button>
          ))}
          </div>
        )}
        <div className="button-row">
          <button
            className="primary-button"
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
            <Sparkles size={17} />
            {activeState === 'loading' ? t.generating : activeState === 'done' ? t.generated : primaryAction}
          </button>
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
              onClick={() => void providerGeneration.retryGeneration(selectedGeneration.id)}
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
        {providerGeneration && (
          <div className="provider-status-panel">
            <div>
              <span className={`status-dot ${lifecycleActive || providerGeneration.state.status === 'loading' ? 'loading' : selectedStatus === 'completed' ? 'done' : selectedStatus === 'failed' || selectedStatus === 'cancelled' ? 'error' : ''}`} />
              <strong>
                {selectedGeneration
                  ? lifecycleLabel(selectedGeneration.status)
                  : providerGeneration.state.status === 'loading'
                    ? textFor(t, 'Submitting generation', '正在提交生成任务')
                    : providerGeneration.state.status === 'error'
                      ? textFor(t, 'Provider generation failed', '提供方生成失败')
                      : providerGeneration.catalogState === 'loading'
                        ? textFor(t, 'Loading capability contract', '正在加载能力合同')
                        : providerGeneration.catalogState === 'error'
                          ? textFor(t, 'Capability contract unavailable', '能力合同不可用')
                          : !providerGeneration.providerAvailable
                            ? textFor(t, 'Provider unavailable', '提供方不可用')
                            : textFor(t, 'Provider-backed path ready', '提供方路径就绪')}
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
                  : providerGeneration.capability
                    ? textFor(
                      t,
                      `${providerGeneration.capability.contractVersion ?? 'Image contract'} · ${providerGeneration.capability.modes.join(', ')}`,
                      `${providerGeneration.capability.contractVersion ?? 'Image 合同'} · ${providerGeneration.capability.modes.map(imageLabel).join('、')}`,
                    )
                    : textFor(t, 'Generation is disabled until capability metadata is available.', '能力元数据可用前，生成保持禁用。')}
            </p>
            {selectedGeneration && (
              <div className="provider-meta-row">
                <span>{selectedGeneration.provider.id}</span>
                <span>{textFor(t, `${selectedGeneration.usage.estimatedCredits} credits`, `${selectedGeneration.usage.estimatedCredits} 点额度`)}</span>
                <span>{textFor(t, `Attempt ${selectedGeneration.attempt.number}`, `第 ${selectedGeneration.attempt.number} 次尝试`)}</span>
                {generatedContentType && <span>{generatedContentType}</span>}
                {selectedGeneration.safety.reviewRequired && (
                  <span>{textFor(t, 'Policy review', '策略复核')}</span>
                )}
                {generatedAssetId && <span>{scanStatus === 'clean' ? textFor(t, 'Download ready', '可下载') : textFor(t, 'Download gated', '下载受限')}</span>}
              </div>
            )}
            {providerGeneration.action.error && <p className="image-history-error">{providerGeneration.action.error}</p>}
            {selectedGeneration?.actions.retry.available && !exactRetryAvailable && (
              <p>{textFor(t, 'Exact retry is unavailable after refresh; recreate the request from its safe preview.', '刷新后无法恢复原始提示词；请根据安全预览重新填写。')}</p>
            )}
          </div>
        )}
      </section>

      {providerGeneration && (
        <section className="image-generation-history">
          <div className="image-history-header">
            <div>
              <span className="eyebrow">{textFor(t, 'Generation history', '生成历史')}</span>
              <h2>{textFor(t, 'Image jobs', '图片任务')}</h2>
            </div>
            <button
              className="icon-button"
              type="button"
              title={textFor(t, 'Refresh history', '刷新历史')}
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
                    onClick={() => providerGeneration.selectGeneration(generation.id)}
                  >
                    <span className="image-history-status">
                      <span className={`status-dot ${generation.status === 'queued' || generation.status === 'running' ? 'loading' : generation.status === 'completed' ? 'done' : generation.status === 'failed' || generation.status === 'cancelled' ? 'error' : ''}`} />
                      {lifecycleLabel(generation.status)}
                    </span>
                    <span className="image-history-prompt">{generation.promptPreview ?? generation.id}</span>
                    <span>{imageLabel(generation.mode)}</span>
                    <span>{formatGenerationTime(generation.createdAt)}</span>
                    <span>{output ? output.scanStatus : '—'}</span>
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
              <button type="button" title={textFor(t, 'Open asset details', '打开资产详情')} onClick={() => simulateAction(isZh ? `已读取资产：${generatedAssetId}` : `Opened asset: ${generatedAssetId}`)}>
                <FileText size={16} />
              </button>
              <button
                type="button"
                title={textFor(t, 'Download output', '下载输出')}
                disabled={scanStatus !== 'clean' || actionBusy}
                onClick={() => void providerGeneration?.downloadAsset(generatedAssetId)}
              >
                <Download size={16} />
              </button>
              <button type="button" title={textFor(t, 'Share output', '分享输出')} onClick={requireAuth}>
                <Share2 size={16} />
              </button>
            </div>
          </article>
        )}
        {!providerGeneration && results.map((work) => (
          <article className="visual-card" key={work.title}>
            <img src={work.image} alt="" />
            <div>
              <strong>{work.title}</strong>
              <span>
                {work.creator} · {work.views}
                {' '}
                {textFor(t, 'views', '浏览')}
              </span>
            </div>
            <div className="card-actions">
              <button type="button" onClick={() => simulateAction(isZh ? `已重新混合：${work.title}` : `Remixed: ${work.title}`)}>
                <RefreshCcw size={16} />
              </button>
              <button type="button" onClick={requireAuth}>
                <Download size={16} />
              </button>
              <button type="button" onClick={requireAuth}>
                <Share2 size={16} />
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
