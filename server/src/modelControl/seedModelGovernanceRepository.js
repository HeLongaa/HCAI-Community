import { HttpError } from '../common/errors/httpError.js'

const copy = (value) => structuredClone(value)
const nowIso = () => new Date().toISOString()
const paginate = (items, options) => {
  const start = options.cursor ? Math.max(0, items.findIndex((item) => item.id === options.cursor) + 1) : 0
  const selected = items.slice(start, start + options.limit)
  return { items: copy(selected), limit: options.limit, nextCursor: items.length > start + options.limit ? selected.at(-1)?.id ?? null : null }
}

export const createSeedModelGovernanceRepository = ({ modelControl, modelRouting, releaseChanges }) => {
  const decisions = new Map()
  const secretRefs = new Map()
  const promotions = new Map()
  const sorted = (map, field = 'createdAt', order = 'desc') => [...map.values()].sort((left, right) => {
    const result = String(left[field] ?? '').localeCompare(String(right[field] ?? '')) || left.id.localeCompare(right.id)
    return order === 'asc' ? result : -result
  })
  return {
    createDecision: async (input) => {
      const row = { ...copy(input), createdAt: nowIso() }
      decisions.set(row.id, row)
      return copy(row)
    },
    findDecision: async (id) => copy(decisions.get(String(id)) ?? null),
    listDecisions: async (options) => paginate(sorted(decisions, options.sort, options.order)
      .filter((row) => !options.source || row.source === options.source)
      .filter((row) => !options.status || row.status === options.status)
      .filter((row) => !options.modality || row.modality === options.modality)
      .filter((row) => !options.environment || row.environment === options.environment)
      .filter((row) => !options.policyId || row.policyId === options.policyId), options),
    createSecretRef: async (input) => {
      if ([...secretRefs.values()].some((row) => row.secretRef === input.secretRef && row.externalVersion === input.externalVersion)) throw new HttpError(409, 'RESOURCE_CONFLICT', 'the immutable SecretRef version already exists')
      const provider = await modelControl.find('provider', input.providerId)
      if (!provider) throw new HttpError(422, 'REFERENCE_NOT_FOUND', 'Provider does not exist')
      const latest = [...secretRefs.values()].find((row) => row.providerId === input.providerId && row.environment === input.environment && row.purpose === input.purpose && ![...secretRefs.values()].some((candidate) => candidate.rotatedFromId === row.id))
      if (!latest && input.rotatedFromId) throw new HttpError(422, 'SECRET_REF_ROTATION_SOURCE_NOT_FOUND', 'rotation source SecretRef does not exist')
      if (latest && input.rotatedFromId !== latest.id) throw new HttpError(409, 'SECRET_REF_ROTATION_REQUIRED', 'new SecretRef versions must rotate the current scope version')
      const row = { ...copy(input), createdAt: nowIso() }
      secretRefs.set(row.id, row)
      return copy(row)
    },
    findSecretRef: async (id) => copy(secretRefs.get(String(id)) ?? null),
    listSecretRefs: async (options) => paginate(sorted(secretRefs, options.sort, options.order)
      .filter((row) => !options.providerId || row.providerId === options.providerId)
      .filter((row) => !options.environment || row.environment === options.environment)
      .filter((row) => !options.purpose || row.purpose === options.purpose)
      .filter((row) => !options.search || `${row.purpose} ${row.ownerRef} ${row.externalVersion}`.toLowerCase().includes(options.search.toLowerCase())), options),
    validatePromotion: async (input, release) => {
      const [deployment, policy, revisions, secretRef] = await Promise.all([
        modelControl.findRoutingDeployment(input.modelDeploymentId), modelRouting.find(input.routePolicyId), modelRouting.listRevisions(input.routePolicyId), Promise.resolve(secretRefs.get(input.providerSecretRefId)),
      ])
      const revision = revisions.find((item) => item.id === input.routePolicyRevisionId)
      if (!deployment || !policy || !revision || !secretRef) throw new HttpError(422, 'PROMOTION_REFERENCE_NOT_FOUND', 'promotion references must all exist')
      if (deployment.environment !== 'production' || policy.environment !== 'production' || secretRef.environment !== 'production') throw new HttpError(422, 'PROMOTION_ENVIRONMENT_MISMATCH', 'deployment, route policy, and SecretRef must target production')
      if (policy.status !== 'active') throw new HttpError(409, 'PROMOTION_POLICY_INACTIVE', 'production route policy must be active before promotion')
      if (revisions[0]?.id !== revision.id) throw new HttpError(409, 'PROMOTION_REVISION_STALE', 'only the current route policy revision can be promoted')
      if (!policy.targets.some((target) => target.modelDeploymentId === deployment.id && target.enabled)) throw new HttpError(422, 'PROMOTION_ROUTE_TARGET_MISMATCH', 'production deployment must be an enabled target of the selected route policy')
      if (deployment.modelVersion?.model?.providerId !== secretRef.providerId) throw new HttpError(422, 'PROMOTION_PROVIDER_MISMATCH', 'SecretRef provider does not match the deployment provider')
      if (secretRef.expiresAt && Date.parse(secretRef.expiresAt) <= Date.now()) throw new HttpError(409, 'PROMOTION_SECRET_EXPIRED', 'expired SecretRef cannot be promoted')
      const latestSecretRef = [...secretRefs.values()].find((item) => item.providerId === secretRef.providerId && item.environment === secretRef.environment && item.purpose === secretRef.purpose && ![...secretRefs.values()].some((candidate) => candidate.rotatedFromId === item.id))
      if (latestSecretRef?.id !== secretRef.id) throw new HttpError(409, 'PROMOTION_SECRET_STALE', 'only the current SecretRef version can be promoted')
      if (release?.artifactVersion !== deployment.modelVersion?.versionKey) throw new HttpError(422, 'PROMOTION_ARTIFACT_MISMATCH', 'artifactVersion must match the production deployment model version')
      for (const promotion of promotions.values()) {
        if (promotion.modelDeploymentId !== input.modelDeploymentId) continue
        if (release?.id && promotion.releaseChangeId === release.id) continue
        const existingRelease = await releaseChanges.find(promotion.releaseChangeId)
        if (['pending_approval', 'approved', 'deployed'].includes(existingRelease?.status)) throw new HttpError(409, 'PROMOTION_ALREADY_ACTIVE', 'production deployment already has an active or pending promotion')
      }
      return true
    },
    recordPromotion: (releaseChangeId, input) => {
      const row = { ...copy(input), releaseChangeId, createdAt: nowIso() }
      promotions.set(row.id, row)
      return copy(row)
    },
    findPromotion: async (id) => {
      const row = promotions.get(String(id))
      if (!row) return null
      return copy({ ...row, releaseChange: await releaseChanges.find(row.releaseChangeId), providerSecretRef: secretRefs.get(row.providerSecretRefId) })
    },
    findPromotionByReleaseChange: async (releaseChangeId) => {
      const row = [...promotions.values()].find((item) => item.releaseChangeId === String(releaseChangeId))
      if (!row) return null
      return copy({ ...row, releaseChange: await releaseChanges.find(row.releaseChangeId), providerSecretRef: secretRefs.get(row.providerSecretRefId) })
    },
    listPromotions: async (options) => {
      const rows = []
      for (const row of sorted(promotions, 'createdAt', options.order)) {
        const releaseChange = await releaseChanges.find(row.releaseChangeId)
        if (options.status && releaseChange?.status !== options.status) continue
        if (options.modelDeploymentId && row.modelDeploymentId !== options.modelDeploymentId) continue
        rows.push({ ...row, releaseChange, providerSecretRef: secretRefs.get(row.providerSecretRefId) })
      }
      return paginate(rows, options)
    },
    exportAll: async () => ({ schemaVersion: 1, exportedAt: nowIso(), decisions: copy(sorted(decisions, 'createdAt', 'asc')), secretRefs: copy(sorted(secretRefs, 'createdAt', 'asc')), promotions: copy(sorted(promotions, 'createdAt', 'asc')) }),
  }
}
