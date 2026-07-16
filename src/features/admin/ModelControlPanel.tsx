import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Ban, Boxes, Download, History, KeyRound, Play, Plus, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Waypoints } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { adminService } from '../../services/adminService'
import type { ModelCatalogModelDto, ModelCapabilityModality, ModelControlStatus, ModelControlSummaryDto, ModelDeploymentDto, ModelDeploymentEnvironment, ModelGovernanceSummaryDto, ModelPromotionDto, ModelProviderDto, ModelRouteDecisionDto, ModelRoutePolicyDto, ModelRoutePreviewResult, ModelRouteRevisionDto, ModelRouteSummaryDto, ModelVersionDto, ProviderSecretRefDto } from '../../services/contracts'

type Mode = 'providers' | 'models' | 'versions' | 'routes'
type GovernanceMode = 'decisions' | 'secrets' | 'promotions'
const statuses: Array<ModelControlStatus | ''> = ['', 'draft', 'active', 'disabled', 'deprecated', 'archived']
const transitions: Record<ModelControlStatus, ModelControlStatus[]> = {
  draft: ['active', 'archived'], active: ['disabled', 'deprecated'], disabled: ['active', 'archived'], deprecated: ['disabled', 'archived'], archived: [],
}
const splitValues = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)
type ModelControlItem = ModelProviderDto | ModelCatalogModelDto | ModelVersionDto | ModelRoutePolicyDto
const itemLabel = (item: ModelControlItem) => 'name' in item ? item.name : item.versionKey
const itemKey = (item: ModelControlItem) => 'key' in item ? item.key : item.versionKey
const downloadJson = (document: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = `model-control-catalog-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function ModelControlPanel({ hasPermission, isZh, notify }: { hasPermission: (permission: Permission) => boolean; isZh: boolean; notify: (message: string) => void }) {
  const [mode, setMode] = useState<Mode>('providers')
  const [providers, setProviders] = useState<ModelProviderDto[]>([])
  const [models, setModels] = useState<ModelCatalogModelDto[]>([])
  const [versions, setVersions] = useState<ModelVersionDto[]>([])
  const [deployments, setDeployments] = useState<ModelDeploymentDto[]>([])
  const [routes, setRoutes] = useState<ModelRoutePolicyDto[]>([])
  const [routeDecisions, setRouteDecisions] = useState<ModelRouteDecisionDto[]>([])
  const [secretRefs, setSecretRefs] = useState<ProviderSecretRefDto[]>([])
  const [promotions, setPromotions] = useState<ModelPromotionDto[]>([])
  const [governanceMode, setGovernanceMode] = useState<GovernanceMode>('decisions')
  const [summary, setSummary] = useState<ModelControlSummaryDto | null>(null)
  const [routeSummary, setRouteSummary] = useState<ModelRouteSummaryDto | null>(null)
  const [governanceSummary, setGovernanceSummary] = useState<ModelGovernanceSummaryDto | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<ModelVersionDto | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<ModelRoutePolicyDto | null>(null)
  const [routeRevisions, setRouteRevisions] = useState<ModelRouteRevisionDto[]>([])
  const [routePreview, setRoutePreview] = useState<ModelRoutePreviewResult | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ModelControlStatus | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonCode, setReasonCode] = useState('catalog_reviewed')
  const [providerDraft, setProviderDraft] = useState({ key: '', name: '', websiteUrl: '', regions: '', dataProcessingRegions: '' })
  const [modelDraft, setModelDraft] = useState({ providerId: '', key: '', name: '', family: '' })
  const [versionDraft, setVersionDraft] = useState({ modelId: '', versionKey: '', contextWindow: '', maxOutputUnits: '' })
  const [capabilityDraft, setCapabilityDraft] = useState({ modality: 'image' as ModelCapabilityModality, operations: 'generate', inputMimeTypes: '', outputMimeTypes: 'image/png' })
  const [deploymentDraft, setDeploymentDraft] = useState({ key: '', environment: 'staging' as ModelDeploymentEnvironment, region: '', deploymentRef: '' })
  const [pricingDraft, setPricingDraft] = useState({ versionKey: '', modelDeploymentId: '', currency: 'USD', unit: 'request', unitPriceMicros: '', effectiveFrom: new Date().toISOString().slice(0, 16) })
  const [routeDraft, setRouteDraft] = useState({ key: '', name: '', modality: 'image' as ModelCapabilityModality, operation: 'generate', environment: 'staging' as ModelDeploymentEnvironment, region: '', audienceRoles: '', rolloutPercentage: '100', rolloutSeed: 'v1', fallbackMode: 'fail_closed' as 'fail_closed' | 'ordered', priority: '100' })
  const [routeTargets, setRouteTargets] = useState({ primary: '', backup: '' })
  const [previewDraft, setPreviewDraft] = useState({ subjectKey: 'preview-user', role: 'member', region: '' })
  const [secretDraft, setSecretDraft] = useState({ providerId: '', environment: 'staging' as ModelDeploymentEnvironment, purpose: 'inference', secretRef: '', externalVersion: '', ownerRef: '', checksumSha256: '', expiresAt: '', rotatedFromId: '' })
  const [promotionDraft, setPromotionDraft] = useState({ modelDeploymentId: '', routePolicyId: '', routePolicyRevisionId: '', providerSecretRefId: '', artifactVersion: '', rollbackVersion: '', summary: '' })
  const [promotionRevisions, setPromotionRevisions] = useState<ModelRouteRevisionDto[]>([])
  const canManage = hasPermission('admin:model-control:manage')
  const canTransition = hasPermission('admin:model-control:transition')
  const canRequestPromotion = hasPermission('admin:releases:manage')

  const refresh = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const query = { search: search || null, status: status || null, limit: 100, sort: 'updatedAt' as const, order: 'desc' as const }
      const [providerPage, modelPage, versionPage, deploymentPage, routePage, decisionPage, secretPage, promotionPage, nextSummary, nextRouteSummary, nextGovernanceSummary] = await Promise.all([
        adminService.modelProviders(mode === 'providers' ? query : { limit: 100 }),
        adminService.catalogModels(mode === 'models' ? query : { limit: 100 }),
        adminService.modelVersions(mode === 'versions' ? query : { limit: 100 }),
        adminService.modelDeployments({ limit: 100 }),
        adminService.modelRoutePolicies(mode === 'routes' ? query : { limit: 100 }),
        adminService.modelRouteDecisions({ limit: 100, sort: 'createdAt', order: 'desc' }),
        adminService.providerSecretRefs({ limit: 100, sort: 'createdAt', order: 'desc' }),
        adminService.modelPromotions({ limit: 100, order: 'desc' }),
        adminService.modelControlSummary(),
        adminService.modelRouteSummary(),
        adminService.modelGovernanceSummary(),
      ])
      setProviders(providerPage.items); setModels(modelPage.items); setVersions(versionPage.items); setDeployments(deploymentPage.items); setRoutes(routePage.items); setRouteDecisions(decisionPage.items); setSecretRefs(secretPage.items); setPromotions(promotionPage.items); setSummary(nextSummary); setRouteSummary(nextRouteSummary); setGovernanceSummary(nextGovernanceSummary)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }, [mode, search, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const items = useMemo<ModelControlItem[]>(() => mode === 'providers' ? providers : mode === 'models' ? models : mode === 'versions' ? versions : routes, [mode, models, providers, routes, versions])
  const selected = items.find((item) => item.id === selectedId) ?? null
  const changeMode = (nextMode: Mode) => {
    setMode(nextMode)
    setSelectedId(null)
    setSelectedVersion(null)
    setSelectedRoute(null)
    setRouteRevisions([])
    setRoutePreview(null)
  }
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true); setError(null)
    try { await action(); notify(success); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  const create = () => void run(async () => {
    if (mode === 'providers') {
      const created = await adminService.createModelProvider({ ...providerDraft, websiteUrl: providerDraft.websiteUrl || null, regions: splitValues(providerDraft.regions), dataProcessingRegions: splitValues(providerDraft.dataProcessingRegions) })
      setSelectedId(created.id); setProviderDraft({ key: '', name: '', websiteUrl: '', regions: '', dataProcessingRegions: '' })
    } else if (mode === 'models') {
      const created = await adminService.createCatalogModel({ ...modelDraft, family: modelDraft.family || null })
      setSelectedId(created.id); setModelDraft({ providerId: '', key: '', name: '', family: '' })
    } else if (mode === 'versions') {
      const created = await adminService.createModelVersion({ modelId: versionDraft.modelId, versionKey: versionDraft.versionKey, contextWindow: versionDraft.contextWindow ? Number(versionDraft.contextWindow) : null, maxOutputUnits: versionDraft.maxOutputUnits ? Number(versionDraft.maxOutputUnits) : null, parameterSchema: { type: 'object', additionalProperties: false } })
      setSelectedId(created.id); setSelectedVersion(created); setVersionDraft({ modelId: '', versionKey: '', contextWindow: '', maxOutputUnits: '' })
    } else {
      const created = await adminService.createModelRoutePolicy({ key: routeDraft.key, name: routeDraft.name, modality: routeDraft.modality, operation: routeDraft.operation, environment: routeDraft.environment, region: routeDraft.region || null, audienceRoles: splitValues(routeDraft.audienceRoles), rolloutPercentage: Number(routeDraft.rolloutPercentage), rolloutSeed: routeDraft.rolloutSeed, fallbackMode: routeDraft.fallbackMode, priority: Number(routeDraft.priority) })
      setSelectedId(created.id); setSelectedRoute(created)
    }
  }, isZh ? '控制面草稿已创建。' : 'Control-plane draft created.')
  const transition = (target: ModelControlStatus) => selected && void run(async () => {
    if (mode === 'routes') {
      if (!selectedRoute) return
      setSelectedRoute(await adminService.transitionModelRoutePolicy(selectedRoute.id, selectedRoute.version, target, reasonCode))
    } else await adminService.transitionModelControl(mode === 'providers' ? 'provider' : mode === 'models' ? 'model' : 'version', selected.id, selected.version, target, reasonCode)
  }, isZh ? `状态已更新为 ${target}。` : `Status changed to ${target}.`)
  const openItem = async (id: string) => {
    setSelectedId(id)
    if (mode === 'versions') {
      try { setSelectedVersion(await adminService.modelVersion(id)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    } else if (mode === 'routes') {
      try {
        const [route, revisions] = await Promise.all([adminService.modelRoutePolicy(id), adminService.modelRouteRevisions(id)])
        setSelectedRoute(route); setRouteRevisions(revisions); setRoutePreview(null)
        setRouteDraft({ key: route.key, name: route.name, modality: route.modality, operation: route.operation, environment: route.environment, region: route.region ?? '', audienceRoles: route.audienceRoles.join(', '), rolloutPercentage: String(route.rolloutPercentage), rolloutSeed: route.rolloutSeed, fallbackMode: route.fallbackMode, priority: String(route.priority) })
        setRouteTargets({ primary: route.targets.find((target) => target.role === 'primary')?.modelDeploymentId ?? '', backup: route.targets.find((target) => target.role === 'backup')?.modelDeploymentId ?? '' })
        setPreviewDraft((current) => ({ ...current, region: route.region ?? '' }))
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    }
  }
  const saveCapability = () => selectedVersion && void run(async () => {
    await adminService.upsertModelCapability(selectedVersion.id, { modality: capabilityDraft.modality, operations: splitValues(capabilityDraft.operations), inputMimeTypes: splitValues(capabilityDraft.inputMimeTypes), outputMimeTypes: splitValues(capabilityDraft.outputMimeTypes), constraints: {} })
    setSelectedVersion(await adminService.modelVersion(selectedVersion.id))
  }, isZh ? '能力定义已保存。' : 'Capability saved.')
  const createDeployment = () => selectedVersion && void run(async () => {
    await adminService.createModelDeployment({ modelVersionId: selectedVersion.id, ...deploymentDraft })
    setSelectedVersion(await adminService.modelVersion(selectedVersion.id))
    setDeploymentDraft({ key: '', environment: 'staging', region: '', deploymentRef: '' })
  }, isZh ? '部署记录已创建，流量仍关闭。' : 'Deployment created with traffic disabled.')
  const createPricing = () => selectedVersion && void run(async () => {
    await adminService.createPricingVersion({ modelVersionId: selectedVersion.id, modelDeploymentId: pricingDraft.modelDeploymentId || null, versionKey: pricingDraft.versionKey, currency: pricingDraft.currency, unit: pricingDraft.unit, unitPriceMicros: Number(pricingDraft.unitPriceMicros), effectiveFrom: new Date(pricingDraft.effectiveFrom).toISOString() })
    setSelectedVersion(await adminService.modelVersion(selectedVersion.id))
    setPricingDraft((current) => ({ ...current, versionKey: '', unitPriceMicros: '' }))
  }, isZh ? '价格版本已追加。' : 'Pricing version added.')
  const saveRoutePolicy = () => selectedRoute && void run(async () => {
    const updated = await adminService.updateModelRoutePolicy(selectedRoute.id, selectedRoute.version, { name: routeDraft.name, modality: routeDraft.modality, operation: routeDraft.operation, environment: routeDraft.environment, region: routeDraft.region || null, audienceRoles: splitValues(routeDraft.audienceRoles), rolloutPercentage: Number(routeDraft.rolloutPercentage), rolloutSeed: routeDraft.rolloutSeed, fallbackMode: routeDraft.fallbackMode, priority: Number(routeDraft.priority) })
    setSelectedRoute(updated)
  }, isZh ? '路由策略已保存。' : 'Route policy saved.')
  const saveRouteTargets = () => selectedRoute && routeTargets.primary && void run(async () => {
    const targets: Array<{ modelDeploymentId: string; role: 'primary' | 'backup'; priority: number; enabled: boolean }> = [{ modelDeploymentId: routeTargets.primary, role: 'primary', priority: 10, enabled: true }]
    if (routeTargets.backup) targets.push({ modelDeploymentId: routeTargets.backup, role: 'backup', priority: 20, enabled: true })
    const updated = await adminService.replaceModelRouteTargets(selectedRoute.id, selectedRoute.version, reasonCode, targets)
    setSelectedRoute(updated)
  }, isZh ? '主备目标已更新。' : 'Route targets updated.')
  const previewRoute = () => selectedRoute && void run(async () => {
    setRoutePreview(await adminService.previewModelRoute({ modality: selectedRoute.modality, operation: selectedRoute.operation, environment: selectedRoute.environment, region: previewDraft.region || null, subjectKey: previewDraft.subjectKey, role: previewDraft.role }))
  }, isZh ? '路由预演完成。' : 'Route preview completed.')
  const rollbackRoute = (revisionNumber: number) => selectedRoute && void run(async () => {
    const updated = await adminService.rollbackModelRoutePolicy(selectedRoute.id, selectedRoute.version, revisionNumber, reasonCode)
    setSelectedRoute(updated)
    setRouteRevisions(await adminService.modelRouteRevisions(selectedRoute.id))
  }, isZh ? '路由配置已回滚，仍需重新激活。' : 'Route configuration restored; reactivation is still required.')
  const createSecretRef = () => void run(async () => {
    await adminService.createProviderSecretRef({
      providerId: secretDraft.providerId,
      environment: secretDraft.environment,
      purpose: secretDraft.purpose,
      secretRef: secretDraft.secretRef,
      externalVersion: secretDraft.externalVersion,
      ownerRef: secretDraft.ownerRef,
      checksumSha256: secretDraft.checksumSha256,
      expiresAt: secretDraft.expiresAt ? new Date(secretDraft.expiresAt).toISOString() : null,
      rotatedFromId: secretDraft.rotatedFromId || null,
      reasonCode,
    })
    setSecretDraft((current) => ({ ...current, secretRef: '', externalVersion: '', checksumSha256: '', expiresAt: '', rotatedFromId: '' }))
  }, isZh ? 'SecretRef 元数据已追加。' : 'SecretRef metadata appended.')
  const selectPromotionPolicy = async (routePolicyId: string) => {
    setPromotionDraft((current) => ({ ...current, routePolicyId, routePolicyRevisionId: '' }))
    if (!routePolicyId) { setPromotionRevisions([]); return }
    try {
      const revisions = await adminService.modelRouteRevisions(routePolicyId)
      setPromotionRevisions(revisions)
      setPromotionDraft((current) => ({ ...current, routePolicyId, routePolicyRevisionId: revisions[0]?.id ?? '' }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const requestPromotion = () => void run(async () => {
    await adminService.requestModelPromotion({ ...promotionDraft, reasonCode })
    setPromotionDraft((current) => ({ ...current, artifactVersion: '', rollbackVersion: '', summary: '' }))
  }, isZh ? '生产提升已提交审批。' : 'Production promotion submitted for approval.')

  if (!hasPermission('admin:model-control:read')) return null
  return (
    <section className="panel model-control-panel" data-testid="model-control-panel">
      <header className="settings-panel-header">
        <div><small>{isZh ? '模型控制面' : 'Model control plane'}</small><h2>{isZh ? 'Provider、模型与路由' : 'Provider, model, and routing control'}</h2></div>
        <div className="button-row">
          <button className="icon-button" type="button" title={isZh ? '导出配置' : 'Export configuration'} onClick={() => void run(async () => downloadJson(mode === 'routes' ? await adminService.exportModelRouting() : await adminService.exportModelControlCatalog()), isZh ? '配置已导出。' : 'Configuration exported.')}><Download size={17} /></button>
          <button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} onClick={() => void refresh()} disabled={busy}><RefreshCw size={17} /></button>
        </div>
      </header>
      <div className="model-control-gate"><ShieldCheck size={18} /><strong>{isZh ? 'Provider 流量受提升审批控制' : 'Provider traffic is promotion-gated'}</strong><span>{summary?.providerTrafficEnabled ? (isZh ? '存在已启用生产流量' : 'Production traffic enabled') : (isZh ? '当前无生产流量' : 'No production traffic')} · {routeSummary?.policyCount ?? 0} {isZh ? '条路由' : 'routes'}</span></div>
      <div className="chip-row" role="tablist">
        {(['providers', 'models', 'versions', 'routes'] as Mode[]).map((item) => <button key={item} type="button" className={mode === item ? 'chip active' : 'chip'} onClick={() => changeMode(item)}>{({ providers: isZh ? 'Provider' : 'Providers', models: isZh ? '模型' : 'Models', versions: isZh ? '版本' : 'Versions', routes: isZh ? '路由' : 'Routing' })[item]}</button>)}
      </div>
      <div className="model-control-toolbar">
        <label><span>{isZh ? '搜索' : 'Search'}</span><div className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} /></div></label>
        <label><span>{isZh ? '状态' : 'Status'}</span><select value={status} onChange={(event) => setStatus(event.target.value as ModelControlStatus | '')}>{statuses.map((item) => <option value={item} key={item || 'all'}>{item || (isZh ? '全部' : 'All')}</option>)}</select></label>
        <label><span>{isZh ? '原因代码' : 'Reason code'}</span><input value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></label>
      </div>
      {canManage && <div className="model-control-create">
        {mode === 'providers' && <><input aria-label="Provider key" placeholder="provider-key" value={providerDraft.key} onChange={(event) => setProviderDraft({ ...providerDraft, key: event.target.value })} /><input aria-label="Provider name" placeholder={isZh ? '名称' : 'Name'} value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} /><input aria-label="Provider website" placeholder="https://" value={providerDraft.websiteUrl} onChange={(event) => setProviderDraft({ ...providerDraft, websiteUrl: event.target.value })} /></>}
        {mode === 'models' && <><select aria-label="Provider" value={modelDraft.providerId} onChange={(event) => setModelDraft({ ...modelDraft, providerId: event.target.value })}><option value="">Provider</option>{providers.filter((item) => item.status !== 'archived').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><input aria-label="Model key" placeholder="model-key" value={modelDraft.key} onChange={(event) => setModelDraft({ ...modelDraft, key: event.target.value })} /><input aria-label="Model name" placeholder={isZh ? '模型名称' : 'Model name'} value={modelDraft.name} onChange={(event) => setModelDraft({ ...modelDraft, name: event.target.value })} /></>}
        {mode === 'versions' && <><select aria-label="Model" value={versionDraft.modelId} onChange={(event) => setVersionDraft({ ...versionDraft, modelId: event.target.value })}><option value="">{isZh ? '选择模型' : 'Select model'}</option>{models.filter((item) => item.status !== 'archived').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><input aria-label="Version key" placeholder="version-key" value={versionDraft.versionKey} onChange={(event) => setVersionDraft({ ...versionDraft, versionKey: event.target.value })} /><input aria-label="Context window" type="number" placeholder={isZh ? '上下文' : 'Context'} value={versionDraft.contextWindow} onChange={(event) => setVersionDraft({ ...versionDraft, contextWindow: event.target.value })} /></>}
        {mode === 'routes' && <><input aria-label="Route key" placeholder="image-staging" value={routeDraft.key} onChange={(event) => setRouteDraft({ ...routeDraft, key: event.target.value })} /><input aria-label="Route name" placeholder={isZh ? '策略名称' : 'Policy name'} value={routeDraft.name} onChange={(event) => setRouteDraft({ ...routeDraft, name: event.target.value })} /><select aria-label="Route modality" value={routeDraft.modality} onChange={(event) => setRouteDraft({ ...routeDraft, modality: event.target.value as ModelCapabilityModality })}>{(['image', 'chat', 'video', 'music'] as ModelCapabilityModality[]).map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Route environment" value={routeDraft.environment} onChange={(event) => setRouteDraft({ ...routeDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select></>}
        <button className="primary-button" type="button" onClick={create} disabled={busy}><Plus size={17} />{isZh ? '新建草稿' : 'New draft'}</button>
      </div>}
      {error && <div className="inline-alert">{error}</div>}
      <div className="model-control-layout">
        <div className="model-control-list">{items.map((item) => <button type="button" className={selectedId === item.id ? 'model-control-row active' : 'model-control-row'} key={item.id} onClick={() => void openItem(item.id)}><span><strong>{itemLabel(item)}</strong><small>{itemKey(item)}</small></span><em data-status={item.status}>{item.status}</em></button>)}{!items.length && <div className="empty-state">{isZh ? '暂无记录' : 'No records'}</div>}</div>
        <div className="model-control-detail">{selected ? <>
          <header><div><small>{mode.slice(0, -1)}</small><h3>{itemLabel(selected)}</h3></div><span>v{selected.version}</span></header>
          {canTransition && <div className="button-row">{transitions[selected.status].map((target) => <button className="ghost-button" type="button" key={target} onClick={() => transition(target)}>{target === 'archived' ? <Archive size={16} /> : target === 'disabled' ? <Ban size={16} /> : target === 'active' ? <RotateCcw size={16} /> : <Boxes size={16} />}{target}</button>)}</div>}
          {mode === 'versions' && selectedVersion && <div className="model-version-tools">
            <div className="model-tool-section"><h4>{isZh ? '能力' : 'Capability'}</h4><select value={capabilityDraft.modality} onChange={(event) => setCapabilityDraft({ ...capabilityDraft, modality: event.target.value as ModelCapabilityModality })}>{(['image', 'chat', 'video', 'music'] as ModelCapabilityModality[]).map((item) => <option key={item}>{item}</option>)}</select><input value={capabilityDraft.operations} onChange={(event) => setCapabilityDraft({ ...capabilityDraft, operations: event.target.value })} placeholder="generate, edit" /><button className="icon-button" type="button" title={isZh ? '保存能力' : 'Save capability'} onClick={saveCapability} disabled={selectedVersion.status !== 'draft'}><Save size={17} /></button></div>
            <div className="model-tool-section"><h4>{isZh ? '部署' : 'Deployment'}</h4><select value={deploymentDraft.environment} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select><input value={deploymentDraft.key} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, key: event.target.value })} placeholder="deployment-key" /><input value={deploymentDraft.region} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, region: event.target.value })} placeholder="region" /><input value={deploymentDraft.deploymentRef} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, deploymentRef: event.target.value })} placeholder="deployment-ref" /><button className="icon-button" type="button" title={isZh ? '新建部署' : 'Create deployment'} onClick={createDeployment}><Plus size={17} /></button></div>
            <div className="model-tool-section"><h4>{isZh ? '价格' : 'Pricing'}</h4><input value={pricingDraft.versionKey} onChange={(event) => setPricingDraft({ ...pricingDraft, versionKey: event.target.value })} placeholder="price-version" /><input value={pricingDraft.unitPriceMicros} onChange={(event) => setPricingDraft({ ...pricingDraft, unitPriceMicros: event.target.value })} type="number" placeholder="micros" /><select value={pricingDraft.modelDeploymentId} onChange={(event) => setPricingDraft({ ...pricingDraft, modelDeploymentId: event.target.value })}><option value="">{isZh ? '全局' : 'Global'}</option>{selectedVersion.deployments?.map((item) => <option value={item.id} key={item.id}>{item.key}</option>)}</select><button className="icon-button" type="button" title={isZh ? '追加价格' : 'Add pricing'} onClick={createPricing}><Plus size={17} /></button></div>
            <div className="model-version-counts"><span>{selectedVersion.capabilities?.length ?? 0} capabilities</span><span>{selectedVersion.deployments?.length ?? 0} deployments</span><span>{selectedVersion.prices?.length ?? 0} prices</span></div>
          </div>}
          {mode === 'routes' && selectedRoute && <div className="model-version-tools model-route-tools" data-testid="model-route-tools">
            <div className="model-tool-section"><h4>{isZh ? '策略' : 'Policy'}</h4><input aria-label="Route operation" value={routeDraft.operation} onChange={(event) => setRouteDraft({ ...routeDraft, operation: event.target.value })} /><input aria-label="Route region" placeholder={isZh ? '全部区域' : 'Any region'} value={routeDraft.region} onChange={(event) => setRouteDraft({ ...routeDraft, region: event.target.value })} /><input aria-label="Route roles" placeholder="member, creator" value={routeDraft.audienceRoles} onChange={(event) => setRouteDraft({ ...routeDraft, audienceRoles: event.target.value })} /><button className="icon-button" type="button" title={isZh ? '保存策略' : 'Save policy'} onClick={saveRoutePolicy} disabled={!canManage || ['active', 'archived'].includes(selectedRoute.status)}><Save size={17} /></button></div>
            <div className="model-tool-section route-policy-controls"><h4>{isZh ? '灰度' : 'Rollout'}</h4><input aria-label="Rollout percentage" type="number" min="0" max="100" value={routeDraft.rolloutPercentage} onChange={(event) => setRouteDraft({ ...routeDraft, rolloutPercentage: event.target.value })} /><input aria-label="Rollout seed" value={routeDraft.rolloutSeed} onChange={(event) => setRouteDraft({ ...routeDraft, rolloutSeed: event.target.value })} /><select aria-label="Fallback mode" value={routeDraft.fallbackMode} onChange={(event) => setRouteDraft({ ...routeDraft, fallbackMode: event.target.value as 'fail_closed' | 'ordered' })}><option value="fail_closed">fail_closed</option><option value="ordered">ordered</option></select><input aria-label="Route priority" type="number" min="0" value={routeDraft.priority} onChange={(event) => setRouteDraft({ ...routeDraft, priority: event.target.value })} /></div>
            <div className="model-tool-section"><h4>{isZh ? '主备目标' : 'Targets'}</h4><select aria-label="Primary deployment" value={routeTargets.primary} onChange={(event) => setRouteTargets({ ...routeTargets, primary: event.target.value })}><option value="">{isZh ? '主部署' : 'Primary deployment'}</option>{deployments.filter((item) => item.environment === selectedRoute.environment).map((item) => <option value={item.id} key={item.id}>{item.key}</option>)}</select><select aria-label="Backup deployment" value={routeTargets.backup} onChange={(event) => setRouteTargets({ ...routeTargets, backup: event.target.value })}><option value="">{isZh ? '无备份' : 'No backup'}</option>{deployments.filter((item) => item.environment === selectedRoute.environment && item.id !== routeTargets.primary).map((item) => <option value={item.id} key={item.id}>{item.key}</option>)}</select><button className="icon-button" type="button" title={isZh ? '保存主备目标' : 'Save route targets'} onClick={saveRouteTargets} disabled={!canManage || !routeTargets.primary || ['active', 'archived'].includes(selectedRoute.status)}><Waypoints size={17} /></button></div>
            <div className="model-tool-section"><h4>{isZh ? '预演' : 'Preview'}</h4><input aria-label="Preview subject" value={previewDraft.subjectKey} onChange={(event) => setPreviewDraft({ ...previewDraft, subjectKey: event.target.value })} /><select aria-label="Preview role" value={previewDraft.role} onChange={(event) => setPreviewDraft({ ...previewDraft, role: event.target.value })}>{['member', 'creator', 'publisher', 'moderator', 'admin'].map((item) => <option key={item}>{item}</option>)}</select><input aria-label="Preview region" value={previewDraft.region} onChange={(event) => setPreviewDraft({ ...previewDraft, region: event.target.value })} /><button className="icon-button" type="button" title={isZh ? '运行路由预演' : 'Run route preview'} onClick={previewRoute}><Play size={17} /></button></div>
            {routePreview && <div className="model-route-preview" data-testid="model-route-preview"><strong>{routePreview.status}</strong><span>{routePreview.reasonCode}</span><small>{routePreview.selected?.deploymentKey ?? (isZh ? '未选择部署' : 'No deployment selected')}</small></div>}
            <div className="model-route-history"><h4><History size={16} />{isZh ? '修订历史' : 'Revision history'}</h4>{routeRevisions.slice(0, 6).map((revision) => <div key={revision.id}><span>r{revision.revisionNumber} · {revision.reasonCode}</span>{canTransition && !['active', 'archived'].includes(selectedRoute.status) && <button className="icon-button" type="button" title={isZh ? `回滚到 r${revision.revisionNumber}` : `Restore r${revision.revisionNumber}`} onClick={() => rollbackRoute(revision.revisionNumber)}><RotateCcw size={15} /></button>}</div>)}</div>
            <div className="model-version-counts"><span>{selectedRoute.rolloutPercentage}% rollout</span><span>{selectedRoute.fallbackMode}</span><span>{selectedRoute.targets.length} targets</span><span>{selectedRoute.revisionCount} revisions</span></div>
          </div>}
        </> : <div className="empty-state">{isZh ? '选择一条记录' : 'Select a record'}</div>}</div>
      </div>
      <section className="model-governance-workbench" data-testid="model-governance-workbench">
        <header className="settings-panel-header"><div><small>MODEL-05</small><h3>{isZh ? '决策、凭证与环境提升' : 'Decisions, secrets, and promotion'}</h3><small>{governanceSummary?.decisionCount ?? 0} decisions · {governanceSummary?.secretRefCount ?? 0} SecretRefs · {governanceSummary?.promotionCount ?? 0} promotions</small></div><button className="icon-button" type="button" title={isZh ? '导出治理证据' : 'Export governance evidence'} onClick={() => void run(async () => downloadJson(await adminService.exportModelGovernance()), isZh ? '治理证据已导出。' : 'Governance evidence exported.')}><Download size={17} /></button></header>
        <div className="chip-row" role="tablist">{(['decisions', 'secrets', 'promotions'] as GovernanceMode[]).map((item) => <button key={item} type="button" className={governanceMode === item ? 'chip active' : 'chip'} onClick={() => setGovernanceMode(item)}>{({ decisions: isZh ? '路由决策' : 'Route decisions', secrets: 'SecretRef', promotions: isZh ? '环境提升' : 'Promotions' })[item]}</button>)}</div>
        {governanceMode === 'secrets' && canManage && <div className="model-governance-form">
          <select aria-label="SecretRef Provider" value={secretDraft.providerId} onChange={(event) => setSecretDraft({ ...secretDraft, providerId: event.target.value })}><option value="">Provider</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
          <select aria-label="SecretRef environment" value={secretDraft.environment} onChange={(event) => setSecretDraft({ ...secretDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select>
          <input aria-label="SecretRef purpose" value={secretDraft.purpose} onChange={(event) => setSecretDraft({ ...secretDraft, purpose: event.target.value })} placeholder="inference" />
          <input aria-label="SecretRef reference" value={secretDraft.secretRef} onChange={(event) => setSecretDraft({ ...secretDraft, secretRef: event.target.value })} placeholder="secret://vault/path" />
          <input aria-label="SecretRef external version" value={secretDraft.externalVersion} onChange={(event) => setSecretDraft({ ...secretDraft, externalVersion: event.target.value })} placeholder="external-version" />
          <input aria-label="SecretRef owner" value={secretDraft.ownerRef} onChange={(event) => setSecretDraft({ ...secretDraft, ownerRef: event.target.value })} placeholder="owner-ref" />
          <input aria-label="SecretRef checksum" value={secretDraft.checksumSha256} onChange={(event) => setSecretDraft({ ...secretDraft, checksumSha256: event.target.value })} placeholder="sha256" />
          <input aria-label="SecretRef expiry" type="datetime-local" value={secretDraft.expiresAt} onChange={(event) => setSecretDraft({ ...secretDraft, expiresAt: event.target.value })} />
          <select aria-label="SecretRef rotation source" value={secretDraft.rotatedFromId} onChange={(event) => setSecretDraft({ ...secretDraft, rotatedFromId: event.target.value })}><option value="">{isZh ? '非轮换' : 'Not a rotation'}</option>{secretRefs.filter((item) => item.providerId === secretDraft.providerId && item.environment === secretDraft.environment && item.purpose === secretDraft.purpose).map((item) => <option value={item.id} key={item.id}>{item.externalVersion}</option>)}</select>
          <button className="primary-button" type="button" onClick={createSecretRef} disabled={busy}><KeyRound size={17} />{isZh ? '追加引用' : 'Append reference'}</button>
        </div>}
        {governanceMode === 'promotions' && canRequestPromotion && <div className="model-governance-form">
          <select aria-label="Promotion deployment" value={promotionDraft.modelDeploymentId} onChange={(event) => setPromotionDraft({ ...promotionDraft, modelDeploymentId: event.target.value })}><option value="">{isZh ? '生产部署' : 'Production deployment'}</option>{deployments.filter((item) => item.environment === 'production').map((item) => <option value={item.id} key={item.id}>{item.key}</option>)}</select>
          <select aria-label="Promotion route policy" value={promotionDraft.routePolicyId} onChange={(event) => void selectPromotionPolicy(event.target.value)}><option value="">{isZh ? '生产路由' : 'Production route'}</option>{routes.filter((item) => item.environment === 'production' && item.status === 'active').map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
          <select aria-label="Promotion route revision" value={promotionDraft.routePolicyRevisionId} onChange={(event) => setPromotionDraft({ ...promotionDraft, routePolicyRevisionId: event.target.value })}><option value="">{isZh ? '路由修订' : 'Route revision'}</option>{promotionRevisions.map((item) => <option value={item.id} key={item.id}>r{item.revisionNumber} · {item.reasonCode}</option>)}</select>
          <select aria-label="Promotion SecretRef" value={promotionDraft.providerSecretRefId} onChange={(event) => setPromotionDraft({ ...promotionDraft, providerSecretRefId: event.target.value })}><option value="">SecretRef</option>{secretRefs.filter((item) => item.environment === 'production').map((item) => <option value={item.id} key={item.id}>{item.purpose} · {item.externalVersion}</option>)}</select>
          <input aria-label="Promotion artifact version" value={promotionDraft.artifactVersion} onChange={(event) => setPromotionDraft({ ...promotionDraft, artifactVersion: event.target.value })} placeholder="artifact-version" />
          <input aria-label="Promotion rollback version" value={promotionDraft.rollbackVersion} onChange={(event) => setPromotionDraft({ ...promotionDraft, rollbackVersion: event.target.value })} placeholder="rollback-version" />
          <input aria-label="Promotion summary" value={promotionDraft.summary} onChange={(event) => setPromotionDraft({ ...promotionDraft, summary: event.target.value })} placeholder={isZh ? '提升摘要' : 'Promotion summary'} />
          <button className="primary-button" type="button" onClick={requestPromotion} disabled={busy}><ShieldCheck size={17} />{isZh ? '提交审批' : 'Request approval'}</button>
        </div>}
        <div className="model-governance-list">
          {governanceMode === 'decisions' && routeDecisions.map((item) => <div key={item.id}><span><strong>{item.status}</strong><small>{item.modality} · {item.environment} · {item.reasonCode}</small></span><code>{item.subjectHash.slice(0, 12)}</code><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}
          {governanceMode === 'secrets' && secretRefs.map((item) => <div key={item.id}><span><strong>{item.purpose} · {item.externalVersion}</strong><small>{item.secretRef} · {item.environment}</small></span><code>{item.ownerRef}</code><time>{item.expiresAt ? new Date(item.expiresAt).toLocaleString() : 'no expiry'}</time></div>)}
          {governanceMode === 'promotions' && promotions.map((item) => <div key={item.id}><span><strong>{item.releaseChange.status}</strong><small>{item.modelDeploymentId} · {item.releaseChange.artifactVersion}</small></span><code>{item.releaseChangeId}</code><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}
          {((governanceMode === 'decisions' && !routeDecisions.length) || (governanceMode === 'secrets' && !secretRefs.length) || (governanceMode === 'promotions' && !promotions.length)) && <div className="empty-state">{isZh ? '暂无记录' : 'No records'}</div>}
        </div>
      </section>
    </section>
  )
}
