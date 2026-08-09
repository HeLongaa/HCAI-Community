import { useEffect, useState } from 'react'

import { chatService } from '../services/chatService'
import type { ApiChatRuntimeReadiness } from '../services/contracts'

export type ChatRuntimeReadinessState = {
  status: 'signed_out' | 'loading' | 'ready' | 'error'
  data: ApiChatRuntimeReadiness | null
}

type ResolvedChatRuntimeReadinessState = ChatRuntimeReadinessState & { sessionKey: string }

export function useChatRuntimeReadiness(sessionKey: string | null): ChatRuntimeReadinessState {
  const [resolved, setResolved] = useState<ResolvedChatRuntimeReadinessState | null>(null)

  useEffect(() => {
    if (!sessionKey) return
    let active = true
    const refresh = () => chatService.getRuntimeReadiness().then((data) => {
      if (active) setResolved({ sessionKey, status: 'ready', data })
    }).catch(() => {
      if (active) setResolved({ sessionKey, status: 'error', data: null })
    })
    void refresh()
    const interval = window.setInterval(refresh, 30_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [sessionKey])

  if (!sessionKey) return { status: 'signed_out', data: null }
  if (resolved?.sessionKey !== sessionKey) return { status: 'loading', data: null }
  return { status: resolved.status, data: resolved.data }
}
