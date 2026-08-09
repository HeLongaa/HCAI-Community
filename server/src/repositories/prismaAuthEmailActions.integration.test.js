import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { buildAuthEmailActionConfig, createAuthEmailActionCodec } from '../auth/emailActions.js'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

test('Prisma email verification and password reset are atomic, single-use, and session-revoking', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const runId = `email-action-${Date.now()}-${randomUUID().slice(0, 8)}`
  const key = Buffer.alloc(32, 9).toString('base64')
  const config = buildAuthEmailActionConfig({
    AUTH_EMAIL_VERIFICATION_REQUIRED: 'true',
    AUTH_PASSWORD_RESET_ENABLED: 'true',
    AUTH_EMAIL_ACTION_ORIGIN: 'https://app.example.com',
    AUTH_EMAIL_ACTION_ENCRYPTION_KEY: key,
  })
  const codec = createAuthEmailActionCodec(config)
  let userId = null

  try {
    const registered = await repository.auth.registerEmailAccount({
      email: `${runId}@example.com`,
      password: 'old-password-123',
      displayName: 'Email Action Integration',
      handle: runId.slice(0, 32),
    }, null, null, config)
    assert.equal(registered.verificationRequired, true)
    userId = registered.user.id
    assert.equal(registered.user.emailVerified, false)

    const verification = await repository.client.authEmailAction.findFirstOrThrow({ where: { userId, kind: 'verify_email' } })
    const verificationToken = codec.decrypt(verification)
    const notification = await repository.client.notification.findFirstOrThrow({ where: { resourceType: 'auth_email_action', resourceId: verification.id } })
    assert.equal(JSON.stringify(verification).includes(verificationToken), false)
    assert.equal(JSON.stringify(notification).includes(verificationToken), false)

    const verificationResults = await Promise.all([
      repository.auth.consumeEmailVerification({ token: verificationToken }),
      repository.auth.consumeEmailVerification({ token: verificationToken }),
    ])
    assert.equal(verificationResults.filter(Boolean).length, 1)
    assert.equal(verificationResults.find(Boolean).user.emailVerified, true)

    await repository.auth.requestPasswordReset({ email: `${runId}@example.com` }, config)
    const resetAction = await repository.client.authEmailAction.findFirstOrThrow({
      where: { userId, kind: 'password_reset' },
      orderBy: { createdAt: 'desc' },
    })
    const resetToken = codec.decrypt(resetAction)
    const resetResults = await Promise.all([
      repository.auth.resetPassword({ token: resetToken, password: 'new-password-456' }),
      repository.auth.resetPassword({ token: resetToken, password: 'new-password-456' }),
    ])
    assert.equal(resetResults.filter(Boolean).length, 1)
    assert.equal(await repository.auth.verifyPasswordCredentials({ email: `${runId}@example.com`, password: 'old-password-123' }), null)
    assert.ok(await repository.auth.verifyPasswordCredentials({ email: `${runId}@example.com`, password: 'new-password-456' }))
    assert.equal(await repository.client.authSession.count({ where: { userId, revokedAt: null } }), 0)
    assert.equal(await repository.client.refreshToken.count({ where: { userId, revokedAt: null } }), 0)
  } finally {
    if (userId) {
      await repository.client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
        await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: userId }, { resourceId: userId }] } })
        await transaction.user.deleteMany({ where: { id: userId } })
      })
    }
    await repository.client.$disconnect()
  }
})
