import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  LoaderCircle,
  Music2,
  Play,
  RefreshCcw,
  RotateCcw,
  Square,
  Video,
} from 'lucide-react'

import { isZhCopy, textFor } from '../../domain/utils'
import type { MusicGenerationWorkflow } from '../../hooks/useMusicGenerationWorkflow'
import type {
  ApiCreativeCapability,
  ApiCreativeModeContract,
  ApiCreativeProviderCatalog,
  ApiCreativeProviderCatalogEntry,
} from '../../services/contracts'
import { CreativeCostPreview } from './CreativeCostPreview'
import { UseCreativeAsset } from '../assets/UseCreativeAsset'

const labelForMode = (mode: string, isZh: boolean) => ({
  instrumental: isZh ? '纯音乐' : 'Instrumental',
  lyrics_to_song: isZh ? '歌词成歌' : 'Lyrics to Song',
})[mode] ?? mode

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
  provider?.capabilities.find((capability) => capability.workspace === 'music') ?? null

const providerClassification = (provider: ApiCreativeProviderCatalogEntry | null, isZh: boolean) => {
  if (!provider) return { label: isZh ? '不可用' : 'Unavailable', tone: 'unavailable' }
  if (provider.id === 'mock' && provider.enabled && provider.configured) return { label: 'Mock', tone: 'mock' }
  if (provider.fixtureInjectable || provider.safeMetadata.fixtureAdapterOnly === true) {
    return { label: isZh ? '仅 Fixture' : 'Fixture only', tone: 'fixture' }
  }
  return { label: isZh ? '不可用' : 'Unavailable', tone: 'unavailable' }
}

const modeContractFor = (contracts: ApiCreativeModeContract[], mode: string) =>
  contracts.find((contract) => contract.id === mode) ?? null

export function MusicStudioPage({
  t,
  providerCatalog,
  providerCatalogState,
  workflow,
  onUseInVideo,
}: {
  t: Record<string, string>
  providerCatalog: ApiCreativeProviderCatalog | null
  providerCatalogState: 'loading' | 'ready' | 'error'
  workflow: MusicGenerationWorkflow
  onUseInVideo: () => void
}) {
  const isZh = isZhCopy(t)
  const providers = useMemo(() => (providerCatalog?.providers ?? [])
    .filter((provider) => provider.capabilities.some((capability) => capability.workspace === 'music')), [providerCatalog])
  const [providerChoice, setProviderChoice] = useState('')
  const [modeChoice, setModeChoice] = useState('instrumental')
  const [prompt, setPrompt] = useState(textFor(t, 'Lo-fi instrumental for focused late-night work, warm keys and clean drums', '适合深夜专注工作的 Lo-fi 纯音乐，温暖键盘与干净鼓点'))
  const [lyrics, setLyrics] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(60)
  const [genre, setGenre] = useState('lo_fi')
  const [mood, setMood] = useState('calm')
  const [tempoBpm, setTempoBpm] = useState(100)
  const [language, setLanguage] = useState(isZh ? 'zh' : 'en')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)

  const providerId = providers.some((provider) => provider.id === providerChoice)
    ? providerChoice
    : providers.find((provider) => provider.id === providerCatalog?.defaultProviderId)?.id ?? providers[0]?.id ?? ''
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null
  const capability = capabilityFor(selectedProvider)
  const modeContracts = capability?.modeContracts ?? []
  const availableModes = modeContracts.filter((contract) => contract.available)
  const mode = availableModes.some((contract) => contract.id === modeChoice) ? modeChoice : availableModes[0]?.id ?? ''
  const activeMode = modeContractFor(modeContracts, mode)
  const classification = providerClassification(selectedProvider, isZh)
  const providerAvailable = Boolean(selectedProvider?.enabled && selectedProvider.configured && activeMode?.available)
  const selectedGeneration = workflow.history.selected
  const selectedOutput = selectedGeneration?.outputs[0] ?? null
  const actionBusy = workflow.action.type != null
  const lifecycleActive = ['queued', 'running'].includes(selectedGeneration?.status ?? '')
  const lyricsReady = mode !== 'lyrics_to_song' || Boolean(lyrics.trim())
  const canGenerate = providerCatalogState === 'ready' && providerAvailable && Boolean(prompt.trim()) && lyricsReady && rightsConfirmed && !lifecycleActive && workflow.generation.status !== 'loading'
  const exactRetryAvailable = selectedGeneration ? workflow.hasOriginalRequest(selectedGeneration.id) : false
  const canPlay = Boolean(
    selectedOutput &&
    selectedOutput.contentType === 'audio/mpeg' &&
    selectedOutput.scanStatus === 'clean' &&
    selectedGeneration?.actions.download.available,
  )

  const runGeneration = () => workflow.runGeneration({
    prompt,
    mode,
    providerId,
    parameters: {
      durationSeconds,
      genre,
      mood,
      tempoBpm,
      outputFormat: 'mp3',
      ...(mode === 'lyrics_to_song' ? { lyrics, language } : {}),
    },
  })

  return (
    <div className="stack video-studio music-studio" data-testid="music-studio">
      <header className="video-studio-header">
        <div className="video-studio-title">
          <span className="video-studio-mark"><Music2 size={22} /></span>
          <div>
            <span className="eyebrow">{textFor(t, 'Audio AI', '音频 AI')}</span>
            <h1>{textFor(t, 'Music Studio', '音乐工作台')}</h1>
            <p>{textFor(t, 'Create governed instrumental tracks and songs from lyrics.', '创作受治理的纯音乐与歌词歌曲。')}</p>
          </div>
        </div>
        <div className="video-provider-control">
          <label>
            <span>{textFor(t, 'Runtime', '运行来源')}</span>
            <select aria-label={textFor(t, 'Music runtime', '音乐运行来源')} value={providerId} onChange={(event) => setProviderChoice(event.target.value)}>
              {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
            </select>
          </label>
          <span className={`runtime-badge ${classification.tone}`}>{classification.label}</span>
        </div>
      </header>

      <div className="video-workbench">
        <section className="video-controls" aria-label={textFor(t, 'Music controls', '音乐控制')}>
          <div className="video-section-heading">
            <span className="eyebrow">{textFor(t, 'Create', '创作')}</span>
            <strong>{textFor(t, 'Generation setup', '生成设置')}</strong>
          </div>

          <div className="video-mode-tabs music-mode-tabs" role="tablist" aria-label={textFor(t, 'Music mode', '音乐模式')}>
            {modeContracts.map((contract) => (
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
                <Music2 size={17} />
                <span>{labelForMode(contract.id, isZh)}</span>
              </button>
            ))}
          </div>

          <label className="video-prompt-field">
            <span>{textFor(t, 'Prompt', '提示词')}</span>
            <textarea
              aria-label={textFor(t, 'Music prompt', '音乐提示词')}
              value={prompt}
              maxLength={capability?.maxPromptCharacters ?? 2000}
              onChange={(event) => setPrompt(event.target.value)}
            />
            <small>{prompt.length}/{capability?.maxPromptCharacters ?? 2000}</small>
          </label>

          {mode === 'lyrics_to_song' && (
            <label className="video-prompt-field music-lyrics-field">
              <span>{textFor(t, 'Lyrics', '歌词')}</span>
              <textarea
                aria-label={textFor(t, 'Song lyrics', '歌曲歌词')}
                value={lyrics}
                maxLength={5000}
                onChange={(event) => setLyrics(event.target.value)}
              />
              <small>{lyrics.length}/5000</small>
            </label>
          )}

          <div className="video-parameter-grid">
            <label>
              <span>{textFor(t, 'Duration', '时长')}</span>
              <select value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value))}>
                {parameterOptions(capability, 'durationSeconds', [30, 60, 120, 180]).map((value) => <option key={value} value={value}>{value} {isZh ? '秒' : 'sec'}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Genre', '风格')}</span>
              <select value={genre} onChange={(event) => setGenre(event.target.value)}>
                {parameterOptions(capability, 'genre', ['ambient', 'cinematic', 'electronic', 'lo_fi', 'pop']).map((value) => <option key={value} value={value}>{String(value).replace('_', ' ')}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Mood', '情绪')}</span>
              <select value={mood} onChange={(event) => setMood(event.target.value)}>
                {parameterOptions(capability, 'mood', ['calm', 'dreamy', 'dramatic', 'energetic']).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>{textFor(t, 'Tempo', '速度')}</span>
              <input aria-label={textFor(t, 'Tempo BPM', '速度 BPM')} type="number" min={40} max={220} value={tempoBpm} onChange={(event) => setTempoBpm(Number(event.target.value))} />
            </label>
            {mode === 'lyrics_to_song' && (
              <label>
                <span>{textFor(t, 'Language', '语言')}</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  {parameterOptions(capability, 'language', ['zh', 'en', 'es', 'ja', 'ko', 'multilingual']).map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            )}
            <label>
              <span>{textFor(t, 'Output', '输出')}</span>
              <select value="mp3" disabled><option value="mp3">MP3</option></select>
            </label>
          </div>

          <label className="video-rights-check">
            <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
            <span>{textFor(t, 'I have the rights to this prompt and any supplied lyrics, and I am not requesting artist imitation.', '我拥有提示词和所填歌词的必要权利，且未要求模仿特定艺人。')}</span>
          </label>

          <CreativeCostPreview t={t} workspace="music" mode={mode} providerId={providerId} />
          <button className="primary-button video-generate-button" type="button" disabled={!canGenerate} onClick={() => void runGeneration()}>
            {workflow.generation.status === 'loading' ? <LoaderCircle className="spin" size={17} /> : <Music2 size={17} />}
            {workflow.generation.status === 'loading' ? textFor(t, 'Creating job', '正在创建任务') : textFor(t, 'Generate music', '生成音乐')}
          </button>

          {providerCatalogState === 'loading' && <p className="video-runtime-message">{textFor(t, 'Loading runtime capabilities', '正在读取运行能力')}</p>}
          {providerCatalogState === 'error' && <p className="video-inline-error">{textFor(t, 'Runtime capabilities could not be loaded. Generation is disabled.', '无法读取运行能力，生成已禁用。')}</p>}
          {providerCatalogState === 'ready' && !providerAvailable && (
            <p className="video-runtime-message"><AlertTriangle size={15} />{textFor(t, 'This runtime is visible for capability review but is not available for product generation.', '此运行来源仅用于能力查看，不能用于产品生成。')}</p>
          )}
          {workflow.generation.error && <p className="video-inline-error">{workflow.generation.error}</p>}
        </section>

        <section className="video-preview-panel" aria-label={textFor(t, 'Music player', '音乐播放器')}>
          <div className="video-preview-toolbar">
            <div>
              <span className={`status-dot ${statusTone(selectedGeneration?.status ?? null)}`} />
              <strong>{labelForStatus(selectedGeneration?.status ?? null, isZh)}</strong>
            </div>
            <span>{selectedGeneration?.provider.id ?? classification.label}</span>
          </div>

          <div className="music-preview-stage">
            {workflow.preview.status === 'ready' && workflow.preview.url ? (
              <audio controls src={workflow.preview.url} data-testid="private-music-player" />
            ) : (
              <div className="music-preview-empty">
                {workflow.preview.status === 'loading' ? <LoaderCircle className="spin" size={34} /> : <Music2 size={34} />}
                <strong>{selectedGeneration?.promptPreview ?? textFor(t, 'No music job selected', '尚未选择音乐任务')}</strong>
                <span>{workflow.preview.error ?? (selectedOutput ? `${selectedOutput.contentType} · ${selectedOutput.scanStatus}` : textFor(t, 'Private audio appears here after governance checks.', '音频通过治理检查后会在这里显示。'))}</span>
              </div>
            )}
          </div>

          <div className="video-preview-details">
            <div><span>{textFor(t, 'Mode', '模式')}</span><strong>{labelForMode(selectedGeneration?.mode ?? mode, isZh)}</strong></div>
            <div><span>{textFor(t, 'Attempt', '尝试')}</span><strong>{selectedGeneration?.attempt.number ?? 1}</strong></div>
            <div><span>{textFor(t, 'Scan', '扫描')}</span><strong>{selectedOutput?.scanStatus ?? '-'}</strong></div>
            <div><span>{textFor(t, 'Credits', '额度')}</span><strong>{selectedGeneration?.usage.estimatedCredits ?? '-'}</strong></div>
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
              <button className="ghost-button" type="button" disabled={actionBusy || !canPlay} onClick={() => void workflow.loadAudio(selectedOutput.assetId, selectedOutput.contentType)}>
                <Play size={15} />{textFor(t, 'Private player', '私有播放')}
              </button>
            )}
            {selectedOutput && (
              <button className="icon-button" type="button" title={textFor(t, 'Download output', '下载输出')} disabled={actionBusy || !selectedGeneration?.actions.download.available} onClick={() => void workflow.downloadAsset(selectedOutput.assetId)}>
                <Download size={16} />
              </button>
            )}
            {selectedOutput && (
              <button className="ghost-button" type="button" disabled={actionBusy || !selectedGeneration?.actions.reuse.available} onClick={onUseInVideo}>
                <Video size={15} />{textFor(t, 'Use in Video', '用于视频')}
              </button>
            )}
          </div>

          {selectedOutput && (
            <UseCreativeAsset t={t} assetId={selectedOutput.assetId} fileName={selectedOutput.fileName} available={selectedOutput.scanStatus === 'clean' && selectedGeneration?.status === 'completed'}/>
          )}

          {selectedGeneration?.actions.retry.available && !exactRetryAvailable && (
            <p className="video-runtime-message">{textFor(t, 'Exact retry is unavailable after refresh. Recreate the request from its safe preview.', '刷新后无法精确重试，请根据安全预览重新填写请求。')}</p>
          )}
          {selectedGeneration?.safety.reviewRequired && <p className="video-review-message"><AlertTriangle size={15} />{textFor(t, 'This output is waiting for policy review.', '此输出正在等待策略审核。')}</p>}
          {selectedOutput?.scanStatus === 'clean' && <p className="video-clean-message"><Check size={15} />{textFor(t, 'Private playback and download are available.', '私有播放和下载已可用。')}</p>}
          {workflow.action.error && <p className="video-inline-error">{workflow.action.error}</p>}
        </section>
      </div>

      <section className="video-history">
        <div className="video-history-header">
          <div>
            <span className="eyebrow">{textFor(t, 'Generation history', '生成历史')}</span>
            <h2>{textFor(t, 'Music jobs', '音乐任务')}</h2>
          </div>
          <button className="icon-button" type="button" title={textFor(t, 'Refresh history', '刷新历史')} disabled={workflow.history.status === 'loading'} onClick={() => void workflow.refreshHistory()}>
            <RefreshCcw size={17} />
          </button>
        </div>
        {workflow.history.error && <p className="video-inline-error">{workflow.history.error}</p>}
        {workflow.history.status === 'loading' && workflow.history.items.length === 0 ? (
          <p className="video-history-empty">{textFor(t, 'Loading music jobs', '正在加载音乐任务')}</p>
        ) : workflow.history.items.length === 0 ? (
          <p className="video-history-empty">{textFor(t, 'No music jobs yet', '暂无音乐任务')}</p>
        ) : (
          <div className="video-history-table">
            <div className="video-history-row music-history-row video-history-columns" aria-hidden="true">
              <span>{textFor(t, 'Status', '状态')}</span>
              <span>{textFor(t, 'Request', '请求')}</span>
              <span>{textFor(t, 'Mode', '模式')}</span>
              <span>{textFor(t, 'Created', '创建时间')}</span>
              <span>{textFor(t, 'Output', '输出')}</span>
            </div>
            {workflow.history.items.map((item) => (
              <button
                className={`video-history-row music-history-row ${selectedGeneration?.id === item.id ? 'active' : ''}`}
                type="button"
                key={item.id}
                onClick={() => workflow.selectGeneration(item.id)}
              >
                <span className="video-history-status"><span className={`status-dot ${statusTone(item.status)}`} />{labelForStatus(item.status, isZh)}</span>
                <span className="video-history-prompt">{item.promptPreview ?? item.id}</span>
                <span>{labelForMode(item.mode, isZh)}</span>
                <span>{formatTime(item.createdAt, isZh)}</span>
                <span>{item.outputs[0] ? `${item.outputs[0].contentType} · ${item.outputs[0].scanStatus}` : '-'}</span>
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
