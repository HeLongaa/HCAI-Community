import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Ban, Boxes, Download, FlaskConical, History, KeyRound, Play, Plus, RefreshCw, RotateCcw, Save, Scale, Search, ShieldCheck, Waypoints } from 'lucide-react'

import type { Permission } from '../../domain/types'
import { adminService } from '../../services/adminService'
import type { AiEvaluationPolicyDto, AiEvaluationRunDto, AiEvaluationSuiteDto, AiEvaluationSummaryDto, ChatProductionReadinessDto, ModelCatalogModelDto, ModelCapabilityModality, ModelControlStatus, ModelControlSummaryDto, ModelDeploymentDto, ModelDeploymentEnvironment, ModelGovernanceSummaryDto, ModelPromotionDto, ModelProviderDto, ModelRouteDecisionDto, ModelRoutePolicyDto, ModelRoutePreviewResult, ModelRouteRevisionDto, ModelRouteSummaryDto, ModelVersionDto, ProviderLegalReviewDto, ProviderLegalSummaryDto, ProviderOperationalPolicyDto, ProviderOperationsSummaryDto, ProviderSecretRefDto } from '../../services/contracts'

type Mode = 'providers' | 'models' | 'versions' | 'routes'
type GovernanceMode = 'operations' | 'evaluations' | 'legal' | 'decisions' | 'secrets' | 'promotions'
const statuses: Array<ModelControlStatus | ''> = ['', 'draft', 'active', 'disabled', 'deprecated', 'archived']
const transitions: Record<ModelControlStatus, ModelControlStatus[]> = {
  draft: ['active', 'archived'], active: ['disabled', 'deprecated'], disabled: ['active', 'archived'], deprecated: ['disabled', 'archived'], archived: [],
}
const splitValues = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean)
const readinessReasonZh: Record<string, string> = {
  no_active_route_policy: '没有启用的生产对话路由', no_route_targets: '生产路由没有目标', provider_approval_required: '部署尚未取得生产流量资格',
  deployment_inactive: '生产部署未启用', deployment_runtime_disabled: '生产运行开关未启用', provider_secret_ref_missing: '缺少当前生产密钥引用',
  provider_secret_unresolved: '生产密钥引用尚未连接到运行环境', production_promotion_missing: '缺少已发布的生产批准',
  production_promotion_route_mismatch: '生产批准与当前路由不一致', production_secret_unapproved: '当前密钥版本未获生产批准',
  production_evaluation_invalid: '模型评测缺失或已过期', production_legal_invalid: '法务审查缺失、已过期或不是当前版本',
  provider_operational_repository_missing: '运营限制服务不可用', provider_operational_policy_missing: '缺少生产运营策略', provider_policy_draft: '生产运营策略尚未启用', provider_policy_disabled: '生产运营策略已停用',
  provider_cap_evidence_missing: '缺少金额上限', provider_cap_evidence_expired: '金额上限已过期', provider_cap_insufficient: '剩余金额不足',
  provider_per_request_budget_exceeded: '单次请求金额超过后台上限',
  provider_kill_switch_active: '紧急关闭开关已开启', provider_circuit_open: 'Provider 熔断已开启', provider_circuit_probe_required: 'Provider 正在等待恢复检查',
  provider_health_missing: '缺少 Provider 健康检查', provider_health_expired: 'Provider 健康检查已过期', provider_health_unavailable: 'Provider 当前不可用',
  provider_rate_limit_exhausted: '每分钟调用次数已用完', provider_concurrency_limit_exhausted: '并发数已用完',
}
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
  const [providerOperations, setProviderOperations] = useState<ProviderOperationalPolicyDto[]>([])
  const [evaluationSuites, setEvaluationSuites] = useState<AiEvaluationSuiteDto[]>([])
  const [evaluationPolicies, setEvaluationPolicies] = useState<AiEvaluationPolicyDto[]>([])
  const [evaluationRuns, setEvaluationRuns] = useState<AiEvaluationRunDto[]>([])
  const [legalReviews, setLegalReviews] = useState<ProviderLegalReviewDto[]>([])
  const [governanceMode, setGovernanceMode] = useState<GovernanceMode>('decisions')
  const [summary, setSummary] = useState<ModelControlSummaryDto | null>(null)
  const [chatProductionReadiness, setChatProductionReadiness] = useState<ChatProductionReadinessDto | null>(null)
  const [routeSummary, setRouteSummary] = useState<ModelRouteSummaryDto | null>(null)
  const [governanceSummary, setGovernanceSummary] = useState<ModelGovernanceSummaryDto | null>(null)
  const [operationsSummary, setOperationsSummary] = useState<ProviderOperationsSummaryDto | null>(null)
  const [evaluationSummary, setEvaluationSummary] = useState<AiEvaluationSummaryDto | null>(null)
  const [legalSummary, setLegalSummary] = useState<ProviderLegalSummaryDto | null>(null)
  const [evaluationReferenceTime, setEvaluationReferenceTime] = useState(0)
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
  const [chatRollbackEvidenceUrl, setChatRollbackEvidenceUrl] = useState('')
  const [providerDraft, setProviderDraft] = useState({ key: '', name: '', websiteUrl: '', regions: '', dataProcessingRegions: '' })
  const [modelDraft, setModelDraft] = useState({ providerId: '', key: '', name: '', family: '' })
  const [versionDraft, setVersionDraft] = useState({ modelId: '', versionKey: '', contextWindow: '', maxOutputUnits: '' })
  const [capabilityDraft, setCapabilityDraft] = useState({ modality: 'image' as ModelCapabilityModality, operations: 'generate', inputMimeTypes: '', outputMimeTypes: 'image/png' })
  const [deploymentDraft, setDeploymentDraft] = useState({ key: '', environment: 'staging' as ModelDeploymentEnvironment, region: '', deploymentRef: '', adapterType: 'openai_image', providerModelId: '', endpointUrl: '', secretPurpose: 'inference', runtimeConfig: '{}', runtimeEnabled: false })
  const [pricingDraft, setPricingDraft] = useState({ versionKey: '', modelDeploymentId: '', currency: 'USD', unit: 'request', unitPriceMicros: '', effectiveFrom: new Date().toISOString().slice(0, 16) })
  const [routeDraft, setRouteDraft] = useState({ key: '', name: '', modality: 'image' as ModelCapabilityModality, operation: 'generate', environment: 'staging' as ModelDeploymentEnvironment, region: '', audienceRoles: '', rolloutPercentage: '100', rolloutSeed: 'v1', fallbackMode: 'fail_closed' as 'fail_closed' | 'ordered', priority: '100' })
  const [routeTargets, setRouteTargets] = useState({ primary: '', backup: '' })
  const [previewDraft, setPreviewDraft] = useState({ subjectKey: 'preview-user', role: 'member', region: '' })
  const [secretDraft, setSecretDraft] = useState({ providerId: '', environment: 'staging' as ModelDeploymentEnvironment, purpose: 'inference', secretRef: '', externalVersion: '', ownerRef: '', checksumSha256: '', expiresAt: '', rotatedFromId: '' })
  const [promotionDraft, setPromotionDraft] = useState({ modelDeploymentId: '', routePolicyId: '', routePolicyRevisionId: '', providerSecretRefId: '', evaluationRunId: '', legalReviewId: '', artifactVersion: '', rollbackVersion: '', summary: '' })
  const [promotionRevisions, setPromotionRevisions] = useState<ModelRouteRevisionDto[]>([])
  const [operationsDraft, setOperationsDraft] = useState({ providerId: '', environment: 'staging' as ModelDeploymentEnvironment, providerAccountRef: 'default', secretPurpose: 'inference', workspace: 'image' as ModelCapabilityModality, modelFamily: '', currency: 'USD', perRequestBudgetMicros: '250000', maxRequestsPerMinute: '60', maxConcurrentRequests: '4', healthTtlSeconds: '300' })
  const [healthDraft, setHealthDraft] = useState({ policyId: '', status: 'healthy' as 'healthy' | 'degraded' | 'unavailable', latencyMs: '', successRateBps: '', sourceType: 'provider_probe' as 'provider_probe' | 'provider_status_page' | 'manual_unavailable' | 'fixture_probe', sourceRef: '' })
  const [evaluationSuiteDraft, setEvaluationSuiteDraft] = useState({ suiteKey: 'chat-regression', name: 'Chat regression', version: '1', modality: 'chat' as ModelCapabilityModality, operation: 'generate', qualityInputHash: '', qualityExpectedHash: '', safetyInputHash: '', safetyExpectedHash: '' })
  const [evaluationPolicyDraft, setEvaluationPolicyDraft] = useState({ policyKey: 'chat-production', version: '1', suiteId: '', environment: 'production' as ModelDeploymentEnvironment, qualityThresholdBps: '8000', safetyThresholdBps: '10000', maxRegressionBps: '250', minimumCases: '2', evidenceTtlSeconds: '86400', reviewedByRef: 'independent-reviewer' })
  const [evaluationRunDraft, setEvaluationRunDraft] = useState({ suiteId: '', policyId: '', modelVersionId: '', modelDeploymentId: '', baselineRunId: '', scoreBps: '10000', safetyPassed: true, outputHash: '', executorRef: 'evaluation-runner' })
  const [legalDraft, setLegalDraft] = useState(() => {
    const validFrom = new Date()
    return { providerId: '', modelVersionId: '', environment: 'production' as ModelDeploymentEnvironment, version: '1', decision: 'approved' as 'approved' | 'blocked', allowedRegions: 'us', geographyStatus: 'approved' as 'approved' | 'blocked', dpaStatus: 'executed' as 'executed' | 'not_required' | 'blocked', retentionStatus: 'approved' as 'approved' | 'blocked', retentionDays: '30', trainingStatus: 'contractual_no_training' as 'opt_out' | 'contractual_no_training' | 'blocked', copyrightStatus: 'approved' as 'approved' | 'blocked', slaStatus: 'approved' as 'approved' | 'blocked', sourceEvidenceHash: '', counselRef: '', productOwnerRef: '', validFrom: validFrom.toISOString().slice(0, 16), expiresAt: new Date(validFrom.getTime() + 90 * 86400_000).toISOString().slice(0, 16) }
  })
  const canManage = hasPermission('admin:model-control:manage')
  const canTransition = hasPermission('admin:model-control:transition')
  const canRequestPromotion = hasPermission('admin:releases:manage')
  const canManageEvaluations = hasPermission('admin:model-evaluations:manage')
  const canExecuteEvaluations = hasPermission('admin:model-evaluations:execute')
  const canManageLegal = hasPermission('admin:provider-legal:manage')
  const canDeployRelease = hasPermission('admin:releases:deploy')

  const refresh = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const query = { search: search || null, status: status || null, limit: 100, sort: 'updatedAt' as const, order: 'desc' as const }
      const [providerPage, modelPage, versionPage, deploymentPage, routePage, decisionPage, secretPage, promotionPage, operationsPage, suitePage, policyPage, runPage, legalPage, nextSummary, nextChatProductionReadiness, nextRouteSummary, nextGovernanceSummary, nextOperationsSummary, nextEvaluationSummary, nextLegalSummary] = await Promise.all([
        adminService.modelProviders(mode === 'providers' ? query : { limit: 100 }),
        adminService.catalogModels(mode === 'models' ? query : { limit: 100 }),
        adminService.modelVersions(mode === 'versions' ? query : { limit: 100 }),
        adminService.modelDeployments({ limit: 100 }),
        adminService.modelRoutePolicies(mode === 'routes' ? query : { limit: 100 }),
        adminService.modelRouteDecisions({ limit: 100, sort: 'createdAt', order: 'desc' }),
        adminService.providerSecretRefs({ limit: 100, sort: 'createdAt', order: 'desc' }),
        adminService.modelPromotions({ limit: 100, order: 'desc' }),
        adminService.providerOperationalPolicies(),
        adminService.evaluationSuites(),
        adminService.evaluationPolicies(),
        adminService.evaluationRuns(),
        adminService.providerLegalReviews(),
        adminService.modelControlSummary(),
        adminService.chatProductionReadiness(),
        adminService.modelRouteSummary(),
        adminService.modelGovernanceSummary(),
        adminService.providerOperationsSummary(),
        adminService.evaluationSummary(),
        adminService.providerLegalSummary(),
      ])
      setProviders(providerPage.items); setModels(modelPage.items); setVersions(versionPage.items); setDeployments(deploymentPage.items); setRoutes(routePage.items); setRouteDecisions(decisionPage.items); setSecretRefs(secretPage.items); setPromotions(promotionPage.items); setProviderOperations(operationsPage.items); setEvaluationSuites(suitePage.items); setEvaluationPolicies(policyPage.items); setEvaluationRuns(runPage.items); setLegalReviews(legalPage.items); setSummary(nextSummary); setChatProductionReadiness(nextChatProductionReadiness); setRouteSummary(nextRouteSummary); setGovernanceSummary(nextGovernanceSummary); setOperationsSummary(nextOperationsSummary); setEvaluationSummary(nextEvaluationSummary); setLegalSummary(nextLegalSummary); setEvaluationReferenceTime(Date.now())
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
  const emergencyDisableChatProduction = () => {
    const route = chatProductionReadiness?.checks?.route
    if (!route || route.status !== 'active') return
    void run(async () => {
      await adminService.transitionModelRoutePolicy(route.id, route.version, 'disabled', 'chat_production_emergency_stop')
    }, isZh ? '生产对话路由已真实停用。' : 'Chat production route disabled.')
  }
  const rollbackChatProduction = () => {
    const promotion = chatProductionReadiness?.checks?.promotion
    const deployment = chatProductionReadiness?.checks?.deployment
    if (!promotion || promotion.status !== 'deployed' || !deployment || !chatRollbackEvidenceUrl) return
    void run(async () => {
      await adminService.rollbackReleaseChange(promotion.releaseChangeId, {
        deploymentId: deployment.id,
        evidenceUrl: chatRollbackEvidenceUrl,
        reasonCode: 'chat_production_emergency_rollback',
      })
      setChatRollbackEvidenceUrl('')
    }, isZh ? '生产对话发布已真实回滚。' : 'Chat production release rolled back.')
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
    await adminService.createModelDeployment({ modelVersionId: selectedVersion.id, ...deploymentDraft, endpointUrl: deploymentDraft.endpointUrl || null, runtimeConfig: JSON.parse(deploymentDraft.runtimeConfig) as Record<string, unknown> })
    setSelectedVersion(await adminService.modelVersion(selectedVersion.id))
    setDeploymentDraft({ key: '', environment: 'staging', region: '', deploymentRef: '', adapterType: 'openai_image', providerModelId: '', endpointUrl: '', secretPurpose: 'inference', runtimeConfig: '{}', runtimeEnabled: false })
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
  const createOperationsPolicy = () => void run(async () => {
    await adminService.createProviderOperationalPolicy({ ...operationsDraft, modelFamily: operationsDraft.modelFamily || null, perRequestBudgetMicros: Number(operationsDraft.perRequestBudgetMicros), maxRequestsPerMinute: Number(operationsDraft.maxRequestsPerMinute), maxConcurrentRequests: Number(operationsDraft.maxConcurrentRequests), healthTtlSeconds: Number(operationsDraft.healthTtlSeconds), reasonCode })
  }, isZh ? 'Provider 运营策略已创建，默认不启用。' : 'Provider operations policy created disabled by default.')
  const recordHealth = () => healthDraft.policyId && void run(async () => {
    await adminService.recordProviderHealth(healthDraft.policyId, { sourceKey: `health-${Date.now()}`, status: healthDraft.status, checkedAt: new Date().toISOString(), latencyMs: healthDraft.latencyMs ? Number(healthDraft.latencyMs) : null, successRateBps: healthDraft.successRateBps ? Number(healthDraft.successRateBps) : null, sourceType: healthDraft.sourceType, sourceRef: healthDraft.sourceRef, details: { recordedFrom: 'admin_model_control' } })
    setHealthDraft((current) => ({ ...current, sourceRef: '', latencyMs: '', successRateBps: '' }))
  }, isZh ? '健康证据已追加。' : 'Health evidence appended.')
  const transitionOperations = (profile: ProviderOperationalPolicyDto, target: 'active' | 'disabled') => void run(async () => {
    await adminService.transitionProviderOperationalPolicy(profile.id, profile.version, target, reasonCode)
  }, isZh ? `Provider 运营策略已${target === 'active' ? '启用' : '停用'}。` : `Provider operations policy ${target}.`)
  const createEvaluationSuite = () => void run(async () => {
    await adminService.createEvaluationSuite({
      suiteKey: evaluationSuiteDraft.suiteKey, name: evaluationSuiteDraft.name, version: Number(evaluationSuiteDraft.version), modality: evaluationSuiteDraft.modality, operation: evaluationSuiteDraft.operation,
      description: null, reasonCode,
      cases: [
        { caseKey: 'quality-1', category: 'quality', scoringType: 'semantic', inputHash: evaluationSuiteDraft.qualityInputHash, expectedHash: evaluationSuiteDraft.qualityExpectedHash, weight: 1 },
        { caseKey: 'safety-1', category: 'safety', scoringType: 'policy', inputHash: evaluationSuiteDraft.safetyInputHash, expectedHash: evaluationSuiteDraft.safetyExpectedHash, weight: 1 },
      ],
    })
  }, isZh ? '评测套件版本已追加。' : 'Evaluation suite version appended.')
  const createEvaluationPolicy = () => void run(async () => {
    const suite = evaluationSuites.find((item) => item.id === evaluationPolicyDraft.suiteId)
    if (!suite) return
    await adminService.createEvaluationPolicy({
      policyKey: evaluationPolicyDraft.policyKey, version: Number(evaluationPolicyDraft.version), suiteId: suite.id, modality: suite.modality, operation: suite.operation,
      environment: evaluationPolicyDraft.environment, qualityThresholdBps: Number(evaluationPolicyDraft.qualityThresholdBps), safetyThresholdBps: Number(evaluationPolicyDraft.safetyThresholdBps),
      maxRegressionBps: Number(evaluationPolicyDraft.maxRegressionBps), minimumCases: Number(evaluationPolicyDraft.minimumCases), evidenceTtlSeconds: Number(evaluationPolicyDraft.evidenceTtlSeconds), reviewedByRef: evaluationPolicyDraft.reviewedByRef, reasonCode,
    })
  }, isZh ? '评测阈值策略已独立复核并追加。' : 'Reviewed evaluation policy appended.')
  const createEvaluationRun = () => void run(async () => {
    const suite = evaluationSuites.find((item) => item.id === evaluationRunDraft.suiteId)
    if (!suite) return
    await adminService.createEvaluationRun({
      sourceKey: `admin-evaluation-${Date.now()}`, suiteId: suite.id, policyId: evaluationRunDraft.policyId, modelVersionId: evaluationRunDraft.modelVersionId,
      modelDeploymentId: evaluationRunDraft.modelDeploymentId || null, baselineRunId: evaluationRunDraft.baselineRunId || null, executorRef: evaluationRunDraft.executorRef,
      results: suite.cases.map((item) => ({ caseId: item.id, scoreBps: Number(evaluationRunDraft.scoreBps), safetyPassed: evaluationRunDraft.safetyPassed, latencyMs: null, outputHash: evaluationRunDraft.outputHash })),
    })
  }, isZh ? '不可变评测报告已生成。' : 'Immutable evaluation report recorded.')
  const createLegalReview = () => void run(async () => {
    const validFrom = new Date(legalDraft.validFrom).toISOString()
    await adminService.createProviderLegalReview({
      sourceKey: `admin-provider-legal-${Date.now()}`, version: Number(legalDraft.version), providerId: legalDraft.providerId, modelVersionId: legalDraft.modelVersionId,
      environment: legalDraft.environment, decision: legalDraft.decision, allowedRegions: splitValues(legalDraft.allowedRegions), geographyStatus: legalDraft.geographyStatus,
      dpaStatus: legalDraft.dpaStatus, retentionStatus: legalDraft.retentionStatus, retentionDays: Number(legalDraft.retentionDays), trainingStatus: legalDraft.trainingStatus,
      copyrightStatus: legalDraft.copyrightStatus, slaStatus: legalDraft.slaStatus, sourceEvidenceHash: legalDraft.sourceEvidenceHash, counselRef: legalDraft.counselRef,
      productOwnerRef: legalDraft.productOwnerRef, reviewedAt: validFrom, validFrom, expiresAt: new Date(legalDraft.expiresAt).toISOString(), reasonCode,
    })
    setLegalDraft((current) => ({ ...current, version: String(Number(current.version) + 1), sourceEvidenceHash: '' }))
  }, isZh ? 'Provider 法务审查证据已追加。' : 'Provider legal review evidence appended.')

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
      <div className="model-control-gate" data-testid="chat-production-readiness" data-status={chatProductionReadiness?.decision ?? 'loading'}>
        <ShieldCheck size={18} />
        <strong>{chatProductionReadiness?.ready ? (isZh ? '对话生产条件已齐全' : 'Chat production is ready') : (isZh ? '对话生产暂不可开启' : 'Chat production is not ready')}</strong>
        <span>{chatProductionReadiness?.ready
          ? `${chatProductionReadiness.checks?.provider?.key ?? 'Provider'} · ${chatProductionReadiness.checks?.deployment?.providerModelId ?? ''}`
          : (chatProductionReadiness?.blockerCodes.length
              ? chatProductionReadiness.blockerCodes.map((code) => isZh ? readinessReasonZh[code] ?? code : code).join(isZh ? '；' : '; ')
              : (isZh ? '正在检查生产条件' : 'Checking production requirements'))}</span>
        {chatProductionReadiness?.checks && <small className="chat-production-checks">
          {isZh ? '路由' : 'Route'}: {chatProductionReadiness.checks.route?.status ?? 'missing'} · {isZh ? '部署' : 'Deployment'}: {chatProductionReadiness.checks.deployment?.status ?? 'missing'} · {isZh ? '流量资格' : 'Traffic'}: {chatProductionReadiness.checks.deployment?.trafficEligible ? 'yes' : 'no'} · SecretRef: {chatProductionReadiness.checks.secretRef?.externalVersion ?? 'missing'} · {isZh ? '发布' : 'Promotion'}: {chatProductionReadiness.checks.promotion?.status ?? 'missing'} · {isZh ? '评测' : 'Evaluation'}: {chatProductionReadiness.checks.evaluation?.status ?? 'missing'} · {isZh ? '法务' : 'Legal'}: {chatProductionReadiness.checks.legal?.decision ?? 'missing'}
          {' · '}{isZh ? '运营限制' : 'Operations'}: {chatProductionReadiness.checks.operational?.readiness.ready ? 'ready' : chatProductionReadiness.checks.operational?.readiness.reasonCode ?? 'missing'}
          {' · '}{isZh ? '次数' : 'Rate'}: {chatProductionReadiness.checks.operational?.rate?.requestCount ?? 0}/{chatProductionReadiness.checks.operational?.profile?.maxRequestsPerMinute ?? 0}
          {' · '}{isZh ? '并发' : 'Concurrency'}: {chatProductionReadiness.checks.operational?.rate?.inFlightCount ?? 0}/{chatProductionReadiness.checks.operational?.profile?.maxConcurrentRequests ?? 0}
          {' · '}{isZh ? '余额' : 'Budget'}: {chatProductionReadiness.checks.operational?.budget?.remainingMicros ?? 'missing'} {chatProductionReadiness.checks.operational?.budget?.currency ?? ''}
          {' · '}{isZh ? '健康' : 'Health'}: {chatProductionReadiness.checks.operational?.health?.status ?? 'missing'} · {isZh ? '熔断' : 'Circuit'}: {chatProductionReadiness.checks.operational?.circuit?.status ?? 'missing'}
        </small>}
        {(canTransition || canDeployRelease) && chatProductionReadiness?.checks && <div className="chat-production-actions" data-testid="chat-production-actions">
          {canTransition && chatProductionReadiness.checks.route?.status === 'active' && <button className="ghost-button danger" type="button" onClick={emergencyDisableChatProduction} disabled={busy}><Ban size={16} />{isZh ? '紧急停用' : 'Emergency disable'}</button>}
          {canDeployRelease && chatProductionReadiness.checks.promotion?.status === 'deployed' && <>
            <input aria-label={isZh ? '生产回滚证据地址' : 'Production rollback evidence URL'} placeholder="https://..." value={chatRollbackEvidenceUrl} onChange={(event) => setChatRollbackEvidenceUrl(event.target.value)} />
            <button className="ghost-button danger" type="button" onClick={rollbackChatProduction} disabled={busy || !chatRollbackEvidenceUrl}><RotateCcw size={16} />{isZh ? '回滚发布' : 'Rollback release'}</button>
          </>}
        </div>}
      </div>
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
            <div className="model-tool-section"><h4>{isZh ? '部署' : 'Deployment'}</h4><select aria-label="Deployment environment" value={deploymentDraft.environment} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Deployment adapter" value={deploymentDraft.adapterType} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, adapterType: event.target.value })}>{['openai_image', 'openai_chat', 'google_video', 'elevenlabs_music'].map((item) => <option key={item}>{item}</option>)}</select><input value={deploymentDraft.key} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, key: event.target.value })} placeholder="deployment-key" /><input value={deploymentDraft.region} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, region: event.target.value })} placeholder="region" /><input value={deploymentDraft.deploymentRef} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, deploymentRef: event.target.value })} placeholder="deployment-ref" /><input aria-label="Provider model ID" value={deploymentDraft.providerModelId} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, providerModelId: event.target.value })} placeholder="provider-model-id" /><input aria-label="Provider endpoint" value={deploymentDraft.endpointUrl} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, endpointUrl: event.target.value })} placeholder="https://provider.example/v1" /><input aria-label="Secret purpose" value={deploymentDraft.secretPurpose} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, secretPurpose: event.target.value })} placeholder="inference" /><textarea aria-label="Deployment runtime config" value={deploymentDraft.runtimeConfig} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, runtimeConfig: event.target.value })} /><label><input type="checkbox" checked={deploymentDraft.runtimeEnabled} onChange={(event) => setDeploymentDraft({ ...deploymentDraft, runtimeEnabled: event.target.checked })} />{isZh ? '允许 staging 运行' : 'Enable staging runtime'}</label><button className="icon-button" type="button" title={isZh ? '新建部署' : 'Create deployment'} onClick={createDeployment}><Plus size={17} /></button></div>
            <div className="model-tool-section"><h4>{isZh ? '价格' : 'Pricing'}</h4><input value={pricingDraft.versionKey} onChange={(event) => setPricingDraft({ ...pricingDraft, versionKey: event.target.value })} placeholder="price-version" /><input value={pricingDraft.unitPriceMicros} onChange={(event) => setPricingDraft({ ...pricingDraft, unitPriceMicros: event.target.value })} type="number" placeholder="micros" /><select value={pricingDraft.modelDeploymentId} onChange={(event) => setPricingDraft({ ...pricingDraft, modelDeploymentId: event.target.value })}><option value="">{isZh ? '全局' : 'Global'}</option>{selectedVersion.deployments?.map((item) => <option value={item.id} key={item.id}>{item.key}</option>)}</select><button className="icon-button" type="button" title={isZh ? '追加价格' : 'Add pricing'} onClick={createPricing}><Plus size={17} /></button></div>
            <div className="model-version-counts"><span>{selectedVersion.capabilities?.length ?? 0} capabilities</span><span>{selectedVersion.deployments?.length ?? 0} deployments</span><span>{selectedVersion.prices?.length ?? 0} prices</span></div>
            <div className="admin-table">{selectedVersion.deployments?.map((deployment) => <div className="admin-row compact" key={deployment.id}><span><strong>{deployment.key}</strong><small>{deployment.adapterType ?? (isZh ? '未配置适配器' : 'No adapter')} · {deployment.providerModelId ?? (isZh ? '未配置模型' : 'No model')} · {deployment.endpointUrl ?? (isZh ? '无接口地址' : 'No endpoint')}</small></span><span className={`status ${deployment.runtimeEnabled ? 'active' : 'disabled'}`}>{deployment.runtimeEnabled ? (isZh ? '运行已启用' : 'runtime enabled') : (isZh ? '运行未启用' : 'runtime disabled')}</span><code>v{deployment.version}</code></div>)}</div>
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
        <div className="chip-row" role="tablist">{(['operations', 'evaluations', 'legal', 'decisions', 'secrets', 'promotions'] as GovernanceMode[]).map((item) => <button key={item} type="button" className={governanceMode === item ? 'chip active' : 'chip'} onClick={() => setGovernanceMode(item)}>{({ operations: isZh ? '运营就绪' : 'Operations', evaluations: isZh ? '质量评测' : 'Evaluations', legal: isZh ? '法务审查' : 'Legal review', decisions: isZh ? '路由决策' : 'Route decisions', secrets: 'SecretRef', promotions: isZh ? '环境提升' : 'Promotions' })[item]}</button>)}</div>
        {governanceMode === 'operations' && <>
          <div className="model-control-gate"><ShieldCheck size={18} /><strong>{operationsSummary?.readyCount ?? 0} / {operationsSummary?.profileCount ?? 0} {isZh ? '策略就绪' : 'policies ready'}</strong><span>{operationsSummary?.blockedCount ?? 0} {isZh ? '阻断' : 'blocked'} · {operationsSummary?.activeLeaseCount ?? 0} {isZh ? '活跃租约' : 'active leases'}</span><button className="icon-button" type="button" title={isZh ? '导出运营证据' : 'Export operations evidence'} onClick={() => void run(async () => downloadJson(await adminService.exportProviderOperations()), isZh ? '运营证据已导出。' : 'Operations evidence exported.')}><Download size={16} /></button></div>
          {canManage && <div className="model-governance-form">
            <select aria-label="Operations Provider" value={operationsDraft.providerId} onChange={(event) => setOperationsDraft({ ...operationsDraft, providerId: event.target.value })}><option value="">Provider</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
            <select aria-label="Operations environment" value={operationsDraft.environment} onChange={(event) => setOperationsDraft({ ...operationsDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="Operations workspace" value={operationsDraft.workspace} onChange={(event) => setOperationsDraft({ ...operationsDraft, workspace: event.target.value as ModelCapabilityModality })}>{(['image', 'chat', 'video', 'music'] as ModelCapabilityModality[]).map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="Operations account reference" value={operationsDraft.providerAccountRef} onChange={(event) => setOperationsDraft({ ...operationsDraft, providerAccountRef: event.target.value })} placeholder="account-ref" />
            <input aria-label="Operations secret purpose" value={operationsDraft.secretPurpose} onChange={(event) => setOperationsDraft({ ...operationsDraft, secretPurpose: event.target.value })} placeholder="inference" />
            <input aria-label="Operations model family" value={operationsDraft.modelFamily} onChange={(event) => setOperationsDraft({ ...operationsDraft, modelFamily: event.target.value })} placeholder="model-family" />
            <input aria-label="Operations request budget" type="number" min="0" value={operationsDraft.perRequestBudgetMicros} onChange={(event) => setOperationsDraft({ ...operationsDraft, perRequestBudgetMicros: event.target.value })} placeholder="budget micros" />
            <input aria-label="Operations requests per minute" type="number" min="1" value={operationsDraft.maxRequestsPerMinute} onChange={(event) => setOperationsDraft({ ...operationsDraft, maxRequestsPerMinute: event.target.value })} />
            <input aria-label="Operations concurrency" type="number" min="1" value={operationsDraft.maxConcurrentRequests} onChange={(event) => setOperationsDraft({ ...operationsDraft, maxConcurrentRequests: event.target.value })} />
            <button className="primary-button" type="button" onClick={createOperationsPolicy} disabled={busy}><Plus size={17} />{isZh ? '新建策略' : 'Create policy'}</button>
          </div>}
          {canManage && <div className="model-governance-form">
            <select aria-label="Health policy" value={healthDraft.policyId} onChange={(event) => setHealthDraft({ ...healthDraft, policyId: event.target.value })}><option value="">{isZh ? '运营策略' : 'Operations policy'}</option>{providerOperations.map((item) => <option value={item.id} key={item.id}>{item.provider?.name ?? item.providerId} · {item.environment} · {item.workspace}</option>)}</select>
            <select aria-label="Health status" value={healthDraft.status} onChange={(event) => setHealthDraft({ ...healthDraft, status: event.target.value as typeof healthDraft.status })}>{(['healthy', 'degraded', 'unavailable'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="Health source type" value={healthDraft.sourceType} onChange={(event) => setHealthDraft({ ...healthDraft, sourceType: event.target.value as typeof healthDraft.sourceType })}>{(['provider_probe', 'provider_status_page', 'manual_unavailable', 'fixture_probe'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="Health source reference" value={healthDraft.sourceRef} onChange={(event) => setHealthDraft({ ...healthDraft, sourceRef: event.target.value })} placeholder="monitor:evidence-id" />
            <input aria-label="Health latency" type="number" min="0" value={healthDraft.latencyMs} onChange={(event) => setHealthDraft({ ...healthDraft, latencyMs: event.target.value })} placeholder="latency ms" />
            <input aria-label="Health success rate" type="number" min="0" max="10000" value={healthDraft.successRateBps} onChange={(event) => setHealthDraft({ ...healthDraft, successRateBps: event.target.value })} placeholder="success bps" />
            <button className="primary-button" type="button" onClick={recordHealth} disabled={busy || !healthDraft.policyId || !healthDraft.sourceRef}><Plus size={17} />{isZh ? '追加健康证据' : 'Append health'}</button>
          </div>}
        </>}
        {governanceMode === 'evaluations' && <>
          <div className="model-control-gate" data-testid="model-evaluation-gate"><FlaskConical size={18} /><strong>{evaluationSummary?.currentPassingCount ?? 0} {isZh ? '份当前合格证据' : 'current passing reports'}</strong><span>{evaluationSummary?.suiteCount ?? 0} suites · {evaluationSummary?.policyCount ?? 0} policies · {evaluationSummary?.runCount ?? 0} runs</span><button className="icon-button" type="button" title={isZh ? '导出评测证据' : 'Export evaluation evidence'} onClick={() => void run(async () => downloadJson(await adminService.exportEvaluations()), isZh ? '评测证据已导出。' : 'Evaluation evidence exported.')}><Download size={16} /></button></div>
          {canManageEvaluations && <div className="model-governance-form" data-testid="evaluation-suite-form">
            <input aria-label="Evaluation suite key" value={evaluationSuiteDraft.suiteKey} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, suiteKey: event.target.value })} />
            <input aria-label="Evaluation suite name" value={evaluationSuiteDraft.name} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, name: event.target.value })} />
            <input aria-label="Evaluation suite version" type="number" min="1" value={evaluationSuiteDraft.version} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, version: event.target.value })} />
            <select aria-label="Evaluation modality" value={evaluationSuiteDraft.modality} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, modality: event.target.value as ModelCapabilityModality })}>{(['image', 'chat', 'video', 'music'] as ModelCapabilityModality[]).map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="Evaluation operation" value={evaluationSuiteDraft.operation} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, operation: event.target.value })} />
            <input aria-label="Quality input hash" value={evaluationSuiteDraft.qualityInputHash} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, qualityInputHash: event.target.value })} placeholder="quality input sha256" />
            <input aria-label="Quality expected hash" value={evaluationSuiteDraft.qualityExpectedHash} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, qualityExpectedHash: event.target.value })} placeholder="quality expected sha256" />
            <input aria-label="Safety input hash" value={evaluationSuiteDraft.safetyInputHash} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, safetyInputHash: event.target.value })} placeholder="safety input sha256" />
            <input aria-label="Safety expected hash" value={evaluationSuiteDraft.safetyExpectedHash} onChange={(event) => setEvaluationSuiteDraft({ ...evaluationSuiteDraft, safetyExpectedHash: event.target.value })} placeholder="safety expected sha256" />
            <button className="primary-button" type="button" onClick={createEvaluationSuite} disabled={busy}><Plus size={17} />{isZh ? '追加套件' : 'Append suite'}</button>
          </div>}
          {canManageEvaluations && <div className="model-governance-form" data-testid="evaluation-policy-form">
            <select aria-label="Evaluation policy suite" value={evaluationPolicyDraft.suiteId} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, suiteId: event.target.value })}><option value="">{isZh ? '评测套件' : 'Evaluation suite'}</option>{evaluationSuites.map((item) => <option value={item.id} key={item.id}>{item.suiteKey} v{item.version}</option>)}</select>
            <input aria-label="Evaluation policy key" value={evaluationPolicyDraft.policyKey} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, policyKey: event.target.value })} />
            <input aria-label="Evaluation policy version" type="number" min="1" value={evaluationPolicyDraft.version} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, version: event.target.value })} />
            <select aria-label="Evaluation policy environment" value={evaluationPolicyDraft.environment} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="Quality threshold" type="number" min="0" max="10000" value={evaluationPolicyDraft.qualityThresholdBps} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, qualityThresholdBps: event.target.value })} />
            <input aria-label="Safety threshold" type="number" min="0" max="10000" value={evaluationPolicyDraft.safetyThresholdBps} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, safetyThresholdBps: event.target.value })} />
            <input aria-label="Regression threshold" type="number" min="0" max="10000" value={evaluationPolicyDraft.maxRegressionBps} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, maxRegressionBps: event.target.value })} />
            <input aria-label="Evaluation reviewer" value={evaluationPolicyDraft.reviewedByRef} onChange={(event) => setEvaluationPolicyDraft({ ...evaluationPolicyDraft, reviewedByRef: event.target.value })} />
            <button className="primary-button" type="button" onClick={createEvaluationPolicy} disabled={busy || !evaluationPolicyDraft.suiteId}><ShieldCheck size={17} />{isZh ? '追加策略' : 'Append policy'}</button>
          </div>}
          {canExecuteEvaluations && <div className="model-governance-form" data-testid="evaluation-run-form">
            <select aria-label="Evaluation run suite" value={evaluationRunDraft.suiteId} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, suiteId: event.target.value })}><option value="">{isZh ? '评测套件' : 'Evaluation suite'}</option>{evaluationSuites.map((item) => <option value={item.id} key={item.id}>{item.suiteKey} v{item.version}</option>)}</select>
            <select aria-label="Evaluation run policy" value={evaluationRunDraft.policyId} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, policyId: event.target.value })}><option value="">{isZh ? '阈值策略' : 'Threshold policy'}</option>{evaluationPolicies.filter((item) => !evaluationRunDraft.suiteId || item.suiteId === evaluationRunDraft.suiteId).map((item) => <option value={item.id} key={item.id}>{item.policyKey} v{item.version}</option>)}</select>
            <select aria-label="Evaluation model version" value={evaluationRunDraft.modelVersionId} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, modelVersionId: event.target.value })}><option value="">{isZh ? '模型版本' : 'Model version'}</option>{versions.map((item) => <option value={item.id} key={item.id}>{item.versionKey}</option>)}</select>
            <select aria-label="Evaluation deployment" value={evaluationRunDraft.modelDeploymentId} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, modelDeploymentId: event.target.value })}><option value="">{isZh ? '无部署' : 'No deployment'}</option>{deployments.filter((item) => !evaluationRunDraft.modelVersionId || item.modelVersionId === evaluationRunDraft.modelVersionId).map((item) => <option value={item.id} key={item.id}>{item.key}</option>)}</select>
            <select aria-label="Evaluation baseline" value={evaluationRunDraft.baselineRunId} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, baselineRunId: event.target.value })}><option value="">{isZh ? '基线运行' : 'Baseline run'}</option>{evaluationRuns.filter((item) => item.suiteId === evaluationRunDraft.suiteId && item.policyId === evaluationRunDraft.policyId).map((item) => <option value={item.id} key={item.id}>{item.status} · {item.qualityScoreBps}</option>)}</select>
            <input aria-label="Evaluation score" type="number" min="0" max="10000" value={evaluationRunDraft.scoreBps} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, scoreBps: event.target.value })} />
            <label><input aria-label="Evaluation safety passed" type="checkbox" checked={evaluationRunDraft.safetyPassed} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, safetyPassed: event.target.checked })} />{isZh ? '安全通过' : 'Safety passed'}</label>
            <input aria-label="Evaluation output hash" value={evaluationRunDraft.outputHash} onChange={(event) => setEvaluationRunDraft({ ...evaluationRunDraft, outputHash: event.target.value })} placeholder="output sha256" />
            <button className="primary-button" type="button" onClick={createEvaluationRun} disabled={busy || !evaluationRunDraft.suiteId || !evaluationRunDraft.policyId || !evaluationRunDraft.modelVersionId}><Play size={17} />{isZh ? '记录运行' : 'Record run'}</button>
          </div>}
        </>}
        {governanceMode === 'legal' && <>
          <div className="model-control-gate" data-testid="provider-legal-gate"><Scale size={18} /><strong>{legalSummary?.approvedCount ?? 0} / {legalSummary?.scopeCount ?? 0} {isZh ? '个 scope 当前获批' : 'current scopes approved'}</strong><span>{legalSummary?.blockedCount ?? 0} {isZh ? '阻断' : 'blocked'} · {legalSummary?.reviewCount ?? 0} reviews</span><button className="icon-button" type="button" title={isZh ? '导出法务证据' : 'Export legal evidence'} onClick={() => void run(async () => downloadJson(await adminService.exportProviderLegalReviews()), isZh ? '法务证据已导出。' : 'Legal evidence exported.')}><Download size={16} /></button></div>
          {canManageLegal && <div className="model-governance-form" data-testid="provider-legal-form">
            <select aria-label="Legal Provider" value={legalDraft.providerId} onChange={(event) => setLegalDraft({ ...legalDraft, providerId: event.target.value, modelVersionId: '' })}><option value="">Provider</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
            <select aria-label="Legal model version" value={legalDraft.modelVersionId} onChange={(event) => setLegalDraft({ ...legalDraft, modelVersionId: event.target.value })}><option value="">{isZh ? '模型版本' : 'Model version'}</option>{versions.filter((item) => models.find((model) => model.id === item.modelId)?.providerId === legalDraft.providerId).map((item) => <option value={item.id} key={item.id}>{item.versionKey}</option>)}</select>
            <select aria-label="Legal environment" value={legalDraft.environment} onChange={(event) => setLegalDraft({ ...legalDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="Legal version" type="number" min="1" value={legalDraft.version} onChange={(event) => setLegalDraft({ ...legalDraft, version: event.target.value })} />
            <select aria-label="Legal decision" value={legalDraft.decision} onChange={(event) => setLegalDraft({ ...legalDraft, decision: event.target.value as typeof legalDraft.decision })}>{(['approved', 'blocked'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="Legal allowed regions" value={legalDraft.allowedRegions} onChange={(event) => setLegalDraft({ ...legalDraft, allowedRegions: event.target.value })} placeholder="us, eu" />
            <select aria-label="Legal geography status" value={legalDraft.geographyStatus} onChange={(event) => setLegalDraft({ ...legalDraft, geographyStatus: event.target.value as typeof legalDraft.geographyStatus })}>{(['approved', 'blocked'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="Legal DPA status" value={legalDraft.dpaStatus} onChange={(event) => setLegalDraft({ ...legalDraft, dpaStatus: event.target.value as typeof legalDraft.dpaStatus })}>{(['executed', 'not_required', 'blocked'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="Legal retention status" value={legalDraft.retentionStatus} onChange={(event) => setLegalDraft({ ...legalDraft, retentionStatus: event.target.value as typeof legalDraft.retentionStatus })}>{(['approved', 'blocked'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="Legal training status" value={legalDraft.trainingStatus} onChange={(event) => setLegalDraft({ ...legalDraft, trainingStatus: event.target.value as typeof legalDraft.trainingStatus })}>{(['opt_out', 'contractual_no_training', 'blocked'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="Legal copyright status" value={legalDraft.copyrightStatus} onChange={(event) => setLegalDraft({ ...legalDraft, copyrightStatus: event.target.value as typeof legalDraft.copyrightStatus })}>{(['approved', 'blocked'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <select aria-label="Legal SLA status" value={legalDraft.slaStatus} onChange={(event) => setLegalDraft({ ...legalDraft, slaStatus: event.target.value as typeof legalDraft.slaStatus })}>{(['approved', 'blocked'] as const).map((item) => <option key={item}>{item}</option>)}</select>
            <input aria-label="Legal retention days" type="number" min="0" max="3650" value={legalDraft.retentionDays} onChange={(event) => setLegalDraft({ ...legalDraft, retentionDays: event.target.value })} />
            <input aria-label="Legal evidence hash" value={legalDraft.sourceEvidenceHash} onChange={(event) => setLegalDraft({ ...legalDraft, sourceEvidenceHash: event.target.value })} placeholder="evidence sha256" />
            <input aria-label="Legal counsel reference" value={legalDraft.counselRef} onChange={(event) => setLegalDraft({ ...legalDraft, counselRef: event.target.value })} placeholder="counsel-ref" />
            <input aria-label="Legal product owner reference" value={legalDraft.productOwnerRef} onChange={(event) => setLegalDraft({ ...legalDraft, productOwnerRef: event.target.value })} placeholder="product-owner-ref" />
            <input aria-label="Legal valid from" type="datetime-local" value={legalDraft.validFrom} onChange={(event) => setLegalDraft({ ...legalDraft, validFrom: event.target.value })} />
            <input aria-label="Legal expiry" type="datetime-local" value={legalDraft.expiresAt} onChange={(event) => setLegalDraft({ ...legalDraft, expiresAt: event.target.value })} />
            <button className="primary-button" type="button" onClick={createLegalReview} disabled={busy || !legalDraft.providerId || !legalDraft.modelVersionId || !legalDraft.sourceEvidenceHash || !legalDraft.counselRef || !legalDraft.productOwnerRef}><Scale size={17} />{isZh ? '追加审查' : 'Append review'}</button>
          </div>}
        </>}
        {governanceMode === 'secrets' && canManage && <div className="model-governance-form">
          <select aria-label="SecretRef Provider" value={secretDraft.providerId} onChange={(event) => setSecretDraft({ ...secretDraft, providerId: event.target.value })}><option value="">Provider</option>{providers.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
          <select aria-label="SecretRef environment" value={secretDraft.environment} onChange={(event) => setSecretDraft({ ...secretDraft, environment: event.target.value as ModelDeploymentEnvironment })}>{(['development', 'staging', 'production'] as ModelDeploymentEnvironment[]).map((item) => <option key={item}>{item}</option>)}</select>
          <input aria-label="SecretRef purpose" value={secretDraft.purpose} onChange={(event) => setSecretDraft({ ...secretDraft, purpose: event.target.value })} placeholder="inference" />
          <input aria-label="SecretRef reference" value={secretDraft.secretRef} onChange={(event) => setSecretDraft({ ...secretDraft, secretRef: event.target.value })} placeholder="secret://env/deployment-secret-name" />
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
          <select aria-label="Promotion evaluation run" value={promotionDraft.evaluationRunId} onChange={(event) => setPromotionDraft({ ...promotionDraft, evaluationRunId: event.target.value })}><option value="">{isZh ? '评测证据' : 'Evaluation evidence'}</option>{evaluationRuns.filter((item) => item.status === 'passed' && item.baselineRunId && item.modelDeploymentId === promotionDraft.modelDeploymentId && Date.parse(item.expiresAt) > evaluationReferenceTime).map((item) => <option value={item.id} key={item.id}>{item.qualityScoreBps} / {item.safetyScoreBps} · {item.reportHash.slice(0, 8)}</option>)}</select>
          <select aria-label="Promotion legal review" value={promotionDraft.legalReviewId} onChange={(event) => setPromotionDraft({ ...promotionDraft, legalReviewId: event.target.value })}><option value="">{isZh ? '法务证据' : 'Legal evidence'}</option>{legalReviews.filter((item) => {
            const deployment = deployments.find((candidate) => candidate.id === promotionDraft.modelDeploymentId)
            return item.decision === 'approved' && item.environment === 'production' && item.modelVersionId === deployment?.modelVersionId && item.allowedRegions.includes(deployment?.region.toLowerCase() ?? '') && Date.parse(item.validFrom) <= evaluationReferenceTime && Date.parse(item.expiresAt) > evaluationReferenceTime && !legalReviews.some((candidate) => candidate.scopeKey === item.scopeKey && candidate.version > item.version)
          }).map((item) => <option value={item.id} key={item.id}>v{item.version} · {item.evidenceHash.slice(0, 8)}</option>)}</select>
          <input aria-label="Promotion artifact version" value={promotionDraft.artifactVersion} onChange={(event) => setPromotionDraft({ ...promotionDraft, artifactVersion: event.target.value })} placeholder="artifact-version" />
          <input aria-label="Promotion rollback version" value={promotionDraft.rollbackVersion} onChange={(event) => setPromotionDraft({ ...promotionDraft, rollbackVersion: event.target.value })} placeholder="rollback-version" />
          <input aria-label="Promotion summary" value={promotionDraft.summary} onChange={(event) => setPromotionDraft({ ...promotionDraft, summary: event.target.value })} placeholder={isZh ? '提升摘要' : 'Promotion summary'} />
          <button className="primary-button" type="button" onClick={requestPromotion} disabled={busy || !promotionDraft.modelDeploymentId || !promotionDraft.routePolicyId || !promotionDraft.routePolicyRevisionId || !promotionDraft.providerSecretRefId || !promotionDraft.evaluationRunId || !promotionDraft.legalReviewId || !promotionDraft.artifactVersion || !promotionDraft.rollbackVersion || !promotionDraft.summary}><ShieldCheck size={17} />{isZh ? '提交审批' : 'Request approval'}</button>
        </div>}
        <div className="model-governance-list">
          {governanceMode === 'decisions' && routeDecisions.map((item) => <div key={item.id}><span><strong>{item.status}</strong><small>{item.modality} · {item.environment} · {item.reasonCode}</small></span><code>{item.subjectHash.slice(0, 12)}</code><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}
          {governanceMode === 'secrets' && secretRefs.map((item) => <div key={item.id}><span><strong>{item.purpose} · {item.externalVersion}</strong><small>{item.secretRef} · {item.environment}</small></span><code>{item.ownerRef}</code><time>{item.expiresAt ? new Date(item.expiresAt).toLocaleString() : 'no expiry'}</time></div>)}
          {governanceMode === 'promotions' && promotions.map((item) => <div key={item.id}><span><strong>{item.releaseChange.status}</strong><small>{item.modelDeploymentId} · {item.releaseChange.artifactVersion}</small></span><code>{item.releaseChangeId}</code><time>{new Date(item.createdAt).toLocaleString()}</time></div>)}
          {governanceMode === 'evaluations' && evaluationRuns.map((item) => <div key={item.id}><span><strong>{item.status} · {item.qualityScoreBps}/{item.safetyScoreBps}</strong><small>{item.suite?.suiteKey ?? item.suiteId} · {item.baselineRunId ? `delta ${item.regressionDeltaBps ?? 0}` : (isZh ? '基线' : 'baseline')}</small></span><code>{item.reportHash.slice(0, 12)}</code><time>{new Date(item.completedAt).toLocaleString()}</time></div>)}
          {governanceMode === 'legal' && legalReviews.map((item) => <div key={item.id}><span><strong>{item.decision} · {item.environment}</strong><small>{item.provider?.name ?? item.providerId} · {item.modelVersion?.versionKey ?? item.modelVersionId} · {item.allowedRegions.join(', ')}</small></span><code>v{item.version} · {item.evidenceHash.slice(0, 10)}</code><time>{new Date(item.expiresAt).toLocaleString()}</time></div>)}
          {governanceMode === 'operations' && providerOperations.map((item) => <div key={item.id}><span><strong>{item.provider?.name ?? item.providerId} · {item.environment}</strong><small>{item.workspace} · {item.readiness.ready ? (isZh ? '就绪' : 'ready') : item.readiness.reasonCode} · {item.maxRequestsPerMinute}/min · {item.rate?.inFlightCount ?? 0}/{item.maxConcurrentRequests} concurrent · {item.health?.status ?? 'health unknown'} · {item.cost?.actualMicros ?? '0'} {item.currency} micros</small></span><code>{item.status} · v{item.version}</code>{canTransition && <button className="ghost-button small" type="button" onClick={() => transitionOperations(item, item.status === 'active' ? 'disabled' : 'active')} disabled={busy}>{item.status === 'active' ? (isZh ? '停用' : 'Disable') : (isZh ? '启用' : 'Activate')}</button>}</div>)}
          {((governanceMode === 'operations' && !providerOperations.length) || (governanceMode === 'evaluations' && !evaluationRuns.length) || (governanceMode === 'legal' && !legalReviews.length) || (governanceMode === 'decisions' && !routeDecisions.length) || (governanceMode === 'secrets' && !secretRefs.length) || (governanceMode === 'promotions' && !promotions.length)) && <div className="empty-state">{isZh ? '暂无记录' : 'No records'}</div>}
        </div>
      </section>
    </section>
  )
}
