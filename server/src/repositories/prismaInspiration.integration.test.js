import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

const databaseUrl = process.env.FOUNDATION_DATABASE_URL
  ?? (process.env.INSPIRATION_DATABASE_INTEGRATION_ENABLED === 'true' ? process.env.DATABASE_URL : null)

const entryPayload = (category, suffix, taxonomy = {}) => ({
  title: `PostgreSQL inspiration ${suffix}`,
  summary: 'A real PostgreSQL integration resource.',
  problem: 'Verify the complete inspiration publication and revision lifecycle.',
  audience: 'Product and content operations teams.',
  categoryId: category.id,
  contentType: category.slug,
  domains: [taxonomy.domain ?? 'automation'],
  difficulty: taxonomy.difficulty ?? 'intermediate',
  toolModels: ['workflow'],
  content: { prerequisites: ['Database available'], steps: ['Create', 'Review', 'Publish'], inputs: ['Draft'], outputs: ['Published resource'], examples: [], mistakes: [] },
  sourceAttribution: 'HCAI PostgreSQL integration test',
  license: 'Original test fixture',
})

test('Prisma inspiration supports review, revisions, favorites, rollback, and category migration', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl
  process.env.DEMO_DATABASE_AUTOSEED = 'false'
  const { createPrismaRepository } = await import('./prismaRepository.js')
  const repository = await createPrismaRepository()
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const authorSession = await repository.auth.registerEmailAccount({ email: `inspiration-author-${suffix}@example.test`, password: 'Inspiration-Integration-42', displayName: 'Inspiration Author', handle: `ia${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}` })
  const readerSession = await repository.auth.registerEmailAccount({ email: `inspiration-reader-${suffix}@example.test`, password: 'Inspiration-Integration-42', displayName: 'Inspiration Reader', handle: `ir${suffix.replaceAll(/[^a-z0-9]/gi, '').slice(-20)}` })
  const author = authorSession.user
  const reader = readerSession.user
  const categoryIds = []
  const entryIds = []
  try {
    const sourceCategory = await repository.inspiration.createCategory({ kind: 'content_type', slug: `workflow-${suffix}`, nameEn: 'Integration workflow', nameZh: '集成工作流', description: null, sortOrder: 900 }, author)
    const replacementCategory = await repository.inspiration.createCategory({ kind: 'content_type', slug: `skill-${suffix}`, nameEn: 'Integration skill', nameZh: '集成 Skill', description: null, sortOrder: 910 }, author)
    const sourceDomain = await repository.inspiration.createCategory({ kind: 'domain', slug: `domain-${suffix}`, nameEn: 'Integration domain', nameZh: '集成领域', description: null, sortOrder: 920 }, author)
    const replacementDomain = await repository.inspiration.createCategory({ kind: 'domain', slug: `domain-replacement-${suffix}`, nameEn: 'Replacement domain', nameZh: '替换领域', description: null, sortOrder: 930 }, author)
    const sourceDifficulty = await repository.inspiration.createCategory({ kind: 'difficulty', slug: `difficulty-${suffix}`, nameEn: 'Integration difficulty', nameZh: '集成难度', description: null, sortOrder: 940 }, author)
    const replacementDifficulty = await repository.inspiration.createCategory({ kind: 'difficulty', slug: `difficulty-replacement-${suffix}`, nameEn: 'Replacement difficulty', nameZh: '替换难度', description: null, sortOrder: 950 }, author)
    categoryIds.push(sourceCategory.id, replacementCategory.id, sourceDomain.id, replacementDomain.id, sourceDifficulty.id, replacementDifficulty.id)

    const draft = await repository.inspiration.create(entryPayload(sourceCategory, suffix, { domain: sourceDomain.slug, difficulty: sourceDifficulty.slug }), author, false)
    entryIds.push(draft.id)
    assert.equal(draft.status, 'draft')
    assert.equal((await repository.inspiration.list({ limit: 20 })).items.some((item) => item.id === draft.id), false)

    assert.equal((await repository.inspiration.submit(draft.id, author)).status, 'pending_review')
    assert.equal((await repository.inspiration.withdraw(draft.id, author)).status, 'draft')
    await repository.inspiration.submit(draft.id, author)
    const published = await repository.inspiration.review(draft.id, { decision: 'approve', note: 'Initial version reviewed.' }, reader)
    assert.equal(published.status, 'published')
    assert.equal(published.version, 1)

    await repository.inspiration.favorite(draft.id, reader, true)
    assert.equal(typeof (await repository.inspiration.favorites({ limit: 20 }, reader)).items[0].favoritedAt, 'string')
    const handoff = await repository.inspiration.use(draft.id, reader)
    assert.equal(handoff.workspaceDraft.version, 1)
    assert.equal(handoff.workspaceDraft.entryId, draft.id)

    const revisionDraft = await repository.inspiration.updateOwn(draft.id, { title: `PostgreSQL revised ${suffix}` }, author)
    assert.equal(revisionDraft.version, 1)
    assert.equal(revisionDraft.pendingRevision.version, 2)
    await repository.inspiration.submit(draft.id, author)
    const stillPublic = await repository.inspiration.find(draft.id)
    assert.equal(stillPublic.version, 1)
    assert.equal(stillPublic.title, published.title)
    assert.equal(stillPublic.pendingRevision, null)
    assert.equal(stillPublic.revisions.some((revision) => revision.status === 'pending_review'), false)

    const revised = await repository.inspiration.review(draft.id, { decision: 'approve', note: 'Revision reviewed.' }, reader)
    assert.equal(revised.version, 2)
    assert.equal(revised.title, `PostgreSQL revised ${suffix}`)
    const adminEdited = await repository.inspiration.updateAdmin(draft.id, { summary: 'Administrator-approved wording.' }, reader)
    assert.equal(adminEdited.version, 3)
    const rolledBack = await repository.inspiration.rollback(draft.id, { version: 1, note: 'Integration rollback.' }, reader)
    assert.equal(rolledBack.version, 4)
    assert.equal(rolledBack.title, published.title)

    const migrated = await repository.inspiration.updateCategory(sourceCategory.id, { active: false, replacementCategoryId: replacementCategory.id }, reader)
    assert.equal(migrated.active, false)
    assert.equal((await repository.inspiration.find(draft.id)).category.id, replacementCategory.id)
    await repository.inspiration.updateCategory(sourceDomain.id, { active: false, replacementCategoryId: replacementDomain.id }, reader)
    await repository.inspiration.updateCategory(sourceDifficulty.id, { active: false, replacementCategoryId: replacementDifficulty.id }, reader)
    const taxonomyMigrated = await repository.inspiration.find(draft.id)
    assert.deepEqual(taxonomyMigrated.domains, [replacementDomain.slug])
    assert.equal(taxonomyMigrated.difficulty, replacementDifficulty.slug)

    const removed = await repository.inspiration.removeFavorites([draft.id], reader)
    assert.equal(removed.removed, 1)
    assert.equal((await repository.inspiration.favorites({ limit: 20 }, reader)).items.length, 0)
  } finally {
    await repository.client.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'")
      await transaction.inspirationUsage.deleteMany({ where: { entryId: { in: entryIds } } })
      await transaction.inspirationFavorite.deleteMany({ where: { entryId: { in: entryIds } } })
      await transaction.inspirationRevision.deleteMany({ where: { entryId: { in: entryIds } } })
      await transaction.inspirationEntry.deleteMany({ where: { id: { in: entryIds } } })
      await transaction.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: [author.id, reader.id] } }, { resourceId: { in: [...entryIds, ...categoryIds] } }] } })
      await transaction.inspirationCategory.deleteMany({ where: { id: { in: categoryIds } } })
      await transaction.user.deleteMany({ where: { id: { in: [author.id, reader.id] } } })
    })
    await repository.client.$disconnect()
  }
})
