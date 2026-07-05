import { useState } from 'react'
import type { LedgerEntry, Locale, SimulateAction } from '../domain/types'
import { pointsLedger } from '../data/mockData'
import { pointsService } from '../services/pointsService'
import type { ApiPointsSummary } from '../services/contracts'
import { useAsyncResource } from './useAsyncResource'

export function useAppFeedback(locale: Locale, accountKey = 'anonymous') {
  const [ledgerItems, setLedgerItems] = useState<LedgerEntry[]>(pointsLedger)
  const [pointsSummary, setPointsSummary] = useState<ApiPointsSummary | null>(null)
  const pointsStatus = useAsyncResource<{ entries: LedgerEntry[]; summary: ApiPointsSummary | null }>({
    load: () => pointsService.ledger(),
    onSuccess: ({ entries, summary }) => {
      if (entries.length > 0) setLedgerItems(entries)
      setPointsSummary(summary)
    },
    getErrorMessage: () => (locale === 'zh' ? '无法同步积分流水，当前显示本地演示数据。' : 'Could not sync points ledger. Showing local demo data.'),
    deps: [locale, accountKey],
    logLabel: 'points-service',
  })

  const pushToast = (message: string) => {
    console.info('[simulation]', message)
  }

  const pushLedger = (description: string, delta: string) => {
    setLedgerItems((current) => [[locale === 'zh' ? '刚刚' : 'Just now', description, delta, locale === 'zh' ? '实时' : 'Live'], ...current])
  }

  const simulateAction: SimulateAction = (message, ledger) => {
    pushToast(message)
    if (ledger) {
      pushLedger(ledger.description, ledger.delta)
    }
  }

  return {
    ledgerItems,
    pointsSummary,
    pointsStatus,
    pushToast,
    pushLedger,
    simulateAction,
  }
}
