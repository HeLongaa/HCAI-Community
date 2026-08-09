import assert from 'node:assert/strict'
import test from 'node:test'

import { getProfileDto } from './prismaTransforms.js'

test('getProfileDto fills the public profile contract for newly registered accounts', () => {
  const profile = getProfileDto({
    handle: 'newcreator',
    lane: 'both',
    bio: '',
    skills: [],
    languages: [],
    stats: {},
    metadata: {},
    user: { displayName: 'New Creator', role: 'member' },
  })

  assert.deepEqual(profile.name, { en: 'New Creator', zh: 'New Creator' })
  assert.deepEqual(profile.bio, { en: '', zh: '' })
  assert.deepEqual(profile.tags, [])
  assert.deepEqual(profile.languages, [])
  assert.equal(profile.stats.paid, '0')
  assert.equal(profile.stats.rank, 'New member')
})

test('getProfileDto preserves metadata while filling missing nested profile fields', () => {
  const profile = getProfileDto({
    handle: 'legacy',
    lane: 'maker',
    bio: 'Stored bio',
    skills: ['Prompting'],
    languages: ['EN'],
    stats: { score: 12 },
    metadata: { name: { en: 'Legacy' }, stats: { completed: 3 } },
    user: { displayName: 'Legacy User', role: 'creator' },
  })

  assert.deepEqual(profile.name, { en: 'Legacy', zh: 'Legacy' })
  assert.deepEqual(profile.bio, { en: 'Stored bio', zh: 'Stored bio' })
  assert.equal(profile.stats.score, 12)
  assert.equal(profile.stats.completed, 3)
  assert.equal(profile.stats.paid, '0')
})
