import assert from 'node:assert/strict'
import test from 'node:test'

import { runSecretLifecycleStagingAcceptance } from './secretLifecycleStagingAcceptance.js'

test('Secret lifecycle acceptance is closed outside an explicitly confirmed staging runtime', async () => {
  await assert.rejects(
    runSecretLifecycleStagingAcceptance({ source: { DEPLOYMENT_ENV: 'production', SECRET_LIFECYCLE_ACCEPTANCE_CONFIRMATION: 'real-staging-secret-lifecycle' }, runId: 'slg-acceptance-1' }),
    /restricted to an explicitly confirmed staging runtime/,
  )
  await assert.rejects(
    runSecretLifecycleStagingAcceptance({ source: { DEPLOYMENT_ENV: 'staging' }, runId: 'slg-acceptance-1' }),
    /restricted to an explicitly confirmed staging runtime/,
  )
})

test('Secret lifecycle acceptance rejects unsafe run identifiers before database access', async () => {
  await assert.rejects(
    runSecretLifecycleStagingAcceptance({
      source: { DEPLOYMENT_ENV: 'staging', SECRET_LIFECYCLE_ACCEPTANCE_CONFIRMATION: 'real-staging-secret-lifecycle' },
      runId: '../escape',
    }),
    /RUN_ID is invalid/,
  )
})
