import { HttpError } from '../common/errors/httpError.js'

const dto = (row) => ({
  ...row,
  requestedAt: row.requestedAt.toISOString(),
  approvedAt: row.approvedAt?.toISOString() ?? null,
  appliedAt: row.appliedAt?.toISOString() ?? null,
  rolledBackAt: row.rolledBackAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  evidence: (row.evidence ?? []).map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
  modelPromotion: row.modelPromotion ? { ...row.modelPromotion, createdAt: row.modelPromotion.createdAt.toISOString() } : null,
})

const releaseInclude = { evidence: { orderBy: { createdAt: 'asc' } }, modelPromotion: true }

const evidenceCreate = (changeId, evidence, nested = false) => ({
  id: evidence.id,
  ...(nested ? {} : { releaseChangeId: changeId }),
  eventType: evidence.eventType,
  actorRef: evidence.actorRef,
  reasonCode: evidence.reasonCode,
  evidence: evidence.evidence,
  evidenceHash: evidence.evidenceHash,
})

export const createPrismaReleaseRepository = (client) => ({
  create: async (payload) => dto(await client.$transaction(async (tx) => {
    if (payload.modelPromotion) {
      await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `model-promotion:${payload.modelPromotion.modelDeploymentId}`)
      const conflict = await tx.modelPromotion.findFirst({
        where: { modelDeploymentId: payload.modelPromotion.modelDeploymentId, releaseChange: { status: { in: ['pending_approval', 'approved', 'deployed'] } } },
        select: { id: true },
      })
      if (conflict) throw new HttpError(409, 'PROMOTION_ALREADY_ACTIVE', 'production deployment already has an active or pending promotion')
    }
    return tx.releaseChange.create({
      data: {
        id: payload.id,
        changeType: payload.changeType,
        status: payload.status,
        sourceEnvironment: payload.sourceEnvironment,
        targetEnvironment: payload.targetEnvironment,
        artifactVersion: payload.artifactVersion,
        rollbackVersion: payload.rollbackVersion,
        secretRef: payload.secretRef,
        secretVersion: payload.secretVersion,
        summary: payload.summary,
        reasonCode: payload.reasonCode,
        requestedByRef: payload.requestedByRef,
        ...(payload.modelPromotion ? { modelPromotion: { create: payload.modelPromotion } } : {}),
        evidence: { create: evidenceCreate(payload.id, payload.evidence, true) },
      },
      include: releaseInclude,
    })
  }, { isolationLevel: payload.modelPromotion ? 'Serializable' : undefined })),
  find: async (id) => {
    const row = await client.releaseChange.findUnique({ where: { id: String(id) }, include: releaseInclude })
    return row ? dto(row) : null
  },
  list: async (query = {}) => {
    const rows = await client.releaseChange.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.targetEnvironment ? { targetEnvironment: query.targetEnvironment } : {}),
        ...(query.changeType ? { changeType: query.changeType } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: releaseInclude,
    })
    const items = rows.slice(0, query.limit)
    return { items: items.map(dto), limit: query.limit, nextCursor: rows.length > query.limit ? items.at(-1)?.id ?? null : null }
  },
  transition: async (id, expectedVersion, patch) => client.$transaction(async (tx) => {
    const promotion = await tx.modelPromotion.findUnique({
      where: { releaseChangeId: String(id) },
      include: {
        releaseChange: true,
        modelDeployment: { include: { modelVersion: { include: { model: true } } } },
        routePolicy: { include: { targets: true, revisions: { orderBy: { revisionNumber: 'desc' }, take: 1 } } },
        providerSecretRef: true,
        evaluationRun: { include: { policy: true } },
        legalReview: true,
      },
    })
    const lifecycleStatus = ['deployed', 'failed', 'rolled_back'].includes(patch.status)
    if (promotion && lifecycleStatus && patch.evidence?.evidence?.deploymentId !== promotion.modelDeploymentId) {
      throw new HttpError(422, 'PROMOTION_DEPLOYMENT_MISMATCH', 'model promotion deployment evidence does not match the approved deployment')
    }
    if (promotion && patch.status === 'deployed') {
      if (promotion.routePolicy.status !== 'active' || promotion.routePolicy.revisions[0]?.id !== promotion.routePolicyRevisionId) {
        throw new HttpError(409, 'PROMOTION_ROUTE_CHANGED', 'production route must remain active at its approved revision')
      }
      if (!promotion.routePolicy.targets.some((target) => target.modelDeploymentId === promotion.modelDeploymentId && target.enabled)) {
        throw new HttpError(409, 'PROMOTION_ROUTE_TARGET_CHANGED', 'production deployment is no longer an enabled route target')
      }
      if (promotion.providerSecretRef.expiresAt && promotion.providerSecretRef.expiresAt <= new Date()) {
        throw new HttpError(409, 'PROMOTION_SECRET_EXPIRED', 'SecretRef expired before promotion was applied')
      }
      const latestSecretRef = await tx.providerSecretRef.findFirst({
        where: { providerId: promotion.providerSecretRef.providerId, environment: promotion.providerSecretRef.environment, purpose: promotion.providerSecretRef.purpose, rotatedTo: null },
      })
      if (latestSecretRef?.id !== promotion.providerSecretRefId) throw new HttpError(409, 'PROMOTION_SECRET_CHANGED', 'approved SecretRef is no longer the current scope version')
      if (promotion.releaseChange.artifactVersion !== promotion.modelDeployment.modelVersion.versionKey) {
        throw new HttpError(409, 'PROMOTION_ARTIFACT_CHANGED', 'approved artifact no longer matches the production deployment')
      }
      if (!promotion.evaluationRun || promotion.evaluationRun.status !== 'passed' || !promotion.evaluationRun.baselineRunId) {
        throw new HttpError(409, 'PROMOTION_EVALUATION_BLOCKED', 'approved promotion no longer has passing regression evidence')
      }
      if (promotion.evaluationRun.expiresAt <= new Date()) throw new HttpError(409, 'PROMOTION_EVALUATION_EXPIRED', 'evaluation evidence expired before promotion was applied')
      if (promotion.evaluationRun.modelDeploymentId !== promotion.modelDeploymentId || promotion.evaluationRun.modelVersionId !== promotion.modelDeployment.modelVersionId || promotion.evaluationRun.policy.environment !== 'production') {
        throw new HttpError(409, 'PROMOTION_EVALUATION_CHANGED', 'evaluation evidence no longer matches the production deployment')
      }
      if (!promotion.legalReview || promotion.legalReview.decision !== 'approved') throw new HttpError(409, 'PROMOTION_LEGAL_BLOCKED', 'approved promotion no longer has passing Provider legal evidence')
      const latestLegalReview = await tx.providerLegalReview.findFirst({ where: { scopeKey: promotion.legalReview.scopeKey }, orderBy: { version: 'desc' } })
      if (latestLegalReview?.id !== promotion.legalReviewId) throw new HttpError(409, 'PROMOTION_LEGAL_CHANGED', 'Provider legal evidence is no longer the current scope version')
      if (promotion.legalReview.validFrom > new Date() || promotion.legalReview.expiresAt <= new Date()) throw new HttpError(409, 'PROMOTION_LEGAL_EXPIRED', 'Provider legal evidence is not currently valid')
      if (promotion.legalReview.providerId !== promotion.modelDeployment.modelVersion.model.providerId || promotion.legalReview.modelVersionId !== promotion.modelDeployment.modelVersionId || promotion.legalReview.environment !== 'production' || !promotion.legalReview.allowedRegions.includes(promotion.modelDeployment.region.toLowerCase())) {
        throw new HttpError(409, 'PROMOTION_LEGAL_MISMATCH', 'Provider legal evidence no longer matches the production Provider, model, environment, and region')
      }
    }
    const changed = await tx.releaseChange.updateMany({
      where: { id: String(id), version: expectedVersion },
      data: {
        status: patch.status,
        approvedByRef: patch.approvedByRef,
        approvedAt: patch.approvedAt,
        appliedByRef: patch.appliedByRef,
        appliedAt: patch.appliedAt,
        rolledBackByRef: patch.rolledBackByRef,
        rolledBackAt: patch.rolledBackAt,
        version: { increment: 1 },
      },
    })
    if (changed.count !== 1) return null
    if (promotion && lifecycleStatus) {
      const deployment = await tx.modelDeployment.updateMany({
        where: { id: promotion.modelDeploymentId, environment: 'production', ...(patch.status === 'deployed' ? { status: 'active' } : {}) },
        data: {
          trafficEligible: patch.status === 'deployed',
          updatedByRef: patch.appliedByRef ?? patch.rolledBackByRef ?? 'release-control',
          version: { increment: 1 },
        },
      })
      if (deployment.count !== 1) throw new HttpError(409, 'PROMOTION_DEPLOYMENT_INELIGIBLE', 'model promotion deployment is not eligible for the requested release transition')
    }
    await tx.releaseEvidence.create({ data: evidenceCreate(String(id), patch.evidence) })
    return dto(await tx.releaseChange.findUnique({ where: { id: String(id) }, include: releaseInclude }))
  }),
})
