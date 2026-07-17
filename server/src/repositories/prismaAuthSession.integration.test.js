import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL

const listQuery = (overrides = {}) => ({
  status: null,
  riskStatus: null,
  search: null,
  cursor: null,
  limit: 20,
  sort: 'lastSeenAt',
  order: 'desc',
  ...overrides,
})

test('Prisma logical auth sessions rotate atomically, contain reuse, and expose only safe evidence', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  assert.ok(repository)

  const suffix = `${Date.now()}${randomUUID().slice(0, 5)}`.replaceAll('-', '')
  const userIds = []
  const sessionIds = []
  let operator

  try {
    const operatorSession = await repository.auth.registerEmailAccount({
      email: `session-operator-${suffix}@example.com`,
      password: 'auth-session-operator-password',
      displayName: 'Auth Session Operator',
      handle: `aso${suffix}`.slice(0, 30),
    }, null, { clientLabel: 'CLI on Linux', networkHash: '1'.repeat(64) })
    operator = operatorSession.user
    userIds.push(operator.id)

    const initial = await repository.auth.registerEmailAccount({
      email: `session-user-${suffix}@example.com`,
      password: 'auth-session-user-password',
      displayName: 'Auth Session User',
      handle: `asu${suffix}`.slice(0, 30),
    }, null, { clientLabel: 'Chrome on macOS', networkHash: 'a'.repeat(64) })
    userIds.push(initial.user.id)

    const firstList = await repository.auth.listSessions(initial.user)
    assert.equal(firstList.length, 1)
    const logicalSessionId = firstList[0].id
    sessionIds.push(logicalSessionId)
    assert.equal(firstList[0].clientLabel, 'Chrome on macOS')
    assert.equal(firstList[0].networkHint, 'aaaaaaaa')
    assert.equal(await repository.auth.findDemoAccountByAccessToken(initial.accessToken).then((user) => user?.id), initial.user.id)

    const rotated = await repository.auth.rotateSession(initial.refreshToken, {
      clientLabel: 'Firefox on Linux',
      networkHash: 'b'.repeat(64),
    })
    assert.ok(rotated)
    const afterRotation = await repository.auth.listSessions(initial.user)
    assert.equal(afterRotation.length, 1)
    assert.equal(afterRotation[0].id, logicalSessionId)
    assert.equal(afterRotation[0].clientLabel, 'Firefox on Linux')
    assert.equal(await repository.client.refreshToken.count({ where: { familyId: logicalSessionId } }), 2)
    assert.equal(await repository.auth.findDemoAccountByAccessToken(rotated.accessToken).then((user) => user?.id), initial.user.id)

    assert.equal(await repository.auth.rotateSession(initial.refreshToken), null)
    const compromised = await repository.client.authSession.findUnique({ where: { id: logicalSessionId } })
    assert.equal(compromised.riskStatus, 'compromised')
    assert.equal(compromised.riskReasonCode, 'refresh_token_reuse')
    assert.ok(compromised.revokedAt)
    assert.equal(await repository.client.refreshToken.count({ where: { familyId: logicalSessionId, revokedAt: null } }), 0)
    assert.equal(await repository.auth.findDemoAccountByAccessToken(initial.accessToken), null)
    assert.equal(await repository.auth.findDemoAccountByAccessToken(rotated.accessToken), null)
    assert.equal(await repository.auth.findDemoAccountByRefreshToken(rotated.refreshToken), null)
    assert.deepEqual(await repository.authSessionAdmin.dispositionSession(logicalSessionId, {
      riskStatus: 'normal',
      expectedVersion: compromised.version,
      reasonCode: 'unsafe_downgrade',
    }, operator), { terminal: true })

    const second = await repository.auth.issueSession(initial.user, {
      clientLabel: 'Safari on iOS',
      networkHash: 'c'.repeat(64),
    })
    const activeSessions = await repository.authSessionAdmin.listSessions(listQuery({
      status: 'active',
      search: initial.user.email,
    }), operator)
    assert.equal(activeSessions.items.length, 1)
    const active = activeSessions.items[0]
    sessionIds.push(active.id)
    assert.equal(active.clientLabel, 'Safari on iOS')
    assert.equal(active.networkHint, 'cccccccc')
    assert.equal(JSON.stringify(active).includes('c'.repeat(64)), false)

    const dispositions = await Promise.all([
      repository.authSessionAdmin.dispositionSession(active.id, {
        riskStatus: 'suspicious', expectedVersion: active.version, reasonCode: 'integration_risk_a',
      }, operator),
      repository.authSessionAdmin.dispositionSession(active.id, {
        riskStatus: 'suspicious', expectedVersion: active.version, reasonCode: 'integration_risk_b',
      }, operator),
    ])
    assert.equal(dispositions.filter((result) => result?.session).length, 1)
    assert.equal(dispositions.filter((result) => result?.conflict).length, 1)

    const currentSecond = await repository.client.authSession.findUnique({ where: { id: active.id } })
    const revoked = await repository.authSessionAdmin.revokeSession(active.id, {
      expectedVersion: currentSecond.version,
      reasonCode: 'integration_revoke',
    }, operator)
    assert.equal(revoked.session.status, 'revoked')
    assert.equal(await repository.auth.findDemoAccountByAccessToken(second.accessToken), null)
    assert.equal(await repository.auth.findDemoAccountByRefreshToken(second.refreshToken), null)

    const third = await repository.auth.issueSession(initial.user, {
      clientLabel: 'Edge on Windows',
      networkHash: 'd'.repeat(64),
    })
    const thirdSession = (await repository.auth.listSessions(initial.user)).find((session) => session.status === 'active')
    sessionIds.push(thirdSession.id)
    assert.deepEqual(await repository.authSessionAdmin.revokeUserSessions(initial.user.id, 'integration_account_containment', operator), { revoked: 1 })
    assert.equal(await repository.auth.findDemoAccountByAccessToken(third.accessToken), null)

    const columns = await repository.client.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'auth_sessions'
      ORDER BY column_name
    `
    const columnNames = columns.map((row) => row.column_name)
    assert.equal(columnNames.some((name) => /(^|_)(ip|user_agent|access_token|refresh_token)(_|$)/.test(name)), false)

    const refreshRows = await repository.client.refreshToken.findMany({ where: { familyId: { in: sessionIds } } })
    const persisted = JSON.stringify({ sessions: await repository.client.authSession.findMany({ where: { id: { in: sessionIds } } }), refreshRows })
    for (const rawValue of [initial.accessToken, initial.refreshToken, rotated.accessToken, rotated.refreshToken, second.accessToken, second.refreshToken]) {
      assert.equal(persisted.includes(rawValue), false)
    }
    assert.equal(persisted.includes('203.0.113.42'), false)
    assert.equal(persisted.includes('Mozilla/5.0 full integration user agent'), false)

    const audits = await repository.client.auditEvent.findMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { resourceId: { in: sessionIds } },
        ],
      },
    })
    const auditJson = JSON.stringify(audits, (_key, value) => typeof value === 'bigint' ? value.toString() : value)
    assert.equal(auditJson.includes(initial.refreshToken), false)
    assert.equal(auditJson.includes(rotated.refreshToken), false)
    assert.equal(auditJson.includes('203.0.113.42'), false)
    assert.ok(audits.some((event) => event.action === 'auth.session.reuse_detected'))
    assert.ok(audits.some((event) => event.action === 'admin.auth.session.risk_dispositioned'))
    assert.ok(audits.some((event) => event.action === 'admin.auth.user_sessions.revoked'))
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.auditEvent.deleteMany({
        where: {
          OR: [
            { actorId: { in: userIds } },
            { resourceId: { in: sessionIds } },
          ],
        },
      })
      await transaction.user.deleteMany({ where: { id: { in: userIds } } })
    })
    await repository.client.$disconnect()
  }
})
