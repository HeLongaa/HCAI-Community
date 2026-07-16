import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Ban, Boxes, Download, Plus, RefreshCw, RotateCcw, Save, Search, ShieldCheck } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { adminService } from '../../services/adminService'
import type { ModelCatalogModelDto, ModelCapabilityModality, ModelControlStatus, ModelControlSummaryDto, ModelDeploymentEnvironment, ModelProviderDto, ModelVersionDto } from '../../services/contracts'

type Mode = 'providers' | 'models' | 'versions'
const statuses: Array<ModelControlStatus | ''> = ['', 'draft', 'active', 'disabled', 'deprecated', 'archived']
const transitions: Record<ModelControlStatus, ModelControlStatus[]> = {
  draft: ['active', 'archived'], active: ['disabled', 'deprecated'], disabled: ['active', 'archived'], deprecated: ['disabled', 'archived'], archived: [],
}
const splitValues = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)
const itemLabel = (item: ModelProviderDto | ModelCatalogModelDto | ModelVersionDto) => 'name' in item ? item.name : item.versionKey
const itemKey = (item: ModelProviderDto | ModelCatalogModelDto | ModelVersionDto) => 'key' in item ? item.key : item.versionKey
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
  const [summary, setSummary] = useState<ModelControlSummaryDto | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<ModelVersionDto | null>(null)
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
  const canManage = hasPermission('admin:model-control:manage')
  const canTransition = hasPermission('admin:model-control:transition')

  const refresh = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const query = { search: search || null, status: status || null, limit: 100, sort: 'updatedAt' as const, order: 'desc' as const }
      const [providerPage, modelPage, versionPage, nextSummary] = await Promise.all([
        adminService.modelProviders(mode === 'providers' ? query : { limit: 100 }),
        adminService.catalogModels(mode === 'models' ? query : { limit: 100 }),
        adminService.modelVersions(mode === 'versions' ? query : { limit: 100 }),
        adminService.modelControlSummary(),
      ])
      setProviders(providerPage.items); setModels(modelPage.items); setVersions(versionPage.items); setSummary(nextSummary)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }, [mode, search, status])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  const items = useMemo(() => mode === 'providers' ? providers : mode === 'models' ? models : versions, [mode, models, providers, versions])
  const selected = items.find((item) => item.id === selectedId) ?? null
  const changeMode = (nextMode: Mode) => {
    setMode(nextMode)
    setSelectedId(null)
    setSelectedVersion(null)
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
    } else {
      const created = await adminService.createModelVersion({ modelId: versionDraft.modelId, versionKey: versionDraft.versionKey, contextWindow: versionDraft.contextWindow ? Number(versionDraft.contextWindow) : null, maxOutputUnits: versionDraft.maxOutputUnits ? Number(versionDraft.maxOutputUnits) : null, parameterSchema: { type: 'object', additionalProperties: false } })
      setSelectedId(created.id); setSelectedVersion(created); setVersionDraft({ modelId: '', versionKey: '', contextWindow: '', maxOutputUnits: '' })
    }
  }, isZh ? '控制面草稿已创建。' : 'Control-plane draft created.')
  const transition = (target: ModelControlStatus) => selected && void run(async () => {
    await adminService.transitionModelControl(mode === 'providers' ? 'provider' : mode === 'models' ? 'model' : 'version', selected.id, selected.version, target, reasonCode)
  }, isZh ? `状态已更新为 ${target}。` : `Status changed to ${target}.`)
  const openItem = async (id: string) => {
    setSelectedId(id)
    if (mode === 'versions') {
      try { setSelectedVersion(await adminService.modelVersion(id)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
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

  if (!hasPermission('admin:model-control:read')) return null
  return (
    <section className="panel model-control-panel" data-testid="model-control-panel">
      <header className="settings-panel-header">
        <div><small>{isZh ? '模型控制面' : 'Model control plane'}</small><h2>{isZh ? 'Provider 与模型注册表' : 'Provider and model registry'}</h2></div>
        <div className="button-row">
          <button className="icon-button" type="button" title={isZh ? '导出目录' : 'Export catalog'} onClick={() => void run(async () => downloadJson(await adminService.exportModelControlCatalog()), isZh ? '目录已导出。' : 'Catalog exported.')}><Download size={17} /></button>
          <button className="icon-button" type="button" title={isZh ? '刷新' : 'Refresh'} onClick={() => void refresh()} disabled={busy}><RefreshCw size={17} /></button>
        </div>
      </header>
      <div className="model-control-gate"><ShieldCheck size={18} /><strong>{isZh ? '真实 Provider 流量关闭' : 'Real Provider traffic disabled'}</strong><span>{summary?.counts.deployments ?? 0} {isZh ? '个部署记录' : 'deployments'}</span></div>
      <div className="chip-row" role="tablist">
        {(['providers', 'models', 'versions'] as Mode[]).map((item) => <button key={item} type="button" className={mode === item ? 'chip active' : 'chip'} onClick={() => changeMode(item)}>{({ providers: isZh ? 'Provider' : 'Providers', models: isZh ? '模型' : 'Models', versions: isZh ? '版本' : 'Versions' })[item]}</button>)}
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
        </> : <div className="empty-state">{isZh ? '选择一条记录' : 'Select a record'}</div>}</div>
      </div>
    </section>
  )
}
