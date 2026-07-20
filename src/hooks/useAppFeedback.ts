import { useCallback, useEffect, useRef, useState } from 'react'
import type { LedgerEntry, Locale, SimulateAction } from '../domain/types'
import { pointsLedger } from '../data/mockData'
import { pointsService } from '../services/pointsService'
import type { ApiPointsSummary } from '../services/contracts'
import { useAsyncResource } from './useAsyncResource'

export type AppToastTone = 'info' | 'success' | 'warning' | 'error'
export type AppToast = { id: number; message: string; tone: AppToastTone }

export function useAppFeedback(locale: Locale, accountKey = 'anonymous') {
  const [ledgerItems, setLedgerItems] = useState<LedgerEntry[]>(pointsLedger)
  const [pointsSummary, setPointsSummary] = useState<ApiPointsSummary | null>(null)
  const [toasts, setToasts] = useState<AppToast[]>([])
  const nextToastId = useRef(0)
  const toastTimers = useRef(new Map<number, number>())
  const pointsStatus = useAsyncResource<{ entries: LedgerEntry[]; summary: ApiPointsSummary | null }>({
    load: () => pointsService.ledger(),
    onSuccess: ({ entries, summary }) => {
      if (entries.length > 0) setLedgerItems(entries)
      setPointsSummary(summary)
    },
    getErrorMessage: () => (locale === 'zh' ? '积分 API 暂不可用；未显示本地替代数据。' : 'The points API is unavailable; no local substitute is shown.'),
    deps: [locale, accountKey],
    logLabel: 'points-service',
  })

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id)
    if (timer != null) window.clearTimeout(timer)
    toastTimers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback((message: string, tone: AppToastTone = 'info') => {
    const normalized = message.trim()
    if (!normalized) return
    const id = ++nextToastId.current
    setToasts((current) => [...current.slice(-3), { id, message: normalized, tone }])
    toastTimers.current.set(id, window.setTimeout(() => dismissToast(id), tone === 'error' ? 8_000 : 5_000))
  }, [dismissToast])

  useEffect(() => () => {
    for (const timer of toastTimers.current.values()) window.clearTimeout(timer)
    toastTimers.current.clear()
  }, [])

  const pushLedger = useCallback((description: string, delta: string) => {
    setLedgerItems((current) => [[locale === 'zh' ? '刚刚' : 'Just now', description, delta, locale === 'zh' ? '实时' : 'Live'], ...current])
  }, [locale])

  const simulateAction: SimulateAction = (message) => {
    pushToast(message)
  }

  return {
    ledgerItems,
    pointsSummary,
    pointsStatus,
    toasts,
    pushToast,
    pushLedger,
    simulateAction,
    dismissToast,
  }
}
