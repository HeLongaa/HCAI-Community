import { useState } from 'react'

import type { AuditEvent } from '../../domain/types'
import type {
  ApiMediaAsset,
  ApiMediaScanAlert,
  ApiMediaScanJob,
  MediaAssetPurpose,
  MediaReviewQueueQuery,
} from '../../services/contracts'

export function useSecurityMediaState() {
  const [rows, setRows] = useState<ApiMediaAsset[]>([])
  const [status, setStatus] = useState<NonNullable<MediaReviewQueueQuery['status']>>('review')
  const [purpose, setPurpose] = useState<MediaAssetPurpose | null>(null)
  const [search, setSearch] = useState('')
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [scanHistory, setScanHistory] = useState<ApiMediaScanJob[]>([])
  const [scanHistoryNextCursor, setScanHistoryNextCursor] = useState<string | null>(null)
  const [scanAlerts, setScanAlerts] = useState<ApiMediaScanAlert[]>([])
  const [callbackFailureEvents, setCallbackFailureEvents] = useState<AuditEvent[]>([])

  return {
    state: {
      rows,
      status,
      purpose,
      search,
      selectedAssetId,
      scanHistory,
      scanHistoryNextCursor,
      scanAlerts,
      callbackFailureEvents,
    },
    setters: {
      setRows,
      setStatus,
      setPurpose,
      setSearch,
      setSelectedAssetId,
      setScanHistory,
      setScanHistoryNextCursor,
      setScanAlerts,
      setCallbackFailureEvents,
    },
  }
}
