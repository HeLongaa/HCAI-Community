import { useState } from 'react'
import type { LedgerEntry, Locale, SimulateAction } from '../domain/types'
import { pointsLedger } from '../data/mockData'

export function useAppFeedback(locale: Locale) {
  const [ledgerItems, setLedgerItems] = useState<LedgerEntry[]>(pointsLedger)

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
    pushToast,
    pushLedger,
    simulateAction,
  }
}
