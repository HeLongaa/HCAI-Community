import assert from 'node:assert/strict'
import test from 'node:test'

import {
  accountStatusDto,
  canReadProfile,
  parseAccountDeletionRequest,
  parseOwnProfileUpdate,
  projectProfileForViewer,
} from './profileLifecycle.js'

test('profile updates accept only bounded owner-editable fields', () => {
  const parsed = parseOwnProfileUpdate({
    displayName: ' New Name ', handle: 'New_Handle', bio: ' hello ', lane: 'maker',
    skills: ['Image', 'Prompting'], languages: ['English'], visibility: 'unlisted',
    discoverable: false, showActivity: false, showPortfolio: true, expectedVersion: 2,
  })
  assert.equal(parsed.handle, 'new_handle')
  assert.equal(parsed.bio, 'hello')
  assert.throws(() => parseOwnProfileUpdate({ stats: { score: 9999 }, expectedVersion: 1 }), /unsupported profile fields/)
  assert.throws(() => parseOwnProfileUpdate({ role: 'admin', expectedVersion: 1 }), /unsupported profile fields/)
  assert.throws(() => parseOwnProfileUpdate({ skills: ['same', 'Same'], expectedVersion: 1 }), /duplicates/)
})

test('account deletion accepts only bounded machine-readable reason codes', () => {
  assert.deepEqual(parseAccountDeletionRequest({ expectedVersion: 1, reasonCode: 'owner_requested' }), { expectedVersion: 1, reasonCode: 'owner_requested' })
  assert.throws(() => parseAccountDeletionRequest({ expectedVersion: 1, reasonCode: 'please delete all my data' }), /machine-readable/)
  assert.throws(() => parseAccountDeletionRequest({ expectedVersion: 1, reasonCode: 'owner_requested', details: 'raw text' }), /unsupported account deletion fields/)
})

test('private profiles are owner-only and privacy settings redact public activity', () => {
  const profile = { userId: 'user-1', handle: 'owner', visibility: 'private', user: { status: 'active' } }
  assert.equal(canReadProfile({ profile }), false)
  assert.equal(canReadProfile({ profile, viewer: { id: 'user-1', handle: 'owner' } }), true)

  const publicProfile = { handle: 'owner', stats: { score: 10 }, reviews: ['great'], portfolio: [{ id: 'asset' }] }
  const redacted = projectProfileForViewer({
    profile: { ...profile, visibility: 'public', showActivity: false, showPortfolio: false },
    publicProfile,
  })
  assert.deepEqual(redacted.stats, {})
  assert.deepEqual(redacted.reviews, [])
  assert.deepEqual(redacted.portfolio, [])
})

test('account status exposes deletion scheduling without secret data', () => {
  const status = accountStatusDto({ status: 'active', accountVersion: 3, deletionRequestedAt: new Date('2026-07-18T00:00:00Z'), deletionScheduledAt: new Date('2026-08-17T00:00:00Z'), deletionReasonCode: 'owner_requested' })
  assert.equal(status.status, 'deletion_requested')
  assert.equal(status.version, 3)
  assert.equal(status.deletionReasonCode, 'owner_requested')
})
