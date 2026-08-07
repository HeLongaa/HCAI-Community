import type { Dispatch, SetStateAction } from 'react'

import { useAsyncResource } from '../../hooks/useAsyncResource'
import { adminService } from '../../services/adminService'
import { mediaService } from '../../services/mediaService'
import type {
  AdminOperationsMetricsDto,
  AdminSecurityAlertDto,
  AdminSecurityEventDto,
  AdminSecurityEventListQuery,
  AdminSecurityIncidentDto,
  ApiMediaAsset,
  ApiMediaGovernanceConfig,
  ApiMediaScanAlert,
  ApiMediaScanJob,
  MediaAssetPurpose,
  MediaGovernancePolicyHistoryItem,
  MediaReviewQueueQuery,
  MediaScanJobHistoryPage,
} from '../../services/contracts'
import type { AuditEvent } from '../../domain/types'
import type { SecurityWorkspace } from './securityWorkspace'

type Options = {
  active: boolean
  workspace: SecurityWorkspace
  canReadAudit: boolean
  canReadQueues: boolean
  isZh: boolean
  securityQuery: AdminSecurityEventListQuery
  operationsMetricsWindow: number
  mediaStatus: NonNullable<MediaReviewQueueQuery['status']>
  mediaPurpose: MediaAssetPurpose | null
  mediaSearch: string
  selectedMediaAssetId: string | null
  mediaScanHistoryPageSize: number
  setSecurityAlerts: Dispatch<SetStateAction<AdminSecurityAlertDto[]>>
  setSecurityEvents: Dispatch<SetStateAction<AdminSecurityEventDto[]>>
  setSecurityNextCursor: Dispatch<SetStateAction<string | null>>
  setSecurityIncidents: Dispatch<SetStateAction<AdminSecurityIncidentDto[]>>
  setSelectedOpenIncidentId: Dispatch<SetStateAction<string>>
  setOperationsMetrics: Dispatch<SetStateAction<AdminOperationsMetricsDto | null>>
  setMediaRows: Dispatch<SetStateAction<ApiMediaAsset[]>>
  onMediaGovernanceConfig: (config: ApiMediaGovernanceConfig) => void
  setMediaPolicyHistory: Dispatch<SetStateAction<MediaGovernancePolicyHistoryItem[]>>
  setMediaScanHistory: Dispatch<SetStateAction<ApiMediaScanJob[]>>
  setMediaScanHistoryNextCursor: Dispatch<SetStateAction<string | null>>
  setMediaScanAlerts: Dispatch<SetStateAction<ApiMediaScanAlert[]>>
  setCallbackFailureEvents: Dispatch<SetStateAction<AuditEvent[]>>
}

export function useAdminSecurityResources({
  active,
  workspace,
  canReadAudit,
  canReadQueues,
  isZh,
  securityQuery,
  operationsMetricsWindow,
  mediaStatus,
  mediaPurpose,
  mediaSearch,
  selectedMediaAssetId,
  mediaScanHistoryPageSize,
  setSecurityAlerts,
  setSecurityEvents,
  setSecurityNextCursor,
  setSecurityIncidents,
  setSelectedOpenIncidentId,
  setOperationsMetrics,
  setMediaRows,
  onMediaGovernanceConfig,
  setMediaPolicyHistory,
  setMediaScanHistory,
  setMediaScanHistoryNextCursor,
  setMediaScanAlerts,
  setCallbackFailureEvents,
}: Options) {
  const securityAlertStatus = useAsyncResource<AdminSecurityAlertDto[] | null>({
    load: () => active && workspace === 'incidents'
      ? (canReadAudit ? adminService.securityAlerts() : Promise.resolve([]))
      : Promise.resolve(null),
    onSuccess: (alerts) => {
      if (alerts) setSecurityAlerts(alerts)
    },
    getErrorMessage: () => (isZh ? '无法读取安全告警，请确认账号具备审计读取权限。' : 'Could not load security alerts. Confirm audit read access.'),
    deps: [active, workspace, canReadAudit, isZh],
    logLabel: 'admin-service',
  })

  const securityStatus = useAsyncResource<{ events: AdminSecurityEventDto[]; nextCursor: string | null } | null>({
    load: () => active && workspace === 'incidents'
      ? (canReadAudit
          ? adminService.securityEvents(securityQuery)
          : Promise.resolve({ events: [], nextCursor: null }))
      : Promise.resolve(null),
    onSuccess: (result) => {
      if (!result) return
      setSecurityEvents(result.events)
      setSecurityNextCursor(result.nextCursor)
    },
    getErrorMessage: () => (isZh ? '无法读取安全事件，请确认账号具备审计读取权限。' : 'Could not load security events. Confirm audit read access.'),
    deps: [active, workspace, canReadAudit, isZh, securityQuery.source, securityQuery.severity, securityQuery.type],
    logLabel: 'admin-service',
  })

  const securityIncidentStatus = useAsyncResource<AdminSecurityIncidentDto[] | null>({
    load: () => active && workspace === 'incidents'
      ? (canReadAudit ? adminService.securityIncidents() : Promise.resolve([]))
      : Promise.resolve(null),
    onSuccess: (incidents) => {
      if (!incidents) return
      setSecurityIncidents(incidents)
      const open = incidents.filter((incident) => incident.status === 'open')
      setSelectedOpenIncidentId((current) => open.some((incident) => incident.id === current) ? current : open[0]?.id ?? '')
    },
    getErrorMessage: () => (isZh ? '无法读取安全事故。' : 'Could not load security incidents.'),
    deps: [active, workspace, canReadAudit, isZh],
    logLabel: 'admin-service',
  })

  const operationsMetricsStatus = useAsyncResource<AdminOperationsMetricsDto | null>({
    load: () => active && workspace === 'overview' && canReadAudit
      ? adminService.operationsMetrics(operationsMetricsWindow)
      : Promise.resolve(null),
    onSuccess: (metrics) => {
      if (metrics) setOperationsMetrics(metrics)
    },
    getErrorMessage: () => (isZh ? '无法读取运营指标，请确认账号具备审计读取权限。' : 'Could not load operations metrics. Confirm audit read access.'),
    deps: [active, workspace, canReadAudit, isZh, operationsMetricsWindow],
    logLabel: 'admin-service',
  })

  const mediaReviewStatus = useAsyncResource<ApiMediaAsset[] | null>({
    load: () => active && workspace === 'media'
      ? (canReadQueues
          ? mediaService.reviewQueue({ status: mediaStatus, purpose: mediaPurpose, search: mediaSearch, limit: 12 })
          : Promise.resolve([]))
      : Promise.resolve(null),
    onSuccess: (items) => {
      if (items) setMediaRows(items)
    },
    getErrorMessage: () => (isZh ? '无法读取媒体审核队列。' : 'Could not load media review queue.'),
    deps: [active, workspace, canReadQueues, isZh, mediaStatus, mediaPurpose, mediaSearch],
    logLabel: 'media-service',
  })

  const mediaGovernanceConfigStatus = useAsyncResource<ApiMediaGovernanceConfig | null>({
    load: () => active && workspace === 'governance' && canReadQueues
      ? mediaService.governanceConfig()
      : Promise.resolve(null),
    onSuccess: (config) => {
      if (config) onMediaGovernanceConfig(config)
    },
    getErrorMessage: () => (isZh ? '无法读取媒体治理配置。' : 'Could not load media governance config.'),
    deps: [active, workspace, canReadQueues, isZh],
    logLabel: 'media-service',
  })

  const mediaPolicyHistoryStatus = useAsyncResource<MediaGovernancePolicyHistoryItem[] | null>({
    load: () => active && workspace === 'governance'
      ? (canReadQueues ? mediaService.governancePolicyHistory() : Promise.resolve([]))
      : Promise.resolve(null),
    onSuccess: (items) => {
      if (items) setMediaPolicyHistory(items)
    },
    getErrorMessage: () => (isZh ? '无法读取媒体治理策略历史。' : 'Could not load media governance policy history.'),
    deps: [active, workspace, canReadQueues, isZh],
    logLabel: 'media-service',
  })

  const mediaScanHistoryStatus = useAsyncResource<MediaScanJobHistoryPage | null>({
    load: () => active && workspace === 'media'
      ? (canReadQueues && selectedMediaAssetId
          ? mediaService.scanJobHistoryPage(selectedMediaAssetId, { limit: mediaScanHistoryPageSize })
          : Promise.resolve({ items: [], limit: mediaScanHistoryPageSize, nextCursor: null }))
      : Promise.resolve(null),
    onSuccess: (page) => {
      if (!page) return
      setMediaScanHistory(page.items)
      setMediaScanHistoryNextCursor(page.nextCursor)
    },
    getErrorMessage: () => (isZh ? '无法读取扫描任务历史。' : 'Could not load scan job history.'),
    deps: [active, workspace, canReadQueues, isZh, selectedMediaAssetId],
    logLabel: 'media-service',
  })

  const mediaScanAlertStatus = useAsyncResource<ApiMediaScanAlert[] | null>({
    load: () => active && workspace === 'media'
      ? (canReadQueues ? mediaService.scanAlerts() : Promise.resolve([]))
      : Promise.resolve(null),
    onSuccess: (items) => {
      if (items) setMediaScanAlerts(items)
    },
    getErrorMessage: () => (isZh ? '无法读取扫描告警。' : 'Could not load scan alerts.'),
    deps: [active, workspace, canReadQueues, isZh],
    logLabel: 'media-service',
  })

  const callbackFailureStatus = useAsyncResource<AuditEvent[] | null>({
    load: () => active && workspace === 'media'
      ? (canReadQueues && canReadAudit
          ? adminService.audit({ action: 'media.scan.callback_denied', resourceType: 'media_asset', limit: 5 })
          : Promise.resolve([]))
      : Promise.resolve(null),
    onSuccess: (events) => {
      if (events) setCallbackFailureEvents(events)
    },
    getErrorMessage: () => (isZh ? '无法读取扫描回调失败事件。' : 'Could not load scanner callback failures.'),
    deps: [active, workspace, canReadAudit, canReadQueues, isZh],
    logLabel: 'admin-service',
  })

  return {
    securityAlertStatus,
    securityStatus,
    securityIncidentStatus,
    operationsMetricsStatus,
    mediaReviewStatus,
    mediaGovernanceConfigStatus,
    mediaPolicyHistoryStatus,
    mediaScanHistoryStatus,
    mediaScanAlertStatus,
    callbackFailureStatus,
  }
}
