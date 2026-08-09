const userSelect = { id: true, displayName: true, profile: { select: { handle: true } } }
const entryInclude = (viewerId = null) => ({
  category: true,
  author: { select: userSelect },
  _count: { select: { favorites: true, usageEvents: true } },
  ...(viewerId ? { favorites: { where: { userId: viewerId }, select: { userId: true } } } : {}),
})

const revisionSelect = (includeSnapshot = false) => ({
  id: true, version: true, status: true, reviewNote: true, reviewedAt: true, createdAt: true,
  ...(includeSnapshot ? { snapshot: true } : {}),
})

const revisionDto = (row) => ({
  id: row.id,
  version: row.version,
  status: row.status,
  reviewNote: row.reviewNote,
  reviewedAt: row.reviewedAt?.toISOString?.() ?? row.reviewedAt ?? null,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  ...(row.snapshot ? { snapshot: row.snapshot } : {}),
})

const dto = (row, viewerId = null) => {
  const revisions = row.revisions?.map(revisionDto)
  const pendingRevision = revisions?.find((revision) => revision.version > row.version && ['draft', 'pending_review', 'changes_requested', 'rejected'].includes(revision.status)) ?? null
  return ({
  id: row.id,
  title: row.title,
  summary: row.summary,
  problem: row.problem,
  audience: row.audience,
  contentType: row.contentType,
  category: row.category ? { id: row.category.id, slug: row.category.slug, nameEn: row.category.nameEn, nameZh: row.category.nameZh } : null,
  domains: row.domains,
  difficulty: row.difficulty,
  toolModels: row.toolModels,
  sourceKind: row.sourceKind,
  sourceAttribution: row.sourceAttribution,
  license: row.license,
  status: row.status,
  content: row.content,
  featured: row.featured,
  supportsTaskDraft: row.supportsTaskDraft,
  version: row.version,
  reviewNote: row.reviewNote,
  author: row.author ? { id: row.author.id, handle: row.author.profile?.handle ?? null, displayName: row.author.displayName } : null,
  favoriteCount: row._count?.favorites ?? 0,
  usageCount: row._count?.usageEvents ?? 0,
  favorited: viewerId ? Boolean(row.favorites?.length) : false,
  publishedAt: row.publishedAt?.toISOString?.() ?? row.publishedAt ?? null,
  createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
  updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  ...(revisions ? { revisions, pendingRevision } : {}),
  })
}

const snapshot = (entry) => ({
  title: entry.title, summary: entry.summary, problem: entry.problem, audience: entry.audience,
  categoryId: entry.categoryId, contentType: entry.contentType, domains: entry.domains,
  difficulty: entry.difficulty, toolModels: entry.toolModels, content: entry.content,
  sourceAttribution: entry.sourceAttribution, license: entry.license,
  featured: entry.featured, supportsTaskDraft: entry.supportsTaskDraft, sortOrder: entry.sortOrder,
})

const mergeSnapshot = (entry, payload) => snapshot({ ...entry, ...payload })

const entryDataFromSnapshot = (value, current) => ({
  title: value.title,
  summary: value.summary,
  problem: value.problem,
  audience: value.audience,
  categoryId: value.categoryId,
  contentType: value.contentType,
  domains: value.domains ?? [],
  difficulty: value.difficulty ?? 'beginner',
  toolModels: value.toolModels ?? [],
  content: value.content ?? {},
  sourceAttribution: value.sourceAttribution ?? null,
  license: value.license ?? null,
  featured: value.featured ?? current.featured,
  supportsTaskDraft: value.supportsTaskDraft ?? current.supportsTaskDraft,
  sortOrder: value.sortOrder ?? current.sortOrder,
})

export const createPrismaInspirationRepository = (client, { recordAudit }) => {
  const actorUser = (actor) => client.user.findUnique({ where: { id: String(actor.id) } })
  const list = async (options = {}, actor = null, own = false) => {
    const userId = actor?.id ? String(actor.id) : null
    const cursor = options.cursor ? await client.inspirationEntry.findUnique({ where: { id: String(options.cursor) }, select: { id: true } }) : null
    const rows = await client.inspirationEntry.findMany({
      where: {
        ...(own ? { authorId: userId } : { status: 'published' }),
        ...(options.status && own ? { status: options.status } : {}),
        ...(options.category ? { category: { slug: options.category } } : {}),
        ...(options.domain ? { domains: { has: options.domain } } : {}),
        ...(options.difficulty ? { difficulty: options.difficulty } : {}),
        ...(options.sourceKind ? { sourceKind: options.sourceKind } : {}),
        ...(options.featured ? { featured: true } : {}),
        ...(options.search ? { OR: [
          { title: { contains: options.search, mode: 'insensitive' } },
          { summary: { contains: options.search, mode: 'insensitive' } },
          { problem: { contains: options.search, mode: 'insensitive' } },
        ] } : {}),
      },
      include: { ...entryInclude(userId), ...(own ? { revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } : {}) },
      orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: (options.limit ?? 30) + 1,
      ...(cursor ? { cursor: { id: cursor.id }, skip: 1 } : {}),
    })
    const pageRows = rows.slice(0, options.limit ?? 30)
    return { items: pageRows.map((row) => dto(row, userId)), limit: options.limit ?? 30, nextCursor: rows.length > pageRows.length ? pageRows.at(-1)?.id ?? null : null }
  }
  const find = async (id, actor = null, allowOwn = false) => {
    const userId = actor?.id ? String(actor.id) : null
    const canReadOwn = allowOwn && Boolean(userId)
    const row = await client.inspirationEntry.findFirst({
      where: { id: String(id), ...(canReadOwn ? { OR: [{ status: 'published' }, { authorId: userId }] } : { status: 'published' }) },
      include: {
        ...entryInclude(userId),
        revisions: {
          ...(canReadOwn ? {} : { where: { status: 'published' } }),
          orderBy: { version: 'desc' },
          select: revisionSelect(canReadOwn),
        },
      },
    })
    return row ? dto(row, userId) : null
  }
  const create = async (payload, actor, official = false) => {
    const user = await actorUser(actor)
    if (!user) return null
    const status = official ? 'published' : 'draft'
    const row = await client.$transaction(async (db) => {
      const entry = await db.inspirationEntry.create({ data: {
        ...payload, authorId: user.id, createdById: user.id, sourceKind: official ? 'official' : 'user_submission', status,
        publishedAt: official ? new Date() : null,
      } })
      await db.inspirationRevision.create({ data: { entryId: entry.id, version: 1, status, snapshot: snapshot(entry), createdById: user.id } })
      return db.inspirationEntry.findUnique({ where: { id: entry.id }, include: entryInclude(user.id) })
    })
    await recordAudit({ actor, action: official ? 'inspiration.official_published' : 'inspiration.draft_created', resourceType: 'inspiration_entry', resourceId: row.id })
    return dto(row, user.id)
  }
  const updateOwn = async (id, payload, actor) => {
    const current = await client.inspirationEntry.findFirst({
      where: { id: String(id), authorId: String(actor.id), sourceKind: 'user_submission', status: { in: ['draft', 'changes_requested', 'rejected', 'published'] } },
      include: { revisions: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!current) return null
    if (current.status === 'published') {
      const nextVersion = current.version + 1
      const latest = current.revisions[0]
      if (latest?.version === nextVersion && !['draft', 'changes_requested', 'rejected'].includes(latest.status)) return null
      const existing = latest?.version === nextVersion ? latest : null
      const nextSnapshot = mergeSnapshot(existing?.snapshot ?? current, payload)
      await client.inspirationRevision.upsert({
        where: { entryId_version: { entryId: current.id, version: nextVersion } },
        create: { entryId: current.id, version: nextVersion, status: 'draft', snapshot: nextSnapshot, createdById: String(actor.id) },
        update: { status: 'draft', snapshot: nextSnapshot, reviewNote: null, reviewedById: null, reviewedAt: null },
      })
      const row = await client.inspirationEntry.findUnique({ where: { id: current.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
      await recordAudit({ actor, action: 'inspiration.revision_draft_updated', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: nextVersion } })
      return dto(row, String(actor.id))
    }
    const row = await client.$transaction(async (db) => {
      const entry = await db.inspirationEntry.update({ where: { id: current.id }, data: { ...payload, status: 'draft', reviewNote: null, version: { increment: 1 } } })
      await db.inspirationRevision.create({ data: { entryId: entry.id, version: entry.version, status: entry.status, snapshot: snapshot(entry), createdById: String(actor.id) } })
      return db.inspirationEntry.findUnique({ where: { id: entry.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
    })
    await recordAudit({ actor, action: 'inspiration.draft_updated', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: row.version } })
    return dto(row, String(actor.id))
  }
  const withdraw = async (id, actor) => {
    const current = await client.inspirationEntry.findFirst({ where: { id: String(id), authorId: String(actor.id), sourceKind: 'user_submission' } })
    if (!current) return null
    if (current.status === 'pending_review') {
      const row = await client.$transaction(async (db) => {
        await db.inspirationRevision.updateMany({ where: { entryId: current.id, version: current.version, status: 'pending_review' }, data: { status: 'draft', reviewNote: null } })
        return db.inspirationEntry.update({ where: { id: current.id }, data: { status: 'draft', reviewNote: null }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
      })
      await recordAudit({ actor, action: 'inspiration.submission_withdrawn', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: row.version } })
      return dto(row, String(actor.id))
    }
    if (current.status === 'published') {
      const revision = await client.inspirationRevision.findFirst({ where: { entryId: current.id, version: current.version + 1, status: 'pending_review' } })
      if (!revision) return null
      await client.inspirationRevision.update({ where: { id: revision.id }, data: { status: 'draft', reviewNote: null } })
      const row = await client.inspirationEntry.findUnique({ where: { id: current.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
      await recordAudit({ actor, action: 'inspiration.revision_withdrawn', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: revision.version } })
      return dto(row, String(actor.id))
    }
    return null
  }
  const submit = async (id, actor) => {
    const current = await client.inspirationEntry.findFirst({ where: { id: String(id), authorId: String(actor.id), sourceKind: 'user_submission' } })
    if (!current) return null
    if (current.status === 'published') {
      const revision = await client.inspirationRevision.findFirst({ where: { entryId: current.id, version: current.version + 1, status: { in: ['draft', 'changes_requested'] } } })
      if (!revision) return null
      await client.inspirationRevision.update({ where: { id: revision.id }, data: { status: 'pending_review', reviewNote: null } })
      const row = await client.inspirationEntry.findUnique({ where: { id: current.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
      await recordAudit({ actor, action: 'inspiration.revision_submitted', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: revision.version } })
      return dto(row, String(actor.id))
    }
    const updated = await client.inspirationEntry.updateMany({ where: { id: current.id, status: { in: ['draft', 'changes_requested'] } }, data: { status: 'pending_review', reviewNote: null } })
    if (!updated.count) return null
    await client.inspirationRevision.updateMany({ where: { entryId: current.id, version: current.version }, data: { status: 'pending_review' } })
    const row = await client.inspirationEntry.findUnique({ where: { id: current.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
    await recordAudit({ actor, action: 'inspiration.submitted', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: row.version } })
    return dto(row, String(actor.id))
  }
  const favorite = async (id, actor, active) => {
    const entry = await client.inspirationEntry.findFirst({ where: { id: String(id), status: 'published' }, select: { id: true } })
    if (!entry) return null
    if (active) await client.inspirationFavorite.upsert({ where: { entryId_userId: { entryId: entry.id, userId: String(actor.id) } }, create: { entryId: entry.id, userId: String(actor.id) }, update: {} })
    else await client.inspirationFavorite.deleteMany({ where: { entryId: entry.id, userId: String(actor.id) } })
    await recordAudit({ actor, action: active ? 'inspiration.favorited' : 'inspiration.unfavorited', resourceType: 'inspiration_entry', resourceId: entry.id })
    return find(entry.id, actor)
  }
  const favorites = async (options, actor) => {
    const rows = await client.inspirationFavorite.findMany({ where: { userId: String(actor.id), entry: { status: 'published' } }, include: { entry: { include: entryInclude(String(actor.id)) } }, orderBy: { createdAt: 'desc' }, take: options.limit ?? 100 })
    return { items: rows.map((row) => ({ ...dto(row.entry, String(actor.id)), favoritedAt: row.createdAt.toISOString() })), limit: options.limit ?? 100, nextCursor: null }
  }
  const removeFavorites = async (ids, actor) => {
    const result = await client.inspirationFavorite.deleteMany({ where: { userId: String(actor.id), entryId: { in: ids.map(String) } } })
    await recordAudit({ actor, action: 'inspiration.favorites_bulk_removed', resourceType: 'inspiration_favorite', resourceId: String(actor.id), metadata: { requestedCount: ids.length, removedCount: result.count } })
    return { removed: result.count, ids }
  }
  const use = async (id, actor) => {
    const row = await client.inspirationEntry.findFirst({ where: { id: String(id), status: 'published' }, include: entryInclude(String(actor.id)) })
    if (!row) return null
    await client.inspirationUsage.create({ data: { entryId: row.id, userId: String(actor.id), entryVersion: row.version, action: 'workspace_handoff', context: { contentType: row.contentType } } })
    await recordAudit({ actor, action: 'inspiration.sent_to_workspace', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: row.version } })
    return { item: dto(row, String(actor.id)), workspaceDraft: { title: row.title, seed: JSON.stringify({ problem: row.problem, audience: row.audience, ...row.content }), entryId: row.id, version: row.version } }
  }
  const adminList = async (options, actor) => {
    const where = options.status === 'pending_review'
      ? { OR: [{ status: 'pending_review' }, { revisions: { some: { status: 'pending_review' } } }] }
      : options.status ? { status: options.status } : {}
    const rows = await client.inspirationEntry.findMany({ where, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } }, orderBy: [{ updatedAt: 'desc' }], take: options.limit ?? 100 })
    return { items: rows.map((row) => dto(row, String(actor.id))), limit: options.limit ?? 100, nextCursor: null }
  }
  const adminFind = async (id, actor) => {
    const row = await client.inspirationEntry.findUnique({ where: { id: String(id) }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
    return row ? dto(row, String(actor.id)) : null
  }
  const updateAdmin = async (id, payload, actor) => {
    const current = await client.inspirationEntry.findUnique({ where: { id: String(id) }, include: { revisions: { where: { status: { in: ['draft', 'pending_review', 'changes_requested', 'rejected'] } }, select: { version: true } } } })
    if (!current || !['published', 'archived'].includes(current.status)) return null
    if (current.revisions.some((revision) => revision.version > current.version)) return null
    const row = await client.$transaction(async (db) => {
      const entry = await db.inspirationEntry.update({ where: { id: current.id }, data: { ...payload, version: { increment: 1 } } })
      await db.inspirationRevision.create({ data: { entryId: entry.id, version: entry.version, status: entry.status, snapshot: snapshot(entry), createdById: String(actor.id), reviewedById: String(actor.id), reviewedAt: new Date() } })
      return db.inspirationEntry.findUnique({ where: { id: entry.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
    })
    await recordAudit({ actor, action: 'inspiration.admin_updated', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: row.version } })
    return dto(row, String(actor.id))
  }
  const review = async (id, payload, actor) => {
    const current = await client.inspirationEntry.findFirst({ where: { id: String(id), sourceKind: 'user_submission' } })
    if (!current) return null
    const status = payload.decision === 'approve' ? 'published' : payload.decision === 'request_changes' ? 'changes_requested' : 'rejected'
    if (current.status === 'published') {
      const revision = await client.inspirationRevision.findFirst({ where: { entryId: current.id, version: current.version + 1, status: 'pending_review' } })
      if (!revision) return null
      const row = await client.$transaction(async (db) => {
        await db.inspirationRevision.update({ where: { id: revision.id }, data: { status, reviewNote: payload.note || null, reviewedById: String(actor.id), reviewedAt: new Date() } })
        if (status === 'published') {
          await db.inspirationEntry.update({ where: { id: current.id }, data: { ...entryDataFromSnapshot(revision.snapshot, current), version: revision.version, reviewNote: payload.note || null, reviewedById: String(actor.id) } })
        }
        return db.inspirationEntry.findUnique({ where: { id: current.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
      })
      await recordAudit({ actor, action: `inspiration.revision_review.${payload.decision}`, resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: revision.version, note: payload.note } })
      return dto(row, String(actor.id))
    }
    if (current.status !== 'pending_review') return null
    const row = await client.$transaction(async (db) => {
      const entry = await db.inspirationEntry.update({ where: { id: current.id }, data: { status, reviewNote: payload.note || null, reviewedById: String(actor.id), publishedAt: status === 'published' ? new Date() : null } })
      await db.inspirationRevision.updateMany({ where: { entryId: entry.id, version: entry.version }, data: { status, reviewNote: payload.note || null, reviewedById: String(actor.id), reviewedAt: new Date() } })
      return db.inspirationEntry.findUnique({ where: { id: entry.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
    })
    await recordAudit({ actor, action: `inspiration.review.${payload.decision}`, resourceType: 'inspiration_entry', resourceId: row.id, metadata: { version: row.version, note: payload.note } })
    return dto(row, String(actor.id))
  }
  const rollback = async (id, payload, actor) => {
    const current = await client.inspirationEntry.findUnique({ where: { id: String(id) }, include: { revisions: { where: { status: { in: ['draft', 'pending_review', 'changes_requested', 'rejected'] } }, select: { version: true } } } })
    if (!current) return null
    if (current.revisions.some((item) => item.version > current.version)) return null
    const revision = await client.inspirationRevision.findUnique({ where: { entryId_version: { entryId: current.id, version: payload.version } } })
    if (!revision) return null
    const nextVersion = current.version + 1
    const row = await client.$transaction(async (db) => {
      const entry = await db.inspirationEntry.update({ where: { id: current.id }, data: { ...entryDataFromSnapshot(revision.snapshot, current), status: 'published', version: nextVersion, reviewNote: payload.note, reviewedById: String(actor.id), archivedAt: null, publishedAt: current.publishedAt ?? new Date() } })
      await db.inspirationRevision.create({ data: { entryId: current.id, version: nextVersion, status: 'published', snapshot: snapshot(entry), reviewNote: payload.note, createdById: String(actor.id), reviewedById: String(actor.id), reviewedAt: new Date() } })
      return db.inspirationEntry.findUnique({ where: { id: current.id }, include: { ...entryInclude(String(actor.id)), revisions: { orderBy: { version: 'desc' }, select: revisionSelect(true) } } })
    })
    await recordAudit({ actor, action: 'inspiration.version_rolled_back', resourceType: 'inspiration_entry', resourceId: row.id, metadata: { sourceVersion: payload.version, version: nextVersion, note: payload.note } })
    return dto(row, String(actor.id))
  }
  const setArchived = async (id, actor, archived) => {
    const current = await client.inspirationEntry.findUnique({ where: { id: String(id) } })
    if (!current) return null
    const status = archived ? 'archived' : 'published'
    const row = await client.inspirationEntry.update({ where: { id: current.id }, data: { status, archivedAt: archived ? new Date() : null, publishedAt: archived ? current.publishedAt : current.publishedAt ?? new Date() }, include: entryInclude(String(actor.id)) })
    await recordAudit({ actor, action: archived ? 'inspiration.archived' : 'inspiration.restored', resourceType: 'inspiration_entry', resourceId: row.id })
    return dto(row, String(actor.id))
  }
  const createCategory = async (payload, actor) => {
    const category = await client.inspirationCategory.create({ data: payload })
    await recordAudit({ actor, action: 'inspiration.category_created', resourceType: 'inspiration_category', resourceId: category.id, metadata: { slug: category.slug, kind: category.kind } })
    return category
  }
  const updateCategory = async (id, payload, actor) => {
    const current = await client.inspirationCategory.findUnique({ where: { id: String(id) } })
    if (!current) return null
    const { replacementCategoryId, ...data } = payload
    const referenceWhere = current.kind === 'content_type'
      ? { categoryId: current.id }
      : current.kind === 'domain'
        ? { domains: { has: current.slug } }
        : { difficulty: current.slug }
    const referenceCount = await client.inspirationEntry.count({ where: referenceWhere })
    if (data.kind && data.kind !== current.kind && referenceCount > 0) return { conflict: 'replacement_invalid', referenceCount }
    let replacement = null
    if (data.active === false && referenceCount > 0) {
      if (!replacementCategoryId || replacementCategoryId === current.id) return { conflict: 'replacement_required', referenceCount }
      replacement = await client.inspirationCategory.findFirst({ where: { id: String(replacementCategoryId), active: true, kind: current.kind } })
      if (!replacement) return { conflict: 'replacement_invalid', referenceCount }
    }
    const category = await client.$transaction(async (db) => {
      const target = replacement ?? (data.slug && data.slug !== current.slug ? { id: current.id, slug: data.slug } : null)
      if (target && current.kind === 'content_type') await db.inspirationEntry.updateMany({ where: referenceWhere, data: { categoryId: target.id, contentType: target.slug } })
      if (target && current.kind === 'difficulty') await db.inspirationEntry.updateMany({ where: referenceWhere, data: { difficulty: target.slug } })
      if (target && current.kind === 'domain') {
        const rows = await db.inspirationEntry.findMany({ where: referenceWhere, select: { id: true, domains: true } })
        await Promise.all(rows.map((entry) => db.inspirationEntry.update({ where: { id: entry.id }, data: { domains: entry.domains.map((value) => value === current.slug ? target.slug : value) } })))
      }
      return db.inspirationCategory.update({ where: { id: current.id }, data })
    })
    await recordAudit({ actor, action: 'inspiration.category_updated', resourceType: 'inspiration_category', resourceId: category.id, metadata: { active: category.active, sortOrder: category.sortOrder, migratedEntries: replacement ? referenceCount : 0, replacementCategoryId: replacement?.id ?? null } })
    return category
  }
  return {
    categories: () => client.inspirationCategory.findMany({ where: { active: true }, orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] }),
    adminCategories: () => client.inspirationCategory.findMany({ orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] }),
    createCategory, updateCategory,
    list, find, create, updateOwn, submit, withdraw, mySubmissions: (options, actor) => list(options, actor, true), favorite, favorites, removeFavorites, use, adminList, adminFind, updateAdmin, review, rollback, setArchived,
  }
}
