import assert from 'node:assert/strict'
import test from 'node:test'

import { creativeAccountingPolicyV1 } from '../creative/accountingPolicy.js'
import { buildBillingPolicyPreview } from './billingPolicyRuntime.js'

test('billing policy preview reports role routing and taxonomy impact without mutating creative pricing', () => {
  const current = { roleLimits: { member: 0, creator: 0, publisher: 0, moderator: 1000, admin: 5000 }, reasonCodes: ['support_credit'], approvalTemplates: ['Review'] }
  const candidate = { roleLimits: { ...current.roleLimits, moderator: 2000 }, reasonCodes: ['support_credit', 'settlement_fix'], approvalTemplates: ['Review'] }
  const preview = buildBillingPolicyPreview({ current, candidate, creativePolicy: creativeAccountingPolicyV1 })
  assert.equal(preview.impact.rolesChanged, 1)
  assert.equal(preview.impact.reasonCodesAdded, 1)
  assert.equal(preview.impact.creativeRuntimeChanged, false)
  assert.equal(preview.impact.creativePolicyVersion, 'creative-policy-v1')
  assert.equal(preview.current.roleLimits.moderator, 1000)
})
