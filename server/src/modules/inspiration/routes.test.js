import assert from 'node:assert/strict'
import test from 'node:test'

import { createInjectedRouteTestServer, requestJson } from '../../common/testing/httpTestClient.js'
import { createSeedRepository } from '../../repositories/seedRepository.js'
import { registerInspirationRoutes } from './routes.js'

const requestBody = (overrides = {}) => ({
  title: 'Editorial image review workflow',
  summary: 'A repeatable review sequence for image generation projects.',
  problem: 'Teams need consistent checks before publishing generated images.',
  audience: 'Creative leads and image generation operators.',
  categoryId: 'inspiration-category-workflows',
  contentType: 'workflows',
  domains: ['image'],
  difficulty: 'intermediate',
  toolModels: ['image-generation'],
  content: {
    prerequisites: ['A clear creative brief'],
    steps: ['Review the brief', 'Generate candidates', 'Check rights and quality'],
    inputs: ['Creative brief'],
    outputs: ['Approved image set'],
    examples: [],
    mistakes: ['Publishing before the rights review'],
  },
  sourceAttribution: 'HCAI editorial workflow',
  license: 'Original contribution',
  ...overrides,
})

const createServer = async () => {
  const repository = createSeedRepository()
  return createInjectedRouteTestServer(repository, (router) => registerInspirationRoutes(router, { repositories: repository }))
}

test('official content is public and another user can favorite and use it', async () => {
  const server = await createServer()
  try {
    const created = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ featured: true }) })
    assert.equal(created.status, 201)
    assert.equal(created.payload.data.status, 'published')
    assert.equal(created.payload.data.sourceKind, 'official')

    const publicList = await requestJson(server.url, '/api/inspiration', { method: 'GET' })
    assert.equal(publicList.status, 200)
    assert.equal(publicList.payload.data.length, 1)

    const favorite = await requestJson(server.url, `/api/inspiration/${created.payload.data.id}/favorite`, { token: 'demo-access.promptlin' })
    assert.equal(favorite.status, 200)
    assert.equal(favorite.payload.data.favorited, true)
    assert.equal(favorite.payload.data.favoriteCount, 1)
    const favorites = await requestJson(server.url, '/api/inspiration/favorites/mine', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(typeof favorites.payload.data[0].favoritedAt, 'string')

    const workspace = await requestJson(server.url, `/api/inspiration/${created.payload.data.id}/use`, { token: 'demo-access.promptlin' })
    assert.equal(workspace.status, 200)
    assert.equal(workspace.payload.data.workspaceDraft.entryId, created.payload.data.id)
    assert.equal(workspace.payload.data.workspaceDraft.version, 1)
  } finally {
    await server.close()
  }
})

test('user submission remains private until an administrator approves it', async () => {
  const server = await createServer()
  try {
    const draft = await requestJson(server.url, '/api/inspiration/submissions', { token: 'demo-access.promptlin', body: requestBody({ title: 'Community review method' }) })
    assert.equal(draft.status, 201)
    assert.equal(draft.payload.data.status, 'draft')
    assert.equal(draft.payload.data.sourceKind, 'user_submission')

    const beforeSubmit = await requestJson(server.url, '/api/inspiration', { method: 'GET' })
    assert.equal(beforeSubmit.payload.data.length, 0)

    const submitted = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    assert.equal(submitted.status, 200)
    assert.equal(submitted.payload.data.status, 'pending_review')

    const forbiddenReview = await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.promptlin', body: { decision: 'approve', note: '' } })
    assert.equal(forbiddenReview.status, 403)

    const approved = await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.opsplus', body: { decision: 'approve', note: 'Content and source reviewed.' } })
    assert.equal(approved.status, 200)
    assert.equal(approved.payload.data.status, 'published')

    const afterApproval = await requestJson(server.url, '/api/inspiration', { method: 'GET' })
    assert.equal(afterApproval.payload.data.length, 1)
    assert.equal(afterApproval.payload.data[0].title, 'Community review method')
  } finally {
    await server.close()
  }
})

test('reviewer can request changes and the author can revise and resubmit', async () => {
  const server = await createServer()
  try {
    const draft = await requestJson(server.url, '/api/inspiration/submissions', { token: 'demo-access.promptlin', body: requestBody() })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    const changes = await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.opsplus', body: { decision: 'request_changes', note: 'Add a concrete output example.' } })
    assert.equal(changes.payload.data.status, 'changes_requested')
    assert.equal(changes.payload.data.reviewNote, 'Add a concrete output example.')

    const revised = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}`, { method: 'PATCH', token: 'demo-access.promptlin', body: { content: { ...requestBody().content, examples: ['Three reviewed image candidates'] } } })
    assert.equal(revised.status, 200)
    assert.equal(revised.payload.data.status, 'draft')
    assert.equal(revised.payload.data.version, 2)

    const resubmitted = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    assert.equal(resubmitted.payload.data.status, 'pending_review')
  } finally {
    await server.close()
  }
})

test('author can withdraw a pending submission without publishing it', async () => {
  const server = await createServer()
  try {
    const draft = await requestJson(server.url, '/api/inspiration/submissions', { token: 'demo-access.promptlin', body: requestBody({ title: 'Withdrawn method' }) })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })

    const withdrawn = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/withdraw`, { token: 'demo-access.promptlin' })
    assert.equal(withdrawn.status, 200)
    assert.equal(withdrawn.payload.data.status, 'draft')

    const publicList = await requestJson(server.url, '/api/inspiration', { method: 'GET' })
    assert.equal(publicList.payload.data.some((item) => item.id === draft.payload.data.id), false)
  } finally {
    await server.close()
  }
})

test('published user content stays public while a new version is reviewed', async () => {
  const server = await createServer()
  try {
    const draft = await requestJson(server.url, '/api/inspiration/submissions', { token: 'demo-access.promptlin', body: requestBody({ title: 'Stable published title' }) })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.opsplus', body: { decision: 'approve', note: '' } })

    const revisionDraft = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}`, {
      method: 'PATCH', token: 'demo-access.promptlin', body: { title: 'Pending revised title' },
    })
    assert.equal(revisionDraft.status, 200)
    assert.equal(revisionDraft.payload.data.status, 'published')
    assert.equal(revisionDraft.payload.data.version, 1)
    assert.equal(revisionDraft.payload.data.pendingRevision.version, 2)
    assert.equal(revisionDraft.payload.data.pendingRevision.snapshot.title, 'Pending revised title')

    const submitted = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    assert.equal(submitted.payload.data.pendingRevision.status, 'pending_review')

    const publicBeforeReview = await requestJson(server.url, `/api/inspiration/${draft.payload.data.id}`, { method: 'GET' })
    assert.equal(publicBeforeReview.payload.data.title, 'Stable published title')
    assert.equal(publicBeforeReview.payload.data.version, 1)
    assert.equal(publicBeforeReview.payload.data.pendingRevision, undefined)
    assert.equal(publicBeforeReview.payload.data.revisions.some((revision) => revision.status === 'pending_review'), false)

    const reviewQueue = await requestJson(server.url, '/api/admin/inspiration?status=pending_review', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(reviewQueue.payload.data.length, 1)
    assert.equal(reviewQueue.payload.data[0].pendingRevision.snapshot.title, 'Pending revised title')

    const approved = await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.opsplus', body: { decision: 'approve', note: 'Revision reviewed.' } })
    assert.equal(approved.payload.data.title, 'Pending revised title')
    assert.equal(approved.payload.data.version, 2)
    assert.equal(approved.payload.data.pendingRevision, null)
  } finally {
    await server.close()
  }
})

test('published revision can be changed, withdrawn, and resubmitted', async () => {
  const server = await createServer()
  try {
    const draft = await requestJson(server.url, '/api/inspiration/submissions', { token: 'demo-access.promptlin', body: requestBody({ title: 'Revision lifecycle' }) })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.opsplus', body: { decision: 'approve', note: '' } })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}`, { method: 'PATCH', token: 'demo-access.promptlin', body: { summary: 'A revised summary for review.' } })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })

    const changes = await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.opsplus', body: { decision: 'request_changes', note: 'Clarify the audience.' } })
    assert.equal(changes.payload.data.status, 'published')
    assert.equal(changes.payload.data.pendingRevision.status, 'changes_requested')
    assert.equal(changes.payload.data.pendingRevision.reviewNote, 'Clarify the audience.')

    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}`, { method: 'PATCH', token: 'demo-access.promptlin', body: { audience: 'Creative teams with a reviewer.' } })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    const withdrawn = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/withdraw`, { token: 'demo-access.promptlin' })
    assert.equal(withdrawn.payload.data.status, 'published')
    assert.equal(withdrawn.payload.data.pendingRevision.status, 'draft')
  } finally {
    await server.close()
  }
})

test('administrator can edit, inspect history, and roll back content', async () => {
  const server = await createServer()
  try {
    const created = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ title: 'Version one' }) })
    const edited = await requestJson(server.url, `/api/admin/inspiration/${created.payload.data.id}`, { method: 'PATCH', token: 'demo-access.opsplus', body: { title: 'Version two' } })
    assert.equal(edited.status, 200)
    assert.equal(edited.payload.data.version, 2)
    assert.equal(edited.payload.data.revisions.length, 2)

    const forbidden = await requestJson(server.url, `/api/admin/inspiration/${created.payload.data.id}`, { method: 'PATCH', token: 'demo-access.promptlin', body: { title: 'Forbidden edit' } })
    assert.equal(forbidden.status, 403)

    const rolledBack = await requestJson(server.url, `/api/admin/inspiration/${created.payload.data.id}/rollback`, { token: 'demo-access.opsplus', body: { version: 1, note: 'Restore the approved wording.' } })
    assert.equal(rolledBack.status, 200)
    assert.equal(rolledBack.payload.data.title, 'Version one')
    assert.equal(rolledBack.payload.data.version, 3)
    assert.equal(rolledBack.payload.data.revisions.length, 3)
  } finally {
    await server.close()
  }
})

test('favorites can be removed in a user-scoped batch', async () => {
  const server = await createServer()
  try {
    const first = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ title: 'Favorite one' }) })
    const second = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ title: 'Favorite two' }) })
    await requestJson(server.url, `/api/inspiration/${first.payload.data.id}/favorite`, { token: 'demo-access.promptlin' })
    await requestJson(server.url, `/api/inspiration/${second.payload.data.id}/favorite`, { token: 'demo-access.promptlin' })

    const removed = await requestJson(server.url, '/api/inspiration/favorites', { method: 'DELETE', token: 'demo-access.promptlin', body: { ids: [first.payload.data.id, second.payload.data.id] } })
    assert.equal(removed.status, 200)
    assert.equal(removed.payload.data.removed, 2)

    const favorites = await requestJson(server.url, '/api/inspiration/favorites/mine', { method: 'GET', token: 'demo-access.promptlin' })
    assert.equal(favorites.payload.data.length, 0)
  } finally {
    await server.close()
  }
})

test('referenced category must migrate before it can be deactivated', async () => {
  const server = await createServer()
  try {
    const created = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody() })
    const conflict = await requestJson(server.url, '/api/admin/inspiration/categories/inspiration-category-workflows', { method: 'PATCH', token: 'demo-access.opsplus', body: { active: false } })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.payload.error.code, 'CATEGORY_MIGRATION_REQUIRED')

    const migrated = await requestJson(server.url, '/api/admin/inspiration/categories/inspiration-category-workflows', { method: 'PATCH', token: 'demo-access.opsplus', body: { active: false, replacementCategoryId: 'inspiration-category-skills', sortOrder: 99 } })
    assert.equal(migrated.status, 200)
    assert.equal(migrated.payload.data.active, false)
    assert.equal(migrated.payload.data.sortOrder, 99)

    const publicEntry = await requestJson(server.url, `/api/inspiration/${created.payload.data.id}`, { method: 'GET' })
    assert.equal(publicEntry.payload.data.category.id, 'inspiration-category-skills')
    assert.equal(publicEntry.payload.data.contentType, 'skills')

    const categories = await requestJson(server.url, '/api/inspiration/categories', { method: 'GET' })
    assert.equal(categories.payload.data.some((category) => category.id === 'inspiration-category-workflows'), false)
    const adminCategories = await requestJson(server.url, '/api/admin/inspiration/categories', { method: 'GET', token: 'demo-access.opsplus' })
    assert.equal(adminCategories.payload.data.some((category) => category.id === 'inspiration-category-workflows' && !category.active), true)
  } finally {
    await server.close()
  }
})

test('domains and difficulty must reference active managed categories', async () => {
  const server = await createServer()
  try {
    const unknownDomain = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ domains: ['not-configured'] }) })
    assert.equal(unknownDomain.status, 400)
    assert.match(unknownDomain.payload.error.message, /domains contains an inactive or unknown value/)

    const unknownDifficulty = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ difficulty: 'expert-plus' }) })
    assert.equal(unknownDifficulty.status, 400)
    assert.match(unknownDifficulty.payload.error.message, /difficulty is inactive or unknown/)

    const mismatchedType = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ contentType: 'forged-type' }) })
    assert.equal(mismatchedType.status, 201)
    assert.equal(mismatchedType.payload.data.contentType, 'workflows')
  } finally {
    await server.close()
  }
})

test('referenced domain and difficulty migrate before managed categories are deactivated', async () => {
  const server = await createServer()
  try {
    const created = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody({ domains: ['image'], difficulty: 'intermediate' }) })

    const domainConflict = await requestJson(server.url, '/api/admin/inspiration/categories/inspiration-domain-image', { method: 'PATCH', token: 'demo-access.opsplus', body: { active: false } })
    assert.equal(domainConflict.status, 409)
    const migratedDomain = await requestJson(server.url, '/api/admin/inspiration/categories/inspiration-domain-image', { method: 'PATCH', token: 'demo-access.opsplus', body: { active: false, replacementCategoryId: 'inspiration-domain-video' } })
    assert.equal(migratedDomain.status, 200)

    const difficultyConflict = await requestJson(server.url, '/api/admin/inspiration/categories/inspiration-difficulty-intermediate', { method: 'PATCH', token: 'demo-access.opsplus', body: { active: false } })
    assert.equal(difficultyConflict.status, 409)
    const migratedDifficulty = await requestJson(server.url, '/api/admin/inspiration/categories/inspiration-difficulty-intermediate', { method: 'PATCH', token: 'demo-access.opsplus', body: { active: false, replacementCategoryId: 'inspiration-difficulty-professional' } })
    assert.equal(migratedDifficulty.status, 200)

    const entry = await requestJson(server.url, `/api/inspiration/${created.payload.data.id}`, { method: 'GET' })
    assert.deepEqual(entry.payload.data.domains, ['video'])
    assert.equal(entry.payload.data.difficulty, 'professional')
  } finally {
    await server.close()
  }
})

test('rejected submission can be revised and submitted again', async () => {
  const server = await createServer()
  try {
    const draft = await requestJson(server.url, '/api/inspiration/submissions', { token: 'demo-access.promptlin', body: requestBody({ title: 'Rejected then revised' }) })
    await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    const rejected = await requestJson(server.url, `/api/admin/inspiration/${draft.payload.data.id}/review`, { token: 'demo-access.opsplus', body: { decision: 'reject', note: 'The source needs clarification.' } })
    assert.equal(rejected.payload.data.status, 'rejected')

    const revised = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}`, { method: 'PATCH', token: 'demo-access.promptlin', body: { sourceAttribution: 'Author-created workflow with original examples.' } })
    assert.equal(revised.status, 200)
    assert.equal(revised.payload.data.status, 'draft')

    const resubmitted = await requestJson(server.url, `/api/inspiration/submissions/${draft.payload.data.id}/submit`, { token: 'demo-access.promptlin' })
    assert.equal(resubmitted.payload.data.status, 'pending_review')
  } finally {
    await server.close()
  }
})

test('category slug changes stay synchronized with referenced entries', async () => {
  const server = await createServer()
  try {
    const created = await requestJson(server.url, '/api/admin/inspiration', { token: 'demo-access.opsplus', body: requestBody() })
    const updatedCategory = await requestJson(server.url, '/api/admin/inspiration/categories/inspiration-category-workflows', { method: 'PATCH', token: 'demo-access.opsplus', body: { slug: 'review-workflows', nameZh: '审核工作流' } })
    assert.equal(updatedCategory.status, 200)
    assert.equal(updatedCategory.payload.data.slug, 'review-workflows')

    const publicEntry = await requestJson(server.url, `/api/inspiration/${created.payload.data.id}`, { method: 'GET' })
    assert.equal(publicEntry.payload.data.category.slug, 'review-workflows')
    assert.equal(publicEntry.payload.data.contentType, 'review-workflows')
  } finally {
    await server.close()
  }
})
