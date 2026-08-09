import { useState } from 'react'

import type { ApiMediaGovernanceConfig, MediaGovernancePolicyHistoryItem } from '../../services/contracts'

export function useSecurityGovernanceState<TDraft extends object>(initialDraft: TDraft) {
  const [config, setConfig] = useState<ApiMediaGovernanceConfig | null>(null)
  const [draft, setDraft] = useState<TDraft>(initialDraft)
  const [history, setHistory] = useState<MediaGovernancePolicyHistoryItem[]>([])
  const [expandedHistoryEventIds, setExpandedHistoryEventIds] = useState<Record<string, boolean>>({})

  return {
    state: { config, draft, history, expandedHistoryEventIds },
    setters: { setConfig, setDraft, setHistory, setExpandedHistoryEventIds },
  }
}
