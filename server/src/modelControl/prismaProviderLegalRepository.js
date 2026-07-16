import { HttpError } from '../common/errors/httpError.js'
import { assertProviderLegalApproval, providerLegalScopeKey } from './providerLegalRuntime.js'

const iso = (value) => value?.toISOString?.() ?? value ?? null
const providerDto = (provider) => provider ? { id: provider.id, key: provider.key, name: provider.name } : null
const modelVersionDto = (modelVersion) => modelVersion ? { id: modelVersion.id, versionKey: modelVersion.versionKey, model: providerDto(modelVersion.model) } : null
const reviewDto = (row) => {
  if (!row) return null
  const { provider, modelVersion, ...review } = row
  return { ...review, reviewedAt: iso(row.reviewedAt), validFrom: iso(row.validFrom), expiresAt: iso(row.expiresAt), createdAt: iso(row.createdAt), provider: providerDto(provider), modelVersion: modelVersionDto(modelVersion) }
}
const include = {
  provider: { select: { id: true, key: true, name: true } },
  modelVersion: { select: { id: true, versionKey: true, model: { select: { id: true, key: true, name: true } } } },
}
const conflict = (error) => {
  if (error instanceof HttpError) throw error
  if (error?.code === 'P2002') throw new HttpError(409, 'LEGAL_REVIEW_CONFLICT', 'immutable Provider legal evidence already exists')
  if (error?.code === 'P2003') throw new HttpError(422, 'LEGAL_REVIEW_REFERENCE_NOT_FOUND', 'referenced Provider legal resource does not exist')
  if (error?.code === 'P2034') throw new HttpError(409, 'LEGAL_REVIEW_STATE_CONFLICT', 'Provider legal evidence changed concurrently; retry with current state')
  throw error
}
const page = (rows, options) => {
  const items = rows.slice(0, options.limit)
  return { items: items.map(reviewDto), limit: options.limit, nextCursor: rows.length > options.limit ? items.at(-1)?.id ?? null : null }
}

export const createPrismaProviderLegalRepository = (client) => ({
  createReview: async (input) => {
    try {
      return reviewDto(await client.$transaction(async (tx) => {
        const scopeKey = providerLegalScopeKey(input)
        await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `provider-legal:${scopeKey}`)
        const duplicate = await tx.providerLegalReview.findUnique({ where: { sourceKey: input.sourceKey }, include })
        if (duplicate) {
          if (duplicate.evidenceHash !== input.evidenceHash) throw new HttpError(409, 'LEGAL_REVIEW_SOURCE_CONFLICT', 'legal review source key already records different evidence')
          return duplicate
        }
        const [provider, modelVersion, current] = await Promise.all([
          tx.provider.findUnique({ where: { id: input.providerId } }),
          tx.modelVersion.findUnique({ where: { id: input.modelVersionId }, include: { model: true } }),
          tx.providerLegalReview.findFirst({ where: { scopeKey }, orderBy: { version: 'desc' } }),
        ])
        if (!provider || !modelVersion) throw new HttpError(422, 'LEGAL_REVIEW_REFERENCE_NOT_FOUND', 'Provider and model version must exist')
        if (modelVersion.model.providerId !== provider.id) throw new HttpError(422, 'LEGAL_REVIEW_PROVIDER_MISMATCH', 'model version does not belong to the selected Provider')
        if (input.version !== (current?.version ?? 0) + 1) throw new HttpError(409, 'LEGAL_REVIEW_VERSION_CONFLICT', 'legal review versions must be appended sequentially per scope')
        return tx.providerLegalReview.create({
          data: { ...input, scopeKey, reviewedAt: new Date(input.reviewedAt), validFrom: new Date(input.validFrom), expiresAt: new Date(input.expiresAt) },
          include,
        })
      }, { isolationLevel: 'Serializable' }))
    } catch (error) { return conflict(error) }
  },
  findReview: async (id) => reviewDto(await client.providerLegalReview.findUnique({ where: { id: String(id) }, include })),
  listReviews: async (options) => {
    const pageCursor = options.cursor ? await client.providerLegalReview.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return page(await client.providerLegalReview.findMany({
      where: {
        ...(options.providerId ? { providerId: options.providerId } : {}),
        ...(options.modelVersionId ? { modelVersionId: options.modelVersionId } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
        ...(options.decision ? { decision: options.decision } : {}),
      },
      include, orderBy: [{ createdAt: options.order }, { id: options.order }], take: options.limit + 1,
      ...(pageCursor ? { cursor: { id: pageCursor.id }, skip: 1 } : {}),
    }), options)
  },
  findLatestForScope: async (scope) => reviewDto(await client.providerLegalReview.findFirst({ where: { scopeKey: providerLegalScopeKey(scope) }, include, orderBy: { version: 'desc' } })),
  assertPromotionEvidence: async (reviewId, deployment) => {
    const [review, fullDeployment] = await Promise.all([
      client.providerLegalReview.findUnique({ where: { id: String(reviewId) }, include }),
      client.modelDeployment.findUnique({ where: { id: deployment.id }, include: { modelVersion: { include: { model: true } } } }),
    ])
    if (!fullDeployment) throw new HttpError(422, 'LEGAL_REVIEW_DEPLOYMENT_NOT_FOUND', 'promoted deployment does not exist')
    const latestReview = review ? await client.providerLegalReview.findFirst({ where: { scopeKey: review.scopeKey }, include, orderBy: { version: 'desc' } }) : null
    try { return assertProviderLegalApproval({ review: reviewDto(review), latestReview: reviewDto(latestReview), deployment: fullDeployment, providerId: fullDeployment?.modelVersion?.model?.providerId }) } catch (error) {
      throw new HttpError(409, 'PROMOTION_LEGAL_BLOCKED', error.message)
    }
  },
  exportAll: async () => ({ schemaVersion: 1, exportedAt: new Date().toISOString(), reviews: (await client.providerLegalReview.findMany({ include, orderBy: { createdAt: 'asc' }, take: 10000 })).map(reviewDto) }),
})
