import { HttpError } from '../common/errors/httpError.js'
import { assertPromotionEvaluation, buildEvaluationEvidence } from './modelEvaluationRuntime.js'

const iso = (value) => value?.toISOString?.() ?? value ?? null
const suiteDto = (row) => row ? ({ ...row, createdAt: iso(row.createdAt), cases: row.cases?.map((item) => ({ ...item, createdAt: iso(item.createdAt) })) ?? [] }) : null
const policyDto = (row) => row ? ({ ...row, reviewedAt: iso(row.reviewedAt), createdAt: iso(row.createdAt), suite: suiteDto(row.suite) }) : null
const resultDto = (row) => row ? ({ ...row, createdAt: iso(row.createdAt) }) : null
const runDto = (row) => row ? ({
  ...row,
  startedAt: iso(row.startedAt), completedAt: iso(row.completedAt), expiresAt: iso(row.expiresAt), createdAt: iso(row.createdAt),
  suite: suiteDto(row.suite), policy: policyDto(row.policy), results: row.results?.map(resultDto) ?? [],
  baselineRun: row.baselineRun ? { ...row.baselineRun, startedAt: iso(row.baselineRun.startedAt), completedAt: iso(row.baselineRun.completedAt), expiresAt: iso(row.baselineRun.expiresAt), createdAt: iso(row.baselineRun.createdAt) } : null,
}) : null
const suiteInclude = { cases: { orderBy: [{ category: 'asc' }, { caseKey: 'asc' }] } }
const policyInclude = { suite: { include: suiteInclude } }
const runInclude = { suite: { include: suiteInclude }, policy: { include: policyInclude }, results: { orderBy: { createdAt: 'asc' } }, baselineRun: true }
const page = (rows, options, mapper) => {
  const items = rows.slice(0, options.limit)
  return { items: items.map(mapper), limit: options.limit, nextCursor: rows.length > options.limit ? items.at(-1)?.id ?? null : null }
}
const conflict = (error) => {
  if (error instanceof HttpError) throw error
  if (error?.code === 'P2002') throw new HttpError(409, 'EVALUATION_EVIDENCE_CONFLICT', 'immutable evaluation evidence already exists')
  if (error?.code === 'P2003') throw new HttpError(422, 'EVALUATION_REFERENCE_NOT_FOUND', 'referenced evaluation resource does not exist')
  if (error?.code === 'P2034') throw new HttpError(409, 'EVALUATION_STATE_CONFLICT', 'evaluation evidence changed concurrently; retry with current state')
  throw error
}

export const createPrismaModelEvaluationRepository = (client) => ({
  createSuite: async (input) => {
    try {
      return suiteDto(await client.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `ai-evaluation-suite:${input.suite.suiteKey}`)
        const current = await tx.aiEvaluationSuite.findFirst({ where: { suiteKey: input.suite.suiteKey }, orderBy: { version: 'desc' } })
        if (input.suite.version !== (current?.version ?? 0) + 1) throw new HttpError(409, 'EVALUATION_SUITE_VERSION_CONFLICT', 'evaluation suite versions must be appended sequentially')
        return tx.aiEvaluationSuite.create({ data: { ...input.suite, cases: { create: input.cases } }, include: suiteInclude })
      }, { isolationLevel: 'Serializable' }))
    } catch (error) { return conflict(error) }
  },
  findSuite: async (id) => suiteDto(await client.aiEvaluationSuite.findUnique({ where: { id: String(id) }, include: suiteInclude })),
  listSuites: async (options) => {
    const pageCursor = options.cursor ? await client.aiEvaluationSuite.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return page(await client.aiEvaluationSuite.findMany({
      where: {
        ...(options.modality ? { modality: options.modality } : {}), ...(options.operation ? { operation: options.operation } : {}),
        ...(options.search ? { OR: [{ suiteKey: { contains: options.search, mode: 'insensitive' } }, { name: { contains: options.search, mode: 'insensitive' } }] } : {}),
      }, include: suiteInclude, orderBy: [{ createdAt: options.order }, { id: options.order }], take: options.limit + 1,
      ...(pageCursor ? { cursor: { id: pageCursor.id }, skip: 1 } : {}),
    }), options, suiteDto)
  },
  createPolicy: async (input) => {
    try {
      return policyDto(await client.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `ai-evaluation-policy:${input.policyKey}`)
        const [suite, current] = await Promise.all([
          tx.aiEvaluationSuite.findUnique({ where: { id: input.suiteId }, include: suiteInclude }),
          tx.aiEvaluationPolicy.findFirst({ where: { policyKey: input.policyKey }, orderBy: { version: 'desc' } }),
        ])
        if (!suite) throw new HttpError(422, 'EVALUATION_SUITE_NOT_FOUND', 'evaluation policy suite does not exist')
        if (suite.modality !== input.modality || suite.operation !== input.operation) throw new HttpError(422, 'EVALUATION_POLICY_SUITE_MISMATCH', 'evaluation policy modality and operation must match its suite')
        if (input.version !== (current?.version ?? 0) + 1) throw new HttpError(409, 'EVALUATION_POLICY_VERSION_CONFLICT', 'evaluation policy versions must be appended sequentially')
        return tx.aiEvaluationPolicy.create({ data: input, include: policyInclude })
      }, { isolationLevel: 'Serializable' }))
    } catch (error) { return conflict(error) }
  },
  findPolicy: async (id) => policyDto(await client.aiEvaluationPolicy.findUnique({ where: { id: String(id) }, include: policyInclude })),
  listPolicies: async (options) => {
    const pageCursor = options.cursor ? await client.aiEvaluationPolicy.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return page(await client.aiEvaluationPolicy.findMany({
      where: { ...(options.suiteId ? { suiteId: options.suiteId } : {}), ...(options.environment ? { environment: options.environment } : {}), ...(options.modality ? { modality: options.modality } : {}) },
      include: policyInclude, orderBy: [{ createdAt: options.order }, { id: options.order }], take: options.limit + 1,
      ...(pageCursor ? { cursor: { id: pageCursor.id }, skip: 1 } : {}),
    }), options, policyDto)
  },
  createRun: async (input) => {
    try {
      return runDto(await client.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext($1))', `ai-evaluation-run:${input.run.sourceKey}`)
        const [suite, policy, modelVersion, deployment, baseline] = await Promise.all([
          tx.aiEvaluationSuite.findUnique({ where: { id: input.run.suiteId }, include: suiteInclude }),
          tx.aiEvaluationPolicy.findUnique({ where: { id: input.run.policyId }, include: policyInclude }),
          tx.modelVersion.findUnique({ where: { id: input.run.modelVersionId }, include: { capabilities: true } }),
          input.run.modelDeploymentId ? tx.modelDeployment.findUnique({ where: { id: input.run.modelDeploymentId } }) : null,
          input.run.baselineRunId ? tx.aiEvaluationRun.findUnique({ where: { id: input.run.baselineRunId } }) : null,
        ])
        if (!suite || !policy || !modelVersion || (input.run.modelDeploymentId && !deployment)) throw new HttpError(422, 'EVALUATION_REFERENCE_NOT_FOUND', 'evaluation run references must all exist')
        if (deployment && deployment.modelVersionId !== modelVersion.id) throw new HttpError(422, 'EVALUATION_DEPLOYMENT_MISMATCH', 'evaluation deployment does not use the selected model version')
        if (deployment && deployment.environment !== policy.environment) throw new HttpError(422, 'EVALUATION_ENVIRONMENT_MISMATCH', 'evaluation deployment environment does not match the threshold policy')
        if (!modelVersion.capabilities.some((item) => item.modality === suite.modality && item.operations.includes(suite.operation))) throw new HttpError(422, 'EVALUATION_CAPABILITY_MISMATCH', 'model version does not declare the evaluated modality and operation')
        if (baseline && (baseline.suiteId !== suite.id || baseline.policyId !== policy.id)) throw new HttpError(422, 'EVALUATION_BASELINE_MISMATCH', 'baseline must use the same suite and threshold policy')
        const evidence = buildEvaluationEvidence({ input, suite: suiteDto(suite), policy: policyDto(policy), baseline })
        const duplicate = await tx.aiEvaluationRun.findUnique({ where: { sourceKey: evidence.run.sourceKey }, include: runInclude })
        if (duplicate) {
          if (duplicate.reportHash !== evidence.run.reportHash) throw new HttpError(409, 'EVALUATION_SOURCE_CONFLICT', 'evaluation source key already records different evidence')
          return duplicate
        }
        return tx.aiEvaluationRun.create({
          data: {
            ...evidence.run,
            startedAt: new Date(evidence.run.startedAt), completedAt: new Date(evidence.run.completedAt), expiresAt: new Date(evidence.run.expiresAt),
            results: { create: evidence.results },
          }, include: runInclude,
        })
      }, { isolationLevel: 'Serializable' }))
    } catch (error) { return conflict(error) }
  },
  findRun: async (id) => runDto(await client.aiEvaluationRun.findUnique({ where: { id: String(id) }, include: runInclude })),
  listRuns: async (options) => {
    const pageCursor = options.cursor ? await client.aiEvaluationRun.findUnique({ where: { id: options.cursor }, select: { id: true } }) : null
    return page(await client.aiEvaluationRun.findMany({
      where: {
        ...(options.suiteId ? { suiteId: options.suiteId } : {}), ...(options.policyId ? { policyId: options.policyId } : {}),
        ...(options.modelVersionId ? { modelVersionId: options.modelVersionId } : {}), ...(options.modelDeploymentId ? { modelDeploymentId: options.modelDeploymentId } : {}),
        ...(options.status ? { status: options.status } : {}),
      }, include: runInclude, orderBy: [{ createdAt: options.order }, { id: options.order }], take: options.limit + 1,
      ...(pageCursor ? { cursor: { id: pageCursor.id }, skip: 1 } : {}),
    }), options, runDto)
  },
  assertPromotionEvidence: async (evaluationRunId, deployment) => {
    const evaluationRun = runDto(await client.aiEvaluationRun.findUnique({ where: { id: String(evaluationRunId) }, include: runInclude }))
    try { return assertPromotionEvaluation({ evaluationRun, modelDeploymentId: deployment.id, modelVersionId: deployment.modelVersionId }) } catch (error) {
      throw new HttpError(409, 'PROMOTION_EVALUATION_BLOCKED', error.message)
    }
  },
  exportAll: async () => ({
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    suites: (await client.aiEvaluationSuite.findMany({ include: suiteInclude, orderBy: { createdAt: 'asc' }, take: 10000 })).map(suiteDto),
    policies: (await client.aiEvaluationPolicy.findMany({ include: policyInclude, orderBy: { createdAt: 'asc' }, take: 10000 })).map(policyDto),
    runs: (await client.aiEvaluationRun.findMany({ include: runInclude, orderBy: { createdAt: 'asc' }, take: 10000 })).map(runDto),
  }),
})
