import { HttpError } from '../common/errors/httpError.js'
import { assertPromotionEvaluation, buildEvaluationEvidence } from './modelEvaluationRuntime.js'

const copy = (value) => structuredClone(value)
const nowIso = () => new Date().toISOString()
const paginate = (items, options) => {
  const start = options.cursor ? Math.max(0, items.findIndex((item) => item.id === options.cursor) + 1) : 0
  const selected = items.slice(start, start + options.limit)
  return { items: copy(selected), limit: options.limit, nextCursor: items.length > start + options.limit ? selected.at(-1)?.id ?? null : null }
}

export const createSeedModelEvaluationRepository = ({ modelControl }) => {
  const suites = new Map()
  const policies = new Map()
  const runs = new Map()
  const sorted = (map, order = 'desc') => [...map.values()].sort((left, right) => {
    const result = left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    return order === 'asc' ? result : -result
  })
  const suiteDto = (row) => row ? copy({ ...row, cases: row.cases ?? [] }) : null
  const runDto = (row) => row ? copy({
    ...row,
    suite: suites.get(row.suiteId) ?? null,
    policy: policies.get(row.policyId) ?? null,
    baselineRun: row.baselineRunId ? runs.get(row.baselineRunId) ?? null : null,
  }) : null
  return {
    createSuite: async (input) => {
      const current = [...suites.values()].filter((item) => item.suiteKey === input.suite.suiteKey).sort((a, b) => b.version - a.version)[0]
      if (current && input.suite.version !== current.version + 1) throw new HttpError(409, 'EVALUATION_SUITE_VERSION_CONFLICT', 'evaluation suite versions must be appended sequentially')
      if (!current && input.suite.version !== 1) throw new HttpError(409, 'EVALUATION_SUITE_VERSION_CONFLICT', 'the first evaluation suite version must be 1')
      const createdAt = nowIso()
      const row = { ...copy(input.suite), createdAt, cases: input.cases.map((item) => ({ ...copy(item), suiteId: input.suite.id, createdAt })) }
      suites.set(row.id, row)
      return suiteDto(row)
    },
    findSuite: async (id) => suiteDto(suites.get(String(id)) ?? null),
    listSuites: async (options) => paginate(sorted(suites, options.order)
      .filter((row) => !options.modality || row.modality === options.modality)
      .filter((row) => !options.operation || row.operation === options.operation)
      .filter((row) => !options.search || `${row.suiteKey} ${row.name}`.toLowerCase().includes(options.search.toLowerCase())), options),
    createPolicy: async (input) => {
      const suite = suites.get(input.suiteId)
      if (!suite) throw new HttpError(422, 'EVALUATION_SUITE_NOT_FOUND', 'evaluation policy suite does not exist')
      if (suite.modality !== input.modality || suite.operation !== input.operation) throw new HttpError(422, 'EVALUATION_POLICY_SUITE_MISMATCH', 'evaluation policy modality and operation must match its suite')
      const current = [...policies.values()].filter((item) => item.policyKey === input.policyKey).sort((a, b) => b.version - a.version)[0]
      if (input.version !== (current?.version ?? 0) + 1) throw new HttpError(409, 'EVALUATION_POLICY_VERSION_CONFLICT', 'evaluation policy versions must be appended sequentially')
      const row = { ...copy(input), reviewedAt: nowIso(), createdAt: nowIso(), suite: suiteDto(suite) }
      policies.set(row.id, row)
      return copy(row)
    },
    findPolicy: async (id) => copy(policies.get(String(id)) ?? null),
    listPolicies: async (options) => paginate(sorted(policies, options.order)
      .filter((row) => !options.suiteId || row.suiteId === options.suiteId)
      .filter((row) => !options.environment || row.environment === options.environment)
      .filter((row) => !options.modality || row.modality === options.modality), options),
    createRun: async (input) => {
      const suite = suites.get(input.run.suiteId)
      const policy = policies.get(input.run.policyId)
      const modelVersion = await modelControl.find('version', input.run.modelVersionId)
      const deployment = input.run.modelDeploymentId ? await modelControl.find('deployment', input.run.modelDeploymentId) : null
      const baseline = input.run.baselineRunId ? runs.get(input.run.baselineRunId) ?? null : null
      if (!suite || !policy || !modelVersion || (input.run.modelDeploymentId && !deployment)) throw new HttpError(422, 'EVALUATION_REFERENCE_NOT_FOUND', 'evaluation run references must all exist')
      if (deployment && deployment.modelVersionId !== modelVersion.id) throw new HttpError(422, 'EVALUATION_DEPLOYMENT_MISMATCH', 'evaluation deployment does not use the selected model version')
      if (deployment && deployment.environment !== policy.environment) throw new HttpError(422, 'EVALUATION_ENVIRONMENT_MISMATCH', 'evaluation deployment environment does not match the threshold policy')
      if (!modelVersion.capabilities?.some((item) => item.modality === suite.modality && item.operations.includes(suite.operation))) throw new HttpError(422, 'EVALUATION_CAPABILITY_MISMATCH', 'model version does not declare the evaluated modality and operation')
      if (baseline && (baseline.suiteId !== suite.id || baseline.policyId !== policy.id)) throw new HttpError(422, 'EVALUATION_BASELINE_MISMATCH', 'baseline must use the same suite and threshold policy')
      const evidence = buildEvaluationEvidence({ input, suite, policy, baseline })
      const duplicate = [...runs.values()].find((item) => item.sourceKey === evidence.run.sourceKey)
      if (duplicate) {
        if (duplicate.reportHash !== evidence.run.reportHash) throw new HttpError(409, 'EVALUATION_SOURCE_CONFLICT', 'evaluation source key already records different evidence')
        return runDto(duplicate)
      }
      const row = { ...copy(evidence.run), createdAt: nowIso(), results: evidence.results.map((item) => ({ ...copy(item), runId: evidence.run.id, createdAt: nowIso() })) }
      runs.set(row.id, row)
      return runDto(row)
    },
    findRun: async (id) => runDto(runs.get(String(id)) ?? null),
    listRuns: async (options) => paginate(sorted(runs, options.order)
      .filter((row) => !options.suiteId || row.suiteId === options.suiteId)
      .filter((row) => !options.policyId || row.policyId === options.policyId)
      .filter((row) => !options.modelVersionId || row.modelVersionId === options.modelVersionId)
      .filter((row) => !options.modelDeploymentId || row.modelDeploymentId === options.modelDeploymentId)
      .filter((row) => !options.status || row.status === options.status).map(runDto), options),
    assertPromotionEvidence: async (evaluationRunId, deployment) => {
      const evaluationRun = runDto(runs.get(String(evaluationRunId)) ?? null)
      try { return assertPromotionEvaluation({ evaluationRun, modelDeploymentId: deployment.id, modelVersionId: deployment.modelVersionId }) } catch (error) {
        throw new HttpError(409, 'PROMOTION_EVALUATION_BLOCKED', error.message)
      }
    },
    exportAll: async () => ({ schemaVersion: 1, exportedAt: nowIso(), suites: copy(sorted(suites, 'asc')), policies: copy(sorted(policies, 'asc')), runs: copy(sorted(runs, 'asc')) }),
  }
}
