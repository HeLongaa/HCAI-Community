import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  Clapperboard,
  Download,
  FileText,
  Image,
  Mic2,
  Music2,
  PenLine,
  Play,
  RefreshCcw,
  Send,
  Share2,
  Shuffle,
  Sparkles,
  Upload,
  Video,
  Zap,
} from 'lucide-react'
import type { Page, PlaygroundMode, SimulateAction, Track, Work } from '../../domain/types'
import { SectionHeader } from '../../components/ui/SectionHeader'
import { tracks, visualWorks } from '../../data/mockData'
import { isZhCopy, textFor } from '../../domain/utils'
import type { ApiCreativeCapability, ApiCreativeGeneration, ApiCreativeProviderCatalog, ApiMediaAsset } from '../../services/contracts'

type ImageGenerationState = {
  status: 'idle' | 'loading' | 'done' | 'error'
  result: ApiCreativeGeneration | null
  error: string | null
}

export function PlaygroundPage({
  t,
  prompt,
  setPrompt,
  generationState,
  runGenerate,
  imageGeneration,
  imageProviderCatalog,
  imageProviderCatalogState,
  imageInputAssets,
  uploadImageInput,
  runImageGeneration,
  playTrack,
  requireAuth,
  simulateAction,
  workspace,
  setWorkspace,
  setPage,
}: {
  t: Record<string, string>
  prompt: string
  setPrompt: (value: string) => void
  generationState: 'idle' | 'loading' | 'done'
  runGenerate: () => void
  imageGeneration: ImageGenerationState
  imageProviderCatalog: ApiCreativeProviderCatalog | null
  imageProviderCatalogState: 'loading' | 'ready' | 'error'
  imageInputAssets: ApiMediaAsset[]
  uploadImageInput: (file: File) => Promise<void>
  runImageGeneration: (input: { prompt: string; mode: string; stylePreset: string; aspectRatio: string; strength: number; inputAssetIds: string[] }) => Promise<void>
  playTrack: (track: Track) => void
  requireAuth: () => void
  simulateAction: SimulateAction
  workspace: PlaygroundMode
  setWorkspace: (workspace: PlaygroundMode) => void
  setPage: (page: Page) => void
}) {
  const isZh = isZhCopy(t)
  const [mode, setMode] = useState<'instrumental' | 'lyrics'>('instrumental')
  const [activeTool, setActiveTool] = useState('song')
  const imageProvider = imageProviderCatalog?.providers.find((provider) => provider.id === imageProviderCatalog.defaultProviderId)
  const imageCapability = imageProvider?.capabilities.find((capability) => capability.workspace === 'image') ?? null
  const tools = [
    {
      key: 'song',
      label: t.createSong,
      icon: Music2,
      prompt: textFor(t, 'Lo-fi instrumental song for late-night coding, warm keys, clean drums', '国风 Lo-fi 歌单片头，古筝采样，轻鼓点，夜色城市氛围'),
    },
    {
      key: 'voice',
      label: t.createVoice,
      icon: Mic2,
      prompt: textFor(t, 'Trustworthy product launch narrator, warm, concise, commercial-ready', '中文课程宣传片旁白，专业、克制、有信任感'),
    },
    {
      key: 'tts',
      label: t.textToSpeech,
      icon: FileText,
      prompt: textFor(t, 'Read this product value proposition as a 20-second ad voiceover', '把这段课程卖点朗读成 20 秒中文广告口播'),
    },
    { key: 'replace', label: t.replaceFile, icon: Upload, prompt },
    {
      key: 'random',
      label: t.random,
      icon: Shuffle,
      prompt: textFor(t, 'Cinematic city-pop chorus, glossy synth bass, late-summer night drive', '国风 Lo-fi 歌单片头，古筝采样，轻鼓点，夜色城市氛围'),
    },
  ]

  const handleGenerate = () => {
    runGenerate()
    simulateAction(isZh ? '已加入生成队列：音乐/声音方案正在模拟生成' : 'Added to generation queue: music and voice concept is rendering')
  }

  const selectTool = (tool: (typeof tools)[number]) => {
    setActiveTool(tool.key)
    if (tool.key !== 'replace') {
      setPrompt(tool.prompt)
    }
    simulateAction(isZh ? `已选择工具：${tool.label}` : `Selected tool: ${tool.label}`)
  }

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
        <>
          <SectionHeader eyebrow={textFor(t, 'Music Studio', '音乐工作台')} title={textFor(t, 'Create AI songs and voice assets', '创作 AI 歌曲和声音素材')} />
          <section className="composer">
          <div className="composer-top">
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t.promptPlaceholder} />
            <div className="composer-actions">
            <button
              className="icon-button"
              type="button"
              onClick={() => simulateAction(isZh ? '已模拟上传参考文件：demo-reference.wav' : 'Reference file uploaded: demo-reference.wav')}
            >
              <Upload size={18} />
            </button>
            <button
              className="icon-button pro"
              type="button"
              onClick={() => simulateAction(isZh ? '已开启 Pro 参数预设：高质量、可商用、保留工程说明' : 'Pro preset enabled: high quality, commercial use, project notes')}
            >
              <Zap size={18} />
            </button>
          </div>
        </div>
        <div className="mode-row">
          <button
            className={mode === 'instrumental' ? 'chip active' : 'chip'}
            type="button"
            onClick={() => {
              setMode('instrumental')
              simulateAction(isZh ? '已切换到伴奏模式' : 'Switched to instrumental mode')
            }}
          >
            <Music2 size={16} />
            {t.instrumental}
          </button>
          <button
            className={mode === 'lyrics' ? 'chip active' : 'chip'}
            type="button"
            onClick={() => {
              setMode('lyrics')
              simulateAction(isZh ? '已切换到 lyrics 模式' : 'Switched to lyrics mode')
            }}
          >
            <PenLine size={16} />
            {t.lyrics}
          </button>
          <button className="primary-button" type="button" onClick={handleGenerate}>
            <Send size={17} />
            {generationState === 'loading' ? t.generating : t.generate}
          </button>
          </div>
        </section>

          <div className="tool-grid">
            {tools.map((tool) => {
              const Icon = tool.icon
              return (
                <button
                  className={activeTool === tool.key ? 'tool-card active' : 'tool-card'}
                  type="button"
                  key={tool.label}
                  onClick={() => selectTool(tool)}
                >
                  <Icon size={20} />
                  <span>{tool.label}</span>
                </button>
              )
            })}
          </div>

          <section className="content-grid two">
            <div className="panel">
              <SectionHeader title={textFor(t, 'Generation queue', '生成队列')} />
              <div className="queue-list">
                <QueueItem t={t} state={generationState} title={prompt || textFor(t, 'Untitled song', '未命名歌曲')} />
                <QueueItem t={t} state="done" title={textFor(t, 'Warm cinematic intro with female vocal', '温暖电影感女声片头')} />
                <QueueItem t={t} state="idle" title={textFor(t, 'Future bass chorus idea', 'Future bass 副歌灵感')} />
              </div>
            </div>
            <div className="panel">
              <SectionHeader title={textFor(t, 'Recent results', '最近结果')} />
              <div className="mini-list">
                {tracks.slice(0, 3).map((track) => (
                  <WorkspaceTrackRow key={track.id} t={t} track={track} playTrack={playTrack} />
                ))}
              </div>
            </div>
          </section>
        </>
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
        <StudioPage
          t={t}
          eyebrow={textFor(t, 'Motion AI', '视频 AI')}
          title={t.videoTitle}
          subtitle={t.videoSubtitle}
          icon={<Clapperboard size={22} />}
          prompt={textFor(t, 'A neon runner crosses a rainy city street while lyrics animate in sync', '中文课程宣传短视频，讲师照片转场，字幕同步，专业克制')}
          primaryAction={textFor(t, 'Generate video', '生成视频')}
          options={isZh ? ['文生视频', '图生视频', '音乐视频', '分镜', '字幕', '配音'] : ['Text to Video', 'Image to Video', 'Music Video', 'Storyboard', 'Subtitles', 'Voiceover']}
          controls={isZh ? ['9:16', '8 秒', '电影感', '快切', '开启字幕', 'MP4'] : ['9:16', '8 sec', 'Cinematic', 'Fast cuts', 'Captions on', 'MP4']}
          results={visualWorks.filter((item) => item.type === 'Video')}
          requireAuth={requireAuth}
          simulateAction={simulateAction}
        />
      )}

      {workspace === 'chat' && (
        <ChatPage
          t={t}
          setPage={setPage}
          openWorkspace={setWorkspace}
          simulateAction={simulateAction}
        />
      )}
    </div>
  )
}

function QueueItem({ t, state, title }: { t: Record<string, string>; state: 'idle' | 'loading' | 'done'; title: string }) {
  return (
    <div className="queue-item">
      <span className={`status-dot ${state}`} />
      <div>
        <strong>{title}</strong>
        <p>
          {state === 'loading'
            ? textFor(t, 'Rendering variations...', '正在渲染变体...')
            : state === 'done'
              ? textFor(t, 'Ready for review', '可预览验收')
              : textFor(t, 'Waiting', '等待中')}
        </p>
      </div>
    </div>
  )
}

function workspaceLabel(workspace: PlaygroundMode, t: Record<string, string>) {
  const labels = {
    music: textFor(t, 'Music', '音乐'),
    image: textFor(t, 'Image', '图片'),
    video: textFor(t, 'Video', '视频'),
    chat: t.chat,
  } satisfies Record<PlaygroundMode, string>
  return labels[workspace]
}

export function ChatPage({
  t,
  setPage,
  openWorkspace,
  simulateAction,
}: {
  t: Record<string, string>
  setPage: (page: Page) => void
  openWorkspace?: (workspace: PlaygroundMode) => void
  simulateAction: SimulateAction
}) {
  const isZh = isZhCopy(t)
  const quickPrompts = isZh
    ? [
        ['写歌词', '根据情绪生成一段主歌和副歌。'],
        ['优化提示词', '把提示词改得更具体、更可直接使用。'],
        ['视频脚本', '把歌曲拆成逐镜头画面。'],
        ['任务需求', '写一份清晰的任务广场买家需求。'],
      ]
    : [
        ['Write lyrics', 'Generate a verse and chorus from a mood.'],
        ['Improve prompt', 'Make a prompt more specific and usable.'],
        ['Video script', 'Turn a song into scene-by-scene shots.'],
        ['Task brief', 'Write a clear buyer request for Task Plaza.'],
      ]
  const [messages, setMessages] = useState(
    isZh
      ? [
          { role: 'assistant', text: '我可以帮你写歌词、提示词、视频脚本、任务需求和社区帖子。' },
          { role: 'user', text: '把这个国风 Lo-fi 想法改成副歌提示词。' },
          { role: 'assistant', text: '可以这样写：轻松国风 Lo-fi 副歌，温暖人声，古筝点缀，雨夜城市氛围，旋律适合循环。' },
        ]
      : [
          { role: 'assistant', text: 'I can help write lyrics, prompts, video scripts, task briefs, and community posts.' },
          { role: 'user', text: 'Turn this lofi idea into a chorus prompt.' },
          { role: 'assistant', text: 'Try: mellow city-pop chorus, intimate vocal, warm Rhodes, rain texture, hook about staying awake until sunrise.' },
        ],
  )
  const [draft, setDraft] = useState('')
  const latestMessageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const sendMessage = () => {
    if (!draft.trim()) return
    setMessages((current) => [
      ...current,
      { role: 'user', text: draft },
      {
        role: 'assistant',
        text: isZh ? '已生成草稿。你可以继续改写，或发送到音乐、图片、视频、任务广场。' : 'Drafted. You can send this to Music, Image, Video, or Task Plaza.',
      },
    ])
    setDraft('')
  }

  const applyPrompt = (title: string, text: string) => {
    const promptText = isZh
      ? `${title}: ${text} 请给我一个可直接用于任务广场或创作工具的中文版本。`
      : `${title}: ${text} Give me a production-ready version for the task plaza or creation tools.`
    setDraft(promptText)
    setMessages((current) => [
      ...current,
      { role: 'user', text: promptText },
      {
        role: 'assistant',
        text: isZh
          ? `已按「${title}」生成一版草稿，你可以继续修改或发送到对应工具。`
          : `I drafted a version for "${title}". You can refine it or send it to the matching tool.`,
      },
    ])
    simulateAction(isZh ? `已应用快捷提示：${title}` : `Quick prompt applied: ${title}`)
  }

  const goWorkspace = (target: PlaygroundMode) => {
    if (openWorkspace) {
      openWorkspace(target)
    } else {
      setPage(target === 'chat' ? 'chat' : 'playground')
    }
    simulateAction(isZh ? `已切换到 AI 工作区：${workspaceLabel(target, t)}` : `Opened AI Workspace: ${workspaceLabel(target, t)}`)
  }

  return (
    <div className="studio-layout">
      <section className="panel chat-panel">
        <SectionHeader eyebrow={textFor(t, 'Assistant', '助手')} title={t.chatTitle} />
        <p className="muted">{t.chatSubtitle}</p>
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div className={`chat-bubble ${message.role}`} key={`${message.role}-${index}`}>
              {message.text}
            </div>
          ))}
          <div aria-hidden="true" ref={latestMessageRef} />
        </div>
        <div className="chat-input">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder={textFor(t, 'Ask for lyrics, prompts, scripts...', '输入歌词、提示词、脚本或任务需求...')}
            rows={1}
          />
          <button className="primary-button" type="button" onClick={sendMessage}>
            <Send size={17} />
          </button>
        </div>
      </section>
      <aside className="panel side-panel chat-quick-panel">
        <SectionHeader title={textFor(t, 'Quick prompts', '快捷提示')} />
        {quickPrompts.map(([title, text]) => (
          <button className="prompt-card" type="button" key={title} onClick={() => applyPrompt(title, text)}>
            <strong>{title}</strong>
            <span>{text}</span>
          </button>
        ))}
        <div className="button-row vertical">
          <button className="ghost-button" type="button" onClick={() => goWorkspace('music')}>
            <Music2 size={17} />
            {textFor(t, 'Music workspace', '音乐工作区')}
          </button>
          <button className="ghost-button" type="button" onClick={() => goWorkspace('image')}>
            <Image size={17} />
            {textFor(t, 'Image workspace', '图片工作区')}
          </button>
          <button className="ghost-button" type="button" onClick={() => goWorkspace('video')}>
            <Clapperboard size={17} />
            {textFor(t, 'Video workspace', '视频工作区')}
          </button>
          <button className="ghost-button" type="button" onClick={() => setPage('tasks')}>
            <BriefcaseBusiness size={17} />
            {textFor(t, 'Task Plaza', '任务广场')}
          </button>
        </div>
      </aside>
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

  const activeState = providerGeneration?.state.status === 'loading'
    ? 'loading'
    : providerGeneration?.state.status === 'done'
      ? 'done'
      : renderState
  const generatedOutput = providerGeneration?.state.result?.outputs[0] ?? null
  const mediaAsset = generatedOutput?.mediaAsset
  const scanStatus = generatedOutput?.storage.scanStatus ?? mediaAsset?.scanStatus ?? null
  const activeModeContract = selectableImageModes.find((modeContract) => modeContract.id === selectedImageMode)
  const requiredInputsReady = !activeModeContract || activeModeContract.inputAssets.minimum === 0
    || (Boolean(sourceAssetId) && (selectedImageMode !== 'image_edit' || Boolean(maskAssetId)))

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
                {providerGeneration.inputAssets.map((asset) => (
                  <option value={asset.id} key={asset.id}>{asset.fileName}</option>
                ))}
              </select>
            </label>
            {selectedImageMode === 'image_edit' && (
              <label>
                <span>{textFor(t, 'PNG mask', 'PNG 蒙版')}</span>
                <select value={maskAssetId} onChange={(event) => setMaskAssetId(event.target.value)}>
                  <option value="">{textFor(t, 'Select a clean PNG mask', '选择已通过扫描的 PNG 蒙版')}</option>
                  {providerGeneration.inputAssets
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
          {providerGeneration && generatedOutput?.storage.mediaAssetId && scanStatus === 'clean' && (
            <button className="ghost-button" type="button" onClick={() => {
              setSourceAssetId(generatedOutput.storage.mediaAssetId ?? '')
              setActiveImageMode('image_to_image')
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
              <span className={`status-dot ${providerGeneration.state.status === 'loading' ? 'loading' : providerGeneration.state.status === 'done' ? 'done' : ''}`} />
              <strong>
                {providerGeneration.state.status === 'loading'
                  ? textFor(t, 'Provider generation running', '正在通过提供方生成')
                  : providerGeneration.state.status === 'done'
                    ? textFor(t, 'Mock provider result persisted', 'Mock 提供方结果已持久化')
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
                : generatedOutput
                  ? textFor(
                    t,
                    `Asset ${generatedOutput.storage.mediaAssetId ?? 'pending'} · scan ${scanStatus ?? 'pending'} · ${providerGeneration.state.result?.provider.mode ?? generatedOutput.storage.provider}`,
                    `资产 ${generatedOutput.storage.mediaAssetId ?? '待生成'} · 扫描 ${scanStatus ?? 'pending'} · ${generatedOutput.storage.provider}`,
                  )
                  : providerGeneration.capability
                    ? textFor(
                      t,
                      `${providerGeneration.capability.contractVersion ?? 'Image contract'} · ${providerGeneration.capability.modes.join(', ')}`,
                      `${providerGeneration.capability.contractVersion ?? 'Image 合同'} · ${providerGeneration.capability.modes.map(imageLabel).join('、')}`,
                    )
                    : textFor(t, 'Generation is disabled until capability metadata is available.', '能力元数据可用前，生成保持禁用。')}
            </p>
            {generatedOutput && (
              <div className="provider-meta-row">
                <span>{providerGeneration.state.result?.provider.label}</span>
                <span>{textFor(t, `${providerGeneration.state.result?.usage.estimatedCredits ?? 0} credits`, `${providerGeneration.state.result?.usage.estimatedCredits ?? 0} 点额度`)}</span>
                {providerGeneration.state.result?.quota && (
                  <span>{textFor(t, `${providerGeneration.state.result.quota.remaining} quota left`, `剩余额度 ${providerGeneration.state.result.quota.remaining}`)}</span>
                )}
                <span>{generatedOutput.contentType}</span>
                {providerGeneration.state.result?.safety.reviewRequired && (
                  <span>{textFor(t, 'Policy review', '策略复核')}</span>
                )}
                <span>{scanStatus === 'clean' ? textFor(t, 'Download ready', '可下载') : textFor(t, 'Download gated', '下载受限')}</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="visual-grid">
        {generatedOutput && (
          <article className="visual-card generated-result-card">
            <div className="generated-preview">
              <Sparkles size={26} />
              <span>{generatedOutput.mediaAsset?.scanStatus ?? generatedOutput.storage.scanStatus ?? 'pending'}</span>
            </div>
            <div>
              <strong>{textFor(t, 'Generated provider image', '提供方生成图片')}</strong>
              <span>
                {generatedOutput.storage.mediaAssetId ?? generatedOutput.id} · {providerGeneration?.state.result?.provider.mode ?? 'mock'}
              </span>
            </div>
            <div className="card-actions">
              <button type="button" onClick={() => simulateAction(isZh ? `已读取资产：${generatedOutput.storage.mediaAssetId}` : `Opened asset: ${generatedOutput.storage.mediaAssetId}`)}>
                <FileText size={16} />
              </button>
              <button
                type="button"
                onClick={() => simulateAction(scanStatus === 'clean'
                  ? textFor(t, `Download contract: ${generatedOutput.storage.downloadPath ?? ''}`, `下载合约：${generatedOutput.storage.downloadPath ?? ''}`)
                  : textFor(t, 'Download is gated until media scan is clean.', '媒体扫描 clean 前不可下载。'))}
              >
                <Download size={16} />
              </button>
              <button type="button" onClick={requireAuth}>
                <Share2 size={16} />
              </button>
            </div>
          </article>
        )}
        {results.map((work) => (
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
function WorkspaceTrackRow({ t, track, playTrack }: { t: Record<string, string>; track: Track; playTrack: (track: Track) => void }) {
  return (
    <div className="track-row">
      <button type="button" onClick={() => playTrack(track)}>
        <img src={track.cover} alt="" />
        <Play size={14} fill="currentColor" />
      </button>
      <div>
        <strong>{track.title}</strong>
        <span>
          {track.artist} · {track.plays} {textFor(t, 'plays', '播放')}
        </span>
      </div>
      <span>{track.duration}</span>
    </div>
  )
}
