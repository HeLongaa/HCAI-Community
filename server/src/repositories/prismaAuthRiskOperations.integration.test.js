import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { createAuthAttemptEvidence } from '../auth/authRiskOperations.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma auth risk operations persist masked evidence, metrics, filters, and CAS policy', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}${randomUUID().slice(0, 6)}`.replaceAll('-', '')
  let actor
  const attemptIds = []
  let originalPolicy
  try {
    const session = await repository.auth.registerEmailAccount({
      email: `auth-risk-${suffix}@example.com`, password: 'auth-risk-integration-password', displayName: 'Auth Risk Operator', handle: `aro${suffix}`.slice(0, 30),
    }, null, { clientLabel: 'CLI on Linux', networkHash: '1'.repeat(64) })
    actor = session.user
    const evidence = createAuthAttemptEvidence({ method: 'email', outcome: 'failure', reasonCode: 'integration_invalid_password', identity: session.user.email, clientContext: { clientLabel: 'Chrome on macOS', networkHash: 'a'.repeat(64) } })
    const attempt = await repository.authRiskAdmin.recordAttempt(evidence)
    attemptIds.push(attempt.id)

    const query = { method: 'email', reasonCode: 'integration_invalid_password', identityHash: null, cursor: null, limit: 20, dateFrom: new Date(Date.now() - 60_000), dateTo: new Date(Date.now() + 60_000) }
    const page = await repository.authRiskAdmin.listFailures(query, actor)
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0].identityHint.endsWith('@example.com'), true)
    assert.equal(JSON.stringify(page).includes(session.user.email), false)
    assert.equal(JSON.stringify(page).includes('a'.repeat(64)), false)

    const metrics = await repository.authRiskAdmin.metrics({ dateFrom: query.dateFrom, dateTo: query.dateTo }, actor)
    assert.ok(metrics.totals.failures >= 1)
    assert.ok(metrics.failureReasons.some((entry) => entry.reasonCode === 'integration_invalid_password'))

    originalPolicy = await repository.authRiskAdmin.getPolicy()
    const updated = await repository.authRiskAdmin.updatePolicy({ enabled: true, windowSeconds: 900, ipAccountThreshold: 4, accountIpThreshold: 6, expectedVersion: originalPolicy.version, reasonCode: 'integration_policy_update' }, actor)
    assert.equal(updated.policy.version, originalPolicy.version + 1)
    assert.equal((await repository.authRiskAdmin.getRuntimePolicy()).windowMs, 900_000)
    assert.deepEqual(await repository.authRiskAdmin.updatePolicy({ enabled: false, windowSeconds: 900, ipAccountThreshold: 4, accountIpThreshold: 6, expectedVersion: originalPolicy.version, reasonCode: 'integration_stale' }, actor), { conflict: true })
  } finally {
    if (repository) {
      await repository.client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
        await transaction.authLoginAttempt.deleteMany({ where: { id: { in: attemptIds } } })
        if (actor) await transaction.auditEvent.deleteMany({ where: { actorId: actor.id } })
        if (originalPolicy?.version === 0) {
          await transaction.authRiskPolicy.deleteMany({ where: { id: 'default', updatedByRef: actor?.id } })
        } else if (originalPolicy) {
          await transaction.authRiskPolicy.update({ where: { id: 'default' }, data: { enabled: originalPolicy.enabled, windowSeconds: originalPolicy.windowSeconds, ipAccountThreshold: originalPolicy.ipAccountThreshold, accountIpThreshold: originalPolicy.accountIpThreshold, version: originalPolicy.version, reasonCode: originalPolicy.reasonCode, updatedByRef: originalPolicy.updatedByRef } })
        }
        if (actor) await transaction.user.deleteMany({ where: { id: actor.id } })
      })
      await repository.client.$disconnect()
    }
  }
})
