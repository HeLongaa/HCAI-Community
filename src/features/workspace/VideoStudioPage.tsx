import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Circle,
  Clapperboard,
  Download,
  Eye,
  FileDown,
  Image,
  LoaderCircle,
  Music2,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Square,
  Upload,
  Video,
} from 'lucide-react'

import { isZhCopy, textFor } from '../../domain/utils'
import type { VideoGenerationWorkflow } from '../../hooks/useVideoGenerationWorkflow'
import type {
  ApiCreativeCapability,
  ApiCreativeModeContract,
  ApiCreativeProviderCatalog,
  ApiCreativeProviderCatalogEntry,
  ApiMediaAsset,
  ApiUserCreativeGeneration,
} from '../../services/contracts'
import { CreativeCostPreview } from './CreativeCostPreview'
import { GenerationRetryConfirmation } from './GenerationRetryConfirmation'
import { UseCreativeAsset } from '../assets/UseCreativeAsset'
import { ActionFeedback, type ActionFeedbackMessage } from '../../components/ui/ActionFeedback'
import { isOperationalCreativeProvider, selectOperationalCreativeProvider } from '../../services/creativeProviderSelection'

const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])
const audioTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/mp4'])

const modeIcon = (mode: string) => mode === 'image_to_video' ? Image : mode === 'music_video' ? Music2 : Clapperboard

const labelForMode = (mode: string, isZh: boolean) => ({
  text_to_video: isZh ? '文生视频' : 'Text to Video',
  image_to_video: isZh ? '图生视频' : 'Image to Video',
  music_video: isZh ? '音乐视频' : 'Music Video',
})[mode] ?? mode

const labelForMotion = (value: string, isZh: boolean) => ({
  subtle: isZh ? '轻微运动' : 'Subtle',
  cinematic: isZh ? '电影感' : 'Cinematic',
  dynamic: isZh ? '动态' : 'Dynamic',
  fast_cuts: isZh ? '快切' : 'Fast cuts',
})[value] ?? value

const labelForStatus = (status: string | null, isZh: boolean, scanStatus: string | null = null) => {
  if (status === 'completed' && scanStatus !== 'clean') {
    return scanStatus === 'rejected' || scanStatus === 'failed'
      ? (isZh ? '输出不可用' : 'Output unavailable')
      : (isZh ? '正在处理输出' : 'Processing output')
  }
  return ({
    queued: isZh ? '排队中' : 'Queued',
    running: isZh ? '生成中' : 'Running',
    review_required: isZh ? '等待审核' : 'Review required',
    completed: isZh ? '已完成' : 'Completed',
    failed: isZh ? '失败' : 'Failed',
    cancelled: isZh ? '已取消' : 'Cancelled',
  })[status ?? ''] ?? (isZh ? '就绪' : 'Ready')
}

const statusTone = (status: string | null, scanStatus: string | null = null) => {
  if (status === 'queued' || status === 'running') return 'loading'
  if (status === 'completed' && scanStatus === 'clean') return 'done'
  if (status === 'completed' && (scanStatus === 'rejected' || scanStatus === 'failed')) return 'error'
  if (status === 'completed') return 'loading'
  if (status === 'failed' || status === 'cancelled') return 'error'
  return ''
}

const formatTime = (value: string | null, isZh: boolean) => {
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

const formatDuration = (milliseconds: number, isZh: boolean) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return isZh ? `${seconds} 秒` : `${seconds}s`
  return isZh ? `${minutes} 分 ${seconds} 秒` : `${minutes}m ${seconds}s`
}

const phaseForGeneration = (
  generation: ApiUserCreativeGeneration | null,
  output: ApiUserCreativeGeneration['outputs'][number] | null,
) => {
  if (!generation) return { active: -1, terminal: false, failed: false }
  const failed = generation.status === 'failed' || generation.status === 'cancelled'
  if (failed) return { active: generation.startedAt ? 1 : 0, terminal: true, failed: true }
  if (output?.scanStatus === 'clean' && generation.status === 'completed') return { active: 4, terminal: true, failed: false }
  if (output || generation.status === 'review_required') return { active: 3, terminal: false, failed: false }
  if (generation.status === 'completed') return { active: 2, terminal: false, failed: false }
  if (generation.status === 'running') return { active: 1, terminal: false, failed: false }
  return { active: 0, terminal: false, failed: false }
}

const parameterOptions = (capability: ApiCreativeCapability | null, key: string, fallback: Array<string | number>) =>
  capability?.parameterDefinitions?.[key]?.options ?? fallback

const capabilityFor = (provider: ApiCreativeProviderCatalogEntry | null) =>
  provider?.capabilities.find((capability) => capability.workspace === 'video') ?? null

const providerClassification = (provider: ApiCreativeProviderCatalogEntry | null, isZh: boolean) => {
  if (!provider) return { label: isZh ? '不可用' : 'Unavailable', tone: 'unavailable' }
  if (provider.id === 'mock' || provider.mode === 'mock') return { label: 'Mock', tone: 'mock' }
  if (provider.enabled && provider.configured && !provider.fixtureInjectable && provider.safeMetadata.fixtureAdapterOnly !== true) {
    return { label: isZh ? '已配置' : 'Configured', tone: 'available' }
  }
  const capabilityValidated = provider.capabilities.some((capability) =>
    capability.workspace === 'video' && capability.availability?.capabilityAvailable,
  )
  if (capabilityValidated) return { label: isZh ? '能力可用' : 'Capability available', tone: 'available' }
  if (provider.fixtureInjectable || Boolean(provider.safeMetadata.fixtureAdapterOnly)) return { label: 'Fixture only', tone: 'unavailable' }
  return { label: isZh ? '不可用' : 'Unavailable', tone: 'unavailable' }
}

const assetAllowedFor = (asset: ApiMediaAsset, contract: ApiCreativeModeContract | null) => Boolean(
  contract &&
  contract.inputAssets.purposes.includes(asset.purpose) &&
  contract.inputAssets.contentTypes.includes(asset.contentType),
)

export function VideoStudioPage({
  t,
  providerCatalog,
  providerCatalogState,
  onRetryCatalog,
  workflow,
}: {
  t: Record<string, string>
  providerCatalog: ApiCreativeProviderCatalog | null
  providerCatalogState: 'loading' | 'ready' | 'error'
  onRetryCatalog: () => Promise<void>
  workflow: VideoGenerationWorkflow
}) {
  const isZh = isZhCopy(t)
  const providers = useMemo(() => (providerCatalog?.providers ?? [])
    .filter((provider) => provider.capabilities.some((capability) => capability.workspace === 'video')), [providerCatalog])
  const [providerChoice, setProviderChoice] = useState('')
  const [modeChoice, setModeChoice] = useState('text_to_video')
  const [prompt, setPrompt] = useState(textFor(t, 'A quiet train crosses a rain-lit city at blue hour, cinematic camera movement', '蓝调时刻，一列安静的火车穿过雨夜城市，电影感镜头运动'))
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [durationSeconds, setDurationSeconds] = useState(8)
  const [motionPreset, setMotionPreset] = useState('cinematic')
  const [sourceImageId, setSourceImageId] = useState('')
  const [audioTrackId, setAudioTrackId] = useState('')
  const [referenceImageId, setReferenceImageId] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [activePanel, setActivePanel] = useState<'setup' | 'result' | 'history'>('setup')
  const [clock, setClock] = useState(() => Date.now())
  const [pendingRetryId, setPendingRetryId] = useState<string | null>(null)
  const [retryFeedback, setRetryFeedback] = useState<ActionFeedbackMessage | null>(null)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('hcaiAssetReuse')
      if (!raw) return
      const reuse = JSON.parse(raw) as { assetId?: string; workspace?: string }
      if (reuse.workspace !== 'video' || !reuse.assetId || !workflow.inputAssets.some((asset) => asset.id === reuse.assetId)) return
      window.queueMicrotask(() => {
        setModeChoice('image_to_video')
        setSourceImageId(reuse.assetId!)
        setRightsConfirmed(true)
      })
    } catch { window.sessionStorage.removeItem('hcaiAssetReuse') }
  }, [workflow.inputAssets])
  const preferredProvider = providerChoice ? providers.find((provider) => provider.id === providerChoice) ?? null : null
  const operationalProvider = selectOperationalCreativeProvider(providerCatalog, 'video')
  const selectedProvider = preferredProvider ?? operationalProvider
  const providerId = selectedProvider?.id ?? ''
  const capability = capabilityFor(selectedProvider)
  const aspectRatioOptions = parameterOptions(capability, 'aspectRatio', ['16:9', '9:16']).map(String)
  const durationOptions = parameterOptions(capability, 'durationSeconds', [4, 6, 8]).map(Number)
  const motionOptions = parameterOptions(capability, 'motionPreset', ['subtle', 'cinematic', 'dynamic', 'fast_cuts']).map(String)
  const selectedAspectRatio = aspectRatioOptions.includes(aspectRatio) ? aspectRatio : aspectRatioOptions[0] ?? '16:9'
  const selectedDurationSeconds = durationOptions.includes(durationSeconds) ? durationSeconds : durationOptions[0] ?? 8
  const selectedMotionPreset = motionOptions.includes(motionPreset) ? motionPreset : motionOptions[0] ?? 'cinematic'
  const modeContracts = capability?.modeContracts ?? []
  const availableModes = modeContracts.filter((contract) => contract.available)
  const mode = availableModes.some((contract) => contract.id === modeChoice) ? modeChoice : availableModes[0]?.id ?? ''
  const activeMode = modeContracts.find((contract) => contract.id === mode) ?? null
  const providerAvailable = Boolean(
    selectedProvider &&
    isOperationalCreativeProvider(selectedProvider, 'video') &&
    activeMode?.available,
  )
  const classification = providerClassification(selectedProvider, isZh)
  const capabilityValidated = Boolean(capability?.availability?.capabilityAvailable)
  const selectableAssets = workflow.inputAssets.filter((asset) => assetAllowedFor(asset, activeMode))
  const selectableImages = selectableAssets.filter((asset) => imageTypes.has(asset.contentType))
  const selectableAudio = selectableAssets.filter((asset) => audioTypes.has(asset.contentType))
  const selectedGeneration = workflow.history.selected
  const visibleRetryId = pendingRetryId === selectedGeneration?.id ? pendingRetryId : null
  const selectedOutput = selectedGeneration?.outputs[0] ?? null
  const actionBusy = workflow.action.type != null
  const lifecycleActive = ['queued', 'running'].includes(selectedGeneration?.status ?? '')
  const outputProcessing = selectedGeneration?.status === 'completed' && selectedOutput?.scanStatus !== 'clean'
  useEffect(() => {
    if (!lifecycleActive && !outputProcessing) return
    const interval = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [lifecycleActive, outputProcessing, selectedGeneration?.id])
  const inputAssetIds = mode === 'image_to_video'
    ? [sourceImageId].filter(Boolean)
    : mode === 'music_video'
      ? [audioTrackId, referenceImageId].filter(Boolean)
      : []
  const requiredRolesReady = mode === 'image_to_video'
    ? Boolean(sourceImageId)
    : mode === 'music_video'
      ? Boolean(audioTrackId)
      : mode === 'text_to_video'
  const inputsReady = Boolean(
    activeMode &&
    requiredRolesReady &&
    inputAssetIds.length >= activeMode.inputAssets.minimum &&
    inputAssetIds.length <= activeMode.inputAssets.maximum,
  )
  const canGenerate = providerCatalogState === 'ready' && providerAvailable && Boolean(prompt.trim()) && inputsReady && rightsConfirmed && !lifecycleActive && workflow.generation.status !== 'loading'
  const exactRetryAvailable = selectedGeneration ? workflow.hasOriginalRequest(selectedGeneration.id) : false
  const confirmRetry = async () => {
    if (!pendingRetryId) return
    setRetryFeedback(null)
    const succeeded = await workflow.retryGeneration(pendingRetryId)
    if (!succeeded) return
    setPendingRetryId(null)
    setRetryFeedback({
      kind: 'success',
      text: textFor(t, 'A new video attempt was created with the same inputs.', '已使用相同输入创建新的视频尝试。'),
    })
  }
  const canPreview = Boolean(
    selectedOutput &&
    selectedOutput.contentType === 'video/mp4' &&
    selectedOutput.scanStatus === 'clean' &&
    selectedGeneration?.actions.download.available,
  )

  const runGeneration = () => {
    setActivePanel('result')
    return workflow.runGeneration({
      prompt,
      mode,
      providerId,
      inputAssetIds,
      parameters: {
        aspectRatio: selectedAspectRatio,
        durationSeconds: selectedDurationSeconds,
        motionPreset: selectedMotionPreset,
        outputFormat: 'mp4',
      },
    })
  }

  const uploadFile = (file: File | undefined) => {
    if (file) void workflow.uploadInput(file, 'submission_asset')
  }

  const rebuildFromSafePreview = () => {
    if (!selectedGeneration) return
    if (selectedGeneration.promptPreview) setPrompt(selectedGeneration.promptPreview)
    if (modeContracts.some((contract) => contract.id === selectedGeneration.mode && contract.available)) {
      setModeChoice(selectedGeneration.mode)
    }
    if (providers.some((provider) => provider.id === selectedGeneration.provider.id)) {
      setProviderChoice(selectedGeneration.provider.id)
    }
    setRightsConfirmed(false)
    setActivePanel('setup')
  }

  return (
    <div className="stack video-studio" data-testid="video-studio" data-panel={activePanel}>
      <header className="video-studio-header">
        <div className="video-studio-title">
          <span className="video-studio-mark"><Clapperboard size={22} /></span>
          <div>
            <span className="eyebrow">{textFor(t, 'Motion AI', '视频 AI')}</span>
            <h1>{t.videoTitle}</h1>
            <p>{t.videoSubtitle}</p>
          </div>
        </div>
        <div className="video-provider-control">
          <label>
            <span>{textFor(t, 'Model', '模型')}</span>
            <select aria-label={textFor(t, 'Video runtime', '视频运行来源')} value={providerId} onChange={(event) => setProviderChoice(event.target.value)}>
              {!providerId && <option value="">{textFor(t, 'No available model', '暂无可用模型')}</option>}
              {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
            </select>
          </label>
          <span className={`runtime-badge ${classification.tone}`} aria-hidden="true">{classification.label}</span>
        </div>
      </header>

      <nav className="workspace-panel-switcher" aria-label={textFor(t, 'Video workspace panels', '视频工作台面板')}>
        <button className={activePanel === 'setup' ? 'active' : ''} type="button" onClick={() => setActivePanel('setup')}>{textFor(t, 'Generation setup', '生成设置')}</button>
        <button className={activePanel === 'result' ? 'active' : ''} type="button" onClick={() => setActivePanel('result')}>{textFor(t, 'Result', '生成结果')}</button>
        <button className={activePanel === 'history' ? 'active' : ''} type="button" onClick={() => setActivePanel('history')}>{textFor(t, 'History', '生成记录')}</button>
      </nav>

      <div className="video-workbench">
        <section className="video-controls" aria-label={textFor(t, 'Video controls', '视频控制')}>
          <div className="video-section-heading">
            <span className="eyebrow">{textFor(t, 'Create', '创作')}</span>
            <strong>{textFor(t, 'Generation setup', '生成设置')}</strong>
          </div>

          <div className="video-mode-tabs" role="tablist" aria-label={textFor(t, 'Video mode', '视频模式')}>
            {modeContracts.map((contract) => {
              const Icon = modeIcon(contract.id)
              return (
                <button
                  className={mode === contract.id ? 'active' : ''}
                  type="button"
                  role="tab"
                  aria-selected={mode === contract.id}
                  key={contract.id}
                  disabled={!contract.available}
                  title={contract.unavailableReason ?? ''}
                  onClick={() => setModeChoice(contract.id)}
                >
                  <Icon size={17} />
                  <span>{labelForMode(contract.id, isZh)}</span>
                </button>
              )
            })}
          </div>

          <label className="video-prompt-field">
            <span>{textFor(t, 'Prompt', '提示词')}</span>
            <textarea
              aria-label={textFor(t, 'Video prompt', '视频提示词')}
              value={prompt}
              maxLength={capability?.maxPromptCharacters ?? 2000}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <small>{prompt.length}/{capability?.maxPromptCharacters ?? 2000}</small>
          </label>

          {activeMode && activeMode.inputAssets.minimum > 0 && (
            <div className="video-assets">
              {mode === 'image_to_video' && (
                <AssetField
                  t={t}
                  label={textFor(t, 'Source image', '源图片')}
                  value={sourceImageId}
                  assets={selectableImages}
                  accept="image/png,image/jpeg,image/webp"
                  uploading={workflow.action.type === 'upload'}
                  onChange={setSourceImageId}
                  onUpload={uploadFile}
                />
              )}
              {mode === 'music_video' && (
                <>
                  <AssetField
                    t={t}
                    label={textFor(t, 'Audio track', '音轨')}
                    value={audioTrackId}
                    assets={selectableAudio}
                    accept="audio/mpeg,audio/wav,audio/mp4"
                    uploading={workflow.action.type === 'upload'}
                    onChange={setAudioTrackId}
                    onUpload={uploadFile}
                  />
                  <AssetField
                    t={t}
                    label={textFor(t, 'Reference image (optional)', '参考图片（可选）')}
                    value={referenceImageId}
                    assets={selectableImages}
                    accept="image/png,image/jpeg,image/webp"
                    uploading={workflow.action.type === 'upload'}
                    onChange={setReferenceImageId}
                    onUpload={uploadFile}
                  />
                </>
              )}
              {workflow.inputAssetsState === 'error' && <p className="video-inline-error">{textFor(t, 'Input assets are unavailable.', '输入素材暂不可用。')}</p>}
            </div>
          )}

          <div className="video-parameter-grid">
            <label>
              <span>{textFor(t, 'Aspect ratio', '画幅')}</span>
              <select value={selectedAspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
                {aspectRatioOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Duration', '时长')}</span>
              <select value={selectedDurationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
                {durationOptions.map((value) => <option key={value} value={value}>{value} {isZh ? '秒' : 'sec'}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Motion', '运动预设')}</span>
              <select value={selectedMotionPreset} onChange={(event) => setMotionPreset(event.target.value)}>
                {motionOptions.map((value) => <option key={value} value={value}>{labelForMotion(value, isZh)}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Output', '输出')}</span>
              <select value="mp4" disabled><option value="mp4">MP4 · 720p</option></select>
            </label>
          </div>

          <label className="video-rights-check">
            <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
            <span>{textFor(t, 'I have the rights and consent required for this prompt and selected media.', '我已获得此提示词及所选素材所需的权利与授权。')}</span>
          </label>

          <CreativeCostPreview t={t} workspace="video" mode={mode} providerId={providerId} />
          <button className="primary-button video-generate-button" type="button" disabled={!canGenerate} onClick={() => void runGeneration()}>
            {workflow.generation.status === 'loading' ? <LoaderCircle className="spin" size={17} /> : <Video size={17} />}
            {workflow.generation.status === 'loading' ? textFor(t, 'Creating job', '正在创建任务') : textFor(t, 'Generate video', '生成视频')}
          </button>

          {providerCatalogState === 'loading' && <p className="video-runtime-message">{textFor(t, 'Loading runtime capabilities', '正在读取运行能力')}</p>}
          {providerCatalogState === 'error' && <p className="video-inline-error">{textFor(t, 'Runtime capabilities could not be loaded. Generation is disabled.', '无法读取运行能力，生成已禁用。')} <button className="ghost-button" type="button" onClick={() => void onRetryCatalog()}>{textFor(t, 'Retry', '重试')}</button></p>}
          {providerCatalogState === 'ready' && !providerAvailable && (
            <p className="video-runtime-message"><AlertTriangle size={15} />{capabilityValidated
              ? textFor(t, 'Capability validated; runtime configuration is not ready.', '能力已验证，当前运行配置尚未就绪。')
              : textFor(t, 'This model is not enabled. Ask an administrator to configure it.', '该模型尚未启用，需要管理员先完成配置。')}</p>
          )}
          {workflow.generation.error && <p className="video-inline-error">{workflow.generation.error}</p>}
        </section>

        <section className="video-preview-panel" aria-label={textFor(t, 'Video preview', '视频预览')}>
          <div className="video-preview-toolbar" role="status" aria-live="polite" aria-label={textFor(t, 'Video generation status', '视频生成状态')}>
            <div>
              <span className={`status-dot ${statusTone(selectedGeneration?.status ?? null, selectedOutput?.scanStatus ?? null)}`} />
              <strong>{selectedGeneration
                ? labelForStatus(selectedGeneration.status, isZh, selectedOutput?.scanStatus ?? null)
                : providerAvailable
                  ? textFor(t, 'Ready', '就绪')
                  : capabilityValidated
                    ? textFor(t, 'Capability available', '能力可用')
                    : textFor(t, 'Model unavailable', '模型暂不可用')}</strong>
            </div>
            <span>{selectedGeneration?.provider.id ?? classification.label}</span>
          </div>

          <VideoLifecycleProgress
            generation={selectedGeneration}
            output={selectedOutput}
            isZh={isZh}
            polling={workflow.history.polling}
            clock={clock}
          />

          <div className={`video-preview-stage ratio-${selectedAspectRatio.replace(':', '-')}`}>
            {workflow.preview.status === 'ready' && workflow.preview.url ? (
              <video controls src={workflow.preview.url} data-testid="private-video-preview" aria-label={textFor(t, 'Private video preview', '私有视频预览')} />
            ) : (
              <>
                <div className="video-preview-overlay">
                  {workflow.preview.status === 'loading' ? <LoaderCircle className="spin" size={30} /> : selectedGeneration ? <Video size={30} /> : <Square size={30} />}
                  <strong>{selectedGeneration?.promptPreview ?? textFor(t, 'No video job selected', '尚未选择视频任务')}</strong>
                  <span>
                    {workflow.preview.error
                      ?? (selectedOutput
                        ? `${selectedOutput.contentType} · ${selectedOutput.scanStatus}`
                        : textFor(t, 'Application preview', '应用内预览'))}
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="video-preview-details">
            <div>
              <span>{textFor(t, 'Mode', '模式')}</span>
              <strong>{labelForMode(selectedGeneration?.mode ?? mode, isZh)}</strong>
            </div>
            <div>
              <span>{textFor(t, 'Attempt', '尝试')}</span>
              <strong>{selectedGeneration?.attempt.number ?? 1}</strong>
            </div>
            <div>
              <span>{textFor(t, 'Scan', '扫描')}</span>
              <strong>{selectedOutput?.scanStatus ?? '-'}</strong>
            </div>
            <div>
              <span>{textFor(t, 'Credits', '额度')}</span>
              <strong>{selectedGeneration?.usage.estimatedCredits ?? '-'}</strong>
            </div>
          </div>

          <div className="video-preview-actions">
            {selectedGeneration?.actions.cancel.available && (
              <button className="ghost-button" type="button" disabled={actionBusy} onClick={() => void workflow.cancelGeneration(selectedGeneration.id)}>
                <Square size={15} />{textFor(t, 'Cancel', '取消')}
              </button>
            )}
            {selectedGeneration?.actions.retry.available && (
              <button className="ghost-button" type="button" disabled={actionBusy || !exactRetryAvailable} onClick={() => {
                setRetryFeedback(null)
                setPendingRetryId(selectedGeneration.id)
              }}>
                <RotateCcw size={15} />{textFor(t, 'Retry', '重试')}
              </button>
            )}
            {selectedOutput && (
              <button className="ghost-button" type="button" disabled={actionBusy || (selectedOutput.contentType === 'video/mp4' && !canPreview)} onClick={() => void workflow.openPreview(selectedOutput.assetId, selectedOutput.contentType)}>
                <Eye size={15} />{textFor(t, 'Private preview', '私有预览')}
              </button>
            )}
            {selectedOutput && (
              <button className="icon-button" type="button" title={textFor(t, 'Download output', '下载输出')} aria-label={textFor(t, 'Download output', '下载输出')} disabled={actionBusy || !selectedGeneration?.actions.download.available} onClick={() => void workflow.downloadAsset(selectedOutput.assetId)}>
                <Download size={16} />
              </button>
            )}
          </div>

          {visibleRetryId && (
            <GenerationRetryConfirmation
              t={t}
              busy={workflow.action.type === 'retry' && workflow.action.targetId === visibleRetryId}
              onCancel={() => setPendingRetryId(null)}
              onConfirm={() => void confirmRetry()}
            />
          )}
          <ActionFeedback message={retryFeedback} className="generation-retry-feedback" />
          <ActionFeedback message={workflow.feedback} className="generation-operation-feedback" />

          {selectedOutput && (
            <UseCreativeAsset t={t} assetId={selectedOutput.assetId} fileName={selectedOutput.fileName} available={selectedOutput.scanStatus === 'clean' && selectedGeneration?.status === 'completed'}/>
          )}

          {selectedGeneration?.actions.retry.available && !exactRetryAvailable && (
            <div className="video-recovery-message">
              <p>{textFor(t, 'Exact retry is unavailable after refresh. Rebuild from the safe preview before submitting again.', '刷新后无法精确重试，可先用安全预览重建并确认后再次提交。')}</p>
              <button className="ghost-button" type="button" onClick={rebuildFromSafePreview}>
                <RotateCcw size={15} />{textFor(t, 'Use safe preview', '用安全预览重建')}
              </button>
            </div>
          )}
          {selectedGeneration?.safety.reviewRequired && <p className="video-review-message"><AlertTriangle size={15} />{textFor(t, 'This output is waiting for policy review.', '此输出正在等待策略审核。')}</p>}
          {selectedOutput?.scanStatus === 'clean' && <p className="video-clean-message"><Check size={15} />{textFor(t, 'Private preview and download are available.', '私有预览和下载已可用。')}</p>}
          {workflow.action.error && <p className="video-inline-error">{workflow.action.error}</p>}
        </section>
      </div>

      <section className="video-history" aria-label={textFor(t, 'Video generation history', '视频生成历史')}>
        <div className="video-history-header">
          <div>
            <span className="eyebrow">{textFor(t, 'Generation history', '生成历史')}</span>
            <h2>{textFor(t, 'Video jobs', '视频任务')}</h2>
          </div>
          <button className="icon-button" type="button" title={textFor(t, 'Refresh history', '刷新历史')} aria-label={textFor(t, 'Refresh history', '刷新历史')} disabled={workflow.history.status === 'loading'} onClick={() => void workflow.refreshHistory()}>
            <RefreshCcw size={17} />
          </button>
        </div>
        {workflow.history.error && <p className="video-inline-error">{workflow.history.error}</p>}
        {workflow.history.status === 'loading' && workflow.history.items.length === 0 ? (
          <p className="video-history-empty">{textFor(t, 'Loading video jobs', '正在加载视频任务')}</p>
        ) : workflow.history.items.length === 0 ? (
          <p className="video-history-empty">{textFor(t, 'No video jobs yet', '暂无视频任务')}</p>
        ) : (
          <div className="video-history-table">
            <div className="video-history-row video-history-columns" aria-hidden="true">
              <span>{textFor(t, 'Status', '状态')}</span>
              <span>{textFor(t, 'Request', '请求')}</span>
              <span>{textFor(t, 'Mode', '模式')}</span>
              <span>{textFor(t, 'Runtime', '运行来源')}</span>
              <span>{textFor(t, 'Created', '创建时间')}</span>
              <span>{textFor(t, 'Output', '输出')}</span>
            </div>
            {workflow.history.items.map((item) => (
              <button className={`video-history-row ${selectedGeneration?.id === item.id ? 'active' : ''}`} type="button" key={item.id} onClick={() => workflow.selectGeneration(item.id)}>
                <span className="video-history-status"><span className={`status-dot ${statusTone(item.status, item.outputs[0]?.scanStatus ?? null)}`} />{labelForStatus(item.status, isZh, item.outputs[0]?.scanStatus ?? null)}</span>
                <span className="video-history-prompt">{item.promptPreview ?? item.id}</span>
                <span>{labelForMode(item.mode, isZh)}</span>
                <span>{item.provider.id}</span>
                <span>{formatTime(item.createdAt, isZh)}</span>
                <span>{item.outputs[0]?.scanStatus ?? '-'}</span>
              </button>
            ))}
          </div>
        )}
        {workflow.history.nextCursor && (
          <button className="ghost-button video-history-more" type="button" onClick={() => void workflow.refreshHistory(workflow.history.nextCursor)}>
            {textFor(t, 'Load more', '加载更多')}
          </button>
        )}
      </section>
    </div>
  )
}

function VideoLifecycleProgress({
  generation,
  output,
  isZh,
  polling,
  clock,
}: {
  generation: ApiUserCreativeGeneration | null
  output: ApiUserCreativeGeneration['outputs'][number] | null
  isZh: boolean
  polling: boolean
  clock: number
}) {
  const phase = phaseForGeneration(generation, output)
  const stages = [
    { label: isZh ? '排队' : 'Queued', icon: Circle },
    { label: isZh ? '生成' : 'Generate', icon: Video },
    { label: isZh ? '取回' : 'Retrieve', icon: FileDown },
    { label: isZh ? '检查' : 'Inspect', icon: ShieldCheck },
    { label: isZh ? '完成' : 'Ready', icon: Check },
  ]
  const started = generation?.startedAt ?? generation?.createdAt
  const finished = generation?.completedAt ?? generation?.failedAt
  const startedAt = started ? new Date(started).getTime() : Number.NaN
  const finishedAt = finished ? new Date(finished).getTime() : Number.NaN
  const elapsed = Number.isFinite(startedAt)
    ? formatDuration((Number.isFinite(finishedAt) ? finishedAt : clock) - startedAt, isZh)
    : null
  const detail = !generation
    ? (isZh ? '创建任务后将在这里显示实时进度' : 'Live progress appears here after a job is created')
    : phase.failed
      ? (isZh ? `任务已停止${elapsed ? ` · 已用时 ${elapsed}` : ''}` : `Job stopped${elapsed ? ` · ${elapsed} elapsed` : ''}`)
      : phase.active === 4
        ? (isZh ? `处理完成${elapsed ? ` · 总用时 ${elapsed}` : ''}` : `Processing complete${elapsed ? ` · ${elapsed} total` : ''}`)
        : phase.active === 3
          ? (isZh ? `输出已取回，正在检查${elapsed ? ` · 已用时 ${elapsed}` : ''}` : `Output received, inspection in progress${elapsed ? ` · ${elapsed} elapsed` : ''}`)
          : (isZh
              ? `${polling ? '正在同步' : '等待更新'}${elapsed ? ` · 已用时 ${elapsed}` : ''} · 通常需要 1-3 分钟`
              : `${polling ? 'Syncing' : 'Awaiting update'}${elapsed ? ` · ${elapsed} elapsed` : ''} · usually 1-3 minutes`)

  return (
    <div className="video-lifecycle" data-testid="video-lifecycle" aria-label={isZh ? '视频处理阶段' : 'Video processing stages'}>
      <ol>
        {stages.map((stage, index) => {
          const state = index < phase.active || (phase.terminal && !phase.failed && index === phase.active)
            ? 'complete'
            : index === phase.active
              ? (phase.failed ? 'error' : 'current')
              : 'pending'
          const Icon = state === 'complete' ? Check : stage.icon
          return (
            <li className={state} key={stage.label} aria-current={state === 'current' || state === 'error' ? 'step' : undefined}>
              <span><Icon className={state === 'current' ? 'pulse-icon' : ''} size={15} /></span>
              <strong>{stage.label}</strong>
            </li>
          )
        })}
      </ol>
      <p>{detail}</p>
    </div>
  )
}

function AssetField({
  t,
  label,
  value,
  assets,
  accept,
  uploading,
  onChange,
  onUpload,
}: {
  t: Record<string, string>
  label: string
  value: string
  assets: ApiMediaAsset[]
  accept: string
  uploading: boolean
  onChange: (value: string) => void
  onUpload: (file: File | undefined) => void
}) {
  return (
    <div className="video-asset-field">
      <label>
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{textFor(t, 'Select a clean asset', '选择已通过扫描的素材')}</option>
          {assets.map((asset) => <option value={asset.id} key={asset.id}>{asset.fileName}</option>)}
        </select>
      </label>
      <label className="video-upload-button" title={textFor(t, 'Upload asset', '上传素材')}>
        {uploading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
        <input type="file" accept={accept} disabled={uploading} onChange={(event) => {
          onUpload(event.target.files?.[0])
          event.currentTarget.value = ''
        }} />
      </label>
    </div>
  )
}
