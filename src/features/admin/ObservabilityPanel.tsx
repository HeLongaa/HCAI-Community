import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, BellRing, Download, RefreshCw, Save, Search, ShieldAlert } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { adminService } from '../../services/adminService'
import type {
  AdminObservabilityAlertDto,
  AdminObservabilityAlertDetailDto,
  AdminObservabilityIncidentMetricsDto,
  AdminObservabilityLevel,
  AdminObservabilityLogDto,
  AdminObservabilityOutcome,
  AdminObservabilityQuery,
  AdminObservabilitySloControlDto,
  AdminSloSummaryDto,
  AdminTraceDto,
} from '../../services/contracts'

const levels: AdminObservabilityLevel[] = ['debug', 'info', 'warn', 'error']
const outcomes: AdminObservabilityOutcome[] = ['success', 'client_error', 'server_error']
const formatDate = (value: string) => value ? new Date(value).toLocaleString() : '-'
const formatRate = (value: number | null | undefined) => value == null ? 'unverifiable' : `${(value * 100).toFixed(3)}%`
const formatBurn = (value: number) => `${value.toFixed(2)}x`
const asIso = (value: string) => value ? new Date(value).toISOString() : null
const oneHourFromNow = () => new Date(Date.now() + 60 * 60 * 1000).toISOString()

const downloadJson = (json: string) => {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `observability-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function ObservabilityPanel({ hasPermission, isZh, notify, initialAlertId = null, onInitialAlertHandled }: {
  hasPermission: (permission: Permission) => boolean
  isZh: boolean
  notify: (message: string) => void
  initialAlertId?: string | null
  onInitialAlertHandled?: () => void
}) {
  const canRead = hasPermission('admin:observability:read')
  const canExport = hasPermission('admin:observability:export')
  const canManage = hasPermission('admin:observability:manage')
  const [draft, setDraft] = useState<AdminObservabilityQuery>({ limit: 20 })
  const [query, setQuery] = useState<AdminObservabilityQuery>({ limit: 20 })
  const [logs, setLogs] = useState<AdminObservabilityLogDto[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([null])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<AdminObservabilityLogDto | null>(null)
  const [trace, setTrace] = useState<AdminTraceDto | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [slos, setSlos] = useState<AdminSloSummaryDto | null>(null)
  const [alerts, setAlerts] = useState<AdminObservabilityAlertDto[]>([])
  const [controls, setControls] = useState<AdminObservabilitySloControlDto[]>([])
  const [incidentMetrics, setIncidentMetrics] = useState<AdminObservabilityIncidentMetricsDto | null>(null)
  const [selectedAlert, setSelectedAlert] = useState<AdminObservabilityAlertDetailDto | null>(null)
  const [reviewDraft, setReviewDraft] = useState({ summary: '', rootCause: '', impact: '', correctiveActions: '' })
  const [sloLoading, setSloLoading] = useState(false)
  const [sloError, setSloError] = useState<string | null>(null)
  const [mutating, setMutating] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const readLogs = useCallback(async (cursor: string | null, filters = query) => {
    if (!canRead) return
    setLoading(true)
    setError(null)
    try {
      const page = await adminService.observabilityLogs({ ...filters, cursor })
      setLogs(page.items)
      setNextCursor(page.nextCursor)
      setSelectedLog((current) => page.items.find((item) => item.id === current?.id) ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [canRead, query])

  const readHealth = useCallback(async () => {
    if (!canRead) return
    setSloLoading(true)
    setSloError(null)
    try {
      const [summary, nextAlerts, nextControls, nextMetrics] = await Promise.all([
        adminService.observabilitySlos(),
        adminService.observabilityAlerts(),
        adminService.observabilitySloControls(),
        adminService.observabilityIncidentMetrics(),
      ])
      setSlos(summary)
      setAlerts(nextAlerts)
      setControls(nextControls)
      setIncidentMetrics(nextMetrics)
    } catch (cause) {
      setSloError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSloLoading(false)
    }
  }, [canRead])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void readLogs(null)
      void readHealth()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [readHealth, readLogs])

  useEffect(() => {
    if (!canRead || !initialAlertId) return
    let cancelled = false
    void adminService.observabilityAlert(initialAlertId).then((alert) => {
      if (!cancelled) setSelectedAlert(alert)
    }).catch((cause) => {
      if (!cancelled) setSloError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (!cancelled) onInitialAlertHandled?.()
    })
    return () => { cancelled = true }
  }, [canRead, initialAlertId, onInitialAlertHandled])

  const applyFilters = () => {
    const next = {
      ...draft,
      dateFrom: asIso(draft.dateFrom ?? ''),
      dateTo: asIso(draft.dateTo ?? ''),
      cursor: null,
    }
    setQuery(next)
    setCursorHistory([null])
    setSelectedLog(null)
    setTrace(null)
    void readLogs(null, next)
  }

  const inspectLog = async (id: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const detail = await adminService.observabilityLog(id)
      setSelectedLog(detail)
      setTrace(detail.traceId ? await adminService.observabilityTrace(detail.traceId) : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDetailLoading(false)
    }
  }

  const exportLogs = async () => {
    setExporting(true)
    setError(null)
    try {
      downloadJson(await adminService.exportObservabilityLogs(query))
      notify(isZh ? '可观测性日志导出已生成。' : 'Observability log export generated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setExporting(false)
    }
  }

  const evaluateSlos = async () => {
    setSloLoading(true)
    setSloError(null)
    try {
      const summary = await adminService.evaluateObservabilitySlos()
      setSlos(summary)
      const [nextAlerts, nextMetrics] = await Promise.all([
        adminService.observabilityAlerts(),
        adminService.observabilityIncidentMetrics(),
      ])
      setAlerts(nextAlerts)
      setIncidentMetrics(nextMetrics)
      notify(isZh ? 'SLO 评估已完成。' : 'SLO evaluation completed.')
    } catch (cause) {
      setSloError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSloLoading(false)
    }
  }

  const transitionAlert = async (alert: AdminObservabilityAlertDto, action: 'acknowledge' | 'silence' | 'resolve') => {
    setMutating(alert.id)
    setSloError(null)
    try {
      const until = action === 'silence' ? oneHourFromNow() : undefined
      const changed = await adminService.transitionObservabilityAlert(alert.id, action, {
        expectedVersion: alert.version,
        note: action === 'resolve' ? 'operator_resolved' : undefined,
        until,
      })
      setAlerts((current) => current.map((item) => item.id === changed.id ? changed : item))
      if (selectedAlert?.id === changed.id) setSelectedAlert(await adminService.observabilityAlert(changed.id))
      notify(isZh ? `告警已${action === 'acknowledge' ? '确认' : action === 'silence' ? '静默一小时' : '解决'}。` : `Alert ${action}d.`)
    } catch (cause) {
      setSloError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(null)
    }
  }

  const inspectAlert = async (id: string) => {
    setMutating(id)
    setSloError(null)
    try {
      setSelectedAlert(await adminService.observabilityAlert(id))
      setReviewDraft({ summary: '', rootCause: '', impact: '', correctiveActions: '' })
    } catch (cause) {
      setSloError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(null)
    }
  }

  const escalateAlert = async (alert: AdminObservabilityAlertDto) => {
    setMutating(alert.id)
    setSloError(null)
    try {
      const changed = await adminService.escalateObservabilityAlert(alert.id, { expectedVersion: alert.version, reasonCode: 'operator_escalation' })
      setAlerts((current) => current.map((item) => item.id === changed.id ? changed : item))
      setSelectedAlert(await adminService.observabilityAlert(changed.id))
      setIncidentMetrics(await adminService.observabilityIncidentMetrics())
      notify(isZh ? '告警已升级到二线值班。' : 'Alert escalated to secondary on-call.')
    } catch (cause) {
      setSloError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(null)
    }
  }

  const saveControl = async (control: AdminObservabilitySloControlDto) => {
    setMutating(control.id)
    setSloError(null)
    try {
      const changed = await adminService.updateObservabilitySloControl(control.sloId, { ...control, expectedVersion: control.version, reasonCode: 'operator_control_update' })
      setControls((current) => current.map((item) => item.sloId === changed.sloId ? changed : item))
      notify(isZh ? 'SLO 与值班配置已更新。' : 'SLO and on-call control updated.')
    } catch (cause) {
      setSloError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(null)
    }
  }

  const submitReview = async () => {
    if (!selectedAlert) return
    setMutating(selectedAlert.id)
    setSloError(null)
    try {
      const result = await adminService.reviewObservabilityIncident(selectedAlert.id, {
        expectedVersion: selectedAlert.version,
        summary: reviewDraft.summary,
        rootCause: reviewDraft.rootCause,
        impact: reviewDraft.impact,
        correctiveActions: reviewDraft.correctiveActions.split('\n').map((item) => item.trim()).filter(Boolean),
        reasonCode: 'incident_reviewed',
      })
      setAlerts((current) => current.map((item) => item.id === result.alert.id ? result.alert : item))
      setSelectedAlert(await adminService.observabilityAlert(result.alert.id))
      setIncidentMetrics(await adminService.observabilityIncidentMetrics())
      notify(isZh ? '事故复盘证据已归档。' : 'Incident review evidence archived.')
    } catch (cause) {
      setSloError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setMutating(null)
    }
  }

  const traceStart = useMemo(() => trace ? new Date(trace.startedAt).getTime() : 0, [trace])
  const traceDuration = useMemo(() => trace ? Math.max(1, new Date(trace.endedAt).getTime() - traceStart) : 1, [trace, traceStart])

  if (!canRead) return (
    <section className="panel observability-panel" data-testid="admin-observability-panel">
      <div className="empty-state"><ShieldAlert size={24} /><strong>{isZh ? '无可观测性读取权限' : 'Observability access denied'}</strong></div>
    </section>
  )

  return (
    <section className="panel observability-panel" data-testid="admin-observability-panel">
      <header className="observability-header">
        <div><small>{isZh ? '事件响应' : 'Incident response'}</small><h2>{isZh ? '日志检索与 Trace' : 'Logs and traces'}</h2></div>
        <div className="button-row">
          <button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} onClick={() => { void readLogs(cursorHistory.at(-1) ?? null); void readHealth() }} disabled={loading || sloLoading}><RefreshCw size={17} /></button>
          <button className="icon-button" type="button" title={isZh ? '导出 JSON' : 'Export JSON'} onClick={() => void exportLogs()} disabled={!canExport || exporting}><Download size={17} /></button>
        </div>
      </header>

      <form className="observability-filters" onSubmit={(event) => { event.preventDefault(); applyFilters() }}>
        <select aria-label={isZh ? '日志级别' : 'Log level'} value={draft.level ?? ''} onChange={(event) => setDraft({ ...draft, level: event.target.value as AdminObservabilityLevel || null })}><option value="">{isZh ? '全部级别' : 'All levels'}</option>{levels.map((item) => <option value={item} key={item}>{item}</option>)}</select>
        <select aria-label={isZh ? '结果' : 'Outcome'} value={draft.outcome ?? ''} onChange={(event) => setDraft({ ...draft, outcome: event.target.value as AdminObservabilityOutcome || null })}><option value="">{isZh ? '全部结果' : 'All outcomes'}</option>{outcomes.map((item) => <option value={item} key={item}>{item}</option>)}</select>
        <input aria-label={isZh ? '服务' : 'Service'} placeholder={isZh ? '服务' : 'Service'} value={draft.service ?? ''} onChange={(event) => setDraft({ ...draft, service: event.target.value || null })} />
        <input aria-label={isZh ? '模块' : 'Module'} placeholder={isZh ? '模块' : 'Module'} value={draft.module ?? ''} onChange={(event) => setDraft({ ...draft, module: event.target.value || null })} />
        <input aria-label="Request ID" placeholder="Request ID" value={draft.requestId ?? ''} onChange={(event) => setDraft({ ...draft, requestId: event.target.value || null })} />
        <input aria-label="Trace ID" placeholder="Trace ID" value={draft.traceId ?? ''} onChange={(event) => setDraft({ ...draft, traceId: event.target.value || null })} />
        <input aria-label={isZh ? '开始时间' : 'Date from'} type="datetime-local" value={draft.dateFrom ?? ''} onChange={(event) => setDraft({ ...draft, dateFrom: event.target.value || null })} />
        <input aria-label={isZh ? '结束时间' : 'Date to'} type="datetime-local" value={draft.dateTo ?? ''} onChange={(event) => setDraft({ ...draft, dateTo: event.target.value || null })} />
        <button className="ghost-button" type="button" onClick={applyFilters} disabled={loading}><Search size={16} />{isZh ? '查询' : 'Search'}</button>
      </form>

      {error && <div className="observability-error" role="alert"><strong>{isZh ? '日志暂不可用' : 'Logs unavailable'}</strong><span>{error}</span></div>}
      <div className="observability-workbench">
        <div className="observability-log-list">
          {loading && <div className="empty-state"><Activity size={22} /><strong>{isZh ? '正在读取日志' : 'Loading logs'}</strong></div>}
          {!loading && !error && logs.length === 0 && <div className="empty-state"><strong>{isZh ? '没有匹配日志' : 'No matching logs'}</strong></div>}
          {!loading && logs.map((log) => (
            <button className={`observability-log-row ${selectedLog?.id === log.id ? 'selected' : ''}`} type="button" key={log.id} onClick={() => void inspectLog(log.id)}>
              <span className={`observability-level ${log.level}`}>{log.level}</span>
              <strong>{log.operation}</strong>
              <span>{log.statusCode ?? '-'} · {log.durationMs ?? '-'}ms · {log.module}</span>
              <small>{formatDate(log.timestamp)} · {log.requestId ?? '-'}</small>
            </button>
          ))}
          <div className="observability-pagination">
            <button className="ghost-button" type="button" disabled={loading || cursorHistory.length === 1} onClick={() => {
              const previous = cursorHistory.slice(0, -1)
              setCursorHistory(previous)
              void readLogs(previous.at(-1) ?? null)
            }}>{isZh ? '上一页' : 'Previous'}</button>
            <span>{isZh ? `第 ${cursorHistory.length} 页` : `Page ${cursorHistory.length}`}</span>
            <button className="ghost-button" type="button" disabled={loading || !nextCursor} onClick={() => {
              if (!nextCursor) return
              setCursorHistory((current) => [...current, nextCursor])
              void readLogs(nextCursor)
            }}>{isZh ? '下一页' : 'Next'}</button>
          </div>
        </div>

        <aside className="observability-detail">
          {detailLoading && <div className="empty-state compact"><strong>{isZh ? '加载详情' : 'Loading detail'}</strong></div>}
          {!detailLoading && !selectedLog && <div className="empty-state"><strong>{isZh ? '选择一条日志' : 'Select a log'}</strong></div>}
          {!detailLoading && selectedLog && <>
            <div className="observability-detail-heading"><strong>{selectedLog.event}</strong><span>{selectedLog.outcome}</span></div>
            <dl className="observability-metadata">
              <div><dt>Request ID</dt><dd>{selectedLog.requestId ?? '-'}</dd></div>
              <div><dt>Trace ID</dt><dd>{selectedLog.traceId ?? '-'}</dd></div>
              <div><dt>{isZh ? '资源' : 'Resource'}</dt><dd>{selectedLog.resourceType ? `${selectedLog.resourceType}/${selectedLog.resourceId ?? '-'}` : '-'}</dd></div>
              <div><dt>{isZh ? '错误码' : 'Error code'}</dt><dd>{selectedLog.errorCode ?? '-'}</dd></div>
            </dl>
            <pre className="observability-json">{JSON.stringify(selectedLog.attributes ?? {}, null, 2)}</pre>
            <div className="observability-trace-heading"><strong>Trace timeline</strong><span>{trace?.spans.length ?? 0} spans</span></div>
            {!trace && <div className="empty-state compact"><span>{isZh ? '该日志没有可还原 Trace' : 'No trace is available for this log'}</span></div>}
            {trace?.spans.map((span) => {
              const offset = ((new Date(span.startedAt).getTime() - traceStart) / traceDuration) * 100
              const width = Math.max(2, (span.durationMs / traceDuration) * 100)
              return <div className="trace-span" key={span.id}>
                <div><strong>{span.operation}</strong><span>{span.durationMs}ms</span></div>
                <div className="trace-track"><i style={{ left: `${offset}%`, width: `${Math.min(width, 100 - offset)}%` }} /></div>
                <small>{span.service} · {span.spanId}{span.parentSpanId ? ` <- ${span.parentSpanId}` : ''}</small>
              </div>
            })}
          </>}
        </aside>
      </div>

      <div className="observability-health-header"><div><small>SLO status</small><h3>{isZh ? '服务目标与告警' : 'Service objectives and alerts'}</h3></div>{canManage && <button className="ghost-button" type="button" onClick={() => void evaluateSlos()} disabled={sloLoading}>{isZh ? '立即评估' : 'Evaluate now'}</button>}</div>
      {sloError && <div className="observability-error" role="alert"><strong>{isZh ? 'SLO 暂不可用' : 'SLO unavailable'}</strong><span>{sloError}</span></div>}
      {sloLoading && <div className="empty-state compact"><strong>{isZh ? '正在读取 SLO' : 'Loading SLO status'}</strong></div>}
      {!sloLoading && slos?.status === 'unverifiable' && <div className="observability-unverifiable"><strong>{isZh ? '无法验证' : 'Unverifiable'}</strong><span>{slos.reason}</span></div>}
      {incidentMetrics && <div className="incident-metrics" data-testid="observability-incident-metrics">
        <div><small>{isZh ? '活动事故' : 'Active incidents'}</small><strong>{incidentMetrics.active}</strong></div>
        <div><small>{isZh ? '活动严重事故' : 'Critical active'}</small><strong>{incidentMetrics.criticalActive}</strong></div>
        <div><small>{isZh ? '已升级' : 'Escalated'}</small><strong>{incidentMetrics.escalated}</strong></div>
        <div><small>MTTA</small><strong>{incidentMetrics.meanTimeToAcknowledgeMinutes == null ? '-' : `${incidentMetrics.meanTimeToAcknowledgeMinutes.toFixed(1)}m`}</strong></div>
        <div><small>MTTR</small><strong>{incidentMetrics.meanTimeToRecoveryMinutes == null ? '-' : `${incidentMetrics.meanTimeToRecoveryMinutes.toFixed(1)}m`}</strong></div>
        <div><small>{isZh ? '复盘覆盖' : 'Review coverage'}</small><strong>{incidentMetrics.reviewCoverage == null ? '-' : `${(incidentMetrics.reviewCoverage * 100).toFixed(0)}%`}</strong></div>
      </div>}
      <div className="observability-control-list" data-testid="observability-slo-controls">
        {controls.map((control) => <div className="observability-control-row" key={control.sloId}>
          <div><strong>{control.sloId}</strong><small>v{control.version} · {control.enabled ? (isZh ? '启用' : 'enabled') : (isZh ? '停用' : 'disabled')}</small></div>
          <label><span>{isZh ? '目标' : 'Target'}</span><input type="number" min="0.9" max="0.99999" step="0.0001" value={control.target} disabled={!canManage} onChange={(event) => setControls((current) => current.map((item) => item.sloId === control.sloId ? { ...item, target: Number(event.target.value) } : item))} /></label>
          <label><span>5m burn</span><input type="number" min="0.1" max="1000" step="0.1" value={control.shortWindowBurnThreshold} disabled={!canManage} onChange={(event) => setControls((current) => current.map((item) => item.sloId === control.sloId ? { ...item, shortWindowBurnThreshold: Number(event.target.value) } : item))} /></label>
          <label><span>60m burn</span><input type="number" min="0.1" max="1000" step="0.1" value={control.longWindowBurnThreshold} disabled={!canManage} onChange={(event) => setControls((current) => current.map((item) => item.sloId === control.sloId ? { ...item, longWindowBurnThreshold: Number(event.target.value) } : item))} /></label>
          <label><span>{isZh ? '主值班' : 'Primary'}</span><input value={control.primaryOnCallHandle} disabled={!canManage} onChange={(event) => setControls((current) => current.map((item) => item.sloId === control.sloId ? { ...item, primaryOnCallHandle: event.target.value } : item))} /></label>
          <label><span>{isZh ? '二线值班' : 'Secondary'}</span><input value={control.secondaryOnCallHandle ?? ''} disabled={!canManage} onChange={(event) => setControls((current) => current.map((item) => item.sloId === control.sloId ? { ...item, secondaryOnCallHandle: event.target.value || null } : item))} /></label>
          <label><span>{isZh ? '升级分钟' : 'Escalate min'}</span><input type="number" min="1" max="1440" value={control.escalationMinutes} disabled={!canManage} onChange={(event) => setControls((current) => current.map((item) => item.sloId === control.sloId ? { ...item, escalationMinutes: Number(event.target.value) } : item))} /></label>
          {canManage && <button className="icon-button" type="button" title={isZh ? '保存 SLO 配置' : 'Save SLO control'} aria-label={isZh ? '保存 SLO 配置' : 'Save SLO control'} disabled={mutating === control.id} onClick={() => void saveControl(control)}><Save size={16} /></button>}
        </div>)}
      </div>
      <div className="slo-grid">
        {(slos?.slos ?? []).map((slo) => <div className={`slo-item ${slo.firing ? 'firing' : ''}`} key={slo.id}><strong>{slo.id}</strong><span>{formatRate(slo.current)} / {formatRate(slo.target)}</span><small>5m {formatBurn(slo.shortWindowBurn)} · 60m {formatBurn(slo.longWindowBurn)}</small></div>)}
        {!sloLoading && slos?.status !== 'unverifiable' && !(slos?.slos?.length) && <div className="empty-state compact"><span>{isZh ? '暂无可计算请求' : 'No eligible requests yet'}</span></div>}
      </div>
      <div className="observability-alerts">
        {alerts.map((alert) => <div className="observability-alert-row" key={alert.id}>
          <span className={`observability-alert-state ${alert.state}`}>{alert.state}</span><strong>{alert.sloId}</strong><span>5m {formatBurn(alert.shortWindowBurn)} · 60m {formatBurn(alert.longWindowBurn)}</span><small>v{alert.version} · L{alert.escalationLevel} · {formatDate(alert.updatedAt)}</small>
          <div className="button-row"><button className="ghost-button" type="button" disabled={mutating === alert.id} onClick={() => void inspectAlert(alert.id)}>{isZh ? '详情' : 'Detail'}</button>{canManage && <><button className="ghost-button" type="button" disabled={mutating === alert.id || alert.state === 'acknowledged' || alert.state === 'resolved'} onClick={() => void transitionAlert(alert, 'acknowledge')}>{isZh ? '确认' : 'Acknowledge'}</button><button className="ghost-button" type="button" disabled={mutating === alert.id || alert.state === 'silenced' || alert.state === 'resolved'} onClick={() => void transitionAlert(alert, 'silence')}>{isZh ? '静默 1h' : 'Silence 1h'}</button><button className="icon-button" type="button" title={isZh ? '升级告警' : 'Escalate alert'} aria-label={isZh ? '升级告警' : 'Escalate alert'} disabled={mutating === alert.id || alert.state === 'resolved'} onClick={() => void escalateAlert(alert)}><BellRing size={16} /></button><button className="ghost-button" type="button" disabled={mutating === alert.id || alert.state === 'resolved'} onClick={() => void transitionAlert(alert, 'resolve')}>{isZh ? '解决' : 'Resolve'}</button></>}</div>
        </div>)}
      </div>
      {selectedAlert && <div className="observability-incident-detail" data-testid="observability-incident-detail">
        <header><div><small>{selectedAlert.id}</small><h3>{selectedAlert.sloId}</h3></div><span className={`observability-alert-state ${selectedAlert.state}`}>{selectedAlert.state}</span></header>
        <dl className="observability-metadata"><div><dt>{isZh ? '责任团队' : 'Owner'}</dt><dd>{selectedAlert.owner}</dd></div><div><dt>{isZh ? '升级目标' : 'Escalation target'}</dt><dd>{selectedAlert.escalationTarget ?? '-'}</dd></div><div><dt>{isZh ? '开始' : 'Started'}</dt><dd>{formatDate(selectedAlert.startedAt)}</dd></div><div><dt>{isZh ? '恢复' : 'Recovered'}</dt><dd>{selectedAlert.resolvedAt ? formatDate(selectedAlert.resolvedAt) : '-'}</dd></div></dl>
        <div className="observability-event-list">{selectedAlert.events.map((event) => <div key={event.id}><span>{event.eventType}</span><strong>{event.reasonCode}</strong><small>{event.actorRef} · {formatDate(event.createdAt)}</small></div>)}</div>
        {selectedAlert.review && <div className="observability-review"><strong>{isZh ? '事故复盘' : 'Incident review'}</strong><p>{selectedAlert.review.summary}</p><small>{selectedAlert.review.correctiveActions.length} actions · {selectedAlert.review.correctiveActionsHash.slice(0, 12)}</small></div>}
        {canManage && selectedAlert.state === 'resolved' && !selectedAlert.review && <form className="observability-review-form" onSubmit={(event) => { event.preventDefault(); void submitReview() }}>
          <label><span>{isZh ? '摘要' : 'Summary'}</span><textarea value={reviewDraft.summary} onChange={(event) => setReviewDraft({ ...reviewDraft, summary: event.target.value })} required minLength={10} /></label>
          <label><span>{isZh ? '根因' : 'Root cause'}</span><textarea value={reviewDraft.rootCause} onChange={(event) => setReviewDraft({ ...reviewDraft, rootCause: event.target.value })} required minLength={10} /></label>
          <label><span>{isZh ? '影响' : 'Impact'}</span><textarea value={reviewDraft.impact} onChange={(event) => setReviewDraft({ ...reviewDraft, impact: event.target.value })} required minLength={10} /></label>
          <label><span>{isZh ? '纠正行动（每行一项）' : 'Corrective actions (one per line)'}</span><textarea value={reviewDraft.correctiveActions} onChange={(event) => setReviewDraft({ ...reviewDraft, correctiveActions: event.target.value })} required minLength={3} /></label>
          <button className="primary-button" type="button" disabled={mutating === selectedAlert.id} onClick={(event) => event.currentTarget.form?.requestSubmit()}>{isZh ? '归档复盘' : 'Archive review'}</button>
        </form>}
      </div>}
    </section>
  )
}
