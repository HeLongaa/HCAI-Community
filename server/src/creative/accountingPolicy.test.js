import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountingForCreativeMode,
  creativeAccountingPolicyHistory,
  creativeAccountingPolicyV1,
  creativeQuotaLimitFor,
  providerCostAvailability,
  validateCreativeAccountingPolicy,
} from './accountingPolicy.js'

test('CreativeAccountingPolicyV1 freezes all four workspace weights and separates three units', () => {
  assert.equal(validateCreativeAccountingPolicy(creativeAccountingPolicyV1), true)
  assert.equal(Object.isFrozen(creativeAccountingPolicyV1.workspaces.image), true)
  assert.deepEqual(accountingForCreativeMode('image', 'image_edit'), { credits: 2, quotaUnits: 2 })
  assert.deepEqual(accountingForCreativeMode('video', 'music_video'), { credits: 12, quotaUnits: 12 })
  assert.deepEqual(accountingForCreativeMode('music', 'lyrics_to_song'), { credits: 5, quotaUnits: 5 })
  assert.deepEqual(accountingForCreativeMode('chat', 'storyboard'), { credits: 2, quotaUnits: 2 })
  assert.equal(creativeAccountingPolicyV1.units.credits.convertibleToProviderCurrency, false)
  assert.equal(creativeAccountingPolicyV1.units.quota.convertibleToCredits, false)
  assert.equal(creativeAccountingPolicyV1.units.providerCost.convertibleToCredits, false)
})

test('accounting closeout matrix settles governed outputs and compensates unbilled no-output failures', () => {
  assert.deepEqual(creativeAccountingPolicyV1.settlement.review_required, {
    credits: 'settle', quota: 'commit', condition: 'persisted_governed_output',
  })
  assert.deepEqual(creativeAccountingPolicyV1.settlement.failed, {
    credits: 'refund', quota: 'release', condition: 'no_output_and_not_billed',
  })
  assert.equal(creativeAccountingPolicyV1.settlement.provider_cost_unknown.providerCost, 'reconcile')
  assert.equal(creativeAccountingPolicyV1.retry.accountingScope, 'attempt')
})

test('policy history is immutable and Provider disabled is never presented as zero cost', () => {
  assert.equal(Object.isFrozen(creativeAccountingPolicyHistory), true)
  assert.equal(creativeAccountingPolicyHistory[0], creativeAccountingPolicyV1)
  assert.deepEqual(providerCostAvailability({ enabled: false, configured: false, safeMetadata: { costMetered: true } }), {
    availability: 'unavailable', reasonCode: 'provider_unavailable',
  })
  assert.equal(creativeQuotaLimitFor({ actor: { role: 'creator' }, source: { CREATIVE_DAILY_QUOTA: '10' } }), 20)
})
