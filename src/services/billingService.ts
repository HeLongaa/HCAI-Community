import { api, withQuery } from './apiClient'
import type { PersonalBillingEntry, PersonalBillingQuery, PersonalBillingSummary } from './contracts'

export const billingService = {
  summary: () => api.get<PersonalBillingSummary>('/billing/summary'),
  async ledger(query?: PersonalBillingQuery) {
    const envelope = await api.getEnvelope<PersonalBillingEntry[]>(withQuery('/billing/ledger', query))
    return {
      items: envelope.data,
      nextCursor: (envelope.meta as { pagination?: { nextCursor?: string | null } } | undefined)?.pagination?.nextCursor ?? null,
    }
  },
  exportCsv: (query?: PersonalBillingQuery) => api.text(withQuery('/billing/ledger/export', { ...query, format: 'csv' })),
}
