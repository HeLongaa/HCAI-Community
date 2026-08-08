import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { createSecretManagerLifecycleGateway } from './providerSecretRetention.js'

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex')
const dayMs = 86_400_000

export const runSecretLifecycleStagingAcceptance = async ({ source = process.env, runId = source.SECRET_LIFECYCLE_ACCEPTANCE_RUN_ID } = {}) => {
  if (source.DEPLOYMENT_ENV !== 'staging' || source.SECRET_LIFECYCLE_ACCEPTANCE_CONFIRMATION !== 'real-staging-secret-lifecycle') {
    throw new Error('Secret lifecycle acceptance is restricted to an explicitly confirmed staging runtime')
  }
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(String(runId ?? ''))) throw new Error('SECRET_LIFECYCLE_ACCEPTANCE_RUN_ID is invalid')
  const secretRefPrefix = String(source.SECRET_LIFECYCLE_SECRET_REF_PREFIX ?? '').trim()
  if (!secretRefPrefix.endsWith('/')) throw new Error('SECRET_LIFECYCLE_SECRET_REF_PREFIX is invalid')

  const { createPrismaRepository } = await import('../repositories/prismaRepository.js')
  const repository = await createPrismaRepository()
  if (!repository?.modelControl || !repository?.modelGovernance) throw new Error('Prisma model governance repository is unavailable')
  const actorRef = `secret-lifecycle-acceptance:${runId}`
  const providerId = `slg-${runId}-provider`
  const retiredId = `slg-${runId}-secret-v1`
  const currentId = `slg-${runId}-secret-v2`
  const secretRef = `${secretRefPrefix}acceptance/${runId}`
  const startedAt = new Date()

  try {
    await repository.modelControl.createProvider({
      id: providerId,
      key: providerId,
      name: 'Secret lifecycle staging acceptance',
      websiteUrl: null,
      regions: ['staging'],
      dataProcessingRegions: ['staging'],
      createdByRef: actorRef,
      updatedByRef: actorRef,
    })
    await repository.modelGovernance.createSecretRef({
      id: retiredId,
      providerId,
      environment: 'staging',
      purpose: 'chat-inference',
      secretRef,
      externalVersion: 'v1',
      ownerRef: actorRef,
      checksumSha256: sha256(`${runId}:v1`),
      expiresAt: null,
      rotatedFromId: null,
      reasonCode: 'staging_lifecycle_acceptance',
      createdByRef: actorRef,
    })
    await repository.modelGovernance.createSecretRef({
      id: currentId,
      providerId,
      environment: 'staging',
      purpose: 'chat-inference',
      secretRef,
      externalVersion: 'v2',
      ownerRef: actorRef,
      checksumSha256: sha256(`${runId}:v2`),
      expiresAt: null,
      rotatedFromId: retiredId,
      reasonCode: 'staging_lifecycle_acceptance_rotation',
      createdByRef: actorRef,
    })

    const gateway = createSecretManagerLifecycleGateway({ source })
    const disabled = await repository.modelGovernance.sweepSecretRetention({ now: startedAt, limit: 500, gateway })
    const deleted = await repository.modelGovernance.sweepSecretRetention({ now: new Date(startedAt.getTime() + 31 * dayMs), limit: 500, gateway })
    const receipts = await repository.client.providerSecretLifecycleReceipt.findMany({
      where: { secretRefId: retiredId },
      orderBy: { action: 'asc' },
      select: { action: true, targetHash: true, receiptHash: true, completedAt: true },
    })
    assert.deepEqual(receipts.map((item) => item.action), ['delete', 'disable'])
    assert.equal(new Set(receipts.map((item) => item.targetHash)).size, 1)
    assert.ok(receipts.every((item) => /^[a-f0-9]{64}$/.test(item.targetHash) && /^[a-f0-9]{64}$/.test(item.receiptHash)))
    const evidence = {
      schemaVersion: 1,
      status: 'passed',
      runId,
      providerId,
      retiredSecretRefId: retiredId,
      targetHash: receipts[0].targetHash,
      actions: receipts.map((item) => ({ action: item.action, receiptHash: item.receiptHash, completedAt: item.completedAt.toISOString() })),
      sweeps: { disabled, deleted },
      simulatedRetentionDays: 31,
      completedAt: new Date().toISOString(),
    }
    assert.equal(JSON.stringify(evidence).includes(secretRef), false)
    process.stdout.write(`${JSON.stringify(evidence)}\n`)
    return evidence
  } finally {
    await repository.client.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSecretLifecycleStagingAcceptance({ runId: process.env.SECRET_LIFECYCLE_ACCEPTANCE_RUN_ID ?? `slg-${randomUUID().slice(0, 12)}` })
    .catch((error) => {
      console.error('[secret-lifecycle-acceptance]', error?.message ?? 'acceptance failed')
      process.exitCode = 1
    })
}
