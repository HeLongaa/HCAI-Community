import { createHash, randomUUID } from 'node:crypto'

import { validationFailed } from '../common/http/validation.js'
import { modelCapabilityModalities, modelDeploymentEnvironments } from './modelControlRuntime.js'

const pageLimit = 100
const sha256Pattern = /^[a-f0-9]{64}$/
const caseCategories = Object.freeze(['quality', 'safety'])
const scoringTypes = Object.freeze(['exact', 'semantic', 'policy'])
export const evaluationRunStatuses = Object.freeze(['passed', 'failed', 'unverifiable'])

const objectValue = (value, name = 'payload') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationFailed(`${name} must be an object`)
  return value
}
const exactFields = (value, allowed, name = 'payload') => {
  const unexpected = Object.keys(value).filter((field) => !allowed.includes(field))
  if (unexpected.length) throw validationFailed(`${name} contains unsupported fields: ${unexpected.join(', ')}`)
}
const text = (value, name, { required = false, maximum = 300 } = {}) => {
  const normalized = String(value ?? '').trim()
  if (required && !normalized) throw validationFailed(`${name} is required`)
  if (normalized.length > maximum) throw validationFailed(`${name} cannot exceed ${maximum} characters`)
  return normalized
}
const key = (value, name) => {
  const normalized = text(value, name, { required: true, maximum: 128 }).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._/-]*$/.test(normalized)) throw validationFailed(`${name} contains unsupported characters`)
  return normalized
}
const integer = (value, name, minimum, maximum) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw validationFailed(`${name} must be an integer between ${minimum} and ${maximum}`)
  return parsed
}
const enumValue = (value, values, name) => {
  const normalized = String(value ?? '')
  if (!values.includes(normalized)) throw validationFailed(`${name} must be one of: ${values.join(', ')}`)
  return normalized
}
const digest = (value, name) => {
  const normalized = text(value, name, { required: true, maximum: 64 }).toLowerCase()
  if (!sha256Pattern.test(normalized)) throw validationFailed(`${name} must be a lowercase SHA-256 digest`)
  return normalized
}
const actorRef = (actor) => actor?.handle ?? actor?.id ?? 'unknown'
const cursor = (value) => text(value, 'cursor', { maximum: 200 }) || null
const limit = (value) => value == null || value === '' ? 20 : integer(value, 'limit', 1, pageLimit)
const order = (value) => enumValue(String(value ?? 'desc').toLowerCase(), ['asc', 'desc'], 'order')
const optionalDate = (value, name) => {
  if (value == null || value === '') return null
  const timestamp = Date.parse(String(value))
  if (!Number.isFinite(timestamp)) throw validationFailed(`${name} must be an ISO 8601 datetime`)
  return new Date(timestamp).toISOString()
}
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((field) => `${JSON.stringify(field)}:${canonical(value[field])}`).join(',')}}`
  return JSON.stringify(value)
}
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex')

export const parseEvaluationSuiteCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['suiteKey', 'name', 'version', 'modality', 'operation', 'description', 'reasonCode', 'cases'])
  if (!Array.isArray(payload.cases) || payload.cases.length < 1 || payload.cases.length > 500) throw validationFailed('cases must contain between 1 and 500 entries')
  const seen = new Set()
  const cases = payload.cases.map((candidate, index) => {
    const item = objectValue(candidate, `cases[${index}]`)
    exactFields(item, ['caseKey', 'category', 'scoringType', 'inputHash', 'expectedHash', 'weight'], `cases[${index}]`)
    const caseKey = key(item.caseKey, `cases[${index}].caseKey`)
    if (seen.has(caseKey)) throw validationFailed(`duplicate evaluation case key: ${caseKey}`)
    seen.add(caseKey)
    return {
      id: `ai-evaluation-case-${randomUUID()}`,
      caseKey,
      category: enumValue(item.category, caseCategories, `cases[${index}].category`),
      scoringType: enumValue(item.scoringType, scoringTypes, `cases[${index}].scoringType`),
      inputHash: digest(item.inputHash, `cases[${index}].inputHash`),
      expectedHash: digest(item.expectedHash, `cases[${index}].expectedHash`),
      weight: integer(item.weight ?? 1, `cases[${index}].weight`, 1, 100),
    }
  })
  const suite = {
    id: `ai-evaluation-suite-${randomUUID()}`,
    suiteKey: key(payload.suiteKey, 'suiteKey'),
    name: text(payload.name, 'name', { required: true, maximum: 160 }),
    version: integer(payload.version, 'version', 1, 1_000_000),
    modality: enumValue(payload.modality, modelCapabilityModalities, 'modality'),
    operation: key(payload.operation, 'operation'),
    description: text(payload.description, 'description', { maximum: 500 }) || null,
    reasonCode: key(payload.reasonCode, 'reasonCode'),
    createdByRef: actorRef(actor),
  }
  return { suite: { ...suite, contentHash: hash({ ...suite, id: undefined, createdByRef: undefined, cases: cases.map(({ id, ...item }) => item) }) }, cases }
}

export const parseEvaluationPolicyCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['policyKey', 'version', 'suiteId', 'modality', 'operation', 'environment', 'qualityThresholdBps', 'safetyThresholdBps', 'maxRegressionBps', 'minimumCases', 'evidenceTtlSeconds', 'reviewedByRef', 'reasonCode'])
  const createdByRef = actorRef(actor)
  const reviewedByRef = text(payload.reviewedByRef, 'reviewedByRef', { required: true, maximum: 160 })
  if (reviewedByRef === createdByRef) throw validationFailed('reviewedByRef must identify a different reviewer')
  const policy = {
    id: `ai-evaluation-policy-${randomUUID()}`,
    policyKey: key(payload.policyKey, 'policyKey'),
    version: integer(payload.version, 'version', 1, 1_000_000),
    suiteId: text(payload.suiteId, 'suiteId', { required: true, maximum: 180 }),
    modality: enumValue(payload.modality, modelCapabilityModalities, 'modality'),
    operation: key(payload.operation, 'operation'),
    environment: enumValue(payload.environment, modelDeploymentEnvironments, 'environment'),
    qualityThresholdBps: integer(payload.qualityThresholdBps, 'qualityThresholdBps', 0, 10_000),
    safetyThresholdBps: integer(payload.safetyThresholdBps, 'safetyThresholdBps', 0, 10_000),
    maxRegressionBps: integer(payload.maxRegressionBps, 'maxRegressionBps', 0, 10_000),
    minimumCases: integer(payload.minimumCases, 'minimumCases', 1, 500),
    evidenceTtlSeconds: integer(payload.evidenceTtlSeconds, 'evidenceTtlSeconds', 60, 2_592_000),
    reviewedByRef,
    reasonCode: key(payload.reasonCode, 'reasonCode'),
    createdByRef,
  }
  return { ...policy, policyHash: hash({ ...policy, id: undefined, createdByRef: undefined }) }
}

export const parseEvaluationRunCreate = (raw = {}, actor) => {
  const payload = objectValue(raw)
  exactFields(payload, ['sourceKey', 'suiteId', 'policyId', 'modelVersionId', 'modelDeploymentId', 'baselineRunId', 'startedAt', 'completedAt', 'executorRef', 'results'])
  if (!Array.isArray(payload.results) || payload.results.length < 1 || payload.results.length > 500) throw validationFailed('results must contain between 1 and 500 entries')
  const seen = new Set()
  const results = payload.results.map((candidate, index) => {
    const item = objectValue(candidate, `results[${index}]`)
    exactFields(item, ['caseId', 'scoreBps', 'safetyPassed', 'latencyMs', 'outputHash'], `results[${index}]`)
    const caseId = text(item.caseId, `results[${index}].caseId`, { required: true, maximum: 180 })
    if (seen.has(caseId)) throw validationFailed(`duplicate evaluation case result: ${caseId}`)
    seen.add(caseId)
    if (typeof item.safetyPassed !== 'boolean') throw validationFailed(`results[${index}].safetyPassed must be a boolean`)
    return {
      id: `ai-evaluation-result-${randomUUID()}`,
      caseId,
      scoreBps: integer(item.scoreBps, `results[${index}].scoreBps`, 0, 10_000),
      safetyPassed: item.safetyPassed,
      latencyMs: item.latencyMs == null ? null : integer(item.latencyMs, `results[${index}].latencyMs`, 0, 3_600_000),
      outputHash: digest(item.outputHash, `results[${index}].outputHash`),
    }
  })
  const startedAt = optionalDate(payload.startedAt, 'startedAt') ?? new Date().toISOString()
  const completedAt = optionalDate(payload.completedAt, 'completedAt') ?? new Date().toISOString()
  if (Date.parse(completedAt) < Date.parse(startedAt)) throw validationFailed('completedAt cannot precede startedAt')
  return {
    run: {
      id: `ai-evaluation-run-${randomUUID()}`,
      sourceKey: key(payload.sourceKey, 'sourceKey'),
      suiteId: text(payload.suiteId, 'suiteId', { required: true, maximum: 180 }),
      policyId: text(payload.policyId, 'policyId', { required: true, maximum: 180 }),
      modelVersionId: text(payload.modelVersionId, 'modelVersionId', { required: true, maximum: 180 }),
      modelDeploymentId: text(payload.modelDeploymentId, 'modelDeploymentId', { maximum: 180 }) || null,
      baselineRunId: text(payload.baselineRunId, 'baselineRunId', { maximum: 180 }) || null,
      executorRef: text(payload.executorRef, 'executorRef', { required: true, maximum: 160 }),
      startedAt,
      completedAt,
      createdByRef: actorRef(actor),
    },
    results,
  }
}

export const buildEvaluationEvidence = ({ input, suite, policy, baseline }) => {
  if (policy.suiteId !== suite.id || policy.modality !== suite.modality || policy.operation !== suite.operation) throw validationFailed('evaluation policy does not match the selected suite')
  if (policy.minimumCases > suite.cases.length) throw validationFailed('evaluation policy minimumCases exceeds the suite case count')
  const cases = new Map(suite.cases.map((item) => [item.id, item]))
  const complete = input.results.length === suite.cases.length && input.results.every((item) => cases.has(item.caseId))
  const weighted = input.results.reduce((summary, result) => {
    const evaluationCase = cases.get(result.caseId)
    if (!evaluationCase) return summary
    const weight = evaluationCase.weight
    if (evaluationCase.category === 'quality') {
      summary.qualityPoints += result.scoreBps * weight
      summary.qualityWeight += weight
    } else {
      summary.safetyPassed += result.safetyPassed ? weight : 0
      summary.safetyWeight += weight
    }
    return summary
  }, { qualityPoints: 0, qualityWeight: 0, safetyPassed: 0, safetyWeight: 0 })
  const qualityScoreBps = weighted.qualityWeight ? Math.floor(weighted.qualityPoints / weighted.qualityWeight) : 0
  const safetyScoreBps = weighted.safetyWeight ? Math.floor(weighted.safetyPassed * 10_000 / weighted.safetyWeight) : 0
  const regressionDeltaBps = baseline ? qualityScoreBps - baseline.qualityScoreBps : null
  const reasonCodes = []
  if (!complete || input.results.length < policy.minimumCases) reasonCodes.push('evaluation_case_coverage_incomplete')
  if (qualityScoreBps < policy.qualityThresholdBps) reasonCodes.push('quality_threshold_failed')
  if (safetyScoreBps < policy.safetyThresholdBps) reasonCodes.push('safety_threshold_failed')
  if (baseline && regressionDeltaBps < -policy.maxRegressionBps) reasonCodes.push('regression_threshold_failed')
  const status = !complete ? 'unverifiable' : reasonCodes.length ? 'failed' : 'passed'
  const expiresAt = new Date(Date.parse(input.run.completedAt) + policy.evidenceTtlSeconds * 1000).toISOString()
  const results = input.results.map((result) => {
    const evaluationCase = cases.get(result.caseId)
    const stableResult = structuredClone(result)
    delete stableResult.id
    return { ...result, status: evaluationCase && result.scoreBps >= policy.qualityThresholdBps && (evaluationCase.category !== 'safety' || result.safetyPassed) ? 'passed' : 'failed', resultHash: hash(stableResult) }
  })
  const report = {
    suiteId: suite.id, suiteContentHash: suite.contentHash, policyId: policy.id, policyHash: policy.policyHash,
    modelVersionId: input.run.modelVersionId, modelDeploymentId: input.run.modelDeploymentId,
    baselineRunId: input.run.baselineRunId, totalCases: results.length,
    passedCases: results.filter((item) => item.status === 'passed').length,
    qualityScoreBps, safetyScoreBps, regressionDeltaBps, status, reasonCodes,
    resultHashes: results.map((item) => item.resultHash).sort(),
  }
  return {
    run: { ...input.run, status, reasonCodes, totalCases: results.length, passedCases: report.passedCases, qualityScoreBps, safetyScoreBps, regressionDeltaBps, reportHash: hash(report), expiresAt },
    results,
  }
}

export const assertPromotionEvaluation = ({ evaluationRun, modelDeploymentId, modelVersionId, now = new Date() }) => {
  if (!evaluationRun) throw validationFailed('evaluationRunId must reference immutable evaluation evidence')
  if (evaluationRun.status !== 'passed') throw validationFailed('evaluation evidence did not pass all quality and safety thresholds')
  if (!evaluationRun.baselineRunId) throw validationFailed('promotion evaluation requires a baseline regression comparison')
  if (evaluationRun.modelDeploymentId !== modelDeploymentId || evaluationRun.modelVersionId !== modelVersionId) throw validationFailed('evaluation evidence does not match the promoted deployment and model version')
  if (Date.parse(evaluationRun.expiresAt) <= now.getTime()) throw validationFailed('evaluation evidence expired before promotion')
  if (evaluationRun.policy?.environment !== 'production') throw validationFailed('promotion evaluation policy must target production')
  return true
}

export const parseEvaluationSuiteListQuery = (query = {}) => ({
  modality: query.modality ? enumValue(query.modality, modelCapabilityModalities, 'modality') : null,
  operation: text(query.operation, 'operation', { maximum: 128 }) || null,
  search: text(query.search, 'search', { maximum: 96 }) || null,
  cursor: cursor(query.cursor), order: order(query.order), limit: limit(query.limit),
})

export const parseEvaluationPolicyListQuery = (query = {}) => ({
  suiteId: text(query.suiteId, 'suiteId', { maximum: 180 }) || null,
  environment: query.environment ? enumValue(query.environment, modelDeploymentEnvironments, 'environment') : null,
  modality: query.modality ? enumValue(query.modality, modelCapabilityModalities, 'modality') : null,
  cursor: cursor(query.cursor), order: order(query.order), limit: limit(query.limit),
})

export const parseEvaluationRunListQuery = (query = {}) => ({
  suiteId: text(query.suiteId, 'suiteId', { maximum: 180 }) || null,
  policyId: text(query.policyId, 'policyId', { maximum: 180 }) || null,
  modelVersionId: text(query.modelVersionId, 'modelVersionId', { maximum: 180 }) || null,
  modelDeploymentId: text(query.modelDeploymentId, 'modelDeploymentId', { maximum: 180 }) || null,
  status: query.status ? enumValue(query.status, evaluationRunStatuses, 'status') : null,
  cursor: cursor(query.cursor), order: order(query.order), limit: limit(query.limit),
})
