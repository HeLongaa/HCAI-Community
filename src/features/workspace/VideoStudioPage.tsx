import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Download,
  Eye,
  Image,
  LoaderCircle,
  Music2,
  RefreshCcw,
  RotateCcw,
  Square,
  Upload,
  Video,
} from 'lucide-react'

import { visualWorks } from '../../data/mockData'
import { isZhCopy, textFor } from '../../domain/utils'
import type { VideoGenerationWorkflow } from '../../hooks/useVideoGenerationWorkflow'
import type {
  ApiCreativeCapability,
  ApiCreativeModeContract,
  ApiCreativeProviderCatalog,
  ApiCreativeProviderCatalogEntry,
  ApiMediaAsset,
} from '../../services/contracts'

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

const labelForStatus = (status: string | null, isZh: boolean) => ({
  queued: isZh ? '排队中' : 'Queued',
  running: isZh ? '生成中' : 'Running',
  review_required: isZh ? '等待审核' : 'Review required',
  completed: isZh ? '已完成' : 'Completed',
  failed: isZh ? '失败' : 'Failed',
  cancelled: isZh ? '已取消' : 'Cancelled',
})[status ?? ''] ?? (isZh ? '就绪' : 'Ready')

const statusTone = (status: string | null) => {
  if (status === 'queued' || status === 'running') return 'loading'
  if (status === 'completed') return 'done'
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

const parameterOptions = (capability: ApiCreativeCapability | null, key: string, fallback: Array<string | number>) =>
  capability?.parameterDefinitions?.[key]?.options ?? fallback

const capabilityFor = (provider: ApiCreativeProviderCatalogEntry | null) =>
  provider?.capabilities.find((capability) => capability.workspace === 'video') ?? null

const providerClassification = (provider: ApiCreativeProviderCatalogEntry | null, isZh: boolean) => {
  if (!provider) return { label: isZh ? '不可用' : 'Unavailable', tone: 'unavailable' }
  if (provider.id === 'mock' && provider.enabled && provider.configured) {
    return { label: 'Mock', tone: 'mock' }
  }
  if (provider.fixtureInjectable || provider.safeMetadata.fixtureAdapterOnly === true) {
    return { label: isZh ? '仅 Fixture' : 'Fixture only', tone: 'fixture' }
  }
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
  workflow,
}: {
  t: Record<string, string>
  providerCatalog: ApiCreativeProviderCatalog | null
  providerCatalogState: 'loading' | 'ready' | 'error'
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
        window.sessionStorage.removeItem('hcaiAssetReuse')
      })
    } catch { window.sessionStorage.removeItem('hcaiAssetReuse') }
  }, [workflow.inputAssets])
  const mockVisual = visualWorks.find((work) => work.type === 'Video')?.image ?? ''

  const providerId = providers.some((provider) => provider.id === providerChoice)
    ? providerChoice
    : providers.find((provider) => provider.id === providerCatalog?.defaultProviderId)?.id ?? providers[0]?.id ?? ''
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null
  const capability = capabilityFor(selectedProvider)
  const modeContracts = capability?.modeContracts ?? []
  const availableModes = modeContracts.filter((contract) => contract.available)
  const mode = availableModes.some((contract) => contract.id === modeChoice) ? modeChoice : availableModes[0]?.id ?? ''
  const activeMode = modeContracts.find((contract) => contract.id === mode) ?? null
  const providerAvailable = Boolean(selectedProvider?.enabled && selectedProvider.configured && activeMode?.available)
  const classification = providerClassification(selectedProvider, isZh)
  const selectableAssets = workflow.inputAssets.filter((asset) => assetAllowedFor(asset, activeMode))
  const selectableImages = selectableAssets.filter((asset) => imageTypes.has(asset.contentType))
  const selectableAudio = selectableAssets.filter((asset) => audioTypes.has(asset.contentType))
  const selectedGeneration = workflow.history.selected
  const selectedOutput = selectedGeneration?.outputs[0] ?? null
  const actionBusy = workflow.action.type != null
  const lifecycleActive = ['queued', 'running'].includes(selectedGeneration?.status ?? '')
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
  const canPreview = Boolean(
    selectedOutput &&
    selectedOutput.contentType === 'video/mp4' &&
    selectedOutput.scanStatus === 'clean' &&
    selectedGeneration?.actions.download.available,
  )

  const runGeneration = () => workflow.runGeneration({
    prompt,
    mode,
    providerId,
    inputAssetIds,
    parameters: {
      aspectRatio,
      durationSeconds,
      motionPreset,
      outputFormat: 'mp4',
    },
  })

  const uploadFile = (file: File | undefined) => {
    if (file) void workflow.uploadInput(file, 'submission_asset')
  }

  return (
    <div className="stack video-studio" data-testid="video-studio">
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
            <span>{textFor(t, 'Runtime', '运行来源')}</span>
            <select aria-label={textFor(t, 'Video runtime', '视频运行来源')} value={providerId} onChange={(event) => setProviderChoice(event.target.value)}>
              {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
            </select>
          </label>
          <span className={`runtime-badge ${classification.tone}`}>{classification.label}</span>
        </div>
      </header>

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
              <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
                {parameterOptions(capability, 'aspectRatio', ['16:9', '9:16']).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Duration', '时长')}</span>
              <select value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
                {parameterOptions(capability, 'durationSeconds', [4, 6, 8]).map((value) => <option key={value} value={value}>{value} {isZh ? '秒' : 'sec'}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Motion', '运动预设')}</span>
              <select value={motionPreset} onChange={(event) => setMotionPreset(event.target.value)}>
                {parameterOptions(capability, 'motionPreset', ['subtle', 'cinematic', 'dynamic', 'fast_cuts']).map((value) => <option key={value} value={value}>{labelForMotion(String(value), isZh)}</option>)}
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

          <button className="primary-button video-generate-button" type="button" disabled={!canGenerate} onClick={() => void runGeneration()}>
            {workflow.generation.status === 'loading' ? <LoaderCircle className="spin" size={17} /> : <Video size={17} />}
            {workflow.generation.status === 'loading' ? textFor(t, 'Creating job', '正在创建任务') : textFor(t, 'Generate video', '生成视频')}
          </button>

          {providerCatalogState === 'loading' && <p className="video-runtime-message">{textFor(t, 'Loading runtime capabilities', '正在读取运行能力')}</p>}
          {providerCatalogState === 'error' && <p className="video-inline-error">{textFor(t, 'Runtime capabilities could not be loaded. Generation is disabled.', '无法读取运行能力，生成已禁用。')}</p>}
          {providerCatalogState === 'ready' && !providerAvailable && (
            <p className="video-runtime-message"><AlertTriangle size={15} />{textFor(t, 'This runtime is visible for capability review but is not available for product generation.', '此运行来源仅用于能力查看，不能用于产品生成。')}</p>
          )}
          {workflow.generation.error && <p className="video-inline-error">{workflow.generation.error}</p>}
        </section>

        <section className="video-preview-panel" aria-label={textFor(t, 'Video preview', '视频预览')}>
          <div className="video-preview-toolbar">
            <div>
              <span className={`status-dot ${statusTone(selectedGeneration?.status ?? null)}`} />
              <strong>{labelForStatus(selectedGeneration?.status ?? null, isZh)}</strong>
            </div>
            <span>{selectedGeneration?.provider.id ?? classification.label}</span>
          </div>

          <div className={`video-preview-stage ratio-${aspectRatio.replace(':', '-')}`}>
            {workflow.preview.status === 'ready' && workflow.preview.url ? (
              <video controls src={workflow.preview.url} data-testid="private-video-preview" />
            ) : (
              <>
                <img src={mockVisual} alt="" />
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
              <button className="ghost-button" type="button" disabled={actionBusy || !exactRetryAvailable} onClick={() => void workflow.retryGeneration(selectedGeneration.id)}>
                <RotateCcw size={15} />{textFor(t, 'Retry', '重试')}
              </button>
            )}
            {selectedOutput && (
              <button className="ghost-button" type="button" disabled={actionBusy || (selectedOutput.contentType === 'video/mp4' && !canPreview)} onClick={() => void workflow.openPreview(selectedOutput.assetId, selectedOutput.contentType)}>
                <Eye size={15} />{textFor(t, 'Private preview', '私有预览')}
              </button>
            )}
            {selectedOutput && (
              <button className="icon-button" type="button" title={textFor(t, 'Download output', '下载输出')} disabled={actionBusy || !selectedGeneration?.actions.download.available} onClick={() => void workflow.downloadAsset(selectedOutput.assetId)}>
                <Download size={16} />
              </button>
            )}
          </div>

          {selectedGeneration?.actions.retry.available && !exactRetryAvailable && (
            <p className="video-runtime-message">{textFor(t, 'Exact retry is unavailable after refresh. Recreate the request from its safe preview.', '刷新后无法精确重试，请根据安全预览重新填写请求。')}</p>
          )}
          {selectedGeneration?.safety.reviewRequired && <p className="video-review-message"><AlertTriangle size={15} />{textFor(t, 'This output is waiting for policy review.', '此输出正在等待策略审核。')}</p>}
          {selectedOutput?.scanStatus === 'clean' && <p className="video-clean-message"><Check size={15} />{textFor(t, 'Private preview and download are available.', '私有预览和下载已可用。')}</p>}
          {workflow.action.error && <p className="video-inline-error">{workflow.action.error}</p>}
        </section>
      </div>

      <section className="video-history">
        <div className="video-history-header">
          <div>
            <span className="eyebrow">{textFor(t, 'Generation history', '生成历史')}</span>
            <h2>{textFor(t, 'Video jobs', '视频任务')}</h2>
          </div>
          <button className="icon-button" type="button" title={textFor(t, 'Refresh history', '刷新历史')} disabled={workflow.history.status === 'loading'} onClick={() => void workflow.refreshHistory()}>
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
                <span className="video-history-status"><span className={`status-dot ${statusTone(item.status)}`} />{labelForStatus(item.status, isZh)}</span>
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
