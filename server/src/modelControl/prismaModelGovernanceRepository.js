import { HttpError } from '../common/errors/httpError.js'
import {
  isProviderSecretPurposeDeletable,
  providerSecretRetentionContract,
  providerSecretRetentionCutoff,
  providerSecretRetentionSweepLimit,
} from './providerSecretRetention.js'

const iso = (value) => value?.toISOString?.() ?? value ?? null
const decisionDto = (row) => row ? ({ ...row, createdAt: iso(row.createdAt) }) : null
const secretRefDto = (row) => row ? ({ ...row, expiresAt: iso(row.expiresAt), createdAt: iso(row.createdAt) }) : null
const promotionInclude = {
  releaseChange: { include: { evidence: { orderBy: { createdAt: 'asc' } } } },
  modelDeployment: true,
  routePolicy: true,
  routePolicyRevision: true,
  providerSecretRef: true,
  evaluationRun: { include: { policy: true } },
  legalReview: true,
}
const promotionDto = (row) => row ? ({
  ...row,
  createdAt: iso(row.createdAt),
  providerSecretRef: secretRefDto(row.providerSecretRef),
  routePolicyRevision: row.routePolicyRevision ? { ...row.routePolicyRevision, createdAt: iso(row.routePolicyRevision.createdAt) } : undefined,
  releaseChange: row.releaseChange ? {
    ...row.releaseChange,
    requestedAt: iso(row.releaseChange.requestedAt), approvedAt: iso(row.releaseChange.approvedAt), appliedAt: iso(row.releaseChange.appliedAt),
    rolledBackAt: iso(row.releaseChange.rolledBackAt), createdAt: iso(row.releaseChange.createdAt), updatedAt: iso(row.releaseChange.updatedAt),
    evidence: row.releaseChange.evidence?.map((item) => ({ ...item, createdAt: iso(item.createdAt) })),
  } : undefined,
}) : null
const page = (rows, options, mapper) => {
  const items = rows.slice(0, options.limit)
  return { items: items.map(mapper), limit: options.limit, nextCursor: rows.length > options.limit ? items.at(-1)?.id ?? null : null }
}
const conflict = (error) => {
  if (error?.code === 'P2002') throw new HttpError(409, 'RESOURCE_CONFLICT', 'the immutable governance fact already exists')
  if (error?.code === 'P2003') throw new HttpError(422, 'REFERENCE_NOT_FOUND', 'referenced model governance resource does not exist')
  if (error?.code === 'P2034') throw new HttpError(409, 'STATE_CONFLICT', 'model governance state changed concurrently; retry with current state')
  throw error
}

export const createPrismaModelGovernanceRepository = (client, { modelEvaluation, providerLegal, recordAudit } = {}) => ({
  createDecision: async (input) => {
    try { return decisionDto(await client.modelRouteDecision.create({ data: input })) } catch (error) { return conflict(error) }
  },
  findDecision: async (id) => decisionDto(await client.modelRouteDecision.findUnique({ where: { id: String(id) } })),
  listDecisions: async (options) => {
    const pageCursor = options.cursor ? await client.modelRouteDecision.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return page(await client.modelRouteDecision.findMany({
      where: {
        ...(options.source ? { source: options.source } : {}), ...(options.status ? { status: options.status } : {}),
        ...(options.modality ? { modality: options.modality } : {}), ...(options.environment ? { environment: options.environment } : {}),
        ...(options.policyId ? { policyId: options.policyId } : {}),
      },
      orderBy: [{ [options.sort]: options.order }, { id: options.order }], take: options.limit + 1,
      ...(pageCursor ? { cursor: { id: pageCursor.id }, skip: 1 } : {}),
    }), options, decisionDto)
  },
  createSecretRef: async (input) => {
    try {
      return await client.$transaction(async (tx) => {
        const scope = `${input.providerId}:${input.environment}:${input.purpose}`
        await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', scope)
        const latest = await tx.providerSecretRef.findFirst({ where: { providerId: input.providerId, environment: input.environment, purpose: input.purpose, rotatedTo: null } })
        if (!latest && input.rotatedFromId) throw new HttpError(422, 'SECRET_REF_ROTATION_SOURCE_NOT_FOUND', 'rotation source SecretRef does not exist')
        if (latest && input.rotatedFromId !== latest.id) throw new HttpError(409, 'SECRET_REF_ROTATION_REQUIRED', 'new SecretRef versions must rotate the current scope version')
        return secretRefDto(await tx.providerSecretRef.create({ data: { ...input, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } }))
      }, { isolationLevel: 'Serializable' })
    } catch (error) { return conflict(error) }
  },
  findSecretRef: async (id) => secretRefDto(await client.providerSecretRef.findUnique({ where: { id: String(id) } })),
  findCurrentSecretRef: async ({ providerId, environment, purpose, now = new Date() }) => secretRefDto(await client.providerSecretRef.findFirst({
    where: { providerId, environment, purpose, rotatedTo: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: 'desc' },
  })),
  listSecretRefs: async (options) => {
    const pageCursor = options.cursor ? await client.providerSecretRef.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return page(await client.providerSecretRef.findMany({
      where: {
        ...(options.providerId ? { providerId: options.providerId } : {}), ...(options.environment ? { environment: options.environment } : {}),
        ...(options.purpose ? { purpose: options.purpose } : {}),
        ...(options.search ? { OR: [{ purpose: { contains: options.search, mode: 'insensitive' } }, { ownerRef: { contains: options.search, mode: 'insensitive' } }, { externalVersion: { contains: options.search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ [options.sort]: options.order }, { id: options.order }], take: options.limit + 1,
      ...(pageCursor ? { cursor: { id: pageCursor.id }, skip: 1 } : {}),
    }), options, secretRefDto)
  },
  sweepSecretRetention: async ({ now = new Date(), limit, gateway } = {}) => {
    if (typeof gateway !== 'function') throw new HttpError(503, 'SECRET_MANAGER_LIFECYCLE_UNAVAILABLE', 'Managed secret lifecycle gateway is unavailable')
    const cutoff = providerSecretRetentionCutoff(now)
    const take = providerSecretRetentionSweepLimit(limit)
    const discovered = await client.$queryRawUnsafe(`
      SELECT retired.id
      FROM provider_secret_refs retired
      JOIN provider_secret_refs replacement ON replacement.rotated_from_id = retired.id
      WHERE retired.purpose IN ('inference', 'chat-inference', 'image-inference', 'music-inference', 'video-inference')
        AND (
          NOT EXISTS (SELECT 1 FROM provider_secret_lifecycle_receipts receipt WHERE receipt.secret_ref_id = retired.id AND receipt.action = 'disable')
          OR (
            replacement.created_at <= $1
            AND EXISTS (SELECT 1 FROM provider_secret_lifecycle_receipts receipt WHERE receipt.secret_ref_id = retired.id AND receipt.action = 'disable')
            AND NOT EXISTS (SELECT 1 FROM provider_secret_lifecycle_receipts receipt WHERE receipt.secret_ref_id = retired.id AND receipt.action = 'delete')
          )
        )
      ORDER BY replacement.created_at, retired.id
      LIMIT $2`, cutoff, take)
    let disabled = 0
    let deleted = 0
    let skipped = 0
    for (const candidate of discovered) {
      const current = await client.providerSecretRef.findUnique({
        where: { id: candidate.id },
        include: { rotatedTo: true, lifecycleReceipts: true },
      })
      if (!current?.rotatedTo || !isProviderSecretPurposeDeletable(current.purpose)) { skipped += 1; continue }
      const disabledReceipt = current.lifecycleReceipts.find((receipt) => receipt.action === 'disable')
      const deletedReceipt = current.lifecycleReceipts.find((receipt) => receipt.action === 'delete')
      const action = !disabledReceipt ? 'disable' : (!deletedReceipt && current.rotatedTo.createdAt <= cutoff ? 'delete' : null)
      if (!action) { skipped += 1; continue }
      const result = await gateway({ action, secretRef: current.secretRef, externalVersion: current.externalVersion, purpose: current.purpose, now })
      const recorded = await client.$transaction(async (db) => {
        await db.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `provider-secret-retention:${current.id}`)
        const fresh = await db.providerSecretRef.findUnique({ where: { id: current.id } })
        if (!fresh || !isProviderSecretPurposeDeletable(fresh.purpose)) return false
        const rotatedTo = await db.providerSecretRef.findFirst({ where: { rotatedFromId: fresh.id } })
        if (!rotatedTo) return false
        const lifecycleReceipts = await db.providerSecretLifecycleReceipt.findMany({ where: { secretRefId: fresh.id } })
        if (lifecycleReceipts.some((receipt) => receipt.action === action)) return false
        if (action === 'delete' && (!lifecycleReceipts.some((receipt) => receipt.action === 'disable') || rotatedTo.createdAt > cutoff)) return false
        await db.providerSecretLifecycleReceipt.create({ data: {
          secretRefId: fresh.id,
          action,
          targetHash: result.targetHash,
          receiptHash: result.receiptHash,
          completedAt: new Date(result.completedAt),
        } })
        return true
      }, { isolationLevel: 'ReadCommitted' })
      if (!recorded) skipped += 1
      else if (action === 'disable') disabled += 1
      else deleted += 1
    }
    const summary = { policyId: providerSecretRetentionContract.policyId, inspected: discovered.length, disabled, deleted, skipped }
    await recordAudit?.({ actor: null, action: 'system.model_control.provider_secret_retention_processed', resourceType: 'provider_secret_retention', resourceId: providerSecretRetentionContract.policyId, metadata: summary })
    return summary
  },
  validatePromotion: async (input, release) => {
    const deployment = await client.modelDeployment.findUnique({ where: { id: input.modelDeploymentId }, include: { modelVersion: { include: { model: true } } } })
    const policy = await client.modelRoutePolicy.findUnique({ where: { id: input.routePolicyId }, include: { targets: true } })
    const revision = await client.modelRoutePolicyRevision.findUnique({ where: { id: input.routePolicyRevisionId } })
    const latestRevision = await client.modelRoutePolicyRevision.findFirst({ where: { policyId: input.routePolicyId }, orderBy: { revisionNumber: 'desc' } })
    const secretRef = await client.providerSecretRef.findUnique({ where: { id: input.providerSecretRefId } })
    const conflictingPromotion = await client.modelPromotion.findFirst({ where: { modelDeploymentId: input.modelDeploymentId, releaseChange: { status: { in: ['pending_approval', 'approved', 'deployed'] } } } })
    if (!deployment || !policy || !revision || !secretRef) throw new HttpError(422, 'PROMOTION_REFERENCE_NOT_FOUND', 'promotion references must all exist')
    if (deployment.environment !== 'production' || policy.environment !== 'production' || secretRef.environment !== 'production') throw new HttpError(422, 'PROMOTION_ENVIRONMENT_MISMATCH', 'deployment, route policy, and SecretRef must target production')
    if (policy.status !== 'active') throw new HttpError(409, 'PROMOTION_POLICY_INACTIVE', 'production route policy must be active before promotion')
    if (revision.policyId !== policy.id) throw new HttpError(422, 'PROMOTION_REVISION_MISMATCH', 'route policy revision does not belong to the selected policy')
    if (latestRevision?.id !== revision.id) throw new HttpError(409, 'PROMOTION_REVISION_STALE', 'only the current route policy revision can be promoted')
    if (!policy.targets.some((target) => target.modelDeploymentId === deployment.id && target.enabled)) throw new HttpError(422, 'PROMOTION_ROUTE_TARGET_MISMATCH', 'production deployment must be an enabled target of the selected route policy')
    if (deployment.modelVersion.model.providerId !== secretRef.providerId) throw new HttpError(422, 'PROMOTION_PROVIDER_MISMATCH', 'SecretRef provider does not match the deployment provider')
    if (secretRef.expiresAt && secretRef.expiresAt <= new Date()) throw new HttpError(409, 'PROMOTION_SECRET_EXPIRED', 'expired SecretRef cannot be promoted')
    const latestSecretRef = await client.providerSecretRef.findFirst({ where: { providerId: secretRef.providerId, environment: secretRef.environment, purpose: secretRef.purpose, rotatedTo: null } })
    if (latestSecretRef?.id !== secretRef.id) throw new HttpError(409, 'PROMOTION_SECRET_STALE', 'only the current SecretRef version can be promoted')
    if (release?.artifactVersion !== deployment.modelVersion.versionKey) throw new HttpError(422, 'PROMOTION_ARTIFACT_MISMATCH', 'artifactVersion must match the production deployment model version')
    await modelEvaluation.assertPromotionEvidence(input.evaluationRunId, deployment)
    await providerLegal.assertPromotionEvidence(input.legalReviewId, deployment)
    if (conflictingPromotion) throw new HttpError(409, 'PROMOTION_ALREADY_ACTIVE', 'production deployment already has an active or pending promotion')
    return true
  },
  findPromotion: async (id) => promotionDto(await client.modelPromotion.findUnique({ where: { id: String(id) }, include: promotionInclude })),
  findPromotionByReleaseChange: async (releaseChangeId) => promotionDto(await client.modelPromotion.findUnique({ where: { releaseChangeId: String(releaseChangeId) }, include: promotionInclude })),
  findDeployedPromotionForDeployment: async (modelDeploymentId) => promotionDto(await client.modelPromotion.findFirst({
    where: { modelDeploymentId: String(modelDeploymentId), releaseChange: { status: 'deployed' } },
    include: promotionInclude,
    orderBy: { createdAt: 'desc' },
  })),
  listPromotions: async (options) => {
    const pageCursor = options.cursor ? await client.modelPromotion.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return page(await client.modelPromotion.findMany({
      where: {
        ...(options.modelDeploymentId ? { modelDeploymentId: options.modelDeploymentId } : {}),
        ...(options.status ? { releaseChange: { status: options.status } } : {}),
      }, include: promotionInclude, orderBy: [{ createdAt: options.order }, { id: options.order }], take: options.limit + 1,
      ...(pageCursor ? { cursor: { id: pageCursor.id }, skip: 1 } : {}),
    }), options, promotionDto)
  },
  exportAll: async () => ({
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    decisions: (await client.modelRouteDecision.findMany({ orderBy: { createdAt: 'asc' }, take: 10000 })).map(decisionDto),
    secretRefs: (await client.providerSecretRef.findMany({ orderBy: { createdAt: 'asc' }, take: 10000 })).map(secretRefDto),
    promotions: (await client.modelPromotion.findMany({ include: promotionInclude, orderBy: { createdAt: 'asc' }, take: 10000 })).map(promotionDto),
  }),
})
