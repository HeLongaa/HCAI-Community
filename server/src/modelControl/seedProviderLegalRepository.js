import { HttpError } from '../common/errors/httpError.js'
import { assertProviderLegalApproval, providerLegalScopeKey } from './providerLegalRuntime.js'

const copy = (value) => value == null ? value : structuredClone(value)
const providerDto = (provider) => provider ? { id: provider.id, key: provider.key, name: provider.name } : null
const modelVersionDto = (modelVersion) => modelVersion ? { id: modelVersion.id, versionKey: modelVersion.versionKey, model: providerDto(modelVersion.model) } : null
const paginate = (rows, options) => {
  const start = options.cursor ? Math.max(0, rows.findIndex((item) => item.id === options.cursor) + 1) : 0
  const items = rows.slice(start, start + options.limit)
  return { items: copy(items), limit: options.limit, nextCursor: rows.length > start + options.limit ? items.at(-1)?.id ?? null : null }
}

export const createSeedProviderLegalRepository = ({ modelControl }) => {
  const reviews = new Map()
  const detail = async (row) => {
    if (!row) return null
    const [provider, modelVersion] = await Promise.all([
      modelControl.find('provider', row.providerId),
      modelControl.find('version', row.modelVersionId),
    ])
    return copy({ ...row, provider: providerDto(provider), modelVersion: modelVersionDto(modelVersion) })
  }
  const latestForScope = (scopeKey) => [...reviews.values()]
    .filter((item) => item.scopeKey === scopeKey)
    .sort((left, right) => right.version - left.version)[0] ?? null
  return {
    createReview: async (input) => {
      const duplicate = [...reviews.values()].find((item) => item.sourceKey === input.sourceKey)
      if (duplicate) {
        if (duplicate.evidenceHash !== input.evidenceHash) throw new HttpError(409, 'LEGAL_REVIEW_SOURCE_CONFLICT', 'legal review source key already records different evidence')
        return detail(duplicate)
      }
      const [provider, modelVersion] = await Promise.all([
        modelControl.find('provider', input.providerId),
        modelControl.find('version', input.modelVersionId),
      ])
      if (!provider || !modelVersion) throw new HttpError(422, 'LEGAL_REVIEW_REFERENCE_NOT_FOUND', 'Provider and model version must exist')
      if (modelVersion.model?.providerId !== provider.id) throw new HttpError(422, 'LEGAL_REVIEW_PROVIDER_MISMATCH', 'model version does not belong to the selected Provider')
      const scopeKey = providerLegalScopeKey(input)
      const current = latestForScope(scopeKey)
      if (input.version !== (current?.version ?? 0) + 1) throw new HttpError(409, 'LEGAL_REVIEW_VERSION_CONFLICT', 'legal review versions must be appended sequentially per scope')
      const row = { ...copy(input), scopeKey, createdAt: new Date().toISOString() }
      reviews.set(row.id, row)
      return detail(row)
    },
    findReview: async (id) => detail(reviews.get(String(id)) ?? null),
    listReviews: async (options) => paginate((await Promise.all([...reviews.values()]
      .filter((item) => !options.providerId || item.providerId === options.providerId)
      .filter((item) => !options.modelVersionId || item.modelVersionId === options.modelVersionId)
      .filter((item) => !options.environment || item.environment === options.environment)
      .filter((item) => !options.decision || item.decision === options.decision)
      .sort((left, right) => options.order === 'asc' ? left.createdAt.localeCompare(right.createdAt) : right.createdAt.localeCompare(left.createdAt))
      .map(detail))), options),
    findLatestForScope: async (scope) => detail(latestForScope(providerLegalScopeKey(scope))),
    assertPromotionEvidence: async (reviewId, deployment) => {
      const fullDeployment = await modelControl.findRoutingDeployment(deployment.id)
      if (!fullDeployment) throw new HttpError(422, 'LEGAL_REVIEW_DEPLOYMENT_NOT_FOUND', 'promoted deployment does not exist')
      const providerId = fullDeployment.modelVersion?.model?.providerId
      const review = reviews.get(String(reviewId)) ?? null
      const latestReview = review ? latestForScope(review.scopeKey) : null
      try { return assertProviderLegalApproval({ review, latestReview, deployment: fullDeployment, providerId }) } catch (error) {
        throw new HttpError(409, 'PROMOTION_LEGAL_BLOCKED', error.message)
      }
    },
    exportAll: async () => ({ schemaVersion: 1, exportedAt: new Date().toISOString(), reviews: await Promise.all([...reviews.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(detail)) }),
  }
}
