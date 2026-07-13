import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  FileText,
  FolderKanban,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Paperclip,
  RefreshCcw,
  Send,
  ShieldAlert,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import type { InspirationItem, Page, PlaygroundMode, SimulateAction, Task } from '../../domain/types'
import { isZhCopy, textFor } from '../../domain/utils'
import { isApiClientError } from '../../services/apiClient'
import { chatService } from '../../services/chatService'
import type {
  ApiChatConversation,
  ApiChatInputAsset,
  ApiChatMessage,
  ChatMode,
  ChatProductContextReference,
  ChatStreamEvent,
  ChatTurnStatus,
} from '../../services/contracts'

type ChatPageProps = {
  t: Record<string, string>
  setPage: (page: Page) => void
  openWorkspace?: (workspace: PlaygroundMode) => void
  signedIn: boolean
  requireAuth: () => void
  tasks: Task[]
  libraryItems: InspirationItem[]
  openModerationAppeal: (moderationDecisionId: string) => void
  simulateAction: SimulateAction
}

type RequestState = {
  status: 'idle' | ChatTurnStatus
  error: string | null
  moderationDecisionId: string | null
}

const modeLabels: Record<ChatMode, [string, string]> = {
  assistant: ['Assistant', '通用助手'],
  prompt_assist: ['Prompt editor', '提示词优化'],
  storyboard: ['Storyboard', '分镜脚本'],
}

const statusLabels: Record<ApiChatMessage['status'], [string, string]> = {
  complete: ['Complete', '已完成'],
  streaming: ['Generating', '生成中'],
  stopped: ['Stopped', '已停止'],
  interrupted: ['Interrupted', '连接中断'],
  failed: ['Failed', '生成失败'],
  blocked: ['Blocked', '已拦截'],
}

const terminalStatuses = new Set<ChatTurnStatus>(['completed', 'stopped', 'interrupted', 'failed', 'blocked'])

const formatDate = (value: string, isZh: boolean) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(isZh ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatBytes = (value: number) => {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

const createClientTurnId = () => {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `web-${random}`
}

const mergeUnique = <T extends { id: string }>(current: T[], incoming: T[]) => {
  const items = new Map(current.map((item) => [item.id, item]))
  incoming.forEach((item) => items.set(item.id, item))
  return [...items.values()]
}

export function ChatPage({
  t,
  setPage,
  openWorkspace,
  signedIn,
  requireAuth,
  tasks,
  libraryItems,
  openModerationAppeal,
  simulateAction,
}: ChatPageProps) {
  const isZh = isZhCopy(t)
  const [mode, setMode] = useState<ChatMode>('assistant')
  const [conversations, setConversations] = useState<ApiChatConversation[]>([])
  const [conversationCursor, setConversationCursor] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ApiChatMessage[]>([])
  const [messageCursor, setMessageCursor] = useState<string | null>(null)
  const [inputAssets, setInputAssets] = useState<ApiChatInputAsset[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem('hcaiAssetReuse')
      if (!raw) return
      const reuse = JSON.parse(raw) as { assetId?: string; workspace?: string }
      if (reuse.workspace !== 'chat' || !reuse.assetId || !inputAssets.some((asset) => asset.id === reuse.assetId)) return
      window.queueMicrotask(() => {
        setSelectedAssetIds((current) => current.includes(reuse.assetId!) ? current : [...current, reuse.assetId!].slice(0, 5))
        window.sessionStorage.removeItem('hcaiAssetReuse')
      })
    } catch { window.sessionStorage.removeItem('hcaiAssetReuse') }
  }, [inputAssets])
  const [selectedContext, setSelectedContext] = useState<ChatProductContextReference[]>([])
  const [draft, setDraft] = useState('')
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [requestState, setRequestState] = useState<RequestState>({ status: 'idle', error: null, moderationDecisionId: null })
  const abortRef = useRef<AbortController | null>(null)
  const latestMessageRef = useRef<HTMLDivElement>(null)

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId) ?? null
  const isStreaming = requestState.status === 'streaming' || requestState.status === 'queued'
  const contextOptions = useMemo(() => [
    ...tasks.map((task) => ({
      reference: { type: 'task' as const, id: String(task.id) },
      title: task.title,
      detail: textFor(t, `Task · ${task.status}`, `任务 · ${task.status}`),
    })),
    ...libraryItems.flatMap((item) => item.id == null ? [] : [{
      reference: { type: 'library_item' as const, id: String(item.id) },
      title: item.title,
      detail: textFor(t, `Library · ${item.type}`, `灵感库 · ${item.type}`),
    }]),
  ], [libraryItems, t, tasks])

  const promptStarters = isZh
    ? [
        ['优化提示词', '把下面的创意整理成可直接用于生成工具的提示词：'],
        ['任务需求', '请把我的想法整理成清晰、可验收的任务需求：'],
        ['分镜脚本', '请把这段内容拆成逐镜头分镜：'],
      ]
    : [
        ['Improve a prompt', 'Turn this idea into a production-ready generation prompt:'],
        ['Write a task brief', 'Turn my idea into a clear, testable task brief:'],
        ['Draft a storyboard', 'Break this content into a shot-by-shot storyboard:'],
      ]

  useEffect(() => {
    latestMessageRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  useEffect(() => () => abortRef.current?.abort('page_unmounted'), [])

  useEffect(() => {
    if (!signedIn) {
      setConversations([])
      setSelectedConversationId(null)
      setMessages([])
      setInputAssets([])
      return
    }
    let active = true
    setLoadingConversations(true)
    setLoadingAssets(true)
    Promise.allSettled([chatService.listConversations(), chatService.listInputAssets()]).then(([conversationResult, assetResult]) => {
      if (!active) return
      if (conversationResult.status === 'fulfilled') {
        setConversations(conversationResult.value.items)
        setConversationCursor(conversationResult.value.nextCursor)
        setSelectedConversationId((current) => current ?? conversationResult.value.items[0]?.id ?? null)
      } else {
        setRequestState({
          status: 'failed',
          error: textFor(t, 'Could not load Chat history.', '无法加载对话历史。'),
          moderationDecisionId: null,
        })
      }
      if (assetResult.status === 'fulfilled') setInputAssets(assetResult.value.items)
    }).finally(() => {
      if (!active) return
      setLoadingConversations(false)
      setLoadingAssets(false)
    })
    return () => {
      active = false
    }
  }, [signedIn, t])

  useEffect(() => {
    if (!signedIn || !selectedConversationId) {
      setMessages([])
      setMessageCursor(null)
      return
    }
    let active = true
    setLoadingMessages(true)
    setRequestState({ status: 'idle', error: null, moderationDecisionId: null })
    chatService.listMessages(selectedConversationId).then((page) => {
      if (!active) return
      setMessages(page.items)
      setMessageCursor(page.nextCursor)
    }).catch((error) => {
      console.info('[chat-messages]', error)
      if (active) setRequestState({
        status: 'failed',
        error: isApiClientError(error) ? error.message : textFor(t, 'Could not load this conversation.', '无法加载此对话。'),
        moderationDecisionId: null,
      })
    }).finally(() => {
      if (active) setLoadingMessages(false)
    })
    return () => {
      active = false
    }
  }, [selectedConversationId, signedIn, t])

  const refreshConversations = async (preferredId?: string) => {
    try {
      const page = await chatService.listConversations()
      setConversations(page.items)
      setConversationCursor(page.nextCursor)
      if (preferredId) setSelectedConversationId(preferredId)
    } catch (error) {
      console.info('[chat-conversations]', error)
    }
  }

  const createConversation = async () => {
    if (!signedIn) {
      requireAuth()
      return null
    }
    setRequestState({ status: 'idle', error: null, moderationDecisionId: null })
    try {
      const conversation = await chatService.createConversation(mode)
      setConversations((current) => [conversation, ...current])
      setSelectedConversationId(conversation.id)
      setMessages([])
      setSelectedAssetIds([])
      setSelectedContext([])
      return conversation
    } catch (error) {
      setRequestState({
        status: 'failed',
        error: isApiClientError(error) ? error.message : textFor(t, 'Could not create a conversation.', '无法创建对话。'),
        moderationDecisionId: null,
      })
      return null
    }
  }

  const loadMoreConversations = async () => {
    if (!conversationCursor) return
    setLoadingConversations(true)
    try {
      const page = await chatService.listConversations(conversationCursor)
      setConversations((current) => mergeUnique(current, page.items))
      setConversationCursor(page.nextCursor)
    } finally {
      setLoadingConversations(false)
    }
  }

  const loadMoreMessages = async () => {
    if (!selectedConversationId || !messageCursor) return
    setLoadingMessages(true)
    try {
      const page = await chatService.listMessages(selectedConversationId, messageCursor)
      setMessages((current) => mergeUnique(current, page.items).sort((left, right) => left.sequence - right.sequence))
      setMessageCursor(page.nextCursor)
    } finally {
      setLoadingMessages(false)
    }
  }

  const deleteConversation = async (conversation: ApiChatConversation) => {
    const confirmed = window.confirm(textFor(t, `Delete “${conversation.title}”? This cannot be undone.`, `删除“${conversation.title}”？此操作无法撤销。`))
    if (!confirmed) return
    setDeletingConversationId(conversation.id)
    try {
      await chatService.deleteConversation(conversation.id)
      const remaining = conversations.filter((item) => item.id !== conversation.id)
      setConversations(remaining)
      if (selectedConversationId === conversation.id) {
        setSelectedConversationId(remaining[0]?.id ?? null)
        setMessages([])
      }
      simulateAction(textFor(t, 'Conversation deleted.', '对话已删除。'))
    } catch (error) {
      setRequestState({
        status: 'failed',
        error: isApiClientError(error) ? error.message : textFor(t, 'Could not delete the conversation.', '无法删除对话。'),
        moderationDecisionId: null,
      })
    } finally {
      setDeletingConversationId(null)
    }
  }

  const applyStreamEvent = (event: ChatStreamEvent, temporaryUserId: string, temporaryAssistantId: string) => {
    if (event.event === 'turn.accepted') {
      const { turn } = event.data
      setActiveTurnId(turn.id)
      const serverUser = turn.messages.find((message) => message.role === 'user')
      const serverAssistant = turn.messages.find((message) => message.role === 'assistant')
      setMessages((current) => current.map((message) => {
        if (message.id === temporaryUserId && serverUser) return serverUser
        if (message.id === temporaryAssistantId && serverAssistant) return serverAssistant
        return message
      }))
      return
    }
    if (event.event === 'turn.snapshot') {
      const { turn } = event.data
      setActiveTurnId(turn.id)
      setMessages((current) => [
        ...current.filter((message) => message.turnId !== turn.id && message.id !== temporaryUserId && message.id !== temporaryAssistantId),
        ...turn.messages,
      ].sort((left, right) => left.sequence - right.sequence))
      return
    }
    if (event.event === 'content.delta') {
      setMessages((current) => current.map((message) => message.id === event.data.messageId
        ? { ...message, content: `${message.content}${event.data.text}`, status: 'streaming', updatedAt: new Date().toISOString() }
        : message))
      return
    }
    if (event.event === 'usage') return
    const terminal = event.data.status
    if (!terminalStatuses.has(terminal)) return
    const messageStatus: ApiChatMessage['status'] = terminal === 'completed'
      ? 'complete'
      : terminal === 'queued'
        ? 'streaming'
        : terminal
    setMessages((current) => current.map((message) => message.turnId === event.data.turnId && message.role === 'assistant'
      ? { ...message, status: messageStatus, updatedAt: new Date().toISOString() }
      : message))
    setRequestState({
      status: terminal,
      error: terminal === 'failed'
        ? textFor(t, 'The response could not be completed. You can retry the prompt.', '回复未能完成，你可以重试此提示。')
        : null,
      moderationDecisionId: event.data.moderationDecisionId ?? null,
    })
  }

  const sendMessage = async () => {
    const content = draft.trim()
    if (!content || isStreaming) return
    if (!signedIn) {
      requireAuth()
      return
    }
    const conversation = selectedConversation ?? await createConversation()
    if (!conversation) return
    const now = new Date().toISOString()
    const clientTurnId = createClientTurnId()
    const temporaryTurnId = `pending-${clientTurnId}`
    const temporaryUserId = `${temporaryTurnId}-user`
    const temporaryAssistantId = `${temporaryTurnId}-assistant`
    const nextSequence = (messages.at(-1)?.sequence ?? 0) + 1
    setMessages((current) => [...current,
      {
        id: temporaryUserId,
        turnId: temporaryTurnId,
        role: 'user',
        status: 'complete',
        sequence: nextSequence,
        content,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: temporaryAssistantId,
        turnId: temporaryTurnId,
        role: 'assistant',
        status: 'streaming',
        sequence: nextSequence + 1,
        content: '',
        createdAt: now,
        updatedAt: now,
      },
    ])
    setDraft('')
    setRequestState({ status: 'streaming', error: null, moderationDecisionId: null })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await chatService.streamTurn(conversation.id, {
        clientTurnId,
        message: content,
        mode: conversation.mode,
        parameters: { maxOutputTokens: 1024, responseFormat: 'text' },
        inputAssetIds: selectedAssetIds,
        productContext: selectedContext,
      }, (event) => applyStreamEvent(event, temporaryUserId, temporaryAssistantId), controller.signal)
      await refreshConversations(conversation.id)
    } catch (error) {
      if (controller.signal.aborted) {
        setRequestState({ status: 'interrupted', error: textFor(t, 'Connection closed. Reopen the conversation to recover its saved state.', '连接已关闭。重新打开对话可恢复已保存状态。'), moderationDecisionId: null })
      } else {
        const details = isApiClientError(error) && error.details && typeof error.details === 'object'
          ? error.details as { moderationDecisionId?: string | null }
          : null
        const blocked = isApiClientError(error) && (error.code.includes('SAFETY') || error.code.includes('REVIEW') || error.code.includes('BLOCKED'))
        setMessages((current) => current.map((message) => message.id === temporaryAssistantId
          ? { ...message, status: blocked ? 'blocked' : 'failed' }
          : message))
        setRequestState({
          status: blocked ? 'blocked' : 'failed',
          error: isApiClientError(error) ? error.message : textFor(t, 'Chat request failed.', '对话请求失败。'),
          moderationDecisionId: details?.moderationDecisionId ?? null,
        })
        await refreshConversations(conversation.id)
      }
    } finally {
      abortRef.current = null
      setActiveTurnId(null)
      setStopping(false)
    }
  }

  const stopGeneration = async () => {
    if (!activeTurnId || stopping) return
    setStopping(true)
    try {
      await chatService.stopTurn(activeTurnId)
    } catch (error) {
      setStopping(false)
      setRequestState((current) => ({
        ...current,
        error: isApiClientError(error) ? error.message : textFor(t, 'Could not stop generation.', '无法停止生成。'),
      }))
    }
  }

  const toggleAsset = (id: string) => {
    setSelectedAssetIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 5 ? [...current, id] : current)
  }

  const toggleContext = (reference: ChatProductContextReference) => {
    const key = `${reference.type}:${reference.id}`
    setSelectedContext((current) => current.some((item) => `${item.type}:${item.id}` === key)
      ? current.filter((item) => `${item.type}:${item.id}` !== key)
      : current.length < 5 ? [...current, reference] : current)
  }

  const retryLastPrompt = () => {
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    if (lastUserMessage) setDraft(lastUserMessage.content)
  }

  return (
    <section className="chat-workspace" data-testid="chat-workspace">
      <aside className="chat-history-panel" aria-label={textFor(t, 'Conversation history', '对话历史')}>
        <div className="chat-panel-heading">
          <div>
            <span className="eyebrow">{textFor(t, 'History', '历史')}</span>
            <h2>{textFor(t, 'Conversations', '对话')}</h2>
          </div>
          <button className="icon-button" type="button" title={textFor(t, 'New conversation', '新建对话')} aria-label={textFor(t, 'New conversation', '新建对话')} onClick={() => void createConversation()}>
            <MessageSquarePlus size={18} />
          </button>
        </div>
        <label className="chat-mode-field">
          <span>{textFor(t, 'New conversation mode', '新对话模式')}</span>
          <select value={mode} onChange={(event) => setMode(event.target.value as ChatMode)} disabled={isStreaming}>
            {(Object.entries(modeLabels) as Array<[ChatMode, [string, string]]>).map(([value, label]) => (
              <option value={value} key={value}>{textFor(t, label[0], label[1])}</option>
            ))}
          </select>
          <ChevronDown size={15} aria-hidden="true" />
        </label>
        <div className="chat-conversation-list">
          {loadingConversations && conversations.length === 0 && <div className="chat-loading"><LoaderCircle className="spin" size={18} /> {textFor(t, 'Loading history...', '正在加载历史...')}</div>}
          {!loadingConversations && signedIn && conversations.length === 0 && (
            <div className="chat-sidebar-empty"><History size={19} /><span>{textFor(t, 'No conversations yet.', '还没有对话。')}</span></div>
          )}
          {!signedIn && (
            <button className="chat-sidebar-empty interactive" type="button" onClick={requireAuth}>
              <History size={19} /><span>{textFor(t, 'Sign in to sync Chat history.', '登录后同步对话历史。')}</span>
            </button>
          )}
          {conversations.map((conversation) => (
            <div className={conversation.id === selectedConversationId ? 'chat-conversation-row active' : 'chat-conversation-row'} key={conversation.id}>
              <button type="button" disabled={isStreaming} onClick={() => {
                setSelectedConversationId(conversation.id)
                setMode(conversation.mode)
              }}>
                <strong>{conversation.title}</strong>
                <span>{textFor(t, modeLabels[conversation.mode][0], modeLabels[conversation.mode][1])} · {formatDate(conversation.lastMessageAt, isZh)}</span>
              </button>
              <button className="chat-delete-button" type="button" disabled={isStreaming || deletingConversationId === conversation.id} title={textFor(t, 'Delete conversation', '删除对话')} aria-label={textFor(t, `Delete ${conversation.title}`, `删除 ${conversation.title}`)} onClick={() => void deleteConversation(conversation)}>
                {deletingConversationId === conversation.id ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
              </button>
            </div>
          ))}
          {conversationCursor && <button className="chat-load-more" type="button" disabled={loadingConversations} onClick={() => void loadMoreConversations()}>{textFor(t, 'Load more', '加载更多')}</button>}
        </div>
      </aside>

      <div className="chat-main-panel">
        <header className="chat-main-header">
          <div>
            <span className="eyebrow">{textFor(t, 'Chat workspace', '对话工作台')}</span>
            <h2>{selectedConversation?.title ?? t.chatTitle}</h2>
          </div>
          <span className={`chat-connection-status ${isStreaming ? 'streaming' : ''}`}>
            {isStreaming && <LoaderCircle className="spin" size={14} />}
            {isStreaming ? textFor(t, 'Streaming', '生成中') : textFor(t, 'Mock provider', 'Mock Provider')}
          </span>
        </header>

        <div className="chat-messages" aria-live="polite" aria-busy={isStreaming}>
          {loadingMessages && <div className="chat-loading centered"><LoaderCircle className="spin" size={20} /> {textFor(t, 'Recovering messages...', '正在恢复消息...')}</div>}
          {!loadingMessages && messages.length === 0 && (
            <div className="chat-welcome">
              <Bot size={28} />
              <h3>{textFor(t, 'What are we making?', '今天想做什么？')}</h3>
              <p>{textFor(t, 'Draft prompts, scripts, task briefs, or refine an idea with saved project context.', '可以起草提示词、脚本和任务需求，也可以结合已保存的项目上下文完善想法。')}</p>
              <div className="chat-starter-list">
                {promptStarters.map(([title, text]) => (
                  <button type="button" key={title} onClick={() => setDraft(text)}>
                    <strong>{title}</strong><span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {messageCursor && <button className="chat-load-more messages" type="button" disabled={loadingMessages} onClick={() => void loadMoreMessages()}>{textFor(t, 'Load more messages', '加载更多消息')}</button>}
          {messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id} data-status={message.status}>
              <div className="chat-message-meta">
                <strong>{message.role === 'assistant' ? textFor(t, 'Assistant', '助手') : textFor(t, 'You', '你')}</strong>
                <span>{formatDate(message.createdAt, isZh)}</span>
              </div>
              <div className="chat-message-content">
                {message.content || (message.status === 'streaming'
                  ? <span className="chat-typing"><i /><i /><i /></span>
                  : <span className="muted">{textFor(t, statusLabels[message.status][0], statusLabels[message.status][1])}</span>)}
              </div>
              {message.status !== 'complete' && message.status !== 'streaming' && (
                <span className={`chat-message-status ${message.status}`}>{textFor(t, statusLabels[message.status][0], statusLabels[message.status][1])}</span>
              )}
            </article>
          ))}
          <div aria-hidden="true" ref={latestMessageRef} />
        </div>

        {(requestState.error || requestState.status === 'blocked' || requestState.status === 'interrupted') && (
          <div className={`chat-request-notice ${requestState.status}`} role="alert">
            {requestState.status === 'blocked' ? <ShieldAlert size={18} /> : <AlertTriangle size={18} />}
            <div>
              <strong>{requestState.status === 'blocked' ? textFor(t, 'Safety review', '安全审核') : textFor(t, 'Response status', '回复状态')}</strong>
              <span>{requestState.error ?? textFor(t, 'This response was stopped by the safety policy.', '此回复已被安全策略停止。')}</span>
            </div>
            {requestState.moderationDecisionId && (
              <button className="ghost-button compact" type="button" onClick={() => openModerationAppeal(requestState.moderationDecisionId as string)}>
                {textFor(t, 'Review or appeal', '查看或申诉')}
              </button>
            )}
            {(requestState.status === 'failed' || requestState.status === 'interrupted') && messages.some((message) => message.role === 'user') && (
              <button className="icon-button" type="button" title={textFor(t, 'Retry prompt', '重试提示词')} aria-label={textFor(t, 'Retry prompt', '重试提示词')} onClick={retryLastPrompt}>
                <RefreshCcw size={16} />
              </button>
            )}
          </div>
        )}

        <div className="chat-selection-summary">
          {selectedAssetIds.map((id) => {
            const asset = inputAssets.find((item) => item.id === id)
            return asset ? <span key={id}><Paperclip size={13} />{asset.fileName}<button type="button" aria-label={textFor(t, `Remove ${asset.fileName}`, `移除 ${asset.fileName}`)} onClick={() => toggleAsset(id)}><X size={12} /></button></span> : null
          })}
          {selectedContext.map((reference) => {
            const option = contextOptions.find((item) => item.reference.type === reference.type && item.reference.id === reference.id)
            return option ? <span key={`${reference.type}:${reference.id}`}><FolderKanban size={13} />{option.title}<button type="button" aria-label={textFor(t, `Remove ${option.title}`, `移除 ${option.title}`)} onClick={() => toggleContext(reference)}><X size={12} /></button></span> : null
          })}
        </div>

        <div className="chat-composer">
          <textarea
            value={draft}
            maxLength={4000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            placeholder={textFor(t, 'Ask for a prompt, script, brief, or revision...', '输入提示词、脚本、任务需求或修改意见...')}
            rows={2}
            disabled={isStreaming}
          />
          <div className="chat-composer-footer">
            <span>{draft.length}/4000</span>
            {isStreaming ? (
              <button className="primary-button danger" type="button" disabled={!activeTurnId || stopping} onClick={() => void stopGeneration()}>
                {stopping ? <LoaderCircle className="spin" size={16} /> : <Square size={15} />}
                {textFor(t, 'Stop', '停止')}
              </button>
            ) : (
              <button className="primary-button" type="button" disabled={!draft.trim()} onClick={() => void sendMessage()}>
                <Send size={17} />
                {textFor(t, 'Send', '发送')}
              </button>
            )}
          </div>
        </div>
      </div>

      <aside className="chat-context-panel" aria-label={textFor(t, 'Chat inputs', '对话输入')}>
        <div className="chat-panel-heading">
          <div>
            <span className="eyebrow">{textFor(t, 'Grounding', '上下文')}</span>
            <h2>{textFor(t, 'Inputs', '输入')}</h2>
          </div>
          <span className="chat-input-count">{selectedAssetIds.length + selectedContext.length}/10</span>
        </div>

        <details open>
          <summary><Paperclip size={16} />{textFor(t, 'Attachments', '附件')}<span>{selectedAssetIds.length}/5</span></summary>
          <div className="chat-input-list">
            {loadingAssets && <div className="chat-loading"><LoaderCircle className="spin" size={16} /> {textFor(t, 'Loading...', '加载中...')}</div>}
            {!loadingAssets && inputAssets.length === 0 && <p>{textFor(t, 'No eligible uploaded assets.', '暂无可用的已上传素材。')}</p>}
            {inputAssets.map((asset) => (
              <label key={asset.id}>
                <input type="checkbox" checked={selectedAssetIds.includes(asset.id)} disabled={!selectedAssetIds.includes(asset.id) && selectedAssetIds.length >= 5} onChange={() => toggleAsset(asset.id)} />
                <FileText size={16} />
                <span><strong>{asset.fileName}</strong><small>{formatBytes(asset.sizeBytes)} · {asset.contentType}</small></span>
              </label>
            ))}
          </div>
        </details>

        <details open>
          <summary><FolderKanban size={16} />{textFor(t, 'Product context', '产品上下文')}<span>{selectedContext.length}/5</span></summary>
          <div className="chat-input-list context">
            {contextOptions.length === 0 && <p>{textFor(t, 'No accessible tasks or library items.', '暂无可访问的任务或灵感库条目。')}</p>}
            {contextOptions.map((option) => {
              const selected = selectedContext.some((item) => item.type === option.reference.type && item.id === option.reference.id)
              return (
                <label key={`${option.reference.type}:${option.reference.id}`}>
                  <input type="checkbox" checked={selected} disabled={!selected && selectedContext.length >= 5} onChange={() => toggleContext(option.reference)} />
                  <FolderKanban size={16} />
                  <span><strong>{option.title}</strong><small>{option.detail}</small></span>
                </label>
              )
            })}
          </div>
        </details>

        <div className="chat-context-note">
          <ShieldAlert size={16} />
          <span>{textFor(t, 'Access is checked again when each message is sent.', '每次发送消息时都会重新校验访问权限。')}</span>
        </div>
        {openWorkspace && (
          <button className="ghost-button chat-workspace-link" type="button" onClick={() => openWorkspace('image')}>
            {textFor(t, 'Open image workspace', '打开图片工作区')}
          </button>
        )}
        <button className="ghost-button chat-workspace-link" type="button" onClick={() => setPage('tasks')}>
          {textFor(t, 'Open Task Plaza', '打开任务广场')}
        </button>
      </aside>
    </section>
  )
}
