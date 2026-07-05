import { api, withQuery } from './apiClient'
import type { LedgerEntry } from '../domain/types'
import type { ApiLedgerEntry, ApiPointsSummary, PointsLedgerQuery } from './contracts'

const toLedgerEntry = (entry: ApiLedgerEntry): LedgerEntry => [
  entry.occurredAtLabel,
  entry.description,
  typeof entry.delta === 'number' && entry.delta > 0 ? `+${entry.delta}` : String(entry.delta),
  String(entry.balanceAfter),
]

export const pointsService = {
  async ledger(query?: PointsLedgerQuery) {
    const envelope = await api.getEnvelope<ApiLedgerEntry[]>(withQuery('/points/ledger', query))
    return {
      entries: envelope.data.map(toLedgerEntry),
      summary: (envelope.meta as { summary?: ApiPointsSummary } | undefined)?.summary ?? null,
    }
  },
}
